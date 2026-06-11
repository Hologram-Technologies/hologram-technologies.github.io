//! **CC-16 (browser) — the WebSocket egress transport.**
//!
//! The userspace TCP/IP NAT (`holospaces::emulator::net`) runs in the browser
//! peer with the rest of the emulator, but there is no raw NIC behind a tab — so
//! the guest's TCP *payload* streams are tunnelled out over a **WebSocket to a
//! relay** (ADR-014). This is the browser implementation of the
//! [`Egress`](holospaces::emulator::net::Egress) seam; natively the same NAT
//! talks to a host socket instead. The relay is the egress *gateway* — a
//! content-blind TCP-over-WebSocket proxy, the network analogue of the Pages
//! cold-start gateway.
//!
//! A tiny binary framing multiplexes every guest TCP connection over the one
//! WebSocket, keyed by an opaque connection id:
//!
//! | dir | opcode | body |
//! |-----|--------|------|
//! | →relay | `0x01` OPEN  | id(4) ip(4) port(2) |
//! | →relay | `0x02` DATA  | id(4) bytes… |
//! | →relay | `0x03` CLOSE | id(4) |
//! | ←relay | `0x11` OPENED | id(4) |
//! | ←relay | `0x12` DATA   | id(4) bytes… |
//! | ←relay | `0x13` CLOSED | id(4) |
//! | ←relay | `0x14` FAILED | id(4) |
//!
//! The NAT polls this egress synchronously; the WebSocket's callbacks fill the
//! per-connection inbound buffers between emulator run-chunks (the browser's
//! cooperative event loop), exactly as a host socket's bytes arrive between
//! polls natively.

use std::cell::RefCell;
use std::collections::{BTreeMap, VecDeque};
use std::rc::Rc;

use holospaces::emulator::net::{Egress, EgressStatus};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{BinaryType, MessageEvent, WebSocket};

const OP_OPEN: u8 = 0x01;
const OP_DATA: u8 = 0x02;
const OP_CLOSE: u8 = 0x03;
const OP_OPENED: u8 = 0x11;
const OP_RDATA: u8 = 0x12;
const OP_CLOSED: u8 = 0x13;
const OP_FAILED: u8 = 0x14;

/// Per-connection state the NAT polls.
struct ConnState {
    status: EgressStatus,
    inbound: VecDeque<u8>,
}

/// State shared between the [`WsEgress`] (polled by the NAT) and the WebSocket
/// callbacks (which deliver host-side bytes and connection events).
struct Shared {
    ws: WebSocket,
    conns: BTreeMap<u32, ConnState>,
    /// Frames queued before the socket is open (flushed by the `onopen` handler).
    outbound: Vec<Vec<u8>>,
    open: bool,
}

impl Shared {
    fn send_frame(&mut self, frame: Vec<u8>) {
        if self.open {
            let _ = self.ws.send_with_u8_array(&frame);
        } else {
            self.outbound.push(frame);
        }
    }
}

/// The browser egress: tunnels the NAT's TCP streams over one WebSocket to a
/// relay. Holds the shared state and keeps the WebSocket callbacks alive for the
/// connection's lifetime.
pub struct WsEgress {
    shared: Rc<RefCell<Shared>>,
    next_id: u32,
    _onopen: Closure<dyn FnMut(JsValue)>,
    _onmessage: Closure<dyn FnMut(MessageEvent)>,
    _onclose: Closure<dyn FnMut(JsValue)>,
}

impl WsEgress {
    /// Open the egress WebSocket to the relay at `url` (e.g.
    /// `ws://127.0.0.1:9000`). The socket connects asynchronously; connections
    /// the NAT opens before it is ready are buffered and flushed on open.
    pub fn connect_relay(url: &str) -> Result<WsEgress, JsValue> {
        let ws = WebSocket::new(url)?;
        ws.set_binary_type(BinaryType::Arraybuffer);
        let shared = Rc::new(RefCell::new(Shared {
            ws: ws.clone(),
            conns: BTreeMap::new(),
            outbound: Vec::new(),
            open: false,
        }));

        // onopen: flush whatever the NAT queued while connecting.
        let s_open = shared.clone();
        let onopen = Closure::wrap(Box::new(move |_e: JsValue| {
            let mut s = s_open.borrow_mut();
            s.open = true;
            let frames = core::mem::take(&mut s.outbound);
            for f in frames {
                let _ = s.ws.send_with_u8_array(&f);
            }
        }) as Box<dyn FnMut(JsValue)>);
        ws.set_onopen(Some(onopen.as_ref().unchecked_ref()));

        // onmessage: a relay frame — deliver host bytes / connection events into
        // the per-connection state the NAT polls.
        let s_msg = shared.clone();
        let onmessage = Closure::wrap(Box::new(move |e: MessageEvent| {
            let buf = js_sys::Uint8Array::new(&e.data()).to_vec();
            if buf.len() < 5 {
                return;
            }
            let op = buf[0];
            let id = u32::from_be_bytes([buf[1], buf[2], buf[3], buf[4]]);
            let mut s = s_msg.borrow_mut();
            match op {
                OP_OPENED => {
                    if let Some(c) = s.conns.get_mut(&id) {
                        c.status = EgressStatus::Open;
                    }
                }
                OP_RDATA => {
                    if let Some(c) = s.conns.get_mut(&id) {
                        c.inbound.extend(&buf[5..]);
                    }
                }
                OP_CLOSED | OP_FAILED => {
                    if let Some(c) = s.conns.get_mut(&id) {
                        c.status = EgressStatus::Closed;
                    }
                }
                _ => {}
            }
        }) as Box<dyn FnMut(MessageEvent)>);
        ws.set_onmessage(Some(onmessage.as_ref().unchecked_ref()));

        // onclose: the tunnel is gone — every connection is closed.
        let s_close = shared.clone();
        let onclose = Closure::wrap(Box::new(move |_e: JsValue| {
            let mut s = s_close.borrow_mut();
            s.open = false;
            for c in s.conns.values_mut() {
                c.status = EgressStatus::Closed;
            }
        }) as Box<dyn FnMut(JsValue)>);
        ws.set_onclose(Some(onclose.as_ref().unchecked_ref()));

        Ok(WsEgress {
            shared,
            next_id: 1,
            _onopen: onopen,
            _onmessage: onmessage,
            _onclose: onclose,
        })
    }
}

impl Egress for WsEgress {
    fn connect(&mut self, ip: [u8; 4], port: u16) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        let mut s = self.shared.borrow_mut();
        s.conns.insert(
            id,
            ConnState {
                status: EgressStatus::Connecting,
                inbound: VecDeque::new(),
            },
        );
        let mut frame = Vec::with_capacity(11);
        frame.push(OP_OPEN);
        frame.extend_from_slice(&id.to_be_bytes());
        frame.extend_from_slice(&ip);
        frame.extend_from_slice(&port.to_be_bytes());
        s.send_frame(frame);
        id
    }

    fn status(&mut self, id: u32) -> EgressStatus {
        self.shared
            .borrow()
            .conns
            .get(&id)
            .map_or(EgressStatus::Closed, |c| c.status)
    }

    fn recv(&mut self, id: u32) -> Vec<u8> {
        let mut s = self.shared.borrow_mut();
        match s.conns.get_mut(&id) {
            Some(c) => c.inbound.drain(..).collect(),
            None => Vec::new(),
        }
    }

    fn send(&mut self, id: u32, data: &[u8]) {
        let mut s = self.shared.borrow_mut();
        if matches!(
            s.conns.get(&id).map(|c| c.status),
            Some(EgressStatus::Closed)
        ) {
            return;
        }
        let mut frame = Vec::with_capacity(5 + data.len());
        frame.push(OP_DATA);
        frame.extend_from_slice(&id.to_be_bytes());
        frame.extend_from_slice(data);
        s.send_frame(frame);
    }

    fn close(&mut self, id: u32) {
        let mut s = self.shared.borrow_mut();
        if let Some(c) = s.conns.get_mut(&id) {
            c.status = EgressStatus::Closed;
        }
        let mut frame = Vec::with_capacity(5);
        frame.push(OP_CLOSE);
        frame.extend_from_slice(&id.to_be_bytes());
        s.send_frame(frame);
    }
}
