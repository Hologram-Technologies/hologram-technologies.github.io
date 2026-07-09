// holo-onion-smux2.mjs — Component B / B1b: the smux **v2** frame codec, byte-validated against the real
// xtaci/smux v1.5.57 (the exact lib the Snowflake bridge runs). This is THE crux of B1: npm `smux@1.0.0`
// speaks v1 and will not interop. Frames captured from a live Go client<->server session (see
// scratchpad/oracle) drive the tests in holo-onion-smux2.test.mjs.
//
// Frame wire format (all multi-byte little-endian):
//   ver(1)=2 | cmd(1) | length(2) | streamID(4) | payload[length]
// Commands: SYN=0 (open stream) · FIN=1 (close) · PSH=2 (data) · NOP=3 (keepalive) · UPD=4 (flow control).
// UPD payload = consumed(4) | window(4)  — v2's per-stream receive window; the sender must not send past it.
// This module is the FRAME layer only (encode/parse). The session state machine + window accounting that
// rides on it is B1b-part-2; this brick is what everything else is checked against.

export const SMUX_VERSION = 2;
export const CMD = { SYN: 0, FIN: 1, PSH: 2, NOP: 3, UPD: 4 };
export const HEADER_LEN = 8;
export const DEFAULT_FRAME_SIZE = 32768;   // smux MaxFrameSize
export const DEFAULT_STREAM_WINDOW = 1048576; // MaxStreamBuffer (1 MiB) — advertised in UPD

// encodeFrame(cmd, streamID, payload?) → Uint8Array
export function encodeFrame(cmd, streamID, payload) {
  const body = payload ? (payload instanceof Uint8Array ? payload : new Uint8Array(payload)) : new Uint8Array(0);
  if (body.length > 0xffff) throw new Error("smux2: frame payload too long (" + body.length + " > 65535)");
  const out = new Uint8Array(HEADER_LEN + body.length);
  const dv = new DataView(out.buffer);
  out[0] = SMUX_VERSION;
  out[1] = cmd;
  dv.setUint16(2, body.length, true);   // length, LE
  dv.setUint32(4, streamID >>> 0, true); // streamID, LE
  if (body.length) out.set(body, HEADER_LEN);
  return out;
}

export const synFrame = (sid) => encodeFrame(CMD.SYN, sid);
export const finFrame = (sid) => encodeFrame(CMD.FIN, sid);
export const nopFrame = (sid = 0) => encodeFrame(CMD.NOP, sid);
export const pshFrame = (sid, data) => encodeFrame(CMD.PSH, sid, data);

// updFrame(sid, consumed, window) → Uint8Array — the v2 flow-control frame.
export function updFrame(sid, consumed, window) {
  const p = new Uint8Array(8);
  const dv = new DataView(p.buffer);
  dv.setUint32(0, consumed >>> 0, true);
  dv.setUint32(4, window >>> 0, true);
  return encodeFrame(CMD.UPD, sid, p);
}

// parseUPD(frame) → {consumed, window} — decode a UPD payload.
export function parseUPD(frame) {
  const dv = new DataView(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength);
  return { consumed: dv.getUint32(0, true) >>> 0, window: dv.getUint32(4, true) >>> 0 };
}

// Streaming frame reader: feed(bytes) as they arrive off KCP; returns complete frames
// {ver, cmd, streamID, length, payload}, buffering partial headers/payloads across feeds.
export function makeFrameReader() {
  let buf = new Uint8Array(0);
  const cat = (a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; };
  return {
    feed(bytes) {
      buf = cat(buf, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      const out = [];
      for (;;) {
        if (buf.length < HEADER_LEN) break;
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const ver = buf[0];
        if (ver !== SMUX_VERSION) throw new Error("smux2: unexpected version byte " + ver);
        const cmd = buf[1];
        const length = dv.getUint16(2, true);
        const streamID = dv.getUint32(4, true) >>> 0;
        if (buf.length < HEADER_LEN + length) break;
        const payload = buf.slice(HEADER_LEN, HEADER_LEN + length);
        buf = buf.slice(HEADER_LEN + length);
        out.push({ ver, cmd, streamID, length, payload });
      }
      return out;
    },
  };
}

// nextClientStreamID: smux client streams are ODD and pre-increment from 1 → first stream is 3
// (confirmed against xtaci/smux: sid=3 for the first OpenStream). Server streams are EVEN.
export function makeStreamIdGen(role = "client") {
  let id = role === "client" ? 1 : 0; // pre-increment by 2 on each alloc
  return () => { id += 2; return id >>> 0; };
}

export default {
  SMUX_VERSION, CMD, HEADER_LEN, DEFAULT_FRAME_SIZE, DEFAULT_STREAM_WINDOW,
  encodeFrame, synFrame, finFrame, nopFrame, pshFrame, updFrame, parseUPD, makeFrameReader, makeStreamIdGen,
};
