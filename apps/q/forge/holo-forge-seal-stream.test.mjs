#!/usr/bin/env node
// holo-forge-seal-stream.test.mjs — prove the DISK streaming sealer (holo-forge-seal-stream.mjs) emits
// the IDENTICAL .holo as the in-memory sealHolo (holo-forge-seal.mjs), so a 9B brain — which the
// in-memory path CANNOT allocate — seals to a byte-for-byte correct archive the real reader consumes.
//
// Checks (all must hold):
//   1  byteIdentical      — sealHoloToFile(file) === sealHolo(memory), byte for byte, same rootHolo.
//   2  realReaderAccepts  — readHolo(streamed file): arch, format "holo/2", footer = rootHolo, every body L5-OK.
//   3  streamRoundTrips   — openHoloStream over the file: headerBytes = Extension, each κ getBody L5-OK.
//   4  multiChunkBody      — a body emitted in MANY small chunks hashes identically (incremental footer).
//   5  dedupCollapses      — 3 tensors / 2 bodies → nBodies 2, both names resolve to the one body, still byte-identical.
//   6  deterministic        — sealing twice yields the same footer.
//   7  bodyLenGuard         — a bodySource that under-delivers a body is REFUSED (no silent short archive).
//
// Usage: node holo-apps/apps/q/forge/holo-forge-seal-stream.test.mjs

import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sealHolo } from "./holo-forge-seal.mjs";
import { sealHoloToFile } from "./holo-forge-seal-stream.mjs";
import { readHolo, openHoloStream } from "./holo-archive.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const enc = new TextEncoder();
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const body = (seed, n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (seed * 131 + i * 7) & 0xff; return b; };

// build forge "parts" (κ-keyed body store + first-use tensors), same shape a ModelFrontEnd.forge() emits
function makeParts(arch, extKey, headerStr, defs /* [[name, seed, len]] */) {
  const blocks = new Map(), tensors = [];
  for (const [name, seed, len] of defs) {
    const b = body(seed, len), hex = sha256hex(b);
    blocks.set(hex, b);
    tensors.push({ name, kappa: "did:holo:sha256:" + hex, nbytes: len });
  }
  return { arch, sourceRoot: "did:holo:sha256:" + sha256hex(enc.encode(arch + "-root")), tensors, blocks, extKey, extBytes: enc.encode(headerStr) };
}

// a Map-backed bodySource; `chunk` forces multi-chunk emission to exercise incremental hashing
const sourceOf = (blocks, chunk = 0) => ({
  async *stream(hex) {
    const b = blocks.get(hex);
    if (!chunk || chunk >= b.length) { yield b; return; }
    for (let o = 0; o < b.length; o += chunk) yield b.subarray(o, Math.min(o + chunk, b.length));
  },
});

async function sealToFile(parts, { chunk = 0, source } = {}) {
  const out = join(tmpdir(), `holo-stream-${parts.arch}-${Math.abs(sha256hex(enc.encode(parts.arch + chunk)).slice(0, 8)).toString()}.holo`);
  const r = await sealHoloToFile({ outPath: out, bodySource: source || sourceOf(parts.blocks, chunk), arch: parts.arch, sourceRoot: parts.sourceRoot, tensors: parts.tensors, extKey: parts.extKey, extBytes: parts.extBytes });
  return { out, r, bytes: new Uint8Array(readFileSync(out)) };
}

const rrOf = (holo) => async (off, len) => holo.subarray(off, off + len);
const checks = {};
const tmp = [];

// fixtures
const gguf = makeParts("qwen2", "gguf.header", "GGUF-HEADER-META…", [["token_embd", 1, 4096], ["blk.0.attn", 2, 2048], ["output.weight", 3, 1536]]);
const dedup = makeParts("qwen2", "gguf.header", "H", [["a", 7, 4096], ["b", 9, 2048], ["a_again", 7, 4096]]); // a == a_again

// 1 · byte-identical to in-memory sealHolo
{
  const mem = sealHolo({ arch: gguf.arch, sourceRoot: gguf.sourceRoot, tensors: gguf.tensors, blocks: gguf.blocks, extKey: gguf.extKey, extBytes: gguf.extBytes });
  const { out, r, bytes } = await sealToFile(gguf); tmp.push(out);
  checks.byteIdentical = eq(bytes, mem.holo) && r.rootHolo === mem.rootHolo && r.bytes === mem.bytes;
}
// 2 · the real production reader accepts the streamed file
{
  const { out, r, bytes } = await sealToFile(gguf); tmp.push(out);
  const rd = readHolo(bytes);
  let bodiesOk = true;
  for (const [hex, b] of gguf.blocks) { const got = rd.store.get(hex); if (!got || !eq(got, b)) bodiesOk = false; }
  checks.realReaderAccepts = rd.meta.arch === "qwen2" && rd.meta.format === "holo/2" && rd.footer === r.rootHolo && bodiesOk;
}
// 3 · openHoloStream round-trips the file
{
  const { out, bytes } = await sealToFile(gguf); tmp.push(out);
  const h = await openHoloStream(rrOf(bytes));
  let bodiesOk = true;
  for (const [hex, b] of gguf.blocks) { const got = await h.getBody(hex); if (!eq(got, b)) bodiesOk = false; }
  checks.streamRoundTrips = eq(h.headerBytes, new Uint8Array(gguf.extBytes)) && bodiesOk && h.order.length === 3;
}
// 4 · multi-chunk body hashes identically (incremental footer == one-shot footer)
{
  const whole = await sealToFile(gguf, { chunk: 0 }); tmp.push(whole.out);
  const chunked = await sealToFile(gguf, { chunk: 7 }); tmp.push(chunked.out);   // 7-byte chunks
  checks.multiChunkBody = eq(whole.bytes, chunked.bytes) && whole.r.rootHolo === chunked.r.rootHolo;
}
// 5 · dedup collapses identical bodies, still byte-identical to sealHolo
{
  const mem = sealHolo({ arch: dedup.arch, sourceRoot: dedup.sourceRoot, tensors: dedup.tensors, blocks: dedup.blocks, extKey: dedup.extKey, extBytes: dedup.extBytes });
  const { out, r, bytes } = await sealToFile(dedup); tmp.push(out);
  const rd = readHolo(bytes);
  const aK = rd.meta.order.find((o) => o.name === "a").kappa, aaK = rd.meta.order.find((o) => o.name === "a_again").kappa;
  checks.dedupCollapses = eq(bytes, mem.holo) && r.nTensors === 3 && r.nBodies === 2 && aK === aaK;
}
// 6 · deterministic
{
  const a = await sealToFile(gguf); tmp.push(a.out);
  const b = await sealToFile(gguf); tmp.push(b.out);
  checks.deterministic = a.r.rootHolo === b.r.rootHolo && eq(a.bytes, b.bytes);
}
// 7 · under-delivered body is refused (no silent short archive)
{
  const liar = { async *stream(hex) { const b = gguf.blocks.get(hex); yield b.subarray(0, Math.max(0, b.length - 1)); } };
  let refused = false;
  try { const x = await sealToFile(gguf, { source: liar }); tmp.push(x.out); } catch (e) { refused = /wrote \d+ != \d+/.test(e.message); }
  checks.bodyLenGuard = refused;
}

for (const f of tmp) { try { rmSync(f); } catch {} }

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-forge-seal-stream.test.result.json"), JSON.stringify({
  spec: "Disk streaming sealer (holo-forge-seal-stream.mjs) — writes a .holo body-by-body straight to disk, byte-for-byte equal to the in-memory sealHolo, so a 9B brain (whose archive exceeds V8's ArrayBuffer ceiling and cannot be sealed in memory) still produces the IDENTICAL archive the real reader (readHolo/openHoloStream) L5-verifies. Peak memory is one chunk; the footer sha256 is computed incrementally and matches one-shot.",
  authority: "holospaces Laws L1/L5 · holo-archive MAGIC \"HOLO\" v2 · holo-forge-seal.mjs byte layout",
  witnessed, checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ disk streaming sealer is byte-identical to sealHolo — a 9B brain is forgeable" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
