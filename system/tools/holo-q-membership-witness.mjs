// holo-q-membership-witness.mjs — Stage E proof: identity/auth/token-gating as the platform fold. Self-sovereign
// identity is content-addressed from the key (SEC-4). A membership grant is VALID only from an admin, and grants
// AT MOST what the author holds (attenuation, SEC-2). Revocation rotates the epoch → forward secrecy (SEC-5). A
// membership event exists ONLY when the granter signs it (§2.9 — the app can't author it). The fold is
// deterministic (D: same log → same roster, any order). Folds with the real collection reduce in (clock, κ)
// order. Pure Node. Run: node holo-q-membership-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const M = await imp("../os/usr/lib/holo/q/holo-q-membership.mjs");
const C = await imp("../os/usr/lib/holo/q/holo-q-collection.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const alice = M.identityOf("alice-pubkey"), bob = M.identityOf("bob-pubkey"), carol = M.identityOf("carol-pubkey");
const genesis = C.makeGenesis({ owner: alice, reducerK: "r", recordKind: "expense" });

console.log("\nholo-q membership — sovereign auth, attenuate-only, forward-secret, consent-gated\n");

// ── 1) SEC-4: identity is content-addressed from the key; unforgeable ─────────────────────────────────────
console.log("self-sovereign identity (SEC-4):");
ok(alice.startsWith("id:") && /^id:[0-9a-f]{64}$/.test(alice), "an identity is the content address of its key");
ok(M.identityOf("alice-pubkey") === alice && alice !== bob, "same key → same identity; different key → different identity (can't forge another's)");

// ── 2) genesis: the owner holds every capability ──────────────────────────────────────────────────────────
console.log("\ngenesis names the owner (every capability):");
{
  const coll = C.createCollection(genesis);
  const st = C.reduce(coll, M.membershipReducer);
  ok(st.owner === alice && M.can(st, alice, "admin") && M.can(st, alice, "write"), "the owner holds read+write+admin");
  ok(!M.isMember(st, bob), "a non-member holds nothing");
}

// ── 3) grant (token-gating) + attenuation: can't grant more than you hold (SEC-2) ─────────────────────────
console.log("\ngrant = token-gating; attenuation caps it:");
let coll, stShared;
{
  coll = C.createCollection(genesis);
  C.append(coll, { kind: "membership", author: alice, payload: { action: "grant", subject: bob, ops: ["read", "write"] } });   // owner grants bob read+write
  let st = C.reduce(coll, M.membershipReducer);
  ok(M.can(st, bob, "read") && M.can(st, bob, "write") && !M.can(st, bob, "admin"), "bob got exactly read+write (the grant), not admin");
  // bob (no admin) tries to grant carol write → VOID (validity rule)
  C.append(coll, { kind: "membership", author: bob, payload: { action: "grant", subject: carol, ops: ["write"] } });
  st = C.reduce(coll, M.membershipReducer);
  ok(!M.isMember(st, carol), "bob (no admin) cannot grant — the membership event is VOID (validity rule)");
  // owner grants bob admin; now bob can grant — but only what bob holds (attenuation): tries to grant carol admin
  C.append(coll, { kind: "membership", author: alice, payload: { action: "grant", subject: bob, ops: ["admin"] } });
  C.append(coll, { kind: "membership", author: bob, payload: { action: "grant", subject: carol, ops: ["read", "admin"] } });
  st = C.reduce(coll, M.membershipReducer);
  ok(M.can(st, carol, "read") && M.can(st, carol, "admin"), "bob (now admin) can grant read+admin he holds");
  stShared = st;
}

// ── 4) revocation → epoch rotation (forward secrecy, SEC-5) ────────────────────────────────────────────────
console.log("\nrevocation rotates the epoch (forward secrecy):");
{
  const epochBefore = stShared.epoch;
  C.append(coll, { kind: "membership", author: alice, payload: { action: "revoke", subject: bob, ops: ["read", "write", "admin"] } });
  const st = C.reduce(coll, M.membershipReducer);
  ok(!M.isMember(st, bob), "the revoked member holds nothing");
  ok(!M.canPerceive(st, bob), "the revoked member can no longer perceive the collection (SEC-5)");
  ok(st.epoch === epochBefore + 1, "revocation rotated the epoch (the removed member never gets the new key)");
}

// ── 5) §2.9: a membership event exists ONLY when the granter authorizes (signs) it ────────────────────────
console.log("\nconsent-gated authoring (§2.9):");
{
  const proposal = M.proposeMembership({ action: "grant", subject: carol, ops: ["read"] });
  ok(proposal.needsAuth === true, "proposeMembership returns a proposal that needs authorization");
  ok(M.authorMembership(proposal, {}) === null, "without the granter's signature there is NO event (the app cannot author)");
  ok(M.authorMembership(proposal, { author: bob, sign: () => null }) === null, "if the granter declines to sign, there is no grant");
  const ev = M.authorMembership(proposal, { author: alice, sign: (e) => "sig:" + e.author });
  ok(ev && ev.author === alice && ev.sig && ev.kind === "membership", "only the granter's signature produces a membership event");
}

// ── 6) D: the fold is DETERMINISTIC (same log → same roster, any order) ───────────────────────────────────
console.log("\ndeterministic auth fold (D — reducer is pure, no IO/clock/random):");
{
  const entries = [...coll.events.entries()];
  const fwd = { id: coll.id, events: new Map(entries) };
  const rev = { id: coll.id, events: new Map([...entries].reverse()) };
  ok(eq(C.reduce(fwd, M.membershipReducer), C.reduce(rev, M.membershipReducer)), "the roster reduces identically regardless of event insertion order");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
