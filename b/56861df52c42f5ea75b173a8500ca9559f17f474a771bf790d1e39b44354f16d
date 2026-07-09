// holo-onion-smux2-session.mjs — Component B / B1b part 2: the smux **v2 client** session state machine,
// faithful to xtaci/smux v1.5.57 (the lib the Snowflake bridge runs). Browser-pure: no Node APIs — the
// transport is injected (`send(bytes)` out, `feed(bytes)` in), so the SAME module drives a WebRTC DataChannel
// on the deployed github.io/Q site and a TCP socket in the Node interop test. The browser is always the CLIENT
// (odd stream ids); the bridge is the server.
//
// v2 per-stream sliding-window flow control (the part v1 lacks and that silently stalls if wrong):
//   sender:   inflight = numWritten - peerConsumed;  win = peerWindow - inflight;  send ≤ win, split ≤ frameSize.
//             peerWindow starts at the slow-start guess 262144 and is refreshed by inbound UPD frames.
//   receiver: as the app consumes bytes, emit UPD(consumed=numRead, window=MaxStreamBuffer) on the first read
//             and thereafter every MaxStreamBuffer/2 consumed.
import {
  CMD, synFrame, finFrame, pshFrame, updFrame, encodeFrame,
  makeFrameReader, parseUPD, makeStreamIdGen,
} from "./holo-onion-smux2.mjs";

export const INITIAL_PEER_WINDOW = 262144; // xtaci/smux initialPeerWindow (slow-start)

export function createSmuxClient({ send, maxFrameSize = 32768, maxStreamBuffer = 1048576 } = {}) {
  if (typeof send !== "function") throw new Error("smux2-session: need a send(bytes) transport");
  const reader = makeFrameReader();
  const nextId = makeStreamIdGen("client");
  const threshold = Math.floor(maxStreamBuffer / 2);
  const streams = new Map();

  function makeStream(id) {
    const st = {
      id, closed: false,
      numWritten: 0, peerConsumed: 0, peerWindow: INITIAL_PEER_WINDOW, // sender window state
      numRead: 0, incr: 0,                                             // receiver window state
      inbox: [],            // queued inbound payloads (Uint8Array)
      readWaiters: [],      // resolvers awaiting data
      winWaiters: [],       // resolvers awaiting window room
      finished: false,
    };
    // deliver an inbound PSH payload
    st._push = (payload) => { st.inbox.push(payload); const w = st.readWaiters.shift(); if (w) w(); };
    st._wakeWin = () => { const ws = st.winWaiters.splice(0); ws.forEach((w) => w()); };

    // read() → Promise<Uint8Array|null(EOF)>; drives receiver-side UPD emission on consume
    st.read = async () => {
      if (!st.inbox.length) {
        if (st.finished) return null;
        await new Promise((res) => st.readWaiters.push(res));
        if (!st.inbox.length && st.finished) return null;
      }
      const chunk = st.inbox.shift();
      st.numRead = (st.numRead + chunk.length) >>> 0;
      st.incr += chunk.length;
      // emit UPD on the FIRST read (numRead just became chunk.length) or once half the buffer is consumed
      if (st.incr >= threshold || st.numRead === chunk.length) {
        st.incr = 0;
        send(updFrame(st.id, st.numRead, maxStreamBuffer));
      }
      return chunk;
    };

    // write(bytes) → Promise<void>; window-gated + frame-split exactly like writeV2
    st.write = async (bytes) => {
      let b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      while (b.length > 0) {
        const inflight = (st.numWritten - st.peerConsumed) >>> 0;
        const win = (st.peerWindow | 0) - (inflight | 0);
        if (win > 0) {
          let n = Math.min(b.length, win);
          let off = 0;
          while (n > 0) {
            const size = Math.min(n, maxFrameSize);
            send(pshFrame(st.id, b.subarray(off, off + size)));
            st.numWritten = (st.numWritten + size) >>> 0;
            off += size; n -= size;
          }
          b = b.subarray(off);
        } else {
          // window exhausted — block until an inbound UPD refreshes peerWindow/peerConsumed
          await new Promise((res) => st.winWaiters.push(res));
        }
      }
    };

    st.close = () => { if (!st.closed) { st.closed = true; send(finFrame(st.id)); } };
    return st;
  }

  function dispatch(fr) {
    const st = streams.get(fr.streamID);
    switch (fr.cmd) {
      case CMD.PSH: if (st) st._push(fr.payload); break;
      case CMD.UPD: {
        if (st) { const u = parseUPD(fr); st.peerConsumed = u.consumed >>> 0; st.peerWindow = u.window >>> 0; st._wakeWin(); }
        break;
      }
      case CMD.FIN: if (st) { st.finished = true; const w = st.readWaiters.shift(); if (w) w(); } break;
      case CMD.NOP: break; // keepalive
      default: break;      // SYN inbound = server-initiated stream; not used by the onion client
    }
  }

  return {
    // open a new client stream (sends SYN); returns {id, read(), write(), close()}
    open() {
      const id = nextId();
      const st = makeStream(id);
      streams.set(id, st);
      send(synFrame(id));
      return st;
    },
    // feed transport bytes (off the DataChannel / socket); parses + dispatches frames
    feed(bytes) { for (const fr of reader.feed(bytes)) dispatch(fr); },
    // keepalive
    nop() { send(encodeFrame(CMD.NOP, 0)); },
    _streams: streams,
  };
}

export default { createSmuxClient, INITIAL_PEER_WINDOW };
