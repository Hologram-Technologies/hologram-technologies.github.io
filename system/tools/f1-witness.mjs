#!/usr/bin/env node
// f1-witness.mjs — Hologram's analogue of F1's scripts/honesty_audit.sh, for the two objects
// gen-f1.mjs seals. It decides three things and refuses on any failure:
//
//   1. Law L5 (dual-axis): both objects re-derive their own did:holo:sha256 identity AND carry the
//      matching blake3 substrate κ over identical canonical content.
//   2. The HONESTY invariant: every claim marked `universallyValid: true` carries non-empty evidence;
//      the RH crux stays `null`; the F1↔inference link stays `false`; ATLAS96's LLM thesis is `null`
//      and its "8K via E8" claim is `false`. No falsified claim may pose as proven.
//   3. ATTACHMENT integrity: the ledger's subject re-derives from the LIVE atlas96.uor.json, proving
//      the overlay points at the genuine, current sealed object (not a stale or invented identity).
//
//   node system/tools/f1-witness.mjs

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE      = dirname(fileURLToPath(import.meta.url));
const HOLO_LIB  = join(HERE, "..", "os", "usr", "lib", "holo");
const Q_E8_DIR  = "C:/Users/pavel/Desktop/Hologram Apps/apps/q/atlas-e8";

const { verify, verifyDualAxis, sriOf } = await import(pathToFileURL(join(HOLO_LIB, "holo-object.mjs")));
const { sha256hex } = await import(pathToFileURL(join(HOLO_LIB, "holo-uor.mjs")));
const hexOf = (did) => String(did).split(":").pop();

const load = (name) => JSON.parse(readFileSync(join(Q_E8_DIR, name), "utf8"));
const checks = [];
const ck = (label, ok, detail = "") => { checks.push({ label, ok: !!ok, detail }); };

const f1     = load("f1.uor.json");
const ledger = load("atlas96-ledger.uor.json");
const atlas  = load("atlas96.uor.json");

// ── 1. Law L5, dual-axis ──────────────────────────────────────────────────────────────────────
ck("F1 object re-derives its did:holo:sha256 (Law L5)", verify(f1), f1.id);
ck("F1 object carries its blake3 substrate κ (dual-axis)", verifyDualAxis(f1),
   (f1.alsoKnownAs || []).find((x) => x.includes("blake3")) || "(missing)");
ck("ATLAS96 ledger re-derives its did:holo:sha256 (Law L5)", verify(ledger), ledger.id);
ck("ATLAS96 ledger carries its blake3 substrate κ (dual-axis)", verifyDualAxis(ledger),
   (ledger.alsoKnownAs || []).find((x) => x.includes("blake3")) || "(missing)");

// ── 2. honesty invariant ────────────────────────────────────────────────────────────────────────
const f1Ledger = f1["f1:ledger"] || [];
const find = (arr, n) => arr.find((e) => e.name === n);

// every proven claim has evidence
const provenNoEvidence = f1Ledger.filter((e) => e.universallyValid === true && !(e.evidence && e.evidence.length));
ck("every F1 `true` claim carries evidence", provenNoEvidence.length === 0,
   provenNoEvidence.map((e) => e.name).join(", ") || "all evidenced");

// the crux and RH-equivalents stay null
for (const n of ["full-li-positivity", "hodge-index-negativity", "spec-z-square"]) {
  const e = find(f1Ledger, n);
  ck(`F1 crux \`${n}\` is null (not asserted proven)`, e && e.universallyValid === null, e ? String(e.universallyValid) : "MISSING");
}
// λ₁ is the only Li slice allowed to be true
const lam1 = find(f1Ledger, "li-lambda1-positive");
ck("F1 λ₁ positivity is `true` (the proven n=1 slice)", lam1 && lam1.universallyValid === true);

// the bridge is graded honestly
const bridge = (f1["f1:bridge"] && f1["f1:bridge"].links) || [];
const bset = Object.fromEntries(bridge.map((b) => [b.name, b.universallyValid]));
ck("bridge `shared-substrate` is true (real kinship)", bset["shared-substrate"] === true);
ck("bridge `modular-forms-kinship` is null (kinship, not a lever)", bset["modular-forms-kinship"] === null);
ck("bridge `improves-inference` is false (numerology refused)", bset["improves-inference"] === false);

// ── ATLAS96 ledger honesty ──────────────────────────────────────────────────────────────────────
const aClaims = ledger["f1:claims"] || [];
const aset = Object.fromEntries(aClaims.map((c) => [c.name, c.universallyValid]));
ck("ATLAS96 `deterministic-unfolding-rederives` is true (witnessed)", aset["deterministic-unfolding-rederives"] === true);
ck("ATLAS96 `is-the-e8-quantizer` is true (measured)", aset["is-the-e8-quantizer"] === true);
ck("ATLAS96 `llm-latent-topology-coordinate` is null (open; strong form falsified)", aset["llm-latent-topology-coordinate"] === null);
ck("ATLAS96 `e8-upscaling-to-8k` is false (falsified)", aset["e8-upscaling-to-8k"] === false);
// no falsified/open claim may pose as proven, and falsifications must cite a record
const liar = aClaims.find((c) => c.universallyValid !== true && c.universallyValid !== false && c.universallyValid !== null);
ck("ATLAS96 claims use only {true,false,null}", !liar, liar ? liar.name : "ok");
const uncitedFalse = aClaims.filter((c) => (c.universallyValid === false || c.status === "open — measured weak; strong form falsified") && !(c.falsifiedBy && c.falsifiedBy.length));
ck("every falsified ATLAS96 claim cites a record", uncitedFalse.length === 0, uncitedFalse.map((c) => c.name).join(", ") || "all cited");

// ── 3. attachment integrity ──────────────────────────────────────────────────────────────────────
// the overlay's leaf links must re-hash to the LIVE atlas-e8 files (Law L5 continuity).
for (const link of ledger.links || []) {
  const bytes = readFileSync(join(Q_E8_DIR, link["schema:name"]));
  const ok = sha256hex(bytes) === hexOf(link.id) && sriOf(bytes) === link.digestSRI;
  ck(`ledger binds the live ${link["schema:name"]} by content (Law L5)`, ok, hexOf(link.id).slice(0, 16) + "…");
}
// the ledger's declared subject must be the atlas96 object's own self-declared identity.
ck("ledger subject = atlas96 object's declared @id", (ledger["f1:subject"] || {}).object === atlas["@id"], atlas["@id"]);
ck("ledger provenance points at the F1 object", ledger["prov:wasInfluencedBy"] === f1.id, ledger["prov:wasInfluencedBy"]);

// ── report ───────────────────────────────────────────────────────────────────────────────────────
let pass = 0;
for (const c of checks) { console.log(`${c.ok ? " ok  " : "FAIL "} ${c.label}${c.detail ? "  — " + c.detail : ""}`); if (c.ok) pass++; }
console.log(`\nf1-witness: ${pass}/${checks.length} checks green`);
process.exit(pass === checks.length ? 0 : 1);
