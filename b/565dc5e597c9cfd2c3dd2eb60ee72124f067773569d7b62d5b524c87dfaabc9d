// holo-onion-snowflake-connect.mjs — Component B / B1c: the whole client, assembled.
// rendezvous → raw Token‖ClientID → encapsulation → KCP → smux v2 → one stream to the Snowflake bridge.
// Browser-pure; runs on github.io/Q. Component C (arti-wasm) drives Tor cells over the returned `stream`.
//
// Framing (verified vs snowflake v2.14.1 client): on DataChannel open write RAW Token(8)‖ClientID(8); then
// every KCP packet is encapsulation-wrapped; the return path is pure encapsulated packets (no header). KCP:
// random conv, stream mode, window 65535, nodelay(0,0,0,1). smux: v2, MaxStreamBuffer 1 MiB.
import { snowflakeRendezvous } from "./holo-onion-snowflake-rdv.mjs";
import { writeData, makeReader, TURBOTUNNEL_TOKEN } from "./holo-onion-snowflake-encap.mjs";
import { Kcp, ByteBuf } from "./holo-onion-kcp.mjs";
import { createSmuxClient } from "./holo-onion-smux2-session.mjs";

const concat = (a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; };

// connectSnowflake(opts?) → { pc, dc, kcp, smux, stream, stats(), close() }
// `stream` is a smux stream ({read(),write(),close()}) carrying an opaque byte pipe to the bridge.
export async function connectSnowflake(opts = {}) {
  const log = opts.log || (() => {});
  const { pc, dc } = await snowflakeRendezvous(opts);

  // 1. session header: raw Token ‖ ClientID (single channel; ClientID would be reused across re-dials)
  const clientID = new Uint8Array(8); crypto.getRandomValues(clientID);
  dc.send(concat(TURBOTUNNEL_TOKEN, clientID));
  log("sent Token‖ClientID");

  // 2. KCP over encapsulation over the DataChannel
  const cb = new Uint8Array(4); crypto.getRandomValues(cb);
  const conv = (cb[0] | (cb[1] << 8) | (cb[2] << 16) | (cb[3] << 24)) >>> 0;
  const kcp = new Kcp(conv, {});
  kcp.stream = 1;
  kcp.setWndSize(65535, 65535);
  kcp.setNoDelay(0, 0, 0, 1); // interval 0 → kcp clamps to its 10ms min, matching kcp-go
  const reader = makeReader();
  let inboundPkts = 0, inboundBytes = 0;
  kcp.setOutput((buf, size) => { try { dc.send(writeData(buf.subarray(0, size))); } catch (e) { /* channel closing */ } });
  dc.addEventListener("message", (e) => {
    const bytes = new Uint8Array(e.data);
    for (const pkt of reader.feed(bytes)) { inboundPkts++; inboundBytes += pkt.length; kcp.input(ByteBuf.from(pkt), true, false); }
  });
  const timer = setInterval(() => kcp.update(), 10);

  // 3. smux v2 over KCP
  const smux = createSmuxClient({ send: (b) => kcp.send(ByteBuf.from(b)) });
  const pump = setInterval(() => {
    for (;;) { const n = kcp.peekSize(); if (n <= 0) break; const b = ByteBuf.alloc(n); const r = kcp.recv(b); if (r <= 0) break; smux.feed(b.subarray(0, r)); }
  }, 5);

  const stream = smux.open();
  return {
    pc, dc, kcp, smux, stream,
    // framing-reached-the-bridge witness: inbound KCP packets + snd_una advancing = the bridge ACKed us
    stats: () => ({ inboundPkts, inboundBytes, snd_una: kcp.snd_una >>> 0, snd_nxt: kcp.snd_nxt >>> 0, conv }),
    close() { clearInterval(timer); clearInterval(pump); try { dc.close(); pc.close(); } catch {} },
  };
}

export default { connectSnowflake };
