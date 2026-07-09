// The .holo package writer — seal a forged model into ONE streamable, range-fetchable,
// did:holo artifact. holo-pkg/1 layout:
//
//   "HOLO" | u32 version | u64 headerLen | header(JSON,JCS) | pad→32 | block region | footer(32B sha256)
//
// header = { format, model:rootKappa, plan, expertDir, order:[hex…], blocks:{hex:{off,len}} }
//
// The block region holds every κ-object the model needs, laid out in FIRST-USE order
// (trunk in compute order, then the per-expert tier). For MoE we store the per-expert
// SLICES (not the whole stacks) — no byte doubling — and reconstruct a whole-stack κ on
// read by concatenating its slices in index order (contiguous verbatim bytes → the whole
// κ re-derives exactly). `packageSource` exposes the file to makeResidentStore as a
// get(hex) over byte ranges, so the existing sparse loader + resident store stream a real
// model from one artifact, fetching only the trunk and the experts a token routes to.
//
// Laws: L1 packageKappa = did:holo of (header ++ region); L2 each block once (dedup);
// L5 every block re-derives or refuses; P2 one-byte edit breaks the footer seal.

import { createHash } from "node:crypto";
import { sha256hex, didHolo, jcs } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { isExpertTensor } from "./gguf-forge-expert-dir.mjs";

const MAGIC = "HOLO", VERSION = 1;
const hexOf = (k) => String(k).split(":").pop();
const align32 = (n) => Math.ceil(n / 32) * 32;
const concat = (arrs) => { let n = 0; for (const a of arrs) n += a.length; const out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };
function u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; }
function u64(v) { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, v >>> 0, true); dv.setUint32(4, Math.floor(v / 4294967296), true); return b; }
const rdU32 = (dv, o) => dv.getUint32(o, true);
const rdU64 = (dv, o) => dv.getUint32(o + 4, true) * 4294967296 + dv.getUint32(o, true);

// Canonical block order for a package: trunk (non-expert) blocks in graph first-use order,
// then the per-expert slice tier (stacked-tensor order, expert-index order). Shared by the
// in-RAM and streaming writers so both produce byte-identical regions / packageKappa.
export function packageOrder(plan, expertDir = null) {
  const graph = synthesizeGraph(plan);
  const nameByHex = {}; for (const t of plan.tensors) nameByHex[hexOf(t.kappa)] = t.name;
  const isExpHex = (h) => nameByHex[h] && isExpertTensor(nameByHex[h]);
  const seen = new Set(), trunkOrder = [];
  const visit = (kref) => { const h = hexOf(kref); if (seen.has(h)) return; seen.add(h); if (!isExpHex(h)) trunkOrder.push(h); };
  for (const op of graph.ops || []) if (op.w) for (const v of Object.values(op.w)) if (typeof v === "string") visit(v);
  for (const t of plan.tensors) { const h = hexOf(t.kappa); if (!isExpHex(h) && !seen.has(h)) { seen.add(h); trunkOrder.push(h); } }
  const expertTier = [], expSeen = new Set();
  if (expertDir) for (const name of Object.keys(expertDir.tensors)) for (const ent of expertDir.tensors[name].experts) {
    const h = hexOf(ent.kappa); if (!expSeen.has(h)) { expSeen.add(h); expertTier.push(h); }
  }
  return { order: [...trunkOrder, ...expertTier], isExpHex, nameByHex };
}

// Build the package bytes. `expert` = the buildExpertDirectory() result {dir, expertBlocks}
// (or null for a dense model).
export function writeHoloPackage(forge, expert = null) {
  const plan = forge.plan;
  const dir = expert ? expert.dir : null;
  const expertBlocks = expert ? expert.expertBlocks : null;
  const { order } = packageOrder(plan, dir);
  const byteOf = (h) => (expertBlocks && expertBlocks.has(h)) ? expertBlocks.get(h) : forge.blocks.get(h);

  // lay out the block region; record κ → {off,len}
  const blocks = {}; const parts = []; let off = 0;
  for (const h of order) {
    const b = byteOf(h);
    if (!b) throw new Error(`holo-pkg: no bytes for block ${h.slice(0, 12)}`);
    blocks[h] = { off, len: b.length }; parts.push(b); off += b.length;
  }
  const region = concat(parts);

  const header = { format: "holo-pkg/1", model: forge.rootKappa, plan, expertDir: dir, order, blocks };
  const headerBytes = new TextEncoder().encode(jcs(header));
  const pre = concat([new TextEncoder().encode(MAGIC), u32(VERSION), u64(headerBytes.length), headerBytes]);
  const padded = concat([pre, new Uint8Array(align32(pre.length) - pre.length)]);
  const beforeFooter = concat([padded, region]);
  const sealHex = sha256hex(beforeFooter);
  const footer = new Uint8Array(sealHex.match(/../g).map((x) => parseInt(x, 16)));
  const bytes = concat([beforeFooter, footer]);
  return { bytes, packageKappa: didHolo("sha256", sealHex), header };
}

// Parse + seal-verify a package. Returns { header, packageKappa, rawAt, blockAt }.
// rawAt(hex): byte view (NO verify) or undefined — for use as a stream source.
// blockAt(hex): rawAt + L5 re-derive (throws on tamper / absence) — for verified reads.
export function readHoloPackage(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error("holo-pkg: bad magic");
  const version = rdU32(dv, 4);
  if (version !== VERSION) throw new Error(`holo-pkg: version ${version} unsupported`);
  const headerLen = rdU64(dv, 8);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + headerLen)));
  const regionStart = align32(16 + headerLen);
  const footerStart = bytes.length - 32;
  const region = bytes.subarray(regionStart, footerStart);

  // P2 seal: footer == sha256(everything before it), or refuse
  const sealHex = sha256hex(bytes.subarray(0, footerStart));
  const footerHex = [...bytes.subarray(footerStart)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (sealHex !== footerHex) throw new Error("holo-pkg: seal REFUSE — package re-derives differently");
  const packageKappa = didHolo("sha256", sealHex);

  // reconstruct map: whole-stack exps κ → its ordered per-expert κ (slices stored, whole rebuilt)
  const recon = {};
  if (header.expertDir) for (const t of header.plan.tensors) {
    if (!isExpertTensor(t.name)) continue;
    const td = header.expertDir.tensors[t.name];
    if (td) recon[hexOf(t.kappa)] = td.experts.map((e) => hexOf(e.kappa));
  }

  function rawAt(hex) {
    const loc = header.blocks[hex];
    if (loc) return region.subarray(loc.off, loc.off + loc.len);
    const slices = recon[hex];
    if (slices) return concat(slices.map((h) => { const s = rawAt(h); if (!s) throw new Error(`holo-pkg: missing slice ${h.slice(0, 12)}`); return s; }));
    return undefined;
  }
  function blockAt(hex) {
    const b = rawAt(hex);
    if (!b) throw new Error(`holo-pkg: κ not in package: ${hex.slice(0, 12)}`);
    const got = sha256hex(b);
    if (got !== hex) throw new Error(`holo-pkg: L5 REFUSE — ${hex.slice(0, 12)} re-derives to ${got.slice(0, 12)}`);
    return b;
  }
  return { header, packageKappa, region, rawAt, blockAt };
}

// Adapter: expose a parsed package to makeResidentStore as an ordered source.
// Returns raw bytes (the resident store does its own verify-by-re-derivation + failover).
export const packageSource = (pkg) => ({ get: (hex) => pkg.rawAt(hex) });

// ── Streaming writer: seal a multi-GB model into a .holo WITHOUT holding the region ──
// `scan` = forgeGgufScan / forgeGgufScanParts result {plan, expertDir, dir, rootKappa};
// `readBlock(loc)` → Promise<Uint8Array> reads one block's bytes given its dir entry (loc =
// {fileOffset,len} single-file, or {part,fileOffset,len} multi-part — the caller dispatches);
// `sink(bytes)` → (Promise) writes sequentially. Block LENGTHS come from scan.dir (no reads); the
// region is copied one block at a time under an incremental sha256 (P2 footer seal). Peak memory
// = one block. Same holo-pkg/1 bytes (and packageKappa) as writeHoloPackage on the same model.
export async function writeHoloPackageStream(scan, readBlock, sink) {
  const { plan, expertDir = null, dir, rootKappa } = scan;
  if (!dir) throw new Error("writeHoloPackageStream: scan.dir required (use forgeGgufScan)");
  const { order } = packageOrder(plan, expertDir);
  // header: blocks{hex:{off,len}} — lengths from scan.dir, offsets assigned sequentially (no reads)
  const blocks = {}; let off = 0;
  for (const h of order) { const loc = dir[h]; if (!loc) throw new Error(`holo-pkg: no dir entry for ${h.slice(0, 12)}`); blocks[h] = { off, len: loc.len }; off += loc.len; }
  const header = { format: "holo-pkg/1", model: rootKappa, plan, expertDir, order, blocks };
  const headerBytes = new TextEncoder().encode(jcs(header));
  const pre = concat([new TextEncoder().encode(MAGIC), u32(VERSION), u64(headerBytes.length), headerBytes]);
  const padded = concat([pre, new Uint8Array(align32(pre.length) - pre.length)]);

  const hash = createHash("sha256");                              // incremental seal over header+region
  const put = async (b) => { hash.update(b); await sink(b); };
  await put(padded);
  let written = 0;
  for (const h of order) {                                        // stream the region: one block in flight
    const loc = dir[h];
    const b = await readBlock(loc);
    if (b.byteLength !== loc.len) throw new Error(`holo-pkg: short read for ${h.slice(0, 12)}`);
    await put(b); written += loc.len;
  }
  const sealHex = hash.digest("hex");
  await sink(new Uint8Array(sealHex.match(/../g).map((x) => parseInt(x, 16))));   // 32B footer
  return { packageKappa: didHolo("sha256", sealHex), header, regionBytes: written, totalBytes: padded.length + written + 32 };
}

// ── Disk reader: open a .holo by fd, expose its blocks as absolute file ranges ──
// Reads only the head (MAGIC|version|headerLen|header); returns a `dir` ({hex→{fileOffset,len}})
// directly usable by makeDiskStore, plus the embedded plan + expertDir. Does NOT re-hash the
// whole file (per-block L5 in the store enforces integrity); pass verifySeal:true to check the
// footer by streaming (one pass) when you need the P2 guarantee on open.
export function openHoloPackageDisk(fd, readRangeSync) {
  const head = readRangeSync(0, 16);
  const dvh = new DataView(head.buffer, head.byteOffset, 16);
  if (new TextDecoder().decode(head.subarray(0, 4)) !== MAGIC) throw new Error("holo-pkg: bad magic");
  const version = rdU32(dvh, 4);
  if (version !== VERSION) throw new Error(`holo-pkg: version ${version} unsupported`);
  const headerLen = rdU64(dvh, 8);
  const header = JSON.parse(new TextDecoder().decode(readRangeSync(16, headerLen)));
  const regionStart = align32(16 + headerLen);
  const dir = Object.create(null);
  for (const hex in header.blocks) { const loc = header.blocks[hex]; dir[hex] = { fileOffset: regionStart + loc.off, len: loc.len }; }
  return { header, plan: header.plan, expertDir: header.expertDir, dir, regionStart, model: header.model };
}
