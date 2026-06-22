#!/usr/bin/env node
// holo-strand-resume-witness.mjs — proves P1 of the unification: RESUME ON THE SPINE. The live session
// head is last-write-wins and SWAPPABLE (any valid manifest κ written there restores). The source chain
// makes resume drift-proof: every resume point is mirrored as a hash-linked session.snapshot entry, so
// the spine holds the TRUE last point. When the live head disagrees with the spine, the spine wins; a
// broken spine is never trusted (fail-closed). "It just remembers — and can't be silently moved."
//
// Drives the REAL substrate: holo-session's injectable createSession core (in-memory kv + κ-store), the
// real holo-strand, and a REAL enrolled holo-identity principal signing each snapshot entry.
//
// Checks (all must hold):
//   1 mirrorRecordsSnapshots   — each session save appends a session.snapshot; the spine's resumePoint = the last κ.
//   2 continuityOkWhenAligned  — live head == spine's last κ ⇒ continuity "ok".
//   3 driftRecovered           — live head swapped to a STALE κ ⇒ continuity "recovered", κ = the true last point.
//   4 defaultRestoresDrift     — WITHOUT the spine, restore(head) returns the STALE experience (the bug we fix).
//   5 recoveredKappaRestores   — restore(kappa = recovered) returns the TRUE last experience (the fix works).
//   6 brokenChainNotTrusted    — tamper a snapshot entry ⇒ continuity "chain-broken", keeps the live head.
//   7 emptyFallsBack           — a spine with no snapshots ⇒ continuity "empty", κ = the live head.
//   8 snapshotsAreSigned       — snapshot entries carry a verifying operator signature (authorship on the spine).
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · holospaces Laws L1/L2/L5 · ADR-0104/0106
// (Holo Session) · rests on #holo-session + #holo-strand + #holo-identity. node tools/holo-strand-resume-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSession } from "../os/usr/lib/holo/holo-session.mjs";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));

// in-memory adapters for the session core
const kvMap = new Map();
const kv = { get: (k) => (kvMap.has(k) ? kvMap.get(k) : null), set: (k, v) => kvMap.set(k, String(v)), remove: (k) => kvMap.delete(k), keys: () => [...kvMap.keys()] };
const kStore = new Map();
const store = { put: async (k, u8) => { kStore.set(k, u8); }, get: async (k) => (kStore.has(k) ? kStore.get(k) : null) };
let tick = 0; const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
const HEAD_PREFIX = "holo.session.head."; const hexOf = (k) => String(k).split(":").pop();

const op = await enroll({ label: "resume-tester", passphrase: "correct horse battery staple" });
const realm = op.kappa, device = "did:holo:sha256:" + "d".repeat(64);

const core = createSession({ kv, store, now });
const backend = arrayBackend();
const strand = makeStrand({ backend, now, signer: op });

// simulate flushSession: save the experience, mirror the resume point onto the spine
let lastSeq = null;
async function flush(tabs) {
  const res = await core.save({ realm, device, tabs, activeTab: 0, settings: {}, tab: "tab-A", expectSeq: lastSeq });
  lastSeq = res.seq;
  await strand.append({ kind: "session.snapshot", payload: { realm, kappa: res.kappa, seq: res.seq } });
  return res;
}
const s1 = await flush([{ id: "1", title: "Home", addr: "home", home: true }]);
const s2 = await flush([{ id: "1", title: "Home", home: true }, { id: "2", title: "Wallet", addr: "wallet" }]);
const s3 = await flush([{ id: "1", title: "Home", home: true }, { id: "2", title: "Wallet", addr: "wallet" }, { id: "3", title: "Atlas", addr: "atlas" }]);

// ── 1 · the spine recorded each resume point; its last point is the latest save ──────────────────────
const rp = await strand.resumePoint();
ok("mirrorRecordsSnapshots",
  strand.replay({ kind: "session.snapshot" }).length === 3 && rp && rp.kappa === s3.kappa && rp.seq === s3.seq,
  `resumePoint=${rp && String(rp.kappa).slice(0, 20)} last=${String(s3.kappa).slice(0, 20)}`);

// ── 2 · live head aligned with the spine ⇒ "ok" ──────────────────────────────────────────────────────
const cOk = await strand.reconcileResume(s3.kappa);
ok("continuityOkWhenAligned", cOk.continuity === "ok" && cOk.kappa === s3.kappa, JSON.stringify(cOk));

// ── 3 · live head SWAPPED to a stale κ ⇒ "recovered", κ = the true last point ────────────────────────
kv.set(HEAD_PREFIX + hexOf(realm), JSON.stringify({ k: s1.kappa, seq: 1, tab: "swapped" }));   // a swapped/stale head
const cDrift = await strand.reconcileResume(s1.kappa);
ok("driftRecovered", cDrift.continuity === "recovered" && cDrift.kappa === s3.kappa && cDrift.sessionHead === s1.kappa, JSON.stringify(cDrift));

// ── 4 · WITHOUT the spine, restore follows the (stale) head — the very drift we fix ──────────────────
const drifted = await core.restore({ realm, device });                          // head = s1 (stale)
ok("defaultRestoresDrift", drifted && (drifted["holo:experience"].tabs.length === 1), `tabs=${drifted && drifted["holo:experience"].tabs.length} (expected stale=1)`);

// ── 5 · restore with the recovered κ returns the TRUE last experience (3 tabs) ───────────────────────
const fixed = await core.restore({ realm, device, kappa: cDrift.kappa });
ok("recoveredKappaRestores", fixed && fixed["holo:experience"].tabs.length === 3 && fixed["holo:experience"].tabs[2].addr === "atlas", `tabs=${fixed && fixed["holo:experience"].tabs.length} (expected true=3)`);

// ── 6 · a tampered spine is NOT trusted (fail-closed) ────────────────────────────────────────────────
const bad = clone(backend.dump()); bad[1]["holstr:payload"].kappa = s3.kappa;   // mutate a snapshot entry's payload
const cBroken = await makeStrand({ backend: arrayBackend(bad) }).reconcileResume(s1.kappa);
ok("brokenChainNotTrusted", cBroken.continuity === "chain-broken" && cBroken.kappa === s1.kappa, JSON.stringify(cBroken));

// ── 7 · an empty spine falls back to the live head ──────────────────────────────────────────────────
const cEmpty = await makeStrand({ backend: arrayBackend() }).reconcileResume(s1.kappa);
ok("emptyFallsBack", cEmpty.continuity === "empty" && cEmpty.kappa === s1.kappa, JSON.stringify(cEmpty));

// ── 8 · snapshot entries are operator-signed (authorship on the spine) ──────────────────────────────
const snaps = strand.replay({ kind: "session.snapshot" });
const vchain = await strand.verify();
ok("snapshotsAreSigned", vchain.ok && snaps.every((r) => r["holstr:sig"] && r["holstr:op"] === op.kappa), JSON.stringify({ ok: vchain.ok }));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-strand P1 — RESUME ON THE SPINE: each session resume point is mirrored as a hash-linked, operator-signed session.snapshot entry on the source chain, so the spine holds the true last point. The live last-write head is swappable; when it drifts from the spine the spine wins (continuity 'recovered'), a broken spine is never trusted ('chain-broken', fail-closed), and an empty spine falls back to the live head. Resume stops silently drifting — and can't be silently moved.",
  authority: "UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · holospaces Laws L1/L2/L5 · ADR-0104/0106 (Holo Session) · rests on #holo-session + #holo-strand + #holo-identity",
  witnessed,
  covers: witnessed ? ["resume-mirror", "continuity-ok", "drift-recovered", "default-drift-bug", "recovered-restores", "broken-chain-fail-closed", "empty-fallback", "signed-snapshots"] : [],
  sample: { trueLast: s3.kappa, stale: s1.kappa, snapshots: snaps.length, strandHead: strand.head() },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-strand-resume-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-strand witness — P1 RESUME ON THE SPINE (drift-proof resume through the source chain)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  true last: ${String(s3.kappa).slice(0, 28)}…  ·  recovered from stale: ${cDrift.continuity}  ·  snapshots on spine: ${snaps.length}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  resume follows the spine, not a swappable head" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
