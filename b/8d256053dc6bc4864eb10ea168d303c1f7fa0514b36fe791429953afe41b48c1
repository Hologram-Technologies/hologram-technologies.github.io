// holo-onion-snowflake-rdv.mjs — Component B / B1c: browser Snowflake rendezvous.
// Reaches the Tor Snowflake broker (CORS-open), gets matched to a volunteer WebRTC proxy, and opens the
// RTCDataChannel that (via the proxy's relay) carries our framing to the Snowflake bridge. Browser-pure:
// RTCPeerConnection + fetch + crypto.getRandomValues — runs on github.io/Q, no Node, no install.
//
// Protocol (from snowflake v2.14.1, verified live): POST {broker}/client with body
//   "1.0\n" + JSON({ offer: JSON.stringify({type,sdp}), nat:"unknown", fingerprint:<bridge> })
// → response JSON { answer: JSON<{type,sdp}>, error? }. DataChannel is Ordered:true (reliable); KCP still
// rides on top for the turbotunnel session that survives proxy re-dials.

export const SNOWFLAKE_DEFAULTS = {
  broker: "https://1098762253.rsc.cdn77.org/",           // cdn77 rendezvous (reachable, ACAO:*)
  fingerprint: "2B280B23E1107BB62ABFC40DDCC8824814F80A72", // default Snowflake bridge
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.antisip.com:3478" },
    { urls: "stun:stun.voipgate.com:3478" },
    { urls: "stun:stun.nextcloud.com:443" },
  ],
};
const CLIENT_VERSION = "1.0";

const randHex = (n) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); };

// wait until ICE gathering finishes (Snowflake sends a non-trickle offer with all candidates inline)
function gatherComplete(pc, timeoutMs = 5000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((res) => {
    const done = () => { clearTimeout(t); res(); };
    const t = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") done(); });
    pc.addEventListener("icecandidate", (e) => { if (!e.candidate) done(); });
  });
}

// snowflakeRendezvous(opts?) → { pc, dc } with dc already OPEN (connected to a live volunteer proxy).
// Throws on: no proxy available, broker error, or DataChannel open timeout.
export async function snowflakeRendezvous(opts = {}) {
  const cfg = { ...SNOWFLAKE_DEFAULTS, ...opts };
  const log = opts.log || (() => {});
  const pc = new RTCPeerConnection({ iceServers: cfg.iceServers });
  const dc = pc.createDataChannel("snowflake-" + randHex(8), { ordered: true });
  dc.binaryType = "arraybuffer";

  const opened = new Promise((res, rej) => {
    dc.addEventListener("open", () => res(dc));
    dc.addEventListener("error", (e) => rej(new Error("dc error: " + (e?.error?.message || e?.message || "unknown"))));
    pc.addEventListener("connectionstatechange", () => {
      log("pc:" + pc.connectionState);
      if (pc.connectionState === "failed") rej(new Error("PeerConnection failed (ICE/UDP blocked or proxy unreachable)"));
    });
  });

  await pc.setLocalDescription(await pc.createOffer());
  await gatherComplete(pc, opts.gatherTimeoutMs || 5000);
  log("offer gathered, polling broker…");

  const body = CLIENT_VERSION + "\n" + JSON.stringify({
    offer: JSON.stringify({ type: pc.localDescription.type, sdp: pc.localDescription.sdp }),
    nat: "unknown",
    fingerprint: cfg.fingerprint,
  });
  // IMPORTANT: text/plain keeps this a CORS-SIMPLE request → no preflight. The broker's
  // Access-Control-Allow-Headers is only "Origin, X-Session-ID" (no Content-Type), so an
  // application/json POST is blocked browser-side ("Failed to fetch"). The broker parses the
  // raw body regardless of content-type.
  const resp = await fetch(new URL("client", cfg.broker).href, {
    method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body,
  });
  if (!resp.ok) throw new Error("broker HTTP " + resp.status);
  const data = await resp.json();
  if (data.error) throw new Error("broker: " + data.error);
  if (!data.answer) throw new Error("no proxy available (broker returned no answer) — retry");
  log("proxy matched, connecting DataChannel…");

  await pc.setRemoteDescription(JSON.parse(data.answer));
  const channel = await Promise.race([
    opened,
    new Promise((_, rej) => setTimeout(() => rej(new Error("DataChannel open timeout (proxy/bridge unreachable)")), opts.openTimeoutMs || 30000)),
  ]);
  log("DataChannel OPEN");
  return { pc, dc: channel };
}

export default { snowflakeRendezvous, SNOWFLAKE_DEFAULTS };
