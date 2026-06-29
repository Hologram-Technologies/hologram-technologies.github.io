// holo-session-roam-witness.mjs — two devices roam the session manifest over a fake hub with REAL AES-GCM
// (shared pair key) + REAL κ (sha256/jcs). Run: node tools/holo-session-roam-witness.mjs
import { makeSessionRoam } from "../os/usr/lib/holo/holo-session-roam.mjs";
import { makeRelayBus } from "../os/usr/lib/holo/holo-relay-bus.mjs";
import { makeCipher } from "../os/usr/lib/holo/holo-session.mjs";
import { jcs } from "../os/usr/lib/holo/holo-uor.mjs";

const te = new TextEncoder();
const hex = (u) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
const kappaOf = async (b) => "did:holo:sha256:" + hex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", te.encode(jcs(b)))));
const b64e = (u8) => Buffer.from(u8).toString("base64");
const settle = () => new Promise((r) => setTimeout(r, 60));

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.error("  ✗ " + n); } };

const PAIRKEY = new Uint8Array(32).fill(7);                 // the shared pair key (E2E); same on both devices
const cipher = makeCipher(PAIRKEY);
const WRONGKEY = makeCipher(new Uint8Array(32).fill(9));    // a different device that was never paired
const TOPIC = "holo:swarm:did:holo:sha256:operatorκ";
const man = (tabs) => ({ "@type": ["holo:SessionManifest"], "holo:experience": { tabs, activeTab: 0, settings: {} } });

// fake point-to-point hub (like a paired RTCDataChannel)
function hub() { const h = [null, null]; const link = (i) => ({ send: (f) => { const o = h[1 - i]; if (o) o(f); }, onMessage: (cb) => { h[i] = cb; } }); return [link(0), link(1)]; }
const [la, lb] = hub();
const relayA = makeRelayBus({ link: la, self: "A" });
const relayB = makeRelayBus({ link: lb, self: "B" });

let aLocal = { body: man([{ id: "t1", title: "Notes" }, { id: "t2", title: "Wallet" }]), seq: 3 };
let bLocal = { body: man([{ id: "t1", title: "Home" }]), seq: 1 };
let bApplied = null, bDiverged = null;

const A = makeSessionRoam({ relay: relayA, topic: TOPIC, cipher, kappaOf, self: "srA", getLocal: () => aLocal, applyRemote: () => {} });
const B = makeSessionRoam({
  relay: relayB, topic: TOPIC, cipher, kappaOf, self: "srB",
  getLocal: () => bLocal,
  applyRemote: (body) => { bApplied = body; bLocal = { body, seq: (bLocal.seq | 0) + 1 }; },
  onDiverged: (body) => { bDiverged = body; },
});
A.start(); B.start();

(async () => {
  // 1. FAST-FORWARD: A newer (seq 3) → B resumes A's exact world
  bApplied = null; bDiverged = null;
  await A.publish(); await settle();
  ok("B fast-forwards to A's manifest", bApplied && bApplied["holo:experience"].tabs.length === 2 && bApplied["holo:experience"].tabs[1].title === "Wallet");
  ok("fast-forward did NOT mis-fire divergence", bDiverged === null);

  // 2. IN-SYNC: both now identical → no re-apply, no divergence
  bApplied = null; bDiverged = null;
  await A.publish(); await settle();
  ok("identical experience → in-sync (no re-apply)", bApplied === null && bDiverged === null);

  // 3. DIVERGED: B advances to a DIFFERENT world at a higher seq; A (older, different) must NOT clobber it
  bLocal = { body: man([{ id: "z", title: "Research" }]), seq: 9 };
  bApplied = null; bDiverged = null;
  await A.publish(); await settle();
  ok("older-but-different → DIVERGED (kept both)", bDiverged && bDiverged["holo:experience"].tabs[0].title === "Notes");
  ok("divergence did NOT clobber B's world", bApplied === null && bLocal.body["holo:experience"].tabs[0].title === "Research");

  // 4. TAMPER: flip the ciphertext → B refuses (decrypt fails), nothing applied
  bApplied = null; bDiverged = null;
  const good = await cipher.seal(te.encode(JSON.stringify(aLocal.body)));
  const bad = good.slice(); bad[bad.length - 1] ^= 0xff;
  await B.onMsg({ __sr: 1, from: "srA", head: { kappa: await kappaOf(aLocal.body), seq: 50 }, blob: b64e(bad) });
  ok("tampered ciphertext refused", bApplied === null && bDiverged === null);

  // 5. WRONG-κ: valid ciphertext but a head.kappa that doesn't match the bytes → refused (L5)
  bApplied = null; bDiverged = null;
  await B.onMsg({ __sr: 1, from: "srA", head: { kappa: "did:holo:sha256:" + "0".repeat(64), seq: 51 }, blob: b64e(good) });
  ok("κ-mismatch refused (verify-before-trust)", bApplied === null && bDiverged === null);

  // 6. NEVER-PAIRED device (wrong key): its sealed blob can't be opened → ignored
  bApplied = null; bDiverged = null;
  const foreign = await WRONGKEY.seal(te.encode(JSON.stringify(man([{ id: "x", title: "Intruder" }]))));
  await B.onMsg({ __sr: 1, from: "srX", head: { kappa: await kappaOf(man([{ id: "x", title: "Intruder" }])), seq: 99 }, blob: b64e(foreign) });
  ok("unpaired device (wrong key) ignored", bApplied === null && bDiverged === null);

  console.log(`holo-session-roam-witness: ${pass}/${pass + fail} green`);
  process.exit(fail ? 1 : 0);
})();
