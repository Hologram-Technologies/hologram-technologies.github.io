#!/usr/bin/env node
// holo-catalog-terms-witness.mjs — keep the USER-FACING app catalog jargon-free. The launcher shows each
// app's name + description to ordinary people, so that copy must be clear, concise, self-explanatory and
// on-theme — NO raw substrate jargon (κ, content-addressed, re-derivation, holospace, L5, self-verifying,
// holo://κ). The plain on-theme vocabulary is used instead: "verified" / "checked genuine" / "self-checking"
// / "tamper-proof" / "no server". Internal identity fields (did:holo @id) are NOT user copy and are ignored;
// genuine external proper names (e.g. "UOR-Framework") are allowed. Anti-drift ratchet; provably non-vacuous.
//   node tools/holo-catalog-terms-witness.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// guard BOTH catalogs: the served copy (what users see) and the apps-repo source (so it can't drift back).
// The source lives in a sibling repo and may be absent in a lean checkout — scanned only if present.
const CATALOGS = [
  { path: join(here, "../os/usr/share/holospaces/index.jsonld"), label: "served" },
  { path: join(here, "../../../holo-apps/apps/index.jsonld"), label: "source" },
].filter((c) => existsSync(c.path));

// banned in USER COPY (name + description). Plain on-theme replacements are the canonical forms.
const BANNED = [
  { re: /κ/, why: "no raw κ in user copy → say 'verified' / 'checked genuine'" },
  { re: /content[- ]address(ed|able|es|ing)?/i, why: "→ 'verified' / 'tamper-proof'" },
  { re: /\bre-deriv\w*/i, why: "→ 'checks itself' / 'proves itself genuine'" },
  { re: /\bUOR[ -](object|substrate)\b/i, why: "→ 'verified object' (proper name 'UOR-Framework' is allowed)" },
  { re: /\bholospace\b/i, why: "→ 'app' / 'space'" },
  { re: /\bL5\b/, why: "drop the law number from user copy" },
  { re: /self-verifying/i, why: "→ 'self-checking'" },
];
const scan = (text) => BANNED.filter((b) => b.re.test(String(text))).map((b) => b.re.source);

const checks = {}; let passed = 0, failed = 0;
const rec = (n, ok, d) => { checks[n] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };

// 1 · non-vacuous — the lint detects planted jargon
rec("the lint detects planted catalog jargon (not vacuous)", scan("a content-addressed κ-object in a holospace, re-derivable (L5)").length >= 4);
// 2 · the plain on-theme vocabulary + genuine proper names pass clean
rec("plain on-theme copy passes (verified · self-checking · no server · UOR-Framework)", scan("A verified, self-checking player with no server, built on UOR-Framework.").length === 0);
// 3 · every catalog's user copy is clean (served + source)
{
  const violations = []; let total = 0;
  for (const cat of CATALOGS) {
    const c = JSON.parse(readFileSync(cat.path, "utf8"));
    const apps = (c["dcat:dataset"] || []).filter((a) => a["schema:name"]); total += apps.length;
    for (const a of apps) for (const field of ["schema:name", "schema:description"]) { const hits = scan(a[field] || ""); for (const h of hits) violations.push(`[${cat.label}] ${a["schema:name"]} ${field}: /${h}/`); }
  }
  rec("every app's name + description is clear, on-theme, jargon-free", violations.length === 0, `${total} apps across ${CATALOGS.map((c) => c.label).join("+")}${violations.length ? " · " + violations.slice(0, 6).join(" · ") : ""}`);
  if (violations.length) for (const v of violations) console.log("    ✗ " + v);
}

const witnessed = failed === 0;
writeFileSync(join(here, "holo-catalog-terms-witness.result.json"), JSON.stringify({
  spec: "User-facing app catalog is jargon-free: every app name + description reads clearly, concisely and on-theme — substrate jargon (κ, content-addressed, re-derivation, holospace, L5, self-verifying) is banned in favour of the plain vocabulary (verified · checked genuine · self-checking · tamper-proof · no server). Internal identity fields are ignored; genuine proper names allowed.",
  authority: "Deliverable D user-facing vocabulary · scan of schema:name/schema:description in the served catalog · self-test (planted detection + plain-copy-allowed)",
  witnessed, banned: BANNED.map((b) => b.why),
  covers: ["user-facing-terminology", "jargon-free", "clarity", "on-theme", "anti-drift"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-catalog-terms-witness: ${passed} passed, ${failed} failed — ${witnessed ? "GREEN" : "RED"}`);
process.exit(witnessed ? 0 : 1);
