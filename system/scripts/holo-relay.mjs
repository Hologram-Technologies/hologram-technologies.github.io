// holo-relay — a content-blind κ pub/sub relay for the messenger (P2 transport).
//
// There is no homeserver (ADR-001). The relay is the browser-peer rendezvous:
// it routes announces between subscribers of a channel and caches (κ, bytes) so
// a peer can fetch what it lacks. It never inspects, signs, or trusts content —
// peers verify every byte on receipt by re-deriving its κ (Law L5), so a hostile
// relay can withhold or reorder but never forge. The analogue of the cold-start
// gateway, for live conversation.
//
// Zero dependencies: a minimal RFC 6455 server over Node's http upgrade (Node's
// global WebSocket is client-only). Single-frame messages, the only shape the
// holo-wire codec emits.

import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { OP, encodeMsg, decodeMsg } from "../os/holo-wire.mjs";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// ── RFC 6455 framing (server side: read masked client frames, write unmasked) ──

function frame(payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x82, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x82; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x82; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, Buffer.from(payload)]);
}

// Pull as many complete frames as `buf` holds; return {messages, rest, close}.
function drain(buf) {
  const messages = [];
  let close = false;
  let o = 0;
  for (;;) {
    if (buf.length - o < 2) break;
    const b0 = buf[o];
    const opcode = b0 & 0x0f;
    const b1 = buf[o + 1];
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = o + 2;
    if (len === 126) {
      if (buf.length - p < 2) break;
      len = buf.readUInt16BE(p); p += 2;
    } else if (len === 127) {
      if (buf.length - p < 8) break;
      len = Number(buf.readBigUInt64BE(p)); p += 8;
    }
    let mask;
    if (masked) {
      if (buf.length - p < 4) break;
      mask = buf.subarray(p, p + 4); p += 4;
    }
    if (buf.length - p < len) break;
    const payload = Buffer.from(buf.subarray(p, p + len));
    if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    o = p + len;
    if (opcode === 0x8) { close = true; break; }       // close
    else if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) messages.push(payload);
    // 0x9 ping / 0xA pong: ignored (no keepalive needed on localhost).
  }
  return { messages, rest: buf.subarray(o), close };
}

export function startRelay(port = 0) {
  const subs = new Map();        // topic → Set<socket>
  const cache = new Map();       // κ → Buffer
  const topicKappas = new Map(); // topic → Set<κ> (for replay to late joiners)

  const get = (map, key, make) => {
    let v = map.get(key);
    if (!v) { v = make(); map.set(key, v); }
    return v;
  };
  const send = (sock, msg) => sock.write(frame(encodeMsg(msg)));

  const handle = (sock, payload) => {
    const m = decodeMsg(new Uint8Array(payload));
    switch (m.op) {
      case OP.SUB: {
        get(subs, m.topic, () => new Set()).add(sock);
        // Replay what the channel already holds, so a late joiner catches up.
        for (const k of topicKappas.get(m.topic) ?? []) {
          send(sock, { op: OP.ANN, topic: m.topic, kappa: k });
        }
        break;
      }
      case OP.PUT: {
        cache.set(m.kappa, Buffer.from(m.bytes));
        get(topicKappas, m.topic, () => new Set()).add(m.kappa);
        for (const peer of subs.get(m.topic) ?? []) {
          if (peer !== sock) send(peer, { op: OP.ANN, topic: m.topic, kappa: m.kappa });
        }
        break;
      }
      case OP.GET: {
        const bytes = cache.get(m.kappa);
        if (bytes) send(sock, { op: OP.OBJ, kappa: m.kappa, bytes });
        else send(sock, { op: OP.MISS, kappa: m.kappa });
        break;
      }
      default: break;
    }
  };

  const server = http.createServer();
  server.on("upgrade", (req, sock) => {
    const key = req.headers["sec-websocket-key"];
    const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    sock.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let buf = Buffer.alloc(0);
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const { messages, rest, close } = drain(buf);
      buf = rest;
      for (const p of messages) handle(sock, p);
      if (close) sock.end();
    });
    const drop = () => {
      for (const set of subs.values()) set.delete(sock);
    };
    sock.on("close", drop);
    sock.on("error", drop);
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const actual = server.address().port;
      resolve({
        port: actual,
        url: `ws://127.0.0.1:${actual}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

// Run directly: `node holo-relay.mjs [port]` (default 9444).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.argv[2]) || 9444;
  const relay = await startRelay(port);
  console.log(`holo-relay listening on ${relay.url}`);
}
