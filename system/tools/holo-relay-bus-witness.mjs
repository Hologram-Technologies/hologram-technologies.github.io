// holo-relay-bus-witness.mjs — pub/sub bus over a fake two-peer hub. Run: node tools/holo-relay-bus-witness.mjs
import { makeRelayBus } from "../os/usr/lib/holo/holo-relay-bus.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.error("  ✗ " + n); } };

// fake hub: two links; each link.send delivers the frame to the OTHER link's handler (point-to-point, like a
// paired RTCDataChannel). Synchronous delivery keeps the witness deterministic. We capture handlers so a
// dedup test can re-deliver the same frame.
function makeHub() {
  const h = [null, null];
  const linkFor = (i) => ({ send: (f) => { const other = h[1 - i]; if (other) other(f); }, onMessage: (cb) => { h[i] = cb; } });
  return { links: [linkFor(0), linkFor(1)], handlers: h };
}

const hub = makeHub();
const A = makeRelayBus({ link: hub.links[0], self: "devA" });
const B = makeRelayBus({ link: hub.links[1], self: "devB" });

// 1. cross-peer delivery
let got = null; B.subscribe("session", (m) => { got = m; });
A.publish("session", { head: "did:holo:sha256:abc", seq: 7 });
ok("B receives A's publish", got && got.head === "did:holo:sha256:abc" && got.seq === 7);

// 2. no self-delivery (A's own publish never fires A's own subscriber on the same topic)
let selfHit = 0; A.subscribe("session", () => { selfHit++; });
A.publish("session", { head: "x" });
ok("publisher does not receive own frame", selfHit === 0);

// 3. topic isolation
let other = 0; B.subscribe("chat", () => { other++; });
A.publish("session", { head: "y" });
ok("other topic not delivered", other === 0);

// 4. fanout to multiple subscribers
let c1 = 0, c2 = 0; B.subscribe("ping", () => { c1++; }); B.subscribe("ping", () => { c2++; });
A.publish("ping", {});
ok("fanout to both subscribers", c1 === 1 && c2 === 1);

// 5. unsubscribe stops delivery
let u = 0; const off = B.subscribe("u", () => { u++; });
A.publish("u", {}); off(); A.publish("u", {});
ok("unsubscribe stops delivery", u === 1);

// 6. dedup by mid (re-deliver the SAME frame to B's handler → fires once)
let d = 0; B.subscribe("dd", () => { d++; });
const frame = { __roam: 1, from: "devA", topic: "dd", msg: {}, mid: "devA:dedup-1" };
hub.handlers[1](frame); hub.handlers[1](frame);
ok("dedup: duplicate mid delivered once", d === 1);

// 7. ignores non-roam traffic sharing the link
let nr = 0; B.subscribe("session", () => { nr++; });
hub.handlers[1]({ hello: "world" });          // a frame without __roam:1
ok("non-roam frame ignored", nr === 0);

// 8. content-blind: arbitrary opaque msg passes through untouched
let blob = null; B.subscribe("blob", (m) => { blob = m; });
const payload = { enc: "b64ciphertext==", n: [1, 2, 3] };
A.publish("blob", payload);
ok("opaque payload passes through verbatim", blob && blob.enc === "b64ciphertext==" && blob.n.length === 3);

console.log(`holo-relay-bus-witness: ${pass}/${pass + fail} green`);
process.exit(fail ? 1 : 0);
