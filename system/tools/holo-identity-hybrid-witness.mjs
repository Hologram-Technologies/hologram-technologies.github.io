// holo-identity-hybrid-witness.mjs — proves the Greeter's identity is now HYBRID (Ed25519 ‖ ML-DSA),
// PC-typed, re-derivable, fail-closed, and backward-compatible with classical-only tokens (Law L5).
// Run: node system/tools/holo-identity-hybrid-witness.mjs
import { principalFromSeed } from "../os/usr/lib/holo/holo-login.mjs";
import { openSession, verifySession } from "../os/usr/lib/holo/holo-identity.mjs";
import { generateMnemonic, seedFromMnemonic } from "../os/usr/lib/holo/holo-wdk.js";

let pass = 0, fail = 0;
const ok = (n, c) => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"}  ${n}`); };

console.log("holo-identity — hybrid post-quantum session (the Greeter's door)\n");

const seed = seedFromMnemonic(generateMnemonic(12));
const p = await principalFromSeed(seed, "Ada");

ok("principal carries an ML-DSA-65 co-key (re-derived from the seed)", p.pqAlg === "ml-dsa-65" && typeof p.pqPub === "string" && p.pqPub.length > 0);
ok("Ed25519 κ is the canonical did:holo:sha256", /^did:holo:sha256:/.test(p.kappa));

const tok = await openSession(p, { session: "primeos", next: "home.html" });
ok("session is typed Player Character (subjectType=pc)", tok.subjectType === "pc");
ok("session carries the pq co-key + ML-DSA co-signature", !!tok.pqPub && !!tok.pqSig && tok.pqAlg === "ml-dsa-65");
ok("verifySession accepts the hybrid token (both sigs)", !!(await verifySession(tok)));

const p2 = await principalFromSeed(seed);
ok("pq co-key + κ re-derive from the same seed (Law L5)", p2.pqPub === p.pqPub && p2.kappa === p.kappa);

ok("rejects a swapped pq pubkey (id commits to it)", !(await verifySession({ ...tok, pqPub: p2.pqPub.slice(0, -4) + "AAAA" })));
const other = await openSession(await principalFromSeed(seedFromMnemonic(generateMnemonic(12))), { session: "x" });
ok("rejects a foreign ML-DSA co-signature", !(await verifySession({ ...tok, pqSig: other.pqSig })));
ok("rejects a tampered body (classical sig)", !(await verifySession({ ...tok, label: "Eve" })));

// agent path: a Non-Player Character session is explicitly typed
const npc = await openSession(p, { session: "primeos", subjectType: "npc" });
ok("agent session is typed Non-Player Character (subjectType=npc)", npc.subjectType === "npc" && !!(await verifySession(npc)));

// backward-compat: a classical-only principal (no pq) still opens + verifies exactly as before
const classical = { kappa: p.kappa, label: p.label, alg: p.alg, pub: p.pub, sign: p.sign };
const ctok = await openSession(classical, { session: "primeos" });
ok("classical-only session verifies (backward-compatible)", !ctok.pqPub && !ctok.pqSig && !!(await verifySession(ctok)));

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
