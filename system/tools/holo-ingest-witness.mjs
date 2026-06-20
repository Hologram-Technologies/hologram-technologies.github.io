#!/usr/bin/env node
// holo-ingest-witness.mjs — proves S0 of "the +": THE PORT. Any source becomes κ-objects, never a
// silent drop, content-addressed so the same bytes seal to the same κ. This is the foundation the
// whole north star rests on: the source κ sealed here is the EVIDENCE ANCHOR a later insight (S5)
// will cite, so it MUST re-derive from content (Law L5) and be deterministic under any clock (Law L2).
//
// Checks (all must hold):
//   1 textSourceSealsAndReDerives  — a .md file → an IngestSource whose source κ re-derives from the raw bytes.
//   2 textViewDecodedAndReDerives  — a text-like source also gets a decoded UTF-8 text view κ that re-derives.
//   3 neverSilentDrop              — an unknown BINARY (NUL bytes) still yields ≥1 κ, honestly marked supported:false.
//   4 contentAddressedDedup        — the SAME bytes under TWO names seal to the SAME source κ (S2 dedup, previewed).
//   5 distinctBytesDistinctKappa   — different bytes → different source κ (no accidental collision/aliasing).
//   6 tamperRefused                — mutate one byte ⇒ the source κ no longer re-derives (Law L5 tamper-refuse).
//   7 closureCoversChildren        — the ingestClosure κ changes iff a child κ (source or view) changes.
//   8 deterministicIdNotClock      — the SAME bytes sealed under two different clocks yield the SAME source κ.
//   9 sniffFallbackDecodesText     — an EXTENSIONLESS textual blob is classified text and gets a view (ANIMA UTF-8 fallback).
//
// Authority (external): UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · FIPS 180-4 (SHA-256) ·
// holospaces Laws L2 (one canonical hash) / L5 (verify by re-derivation). Rests on #holo-uor + #holo-resolver.
//   node tools/holo-ingest-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sealIngest, classify } from "../os/usr/lib/holo/holo-ingest.mjs";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { reDerive, hexOf } from "../os/sbin/holo-resolver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
// re-derive the open-web κ axis from bytes via the INDEPENDENT resolver (WebCrypto/node:crypto), not the
// module under test — so a passing check means two independent implementations agree on the address.
const reKappa = async (bytes) => "did:holo:sha256:" + (await reDerive(bytes));

// ── 1 · a markdown source seals; its source κ re-derives from the exact raw bytes ───────────────────
const mdBytes = enc("# Acme Corp\n\nFounded 2019 in Berlin. CEO: Dana Lee. Revenue 2024: €4.2M.\n");
const md = sealIngest({ name: "acme.md", bytes: mdBytes });
ok("textSourceSealsAndReDerives",
  md["@type"] === "holo:IngestSource" && md.source === (await reKappa(mdBytes)) && md.kind === "text",
  `source=${md.source}`);

// ── 2 · the decoded UTF-8 text view is sealed as its own κ and re-derives (what MAP/S1 will read) ───
const viewBytes = enc(new TextDecoder().decode(mdBytes));
ok("textViewDecodedAndReDerives",
  md.view.mode === "text" && md.view.supported === true && md.view.kappa === (await reKappa(viewBytes)),
  `view=${md.view.kappa}`);

// ── 3 · NEVER A SILENT DROP: an unknown binary (embedded NUL) still seals ≥1 κ, honestly unsupported ─
const binBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff, 0x00, 0xfe]); // PNG-ish + NULs
const bin = sealIngest({ name: "logo.png", bytes: binBytes });
ok("neverSilentDrop",
  bin.source === (await reKappa(binBytes)) && bin.view.supported === false && bin.view.mode === "raw"
  && classify("logo.png", binBytes).kind === "binary",
  `kind=${bin.kind}`);

// ── 4 · CONTENT-ADDRESSED dedup: identical bytes, different filenames → identical source κ ──────────
const a1 = sealIngest({ name: "report-final.md",  bytes: mdBytes });
const a2 = sealIngest({ name: "report-final-v2.md", bytes: mdBytes });
ok("contentAddressedDedup", a1.source === a2.source, "same bytes must collapse to one κ (S2 foundation)");

// ── 5 · distinct bytes → distinct source κ (no aliasing) ────────────────────────────────────────────
const other = sealIngest({ name: "acme.md", bytes: enc("# Beta Corp\n\nDifferent content entirely.\n") });
ok("distinctBytesDistinctKappa", other.source !== md.source);

// ── 6 · Law L5 tamper-refuse: flip one byte ⇒ the claimed source κ no longer re-derives ─────────────
const tampered = new Uint8Array(mdBytes); tampered[2] ^= 0x01;          // mutate one byte
const tamperedKappa = await reKappa(tampered);
ok("tamperRefused", tamperedKappa !== md.source && hexOf(tamperedKappa) !== hexOf(md.source));

// ── 7 · the ingestClosure κ is sensitive to BOTH children (changes iff source or view changes) ──────
const sameAgain = sealIngest({ name: "acme.md", bytes: mdBytes });
const closureStable = sameAgain["holo:ingestClosure"] === md["holo:ingestClosure"];
const closureMovesWithContent = other["holo:ingestClosure"] !== md["holo:ingestClosure"];
ok("closureCoversChildren", closureStable && closureMovesWithContent,
  `stable=${closureStable} movesWithContent=${closureMovesWithContent}`);

// ── 8 · Law L2 determinism: same bytes, two different clocks → same source κ (id is content, not time) ─
const tA = sealIngest({ name: "acme.md", bytes: mdBytes }, { now: () => 1000 });
const tB = sealIngest({ name: "acme.md", bytes: mdBytes }, { now: () => 999999 });
ok("deterministicIdNotClock",
  tA.source === tB.source && tA["holo:ingestClosure"] === tB["holo:ingestClosure"]
  && tA["prov:generatedAtTime"] !== tB["prov:generatedAtTime"]);

// ── 9 · ANIMA UTF-8 fallback: an EXTENSIONLESS textual blob is still classified text + gets a view ──
const noExt = enc("just some notes about Dana Lee and Acme Corp, no file extension at all\n");
const blob = sealIngest({ name: "NOTES", bytes: noExt });
ok("sniffFallbackDecodesText",
  blob.kind === "text" && blob.view.supported === true && blob.view.kappa === (await reKappa(enc(new TextDecoder().decode(noExt)))));

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "the + — S0 PORT (holo-ingest): the single universal intake seals ANY source into κ-objects — never a silent drop (binary sealed raw, honestly marked), content-addressed (same bytes → same κ, the basis of S2 dedup and S5 provenance), with a decoded UTF-8 text view for text-like sources (ANIMA's UTF-8 fallback) and a non-circular ingestClosure κ that pins the whole ingest. Source κs re-derive from content via the independent resolver (Law L5) and are deterministic under any clock (Law L2)",
  authority: "UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · FIPS 180-4 (SHA-256) · holospaces Laws L2/L5 · rests on #holo-uor + #holo-resolver",
  witnessed,
  covers: witnessed ? ["ingest-port","never-silent-drop","content-addressed","text-view","utf8-fallback","ingest-closure","law-l5","law-l2","dedup-foundation"] : [],
  sample: { source: md.source, view: md.view.kappa, closure: md["holo:ingestClosure"], binaryStillSealed: bin.source },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ingest-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ingest witness — S0 the + PORT (any source → κ-objects, never dropped)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  sample: source ${md.source.slice(0, 28)}… · view ${md.view.kappa.slice(0, 28)}… · closure ${md["holo:ingestClosure"].slice(0, 28)}…`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the Port seals any source by content address, never silently drops" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
