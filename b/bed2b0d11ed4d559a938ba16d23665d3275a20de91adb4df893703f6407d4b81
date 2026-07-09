// onion-probe.worker.mjs — S0 Part B spike (THROWAWAY). Runs OFF the main thread (mirrors the Q-orb
// worker fix). Emits the Seam-B shape — head/chunk/end — so the measured path matches production's
// egress contract (holo-egress-client.mjs). Timings use performance.now() (real wall-clock in a browser).
//
// Pluggable TRANSPORTS: swap the first hop, keep the harness + measurement identical.
//   • gateway  — REAL, measurable from any normal browser today (fetch an .onion via a public https
//                Tor gateway). NOT private; a lower-bound data point for "how fast could an open feel".
//   • arti-wasm — STUB. Wire an Arti-in-WASM client (Snowflake/WSS transport) here. Until then it
//                 reports unavailable, so the harness never fabricates a number.
//
// message in : { type:"probe", url, transport }
// messages out: { type:"mark", name, t }          // performance marks (transport-ready, first-byte, end)
//               { type:"head", status, contentType }
//               { type:"chunk", n }                // byte count only (spike doesn't ship bytes to UI)
//               { type:"end", ok, bytes, verified } // verified = onion ed25519 key checked end-to-end
//               { type:"error", error }

const now = () => performance.now();

// A public https→Tor gateway, host-swapped for the onion (measurable, NON-PRIVATE — spike only).
// Kept as data, not policy: production rung 3 must show the "a relay can see this" signal.
function gatewayUrl(onionUrl) {
  const u = new URL(/^https?:\/\//i.test(onionUrl) ? onionUrl : "http://" + onionUrl);
  const host = u.hostname.replace(/\.onion$/i, "");
  // e.g. <pubkey>.onion.<gateway-domain> — set GATEWAY at run time; left blank to force a conscious choice.
  const GATEWAY = self.__ONION_GATEWAY__ || ""; // e.g. "onion.example" — a gateway you trust for the SPIKE
  if (!GATEWAY) throw new Error("no gateway configured — set self.__ONION_GATEWAY__ for the gateway probe");
  return `https://${host}.onion.${GATEWAY}${u.pathname}${u.search}`;
}

const TRANSPORTS = {
  async gateway(url, post) {
    const gw = gatewayUrl(url);
    post({ type: "mark", name: "transport-ready", t: now() }); // gateway has no circuit to build
    const res = await fetch(gw, { redirect: "follow" });
    post({ type: "head", status: res.status, contentType: res.headers.get("content-type") || "" });
    let bytes = 0, first = false;
    const reader = res.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      if (!first) { first = true; post({ type: "mark", name: "first-byte", t: now() }); }
      bytes += value.length; post({ type: "chunk", n: value.length }); }
    post({ type: "mark", name: "end", t: now() });
    // A gateway terminates the onion TLS — the client CANNOT verify the ed25519 key end-to-end here.
    post({ type: "end", ok: res.ok, bytes, verified: false });
  },

  async ["arti-wasm"](url, post) {
    // TODO(S2): instantiate Arti (Rust→WASM) in this worker; open a stream to `url` over a Snowflake
    // (WebRTC) or WSS pluggable transport; forward head/chunk/end; set verified=true after the client
    // checks the onion's ed25519 key (§0 self-authentication — no gateway trusted for authenticity).
    throw new Error("arti-wasm transport not wired — this is the S2 build; spike measures the gateway path only");
  },
};

self.onmessage = async (e) => {
  const { type, url, transport } = e.data || {};
  if (type !== "probe") return;
  const post = (m) => self.postMessage(m);
  post({ type: "mark", name: "start", t: now() });
  try {
    const fn = TRANSPORTS[transport];
    if (!fn) throw new Error("unknown transport: " + transport);
    await fn(url, post);
  } catch (err) { post({ type: "error", error: String((err && err.message) || err) }); }
};
