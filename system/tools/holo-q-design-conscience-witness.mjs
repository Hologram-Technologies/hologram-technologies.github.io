// holo-q-design-conscience-witness.mjs — re-derivable proof that beauty is an INVARIANT (S4): generated HTML is
// audited against the holo product spec and REPAIRED (raw colors → --holo-* tokens, ad-hoc spacing → token
// scale, token :root/dark-default injected, viewport ensured, <img> alt added), and enforce() is IDEMPOTENT —
// once repaired it audits clean and re-repairing is a no-op. Deterministic. Pure Node.
// Run: node holo-q-design-conscience-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const { audit, repair, enforce, TOKENS, SPACE } = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-design-conscience.mjs")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// an "ugly" model output: raw hex colors, off-scale spacing, no viewport, no tokens, an <img> with no alt.
const UGLY = '<!doctype html><html><head><title>x</title>'
  + '<style>.card{background:#12141c;color:#ffffff;padding:13px;margin:7px;border:1px solid #303541}'
  + '.btn{background:#2861e0;gap:9px}</style></head>'
  + '<body><div class="card"><h2 style="color:#cccccc;margin:5px">Hi</h2>'
  + '<img src="/logo.png"><button class="btn">Go</button></div></body></html>';

console.log("\nholo-q design conscience — beautiful by construction (audit → repair → clean)\n");

// ── 1) audit flags the violations ─────────────────────────────────────────────────────────────────────────
console.log("audit catches the violations:");
{
  const a = audit(UGLY);
  const rules = a.violations.map((v) => v.rule);
  ok(!a.clean, "ugly output is flagged (not clean)");
  ok(rules.includes("raw-color"), "raw hex/rgb colors are flagged");
  ok(rules.includes("off-scale-spacing"), "off-scale spacing (13px/7px/5px/9px) is flagged");
  ok(rules.includes("no-tokens-root"), "missing --holo-* token root (dark-default) is flagged");
  ok(rules.includes("no-viewport"), "missing responsive viewport is flagged");
  ok(rules.includes("img-no-alt"), "an <img> with no alt is flagged (a11y)");
}

// ── 2) repair fixes them deterministically ────────────────────────────────────────────────────────────────
console.log("\nrepair makes it on-brand:");
{
  const r = repair(UGLY);
  ok(!/#[0-9a-fA-F]{3,6}\b/.test(r.html.replace(/\/\*holo-tokens\*\/[\s\S]*?<\/style>/, "")), "no raw hex remains in app CSS (token root excepted)");
  ok(/var\(--holo-(bg|surface|fg|muted|accent|border)\)/.test(r.html), "colors are now --holo-* token vars");
  ok(/var\(--holo-space-\d+\)/.test(r.html), "spacing now uses the token space scale");
  ok(r.html.includes("color-scheme:dark") && r.html.includes("--holo-bg:"), "the dark-default token :root was injected (vars resolve)");
  ok(/<meta[^>]+viewport/i.test(r.html), "a responsive viewport meta was added");
  ok(/<img\b[^>]*\salt\s*=/.test(r.html), "the <img> got an alt attribute");
}

// ── 3) IDEMPOTENT: enforce → clean, and re-enforcing changes nothing ──────────────────────────────────────
console.log("\nidempotent: once enforced it stays clean (a verified invariant):");
{
  const e1 = enforce(UGLY);
  ok(e1.clean, "after enforce(), the output audits CLEAN (0 violations)");
  const e2 = enforce(e1.html);
  ok(e2.clean && e2.fixed.length === 0, "re-enforcing an already-clean doc fixes nothing (idempotent)");
  ok(e2.html === e1.html, "deterministic: enforce(enforce(x)) === enforce(x)");
}

// ── 4) a snapped spacing value lands on the token scale; a color maps to the NEAREST token ────────────────
console.log("\ncorrectness of the mappings:");
{
  const r = repair('<div style="margin:13px;color:#0c0e15">x</div>');
  ok(/margin:var\(--holo-space-12\)/.test(r.html), "the 13px MARGIN snapped to the nearest scale token (--holo-space-12, not 0/16)");
  ok(!/margin:var\(--holo-space-(0|16)\)/.test(r.html), "…and specifically not mis-snapped to 0 or 16");
  ok(r.html.includes("color:var(--holo-bg)"), "#0c0e15 mapped to the nearest token (--holo-bg ≈ #0b0e16)");
}

// ── 5) a clean, already-tokenized doc is left essentially untouched (no false positives) ──────────────────
console.log("\nno false positives on already-clean input:");
{
  const CLEAN = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<style>/*holo-tokens*/:root{color-scheme:dark}.x{color:var(--holo-fg);padding:var(--holo-space-16)}</style></head>'
    + '<body><img src="a" alt="logo"><div class="x">ok</div></body></html>';
  ok(audit(CLEAN).clean, "a token-only, viewport+alt doc audits clean as-is");
  ok(enforce(CLEAN).fixed.length === 0, "enforce() leaves a clean doc unchanged (no churn)");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
