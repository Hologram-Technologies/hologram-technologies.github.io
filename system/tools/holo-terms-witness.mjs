#!/usr/bin/env node
// holo-terms-witness.mjs — one-term-one-meaning CI (Deliverable D). Enforces a CANONICAL vocabulary in
// first-party concept prose: a curated banned-synonym table maps each deprecated/ambiguous term to its one
// canonical form. The lint (1) is NOT vacuous — it detects a planted banned term; (2) does NOT flag the
// canonical primitives (κ-object, did:holo:sha256, render registry…); (3) keeps the first-party docs CLEAN,
// failing CI if any banned synonym reappears. This is the anti-drift ratchet: the κ-substrate primitives
// (κ, did:holo, κ-object) are DELIBERATE and allowed — only genuine SYNONYM DRIFT is banned.
//
// Scope: first-party prose (.md/.mdx) under system/, excluding vendored/build trees. Word-boundary matching
// avoids substring false positives (e.g. "copy-link-address", "kobjects"). Pure Node → gated live (LIVE_EXIT).
//   node tools/holo-terms-witness.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM = join(here, "..");

// banned synonym → the ONE canonical term (with why). All are forward-ratchet (absent from first-party prose
// today); reintroducing one fails CI. NOT banned: κ, κ-object, did:holo, κ-store, κ-address — the canonical primitives.
const BANNED = [
  { re: /\brender substrate\b/i, canon: "render registry / renderer", why: "ambiguous — split into 'renderer' (κ→view) and 'model engine' (GPU inference)" },
  { re: /\b(k-object|kappa-object|kappa object)\b/i, canon: "κ-object", why: "one term for the content-addressed object" },
  { re: /\b(k-address|kappa-address)\b/i, canon: "κ-address (or 'address')", why: "one term for the content-derived name" },
  { re: /\b(k-store|kappa store)\b/i, canon: "κ-store", why: "one term for the content-addressed store" },
  { re: /\bcontent-address store\b/i, canon: "κ-store", why: "one term for the content-addressed store" },
];
const scanText = (text) => { const hits = []; for (const b of BANNED) { const m = text.match(new RegExp(b.re, b.re.flags.includes("g") ? b.re.flags : b.re.flags + "g")); if (m) hits.push({ term: m[0], canon: b.canon }); } return hits; };

const EXCLUDE = /(^|[\\/])(\.git|node_modules|target|dist|\.astro|vendor|devtools|prism-btc|three|aframe|monaco|codemirror|xterm)([\\/]|$)/;
const PROSE = new Set([".md", ".mdx"]);
function walk(dir, out = []) {
  let ents; try { ents = readdirSync(dir); } catch { return out; }
  for (const n of ents) { const p = join(dir, n); if (EXCLUDE.test(p)) continue; let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out); else if (PROSE.has(extname(p).toLowerCase())) out.push(p); }
  return out;
}

const checks = {}; let passed = 0, failed = 0;
const rec = (n, ok, d) => { checks[n] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };

// 1 · NOT vacuous — the lint detects planted banned terms
{ const h = scanText("we mount it through the render substrate as a k-object in the kappa store"); rec("the lint detects planted banned synonyms (not vacuous)", h.length === 3, h.map((x) => x.term).join(",")); }
// 2 · canonical primitives are NOT flagged
{ const h = scanText("the κ-object resolves via did:holo:sha256 and renders through the render registry / renderer onto the κ-store"); rec("canonical terms (κ-object · did:holo · render registry · κ-store) are NOT flagged", h.length === 0, h.map((x) => x.term).join(",") || "clean"); }
// 3 · first-party concept prose is CLEAN (the enforcement)
{
  const files = walk(SYSTEM);
  const violations = [];
  for (const f of files) { const hits = scanText(readFileSync(f, "utf8")); for (const hit of hits) violations.push(`${relative(SYSTEM, f)}: "${hit.term}" → ${hit.canon}`); }
  rec("first-party concept prose holds the one-term-one-meaning vocabulary (anti-drift ratchet)", violations.length === 0, `${files.length} prose files scanned${violations.length ? " · " + violations.slice(0, 5).join(" · ") : ""}`);
  if (violations.length) for (const v of violations) console.log("    ✗ " + v);
}

const witnessed = failed === 0;
writeFileSync(join(here, "holo-terms-witness.result.json"), JSON.stringify({
  spec: "One-term-one-meaning terminology lint: a canonical vocabulary enforced in first-party concept prose; banned synonyms (render substrate, k-object, k-address, k-store…) fail CI; the κ-substrate primitives (κ-object, did:holo, κ-store) are the canonical, allowed forms. Anti-drift ratchet.",
  authority: "Deliverable D terminology system · word-boundary scan of first-party .md/.mdx prose · self-test (planted detection + canonical-allowed) so the lint is provably non-vacuous",
  witnessed, banned: BANNED.map((b) => ({ canon: b.canon, why: b.why })),
  covers: ["terminology", "one-term-one-meaning", "anti-drift", "canonical-vocabulary"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-terms-witness: ${passed} passed, ${failed} failed — ${witnessed ? "GREEN" : "RED"}`);
process.exit(witnessed ? 0 : 1);
