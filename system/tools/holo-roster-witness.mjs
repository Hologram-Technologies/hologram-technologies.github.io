// holo-roster-witness.mjs — asserts SEC-4: a roster is CONTENT-ADDRESSED and BINDS its operator.
//
// Proves, against the DEPLOYED runtime (os/usr/lib/holo/holo-identity.mjs), that:
//   (a) the roster is content-addressed   — its κ re-derives from its own canonical bytes (Law L5),
//   (b) it binds its operator             — changing the operator changes the roster κ,
//   (c) membership is committed           — adding/removing a member changes the roster κ,
//   (d) tampering is caught               — a mutated roster does not re-derive to its κ.
//
// No browser: holo-identity falls back to an in-memory store under node (hasIDB === false), so
// enroll/forget mutate the same `store.all()` that contentRoster() reads. Run: node tools/holo-roster-witness.mjs

import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { enroll, forget, contentRoster, verifyRoster } from "../os/usr/lib/holo/holo-identity.mjs";

let pass = 0, fail = 0;
const rec = (name, ok) => { (ok ? (pass++, console.log("  ok   " + name)) : (fail++, console.log("  FAIL " + name))); };

const KAPPA = /^did:holo:sha256:[0-9a-f]{64}$/;

async function main() {
  // Two operators enrolled on this (in-memory) device.
  const alice = await enroll({ label: "alice", passphrase: "correct horse" });
  const bob   = await enroll({ label: "bob",   passphrase: "battery staple" });

  // ── (a) content-addressed: κ shape + re-derives from its own bytes (Law L5)
  const r1 = await contentRoster(alice);
  rec("rosterKappa is a did:holo:sha256 κ", KAPPA.test(r1.rosterKappa));
  rec("(a) roster κ re-derives from its bytes (verifyRoster passes)", (await verifyRoster(r1)) !== null);
  // independent re-derivation: recompute and compare (not just trust verifyRoster)
  const r1again = await contentRoster(alice);
  rec("(a) re-derivation is deterministic (same operator+members ⇒ same κ)", r1again.rosterKappa === r1.rosterKappa);

  // ── (b) binds its operator: same members, different operator ⇒ different κ
  const rBob = await contentRoster(bob);
  rec("(b) operator κ is committed in the body", r1.operator === alice.kappa && rBob.operator === bob.kappa);
  rec("(b) changing the operator changes the roster κ", rBob.rosterKappa !== r1.rosterKappa);

  // ── (c) membership is committed: remove a member ⇒ different κ
  rec("members are sorted identity κs", JSON.stringify(r1.members) === JSON.stringify([...r1.members].sort()) && r1.members.every((m) => KAPPA.test(m)));
  rec("(c) roster of 2 commits both members", r1.members.includes(alice.kappa) && r1.members.includes(bob.kappa));
  await forget(bob.kappa);
  const r1after = await contentRoster(alice);
  rec("(c) removing a member changes the roster κ", r1after.rosterKappa !== r1.rosterKappa);
  rec("(c) removed member no longer in the roster", !r1after.members.includes(bob.kappa));

  // ── (d) tamper-refuse: mutate operator / members / κ ⇒ verifyRoster returns null
  rec("(d) tampered operator is caught", (await verifyRoster({ ...r1, operator: "did:holo:sha256:" + "0".repeat(64) })) === null);
  rec("(d) tampered members are caught", (await verifyRoster({ ...r1, members: [] })) === null);
  rec("(d) tampered κ is caught", (await verifyRoster({ ...r1, rosterKappa: "did:holo:sha256:" + "f".repeat(64) })) === null);
  // a roster whose canon was swapped to commit different bytes than its κ
  rec("(d) canon/κ mismatch is caught", (await verifyRoster({ ...r1, canonical: r1.canonical + " " })) === null);

  // ── no-operator must refuse (a roster with no operator is not SEC-4)
  let refused = false;
  try { await contentRoster(undefined); } catch { refused = true; }
  rec("contentRoster refuses with no operator", refused);

  // cleanup
  await forget(alice.kappa);

  console.log("\nholo-roster-witness: " + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
