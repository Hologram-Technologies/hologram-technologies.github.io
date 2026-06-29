#!/usr/bin/env node
// holo-language-fold-witness.mjs — STEP B of the ADAM convergence: FOLD the adapters onto the ONE Language
// seam. Proves the three REAL adapters (web=storage+transport, web3=storage, ai=compile) routed through
// node.languages produce a BIT-IDENTICAL κ to the bespoke registerAll+createExpression path (Law: bit-identity),
// are now capability-typed in one registry, and round-trip (express→get, L5). The fold changes homing, not bytes.
// Authority: ADAM Language · the objective seam · Law: content-addressing-is-performance / bit-identity.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeAd4m } from "../os/usr/lib/holo/holo-ad4m.mjs";
import { makeNode } from "../os/usr/lib/holo/holo-node.mjs";
import { registerAll, foldInto } from "../os/usr/lib/holo/holo-ad4m-lang.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tick = 0; const now = () => `2026-06-27T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const me = await enroll({ label: "fold-me", passphrase: "fold the scatter" });
const samples = {
  web: { data: "hello from http", source: "https://x.test/a", contentType: "text/plain" },
  web3: { content: "0xdeadbeef", caip: "eip155:1/erc721:0xabc/1" },
  ai: { output: "a generated answer", model: "q-0.5b", prompt: "say something" },
};

// Path A — BESPOKE: the old registerAll + createExpression path
const ad4m = makeAd4m({ signer: me, now });
registerAll(ad4m);
const A = Object.fromEntries(Object.entries(samples).map(([k, s]) => [k, ad4m.createExpression(k, s).url]));

// Path B — FOLDED: the same adapters routed through the ONE capability-typed registry
const node = makeNode({ signer: me, now });
const folded = foldInto(node);
const B = Object.fromEntries(Object.entries(samples).map(([k, s]) => [k, node.languages.express(k, s).url]));

// ── 1 · BIT-IDENTITY parity: folded κ === bespoke κ, for all three real adapters ──────────────────────
const parity = Object.keys(samples).every((k) => A[k] === B[k] && String(A[k]).startsWith("did:holo:"));
ok("foldIsBitIdentical", parity, JSON.stringify(Object.fromEntries(Object.keys(samples).map((k) => [k, A[k] === B[k]]))));

// ── 2 · the folded adapters are capability-typed in ONE registry ──────────────────────────────────────
const cap = (c) => node.languages.byCapability(c).map((L) => L.name);
ok("foldedAreCapabilityTyped",
  cap("storage").includes("web") && cap("storage").includes("web3") && cap("compile").includes("ai") && cap("transport").includes("web"),
  JSON.stringify({ storage: cap("storage"), transport: cap("transport"), compile: cap("compile") }));

// ── 3 · the three real adapters cover three capabilities of the taxonomy ──────────────────────────────
const covered = node.languages.coveredCapabilities();
ok("realAdaptersCoverThreeCaps", ["storage", "transport", "compile"].every((c) => covered.includes(c)) && folded.length === 3, covered.join(","));

// ── 4 · one registry round-trips: express → get re-verifies (Law L5) ──────────────────────────────────
const roundTrips = Object.keys(samples).every((k) => { const u = node.languages.express(k, samples[k]).url; const got = node.languages.get(u); return got && got.id === u; });
ok("oneRegistryRoundTrips", roundTrips, "express→get re-verifies for web/web3/ai");

await forget(me.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-language-fold (ADAM convergence Step B) — the real web/web3/ai adapters folded onto the ONE Language registry produce a BIT-IDENTICAL κ to the bespoke registerAll+createExpression path; they are now capability-typed (storage/transport/compile) in one seam and round-trip (L5). The fold re-homes, never re-bytes (bit-identity).",
  authority: "ADAM Language · objective seam · Law: bit-identity / content-addressing-is-performance",
  witnessed, parityA: A, parityB: B, checks, failed: fail,
};
writeFileSync(join(here, "holo-language-fold-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-language-fold — STEP B: fold real adapters onto the ONE Language seam (bit-identical)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — web/web3/ai folded, κ bit-identical, one registry` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
