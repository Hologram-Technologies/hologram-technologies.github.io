#!/usr/bin/env node
// holo-hf-ingest-witness.mjs — ADR-0114 S1: prove the in-browser HuggingFace ingestion logic (holo-hf-ingest.mjs)
// against a MOCK fetch — the range-assembly, resume, auth, status-mapping, format-detection and κ-block registration
// that turn a HF repo into forge-ready κ bytes, entirely in a browser fetch.
//
// HONEST LINE: a mock cannot settle whether huggingface.co answers cross-origin Range reads (CORS + 206) — that is
// a browser-session check. What IS proven here: range requests reassemble byte-identical, resume skips have-chunks,
// a server that IGNORES Range (returns 200 whole) is surfaced as `servedWhole` (the CORS/range fallback, not a lie),
// a thrown fetch surfaces as a clear network/cors error (no silent partial), 401/403/404 map to actionable reasons,
// GGUF magic is detected, the bearer token is sent only when present, and every block + the whole-file κ register.
//
// Checks (all must hold):
//   1  mapsHfStatuses          — 200→ok, 401→auth, 403→gated, 404→notfound.
//   2  selectsGgufWithCompanions — repo info with a .gguf + configs → smallest gguf chosen, companions collected.
//   3  rangeAssemblesExactBytes — 206 chunked server → reassembled bytes byte-identical to source; magic preserved.
//   4  resumeSkipsHaveChunks    — with have={0} only the missing chunks are fetched.
//   5  detectsRangeIgnored      — server returns 200 whole (ignores Range) → servedWhole=true (CORS/range fallback).
//   6  corsBlockSurfaces        — fetch throws → HfError kind "network/cors", never a silent partial.
//   7  detectsGgufMagic         — "GGUF" head → "gguf"; random head → null.
//   8  registersKappaBlocks     — every block + the whole-file κ land in the store; blocks tile the file exactly.
//   9  authHeaderOnlyWhenToken  — token → Authorization: Bearer seen; public → no Authorization header.
//
// Authority (external): holospaces Laws L1/L5 · ADR-0114 · ADR-0092 (governed fetch) · HuggingFace Hub API ·
// HTTP Range/206 (RFC 7233). Usage: node tools/holo-hf-ingest-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { ingest, rangeDownload, selectModelFile, mapHfStatus, detectFormatFromMagic, HfError, hfResolveUrl } from "../os/usr/lib/holo/q/holo-hf-ingest.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-hf-ingest-witness.result.json"), JSON.stringify(r, null, 2) + "\n");
const sha256hex = (b) => createHash("sha256").update(Buffer.from(b)).digest("hex");

// ── a synthetic GGUF file: "GGUF" magic + deterministic body ───────────────────────────────────────────
const REPO = "onnx-community/Qwen2.5-Coder-0.5B-Instruct-GGUF";
const FILE = "qwen2.5-coder-0.5b-instruct-q8_0.gguf";
const FSIZE = 1000;
const SRC = new Uint8Array(FSIZE);
SRC.set([0x47, 0x47, 0x55, 0x46], 0);                 // "GGUF"
for (let i = 4; i < FSIZE; i++) SRC[i] = (i * 31 + 7) & 0xff;

const INFO = {
  id: REPO, gated: false,
  siblings: [
    { rfilename: FILE, size: FSIZE },
    { rfilename: "qwen2.5-coder-0.5b-instruct-f16.gguf", size: FSIZE * 4 }, // bigger → not chosen
    { rfilename: "tokenizer.json", size: 50 },
    { rfilename: "config.json", size: 20 },
    { rfilename: "README.md", size: 10 },               // not a companion
  ],
};

// mock fetch factory. mode: "range" (honors Range→206) | "whole" (ignores Range→200) | "throw" | status code number.
function makeFetch(mode = "range") {
  const seen = { auth: [] };
  const fetch = async (url, { headers = {} } = {}) => {
    seen.auth.push(headers.Authorization || null);
    if (mode === "throw") throw new Error("Failed to fetch (CORS)");
    if (typeof mode === "number") return { status: mode, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    if (String(url).includes("/api/models/")) return { status: 200, json: async () => INFO, arrayBuffer: async () => new ArrayBuffer(0) };
    // resolve URL (the file)
    if (mode === "whole") return { status: 200, arrayBuffer: async () => SRC.buffer.slice(0) };
    const m = /bytes=(\d+)-(\d+)/.exec(headers.Range || "");
    if (!m) return { status: 200, arrayBuffer: async () => SRC.buffer.slice(0) };
    const start = +m[1], end = Math.min(+m[2], FSIZE - 1);
    return { status: 206, arrayBuffer: async () => SRC.slice(start, end + 1).buffer };
  };
  return { fetch, seen };
}

const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const checks = {};

// 1 · status mapping
checks.mapsHfStatuses = mapHfStatus(200).ok && mapHfStatus(401).kind === "auth" && mapHfStatus(403).kind === "gated" && mapHfStatus(404).kind === "notfound";

// 2 · file selection + companions (smallest gguf, not the f16)
{
  const sel = selectModelFile(INFO, {});
  checks.selectsGgufWithCompanions = sel.file === FILE && sel.format === "gguf" && sel.companions.includes("tokenizer.json") && sel.companions.includes("config.json") && !sel.companions.includes("README.md");
}

// 3 · range assembly is byte-exact, magic preserved
{
  const { fetch } = makeFetch("range");
  const dl = await rangeDownload(hfResolveUrl(REPO, FILE), { fetch, size: FSIZE, chunkSize: 64 });
  checks.rangeAssemblesExactBytes = eq(dl.bytes, SRC) && !dl.servedWhole && detectFormatFromMagic(dl.bytes) === "gguf";
}

// 4 · resume: have chunk 0 → it is not fetched
{
  const { fetch } = makeFetch("range");
  const dl = await rangeDownload(hfResolveUrl(REPO, FILE), { fetch, size: FSIZE, chunkSize: 100, have: new Set([0]) });
  const nChunks = Math.ceil(FSIZE / 100);
  checks.resumeSkipsHaveChunks = dl.fetched.length === nChunks - 1 && !dl.fetched.includes(0);
}

// 5 · server ignores Range → servedWhole flagged (the CORS/range fallback)
{
  const { fetch } = makeFetch("whole");
  const dl = await rangeDownload(hfResolveUrl(REPO, FILE), { fetch, size: FSIZE, chunkSize: 64 });
  checks.detectsRangeIgnored = dl.servedWhole === true && eq(dl.bytes, SRC);
}

// 6 · fetch throws (CORS) → clear network/cors error, no silent partial
{
  const { fetch } = makeFetch("throw");
  let kind = null;
  try { await rangeDownload(hfResolveUrl(REPO, FILE), { fetch, size: FSIZE, chunkSize: 64 }); }
  catch (e) { kind = e instanceof HfError ? e.kind : "other"; }
  checks.corsBlockSurfaces = kind === "network/cors";
}

// 7 · magic detection
checks.detectsGgufMagic = detectFormatFromMagic(new Uint8Array([0x47, 0x47, 0x55, 0x46, 0, 0])) === "gguf" && detectFormatFromMagic(new Uint8Array([1, 2, 3, 4])) === null;

// 8 · full ingest registers every block + the whole-file κ; blocks tile the file
{
  const { fetch } = makeFetch("range");
  const store = new Map();
  const man = await ingest(REPO, { fetch, sha256hex, chunkSize: 128, blockSize: 256, kput: async (k, b) => store.set(k.split(":").pop(), new Uint8Array(b)) });
  const tiles = man.blocks.reduce((n, b) => n + b.len, 0) === FSIZE && man.blocks[0].off === 0;
  const wholeReg = store.has(man.kappa.split(":").pop());
  const blocksReg = man.blocks.every((b) => store.has(b.kappa.split(":").pop()));
  const wholeMatches = man.kappa.endsWith(sha256hex(SRC));
  checks.registersKappaBlocks = man.format === "gguf" && tiles && wholeReg && blocksReg && wholeMatches;
}

// 9 · auth header only when a token is present
{
  const a = makeFetch("range"); await rangeDownload(hfResolveUrl(REPO, FILE), { fetch: a.fetch, token: "hf_abc", size: FSIZE, chunkSize: 1000 });
  const b = makeFetch("range"); await rangeDownload(hfResolveUrl(REPO, FILE), { fetch: b.fetch, size: FSIZE, chunkSize: 1000 });
  checks.authHeaderOnlyWhenToken = a.seen.auth.some((h) => h === "Bearer hf_abc") && b.seen.auth.every((h) => h === null);
}

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Holo Forge Unified (ADR-0114) S1 — in-browser HuggingFace ingestion (holo-hf-ingest.mjs): discover info, select the GGUF/ONNX file + companions, RANGE-stream multi-GB weights (resume-able), map auth/gated/404 honestly, detect format by magic, and register the bytes as κ-blocks. A range-ignoring server is surfaced as servedWhole and a thrown fetch as network/cors — never a silent partial. Live cross-origin CORS+206 is the deferred browser-session check.",
  authority: "holospaces Laws L1/L5 · ADR-0114 · ADR-0092 governed fetch · HuggingFace Hub API · HTTP Range/206 (RFC 7233)",
  note: "Logic is REAL + Node-proven against a mock fetch. Deferred to a browser session: the LIVE check that huggingface.co answers cross-origin Range reads (CORS + 206); if it does not, ingestion routes through the host-proxy /sc/* precedent (a relay in the path — not literally serverless). Wiring ingest()→forge→sealHolo is S0/S3.",
  witnessed,
  covers: witnessed ? ["hf-ingest", "range-stream-resume", "status-mapping", "format-detect", "kappa-block-register", "cors-honest-fallback", "auth-token"] : [],
  checks,
});

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ in-browser HF ingestion range-streams + resumes + maps statuses + detects format + registers κ-blocks, honest about the range/CORS fallback" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
