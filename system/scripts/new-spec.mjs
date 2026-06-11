#!/usr/bin/env node
// new-spec.mjs — scaffold a new spec row + its witness, so adding a standard is
// fill-in-the-blanks instead of from-scratch. It stamps the two machine-readable
// pieces (a pinned specs.json row + a witness skeleton that SKIPs until you fill it
// in, so it never false-passes and never blocks the tree), then prints the manual
// pieces (the runCovering wire, the docs/09 ADR, the docs/10 CC row).
//
// Usage:
//   node scripts/new-spec.mjs --id <id> --name "<name>" --version "<pin>" \
//        --cat "<Category>" [--icon <icon>] [--org "<org>"] [--url <url>] \
//        [--bundle <bundleId>[,<id2>]] [--new-bundle "<name>|<authority>"] \
//        [--uses a,b]
//
// A spec is admitted to the catalog only if PINNED (--version) and WITNESSED
// (a real file witness). This scaffolder enforces both up front. See SPEC-BUNDLES.md.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));            // .../scripts
const repoRoot = join(here, "..");
const webDir = join(repoRoot, "os");
const specsPath = join(webDir, "specs.json");

// ── tiny flag parser (--k v / --k=v / boolean --k) ───────────────────────────
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) continue;
  const k = argv[i].slice(2);
  const eq = k.indexOf("=");
  if (eq >= 0) { args[k.slice(0, eq)] = k.slice(eq + 1); continue; }
  const next = argv[i + 1];
  if (next && !next.startsWith("--")) { args[k] = next; i++; } else { args[k] = true; }
}
const die = (m) => { console.error(`new-spec: ${m}`); process.exit(1); };

// ── required: id, name, version (the pin), cat ───────────────────────────────
const id = args.id;
if (!id || typeof id !== "string") die("--id <kebab-id> is required");
if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) die(`--id "${id}" must be kebab-case (a-z 0-9 -)`);
const name = args.name || die("--name \"<human name>\" is required");
const version = args.version || die("--version \"<pinned version or hash>\" is required (a spec MUST be pinned)");
const cat = args.cat || die("--cat \"<Category>\" is required");

const reg = JSON.parse(readFileSync(specsPath, "utf8"));
if (reg.specs.some((s) => s.id === id)) die(`a spec with id "${id}" already exists`);

// ── category must exist, or be created inline with --icon ────────────────────
reg.categories = reg.categories || [];
if (!reg.categories.some(([n]) => n === cat)) {
  if (!args.icon) die(`category "${cat}" is not defined — pass --icon <icon> to create it`);
  reg.categories.push([cat, String(args.icon)]);
  console.log(`+ category  ${cat} (${args.icon})`);
}

// ── bundles: must be defined, or create one inline with --new-bundle ─────────
reg.bundles = reg.bundles || [];
const bundleIds = args.bundle ? String(args.bundle).split(",").map((s) => s.trim()).filter(Boolean) : [];
if (args["new-bundle"]) {
  if (bundleIds.length !== 1) die("--new-bundle expects exactly one --bundle <id> to define");
  const [bn, bauth] = String(args["new-bundle"]).split("|");
  if (!bn || !bauth) die('--new-bundle "Human name|External authority" (pipe-separated)');
  if (!reg.bundles.some((b) => b.id === bundleIds[0])) {
    reg.bundles.push({ id: bundleIds[0], name: bn.trim(), description: args["bundle-desc"] ? String(args["bundle-desc"]) : bn.trim(), authority: bauth.trim() });
    console.log(`+ bundle    ${bundleIds[0]} — ${bn.trim()}`);
  }
}
for (const b of bundleIds) if (!reg.bundles.some((x) => x.id === b)) die(`bundle "${b}" is not defined — add --new-bundle "Name|Authority", or define it in specs.json`);

// ── the witness path + skeleton (skips until implemented; never false-passes) ─
const witnessFile = `${id}-witness.mjs`;
const witnessPath = join(webDir, witnessFile);
const witnessRel = `os/${witnessFile}`;
if (!existsSync(witnessPath)) {
  writeFileSync(witnessPath, witnessSkeleton({ id, name, url: args.url, version }));
  console.log(`+ witness   ${witnessRel}`);
} else {
  console.log(`= witness   ${witnessRel} (exists — left as-is)`);
}

// ── the row ──────────────────────────────────────────────────────────────────
const row = { id, name, org: args.org ? String(args.org) : "", cat, url: args.url ? String(args.url) : "", version, tested: true, witness: witnessRel };
if (bundleIds.length === 1) row.bundle = bundleIds[0];
else if (bundleIds.length > 1) row.bundle = bundleIds;
row.uses = args.uses ? String(args.uses).split(",").map((s) => s.trim()).filter(Boolean) : [witnessRel];
reg.specs.push(row);
writeFileSync(specsPath, JSON.stringify(reg, null, 2) + "\n");
console.log(`+ spec      ${id} → ${cat}${bundleIds.length ? ` [${bundleIds.join(", ")}]` : ""}`);

// ── the manual remainder (printed checklist) ─────────────────────────────────
console.log(`
Next — three manual steps (the gate enforces them):

  1. Implement ${witnessFile}: re-derive conformance against the EXTERNAL authority
     (${args.url || "the standard's spec/test-suite"}). Emit covers:["${id}"] only when every check passes.

  2. Wire it into the gate — add this line to os/enforce-witnesses.mjs
     (in the witness-runs section):

       runCovering("${id}", "${witnessFile}", "${id}-witness.result.json");

  3. Record it in the docs (single source of truth):
     • docs/09-Architecture-Decisions.md — an ADR section for the decision (why this standard, non-goals).
     • docs/10-Quality-Requirements.md — a conformance-catalog row: invariant · external authority · enforcement · witness.

Verify:  cd os && STRUCTURE_ONLY=1 node enforce-witnesses.mjs
`);

function witnessSkeleton({ id, name, url, version }) {
  return `#!/usr/bin/env node
// ${id}-witness.mjs — witness for the "${name}" spec.
//
// Authority (pinned, EXTERNAL — never self-reference): ${url || "<spec url>"} @ ${version}.
// Re-derive conformance here and emit covers:["${id}"] ONLY when every check passes.
// Prefer PURE-STATIC checks (green locally AND in CI). If this needs an oracle
// (browser / emulator / network), SKIP (exit 0, covers:[]) when it is absent — a
// witness must never false-pass. Wire it via runCovering() in enforce-witnesses.mjs.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "${id}-witness.result.json"), JSON.stringify(r, null, 2) + "\\n");
const skip = (why) => { write({ spec: "${name}", witnessed: false, covers: [], skipped: why }); console.log(\`SKIP — \${why}\`); process.exit(0); };

// SCAFFOLD: delete this guard once the checks below are real.
skip("scaffold — implement the conformance checks for ${id}");

// ── checks (re-derivations against ${url || "the authority"}) ──
const checks = {
  // example: theFontReDerivesToItsPin: hash(read("...")) === "blake3:…",
};
const witnessed = Object.values(checks).length > 0 && Object.values(checks).every(Boolean);
write({ spec: "${name}", authority: "${url || ""} @ ${version}", witnessed, covers: witnessed ? ["${id}"] : [], checks });
for (const [k, v] of Object.entries(checks)) console.log(\`  \${v ? "ok  " : "FAIL"}  \${k}\`);
console.log(\`VERDICT : \${witnessed ? "WITNESSED ✓" : "NOT WITNESSED"}\`);
process.exit(witnessed ? 0 : 1);
`;
}
