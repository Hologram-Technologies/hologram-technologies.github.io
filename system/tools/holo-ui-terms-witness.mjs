#!/usr/bin/env node
// holo-ui-terms-witness.mjs — keep the SHELL CHROME jargon-free. The tooltips, labels and input hints a
// person reads while using the OS (title · aria-label · placeholder · alt across the frame UI) must be
// clear, concise and on-theme — no explanatory substrate jargon (Law L5, re-derivation, content-addressed,
// holospace, verifyDeep, UOR object) and no raw κ/did:holo in a LABEL. Placeholders MAY show accepted
// input formats (did:holo:…, holo://, ipfs://, bafy/Qm) — that teaches syntax, like "user@example.com" in
// an email field. Code fragments (attributes built by string concatenation) are skipped. Anti-drift ratchet.
//   node tools/holo-ui-terms-witness.mjs
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const FRAME = join(here, "../os/usr/share/frame");

const EXPL = [ /\bLaw L5\b/i, /\bL5\b/, /re-deriv\w*/i, /content[- ]address(ed|able|es|ing)?/i, /\bholospace\b/i, /\bverifyDeep\b/, /\bUOR[ -](object|substrate)\b/i, /verify by re-derivation/i ];
const IDENT = [ /κ/, /did:holo/i ];   // banned in LABELS (title/aria-label/alt); allowed in placeholders as input-format examples
const isCode = (v) => /encodeURIComponent|opts\.|\)\s*\?|\$\{|"\s*\+|\+\s*"|<\//.test(v);   // attribute built by JS concat → not static user copy
const ATTR = /(title|aria-label|placeholder|alt)\s*=\s*"([^"]*)"/g;
// toast/notify status + error messages a person reads — labels, so κ/did:holo are banned too (no input here).
const TOAST = /(?:toast|notify|showToast|notification)\s*\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g;

function scanFile(text) {
  const hits = []; let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(text))) {
    const attr = m[1].toLowerCase(), val = m[2];
    if (!val.trim() || isCode(val)) continue;
    const banned = [...EXPL, ...(attr === "placeholder" ? [] : IDENT)];
    for (const re of banned) if (re.test(val)) { hits.push({ attr, val: val.slice(0, 70), re: re.source }); break; }
  }
  TOAST.lastIndex = 0;
  while ((m = TOAST.exec(text))) {
    const val = m[2];
    for (const re of [...EXPL, ...IDENT]) if (re.test(val)) { hits.push({ attr: "toast", val: val.slice(0, 70), re: re.source }); break; }
  }
  // visible TEXT NODES (content between tags) — strip code/style first. Ban explanatory jargon + κ-compounds
  // (κ-store, κ-addressed…). Bare standalone κ / did:holo are ALLOWED here: they display an actual value
  // (an ID, a source list), like an input-format hint — not an explanation.
  const TEXT_BANNED = [...EXPL, /κ-[\wα-ωΑ-Ω]+/i];
  const stripped = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  for (const node of stripped.split(/<[^>]+>/)) {
    const t = node.replace(/\s+/g, " ").trim();
    if (t.length < 2) continue;
    for (const re of TEXT_BANNED) if (re.test(t)) { hits.push({ attr: "text", val: t.slice(0, 70), re: re.source }); break; }
  }
  return hits;
}

const checks = {}; let passed = 0, failed = 0;
const rec = (n, ok, d) => { checks[n] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };

// 1 · non-vacuous (labels, toasts AND text nodes)
rec("detects planted label + toast + text-node jargon (not vacuous)", scanFile('<a title="content-addressed κ (Law L5)">x</a>').length >= 1 && scanFile('toast("✗ refused re-derivation mismatch (Law L5)")').length >= 1 && scanFile('<p>served from the κ-store, every byte re-derives (Law L5)</p>').length >= 1);
// 2 · plain on-theme labels pass
rec("plain on-theme labels pass (verified · fingerprint · app · checks itself)", scanFile('<a title="Verified by its fingerprint — the app checks itself">').length === 0);
// 3 · input-format placeholders are allowed (teaching syntax, not jargon)
rec("input-format placeholders allowed (did:holo:… · holo:// · ipfs://)", scanFile('<input placeholder="https:// · did:holo:sha256:… · ipfs://… · bafy…">').length === 0);
// 4 · code-built attributes are skipped (no false positives)
rec("code-fragment attributes are skipped (no false positive)", scanFile('<a title=" + encodeURIComponent(title) + (opts.kappa ? "').length === 0);
// 5 · the whole shell chrome is clean
{
  const files = readdirSync(FRAME).filter((f) => f.endsWith(".html"));
  const violations = [];
  for (const f of files) { for (const h of scanFile(readFileSync(join(FRAME, f), "utf8"))) violations.push(`${f} [${h.attr}]: "${h.val}" /${h.re}/`); }
  rec("the shell chrome's labels + hints are clear, on-theme, jargon-free", violations.length === 0, `${files.length} chrome files${violations.length ? " · " + violations.slice(0, 6).join(" · ") : ""}`);
  if (violations.length) for (const v of violations) console.log("    ✗ " + v);
}

const witnessed = failed === 0;
writeFileSync(join(here, "holo-ui-terms-witness.result.json"), JSON.stringify({
  spec: "Shell chrome is jargon-free: tooltips, labels and input hints (title/aria-label/placeholder/alt) read clearly and on-theme — explanatory substrate jargon banned, raw κ/did:holo banned in labels, input-format placeholders allowed, code-built attributes skipped.",
  authority: "Deliverable D user-facing vocabulary · scan of user-visible attributes in os/usr/share/frame · self-test (planted + plain-allowed + input-format-allowed + code-skipped)",
  witnessed, covers: ["shell-chrome", "tooltips", "labels", "jargon-free", "on-theme"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-ui-terms-witness: ${passed} passed, ${failed} failed — ${witnessed ? "GREEN" : "RED"}`);
process.exit(witnessed ? 0 : 1);
