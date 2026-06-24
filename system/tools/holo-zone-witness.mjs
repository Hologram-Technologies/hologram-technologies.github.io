#!/usr/bin/env node
// holo-zone-witness.mjs — proves A MUTABLE NAME OWNED BY A KEY ON THE OPERATOR'S SOURCE CHAIN (holo-zone):
// the registrar-free, root-free, blockchain-free replacement for a DNS zone. A name is a `zone.bind` entry
// on holo-strand; resolution VERIFIES the whole chain then reads the latest binding (Law L5, fail-closed);
// mutation appends; the prior target stays in history. Ownership is the operator signature — only the owner
// can change a name under their zone, and you cannot be tricked into reading a foreign chain as the owner
// you asked for. It rides the SAME spine as the rest of history (Law L2), roams cross-device verify-before-
// adopt, and resolves through the SAME one omni door as κ/ENS/CID/web (holo-zone-lane).
//
// Drives the REAL substrate: holo-strand (hash-linked, signed, append-only) + a REAL enrolled holo-identity
// operator as signer. In-memory array backend so a fresh zone can "reload" a received chain (roam proof).
//
// Checks (all must hold):
//   1 bindAndResolve        — bind a name; resolve returns its target κ + the holo://zone/<owner>/<label> name.
//   2 mutableRebind         — re-bind the same name; resolve returns the NEW target; the OLD target stays in history.
//   3 independentLabels     — a second name resolves on its own; the first is unaffected (last-write-wins per label).
//   4 revokeUnbinds         — revoke a name ⇒ it resolves unbound; other names still resolve.
//   5 headAttestsZone       — verifyZone ok; the zone head === the strand head (one spine).
//   6 tamperRefused         — mutate a binding's target on disk ⇒ resolve fails closed (chain won't re-derive).
//   7 foreignOwnerRefused   — open the owner's REAL chain while CLAIMING a different owner ⇒ refused (no hijack).
//   8 crossDeviceAdopt      — a peer adopts the serialised zone (verify-before-adopt) and resolves it OFFLINE;
//                             a peer adopting a FOREIGN-signed chain as this owner is refused.
//   9 laneResolves          — parseZoneRef/classifyZone tag the name; resolveZone routes it to the owner's zone.
//  10 laneFailsClosed       — a malformed name won't parse; an unknown owner / unbound label fail closed.
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · W3C PROV-O · holospaces Laws L1/L2/L3/L5
// · rests on #holo-strand + #holo-identity + #holo-object. node tools/holo-zone-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeZone, normTarget } from "../os/usr/lib/holo/holo-zone.mjs";
import { parseZoneRef, classifyZone, resolveZone } from "../os/sbin/holo-zone-lane.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let store = clone(init); return { load: async () => clone(store), save: async (r) => { store = clone(r); }, dump: () => clone(store) }; };

let tick = 0;
const now = () => `2026-06-23T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const kA = "a1".repeat(32), kB = "b2".repeat(32), kC = "c3".repeat(32);   // three distinct 64-hex κ targets
const tA = normTarget(kA), tB = normTarget(kB), tC = normTarget(kC);

// a REAL operator (the zone owner) and a SECOND operator (an impostor / a different owner)
const owner = await enroll({ label: "zone-owner", passphrase: "correct horse battery" });
const other = await enroll({ label: "impostor", passphrase: "tr0ub4dor and-3" });
const ownerHex = owner.kappa.split(":").pop();

// ── build the owner's zone on a real signed strand ───────────────────────────────────────────────────
const backend = arrayBackend();
const zone = makeZone({ owner, backend, now });
const r1 = await zone.bind("ilya.deck", kA);

// 1 · bind + resolve → target κ and the qualified holo://zone name
const g1 = await zone.resolve("ilya.deck");
ok("bindAndResolve", r1.ok && g1.ok && g1.target === tA && g1.name === `holo://zone/${ownerHex}/ilya.deck`, JSON.stringify(g1));

// 2 · mutate the name by appending a new binding; new target wins, old target survives in history
await zone.bind("ilya.deck", kB);
const g2 = await zone.resolve("ilya.deck");
const oldStillInHistory = zone.entries().some((e) => e["holstr:kind"] === "zone.bind" && (e["holstr:payload"] || {}).label === "ilya.deck" && (e["holstr:payload"] || {}).target === tA);
ok("mutableRebind", g2.ok && g2.target === tB && oldStillInHistory, `now=${g2.target} oldKept=${oldStillInHistory}`);

// 3 · a second, independent name
await zone.bind("home", kC);
const gh = await zone.resolve("home"), gd = await zone.resolve("ilya.deck");
ok("independentLabels", gh.ok && gh.target === tC && gd.ok && gd.target === tB, JSON.stringify({ home: gh.target, deck: gd.target }));

// 4 · revoke unbinds that name only
await zone.revoke("home");
const gh2 = await zone.resolve("home"), gd2 = await zone.resolve("ilya.deck");
ok("revokeUnbinds", gh2.ok === false && gh2.why === "unbound" && gd2.ok === true && gd2.target === tB, JSON.stringify({ home: gh2.why, deck: gd2.ok }));

// 5 · the head κ attests the zone (one spine: zone head === strand head)
const vz = await zone.verifyZone();
ok("headAttestsZone", vz.ok && vz.head === zone.head() && zone.head() === zone.strand.head(), JSON.stringify(vz));

// 6 · tamper a binding's target on disk ⇒ resolve fails closed (the chain no longer re-derives)
const tampered = clone(backend.dump());
const idx = tampered.findIndex((e) => e["holstr:kind"] === "zone.bind" && (e["holstr:payload"] || {}).label === "ilya.deck");
tampered[idx]["holstr:payload"].target = normTarget("dead".padEnd(64, "0"));   // point the name somewhere else
const evil = makeZone({ owner: owner.kappa, backend: arrayBackend(tampered) });
const gt = await evil.resolve("ilya.deck");
ok("tamperRefused", gt.ok === false && /zone-unverified/.test(gt.why), JSON.stringify(gt));

// 7 · open the owner's REAL (untampered) chain while CLAIMING a different owner ⇒ refused (namespace can't be hijacked)
const claimed = makeZone({ owner: other.kappa, backend: arrayBackend(backend.dump()) });
const vc = await claimed.verifyZone();
const gc = await claimed.resolve("ilya.deck");
ok("foreignOwnerRefused", vc.ok === false && vc.why === "foreign-owner" && gc.ok === false, JSON.stringify({ vc, resolve: gc.ok }));

// 8 · a peer adopts the serialised zone (verify-before-adopt) and resolves it OFFLINE; a foreign chain is refused
const wire = zone.entries();                                   // what would travel over gossip / roam
const peer = makeZone({ owner: owner.kappa, backend: arrayBackend([]) });   // read-only peer, empty, no network
const adopted = await peer.adopt(wire);
const gp = await peer.resolve("ilya.deck");
const foreignZone = makeZone({ owner: other, backend: arrayBackend(), now });
await foreignZone.bind("evil", kA);
const rejectForeign = await peer.adopt(foreignZone.entries());  // peer (owner) must refuse a chain signed by `other`
ok("crossDeviceAdopt", adopted.ok && gp.ok && gp.target === tB && rejectForeign.ok === false, JSON.stringify({ adopted: adopted.ok, peerSees: gp.target, refusedForeign: !rejectForeign.ok }));

// 9 · the lane: classify + resolve a Holo name through the one omni door
const name = zone.qualified("ilya.deck");
const ref = parseZoneRef(name);
const cls = classifyZone(name);
const lr = await resolveZone(name, { openZone: async (o) => (o === ownerHex ? zone : null) });
ok("laneResolves", ref && ref.owner === ownerHex && ref.label === "ilya.deck" && cls && cls.lane === "zone" && lr.ok && lr.kappa === tB, JSON.stringify({ ref, cls, lr: { ok: lr.ok, kappa: lr.kappa } }));

// 10 · the lane fails closed: a malformed name won't parse; unknown owner & unbound label both refuse
const bad = parseZoneRef("holo://zone/not-a-key/x");
const unknownOwner = await resolveZone(`holo://zone/${"0".repeat(64)}/ghost`, { openZone: async () => null });
const unboundLabel = await resolveZone(zone.qualified("never-bound"), { openZone: async () => zone });
ok("laneFailsClosed", bad === null && unknownOwner.ok === false && unknownOwner.reason === "zone-unavailable" && unboundLabel.ok === false && unboundLabel.reason === "unbound", JSON.stringify({ bad, unknownOwner: unknownOwner.reason, unboundLabel: unboundLabel.reason }));

await forget(owner.kappa); await forget(other.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-zone — a MUTABLE NAME OWNED BY A KEY ON THE OPERATOR'S SOURCE CHAIN: the registrar-free, root-free, KSK-free, blockchain-free replacement for a DNS zone. A name is a zone.bind entry on holo-strand; resolution verifies the whole chain then reads the latest binding (Law L5, fail-closed); mutation appends (old target kept, rewindable); ownership is the operator signature (only the owner changes a name, no foreign-owner hijack). It rides the SAME spine as the rest of history (Law L2), resolves fully offline (Law L3), roams cross-device verify-before-adopt, and resolves through the SAME one omni door as κ/ENS/CID/web (holo-zone-lane).",
  authority: "UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · W3C PROV-O · holospaces Laws L1/L2/L3/L5 · rests on #holo-strand + #holo-identity + #holo-object",
  witnessed,
  covers: witnessed ? ["owned-mutable-name", "resolve-by-rederivation", "mutate-keeps-history", "revoke", "head-attests-zone", "tamper-refused", "foreign-owner-refused", "cross-device-adopt", "offline-resolve", "one-omni-door"] : [],
  sample: { name, target: tB, head: zone.head(), owner: owner.kappa },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-zone-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-zone witness — a mutable name owned by a key on the operator's source chain (registrar-free · root-free · verify-before-trust)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  name: ${name}\n  → ${tB}  ·  head ${String(zone.head()).slice(0, 28)}…`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  a name no registrar issued, no root signs, that cannot lie and works offline" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
