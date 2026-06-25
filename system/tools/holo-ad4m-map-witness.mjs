#!/usr/bin/env node
// holo-ad4m-map-witness.mjs — PROVE THE MAPPING before building the facade. Coasys/AD4M's meta-ontology
// is not a thing to port; it is a vocabulary that the κ substrate ALREADY satisfies. This witness drives
// the REAL substrate modules and asserts, mechanically, that:
//   Agent       ≡ an operator κ            (holo-identity.addressOf → did:holo:sha256, L1)
//   Expression  ≡ a sealed UOR object      (holo-object.seal — the URL is the content address, L1/L2)
//   Perspective ≡ a holo-strand of Links   (signed, append-only; head κ attests the graph; L5 over seq)
//
// Authority: AD4M meta-ontology (docs.ad4m.dev — Agent/Expression/Perspective/Link) · holospaces Laws
// L1 (id = H(content)) · L2 (one canonical wire, JCS) · L5 (re-derive, fail-closed). node tools/holo-ad4m-map-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { seal, verify as verifyObj, address } from "../os/usr/lib/holo/holo-object.mjs";
import { addressOf, enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-25T00:00:${String(tick++).padStart(2, "0")}.000Z`;

// ── 1 · Expression ≡ a sealed κ: the address is did:holo:sha256, and verify re-derives it ────────────────
const expr = seal({ "@type": ["ad4m:Expression"], "ad4m:data": { note: "hello wise web" } });
ok("expressionIsKappa", /^did:holo:sha256:[0-9a-f]{64}$/.test(expr.id) && verifyObj(expr) && expr.id === address(expr),
  `url=${String(expr.id).slice(0, 28)}…`);

// ── 2 · Agent ≡ an operator κ: a real enrolled principal's κ is the content address of its public key ────
const op = await enroll({ label: "ad4m-mapper", passphrase: "wise web first principles" });
const derivedDid = await addressOf(Uint8Array.from(atob(op.pub), (c) => c.charCodeAt(0)));
ok("agentIsKappa", /^did:holo:sha256:/.test(op.kappa) && derivedDid === op.kappa, `agent=${String(op.kappa).slice(0, 28)}…`);

// ── 3 · Perspective ≡ a strand of Links: two Links chain + the whole graph verifies ──────────────────────
const backend = arrayBackend();
const p = makeStrand({ backend, now, signer: op });
const L0 = await p.append({ kind: "ad4m:link", payload: { source: "me", predicate: "likes", target: expr.id } });
const L1 = await p.append({ kind: "ad4m:link", payload: { source: "me", predicate: "wrote", target: expr.id } });
const v = await p.verify();
ok("perspectiveIsStrand", v.ok && v.length === 2 && L1["holstr:prev"] === L0.id && p.head() === L1.id, JSON.stringify(v));

// ── 4 · L5 over the sequence: reorder the two Links ⇒ the Perspective refuses ─────────────────────────────
const reordered = clone(backend.dump()); [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
const vr = await makeStrand({ backend: arrayBackend(reordered) }).verify();
ok("reorderRefused", vr.ok === false, JSON.stringify(vr));

// ── 5 · L5 per Link: mutate a Link's target (predicate-object) ⇒ refuse at that index ─────────────────────
const tampered = clone(backend.dump()); tampered[1]["holstr:payload"].target = "did:holo:sha256:" + "0".repeat(64);
const vt = await makeStrand({ backend: arrayBackend(tampered) }).verify();
ok("tamperRefused", vt.ok === false && vt.brokeAt === 1, JSON.stringify(vt));

// ── 6 · the content-address core needs no signer: an unsigned Perspective still chains + verifies ─────────
const plain = makeStrand({ backend: arrayBackend(), now });
const q0 = await plain.append({ kind: "ad4m:link", payload: { source: "a", predicate: "p", target: "b" } });
const q1 = await plain.append({ kind: "ad4m:link", payload: { source: "b", predicate: "p", target: "c" } });
const vq = await plain.verify();
ok("unsignedPerspectiveChains", vq.ok && q1["holstr:prev"] === q0.id && !q0["holstr:sig"], JSON.stringify(vq));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "AD4M's meta-ontology is mechanically satisfied by the existing κ substrate: an Agent IS an operator κ (holo-identity), an Expression IS a sealed UOR object (holo-object), a Perspective IS a holo-strand of Link entries whose head κ attests the whole ordered graph (Law L5 over the sequence). No port, no daemon — a vocabulary mapped onto what the substrate already is.",
  authority: "AD4M meta-ontology (docs.ad4m.dev — Agent/Expression/Perspective/Link) · holospaces Laws L1/L2/L5 · rests on #holo-object + #holo-identity + #holo-strand",
  witnessed,
  covers: witnessed ? ["expression-is-kappa", "agent-is-kappa", "perspective-is-strand", "reorder-refused", "tamper-refused", "unsigned-chains"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-map-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m MAP witness — AD4M ≡ the κ substrate (Agent/Expression/Perspective mapped, not ported)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${Object.keys(checks).length}/${Object.keys(checks).length} GREEN — the mapping is true, not aspirational` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
