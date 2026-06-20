#!/usr/bin/env node
// csp-hashes.mjs — derive a strict, hash-based Content-Security-Policy for a content-addressed page.
//
// WHY HASHES (not nonces): a κ-served page is FIXED bytes pinned by hash (Law L5). A per-response
// nonce would change the bytes and break the pin, so the only CSP that composes with content addressing
// is one built from the sha256 of each INLINE block — which is itself a content address of that block.
// The CSP hash of an inline <script> IS the κ of its source. The two ideas are the same idea.
//
// WHAT IT DOES: for each target HTML file it hashes every inline <script> and <style> block (the exact
// bytes between the tags, as the browser hashes them), assembles a `script-src`/`style-src` allow-list,
// and emits a full policy. It also REPORTS the things that block ENFORCEMENT and must be refactored
// first: inline event-handler attributes (on*=), inline style= attributes, and cross-origin <script
// src>/<link href> (which a strict default-src 'self' would deny).
//
// OUTPUT: writes os/etc/boot-csp.json { "<serve-rel>": "<policy>" } consumed by holo-fhs-sw.js, which
// stamps it as Content-Security-Policy-REPORT-ONLY (observe, never block) until a real-browser pass
// confirms zero violations — then it is promoted to the enforcing header. Pass --check to print the
// report and the policies WITHOUT writing (CI / inspection).
//
//   node tools/csp-hashes.mjs            # regenerate os/etc/boot-csp.json
//   node tools/csp-hashes.mjs --check    # report only, write nothing

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const OUT = join(OS, "etc/boot-csp.json");
const checkOnly = process.argv.includes("--check");

// The controlled pre-desktop boot SCREENS: small, near-fully same-origin, minimal connectivity — the
// pages where a strict CSP is both highest-value and safe to lock. The cold entry (index.html) and the
// app platform (shell.html / home.html) are deliberately NOT here: index can only carry an ENFORCING
// meta (Report-Only is header-only) so it is promoted by hand after a browser pass; shell/home need a
// connect-src allow-list (they reach RPCs, gateways, peers) that is its own pass.
const TARGETS = [
  { rel: "splash.html", file: join(OS, "usr/share/frame/splash.html") },
  { rel: "login.html", file: join(OS, "usr/share/frame/login.html") },
];

// G3 (Law L5): the app platform pages can't take a hash-only script-src (too many inline blocks/handlers)
// and they legitimately reach the network. So they get a NARROWER policy whose ONLY job is to forbid
// cross-origin CODE EXECUTION: script-src locked to 'self'+wasm+inline (no https: origin), connect-src
// left unrestricted (no default-src ⇒ data fetches stay open, governed by Law L4 not CSP). Emitted as a
// fixed string (not hash-derived) so it survives regeneration; still served Report-Only by the SW.
const SCRIPT_LOCK = "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
const PLATFORM = [
  { rel: "shell.html", file: join(OS, "usr/share/frame/shell.html") },
  { rel: "home-screen.html", file: join(OS, "usr/share/frame/home-screen.html") },
];

// A CSP hash-source MUST be single-quoted (`'sha256-…'`); unquoted it is an invalid source expression
// the browser silently ignores — which would drop script-src to just 'self' and block every inline block.
const b64sha256 = (text) => "'sha256-" + createHash("sha256").update(text, "utf8").digest("base64") + "'";

// Inline <script>…</script> with NO src attribute → executed (or governed) inline; hash its exact body.
// We hash EVERY inline block regardless of type (json-ld, importmap, module, classic): hashing an extra
// non-executable block is harmless, MISSING one that the browser does check would brick the page.
const inlineScripts = (html) => {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) { if (!/\bsrc\s*=/i.test(m[1])) out.push(m[2]); }
  return out;
};
const inlineStyles = (html) => {
  const out = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
};
// Enforcement blockers — things a strict policy denies that hashes can't rescue without loosening it.
const eventHandlers = (html) => (html.match(/\son[a-z]+\s*=\s*["']/gi) || []).map((s) => s.trim().replace(/\s*=.*$/, ""));
const styleAttrs = (html) => (html.match(/\sstyle\s*=\s*["']/gi) || []).length;
const externalRefs = (html) => {
  const out = [];
  const re = /<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const u = m[1];
    if (/^https?:\/\//i.test(u) || u.startsWith("//")) out.push(u);   // cross-origin absolute; relative/same-origin is 'self'
  }
  return out;
};

const policyFor = (scriptHashes, styleHashes) => [
  "default-src 'self'",
  "script-src 'self' " + scriptHashes.join(" "),
  "style-src 'self' " + styleHashes.join(" "),
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const manifest = {
  "_comment": "Strict per-page CSP for the boot screens, hash-derived by tools/csp-hashes.mjs. Served by holo-fhs-sw.js as Content-Security-Policy-Report-Only (observe, do not block) until a browser pass shows zero violations, then promoted to the enforcing header. Regenerate after ANY edit to a listed page (the inline hashes drift).",
  "mode": "report-only",
};
let blockers = 0;
for (const t of TARGETS) {
  if (!existsSync(t.file)) { console.log(`  ?  ${t.rel} — not found, skipped`); continue; }
  const html = readFileSync(t.file, "utf8");
  const sh = inlineScripts(html).map(b64sha256);
  const st = inlineStyles(html).map(b64sha256);
  const handlers = eventHandlers(html);
  const styles = styleAttrs(html);
  const ext = externalRefs(html);
  manifest[t.rel] = policyFor(sh, st);
  console.log(`\n  ◆ ${t.rel}`);
  console.log(`      inline script blocks: ${sh.length}   inline style blocks: ${st.length}`);
  if (handlers.length) { blockers++; console.log(`      ⚠ ENFORCE-BLOCKER — ${handlers.length} inline event handler(s): ${[...new Set(handlers)].join(", ")} (refactor to addEventListener, or add 'unsafe-hashes')`); }
  if (styles) { blockers++; console.log(`      ⚠ ENFORCE-BLOCKER — ${styles} inline style="" attribute(s) (move to a <style> block / class, or style-src needs 'unsafe-inline')`); }
  if (ext.length) { blockers++; console.log(`      ⚠ ENFORCE-BLOCKER — cross-origin ref(s): ${ext.join(", ")} (add the origin to the matching directive)`); }
  if (!handlers.length && !styles && !ext.length) console.log(`      ✓ no enforcement blockers — safe to promote Report-Only → enforcing after a browser pass`);
}

// G3: the platform pages carry only the cross-origin-CODE lock (script-src), reported for code offenders.
manifest["_shell_comment"] = "shell.html / home-screen.html are the APP PLATFORM, not a controlled boot screen: many inline scripts/handlers + real network reach (RPCs, gateways, peers, governed import fetch). A hash-only script-src is infeasible; the G3 goal is narrower — forbid cross-origin CODE EXECUTION. script-src locks to 'self'+wasm+inline (no https: origin serves a script/module); connect-src stays open (data fetches governed by Law L4, not CSP). Report-Only until a browser pass.";
for (const t of PLATFORM) {
  if (!existsSync(t.file)) { console.log(`  ?  ${t.rel} — not found, skipped`); continue; }
  const html = readFileSync(t.file, "utf8");
  const codeLoads = [
    ...html.matchAll(/\bimport\s*\(\s*["']https?:\/\/[^"']+/gi),
    ...html.matchAll(/\bimport\b[^;'"]*?\bfrom\s*["']https?:\/\/[^"']+/gi),
    ...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//gi),
  ];
  manifest[t.rel] = SCRIPT_LOCK;
  console.log(`\n  ◆ ${t.rel} (platform — script-src lock only)`);
  if (codeLoads.length) { blockers++; console.log(`      ⚠ G3 BLOCKER — ${codeLoads.length} cross-origin CODE load(s) remain; vendor them before promoting to enforcing`); }
  else console.log(`      ✓ no cross-origin code load — safe to promote Report-Only → enforcing after a browser pass`);
}

if (!checkOnly) { writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n"); console.log(`\nwrote ${OUT}`); }
else console.log(`\n(check only — nothing written)`);
console.log(`${blockers} page(s) carry enforcement blockers; Report-Only is unaffected (it never blocks).`);
