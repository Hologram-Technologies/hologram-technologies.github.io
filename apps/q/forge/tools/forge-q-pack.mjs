// forge-q-pack.mjs — merge every Q model's .holo bodies into ONE κ-addressable pack (q-models.holo), LOSSLESS
// (bodies copied byte-for-byte, same κ), DEDUPLICATED by κ, STREAMING (never holds the pack/a body in RAM),
// instant-tier-first ordering. Reads BOTH .holo flavors (tensor-archive: Metadata+Weights+Extension; file-bundle:
// Metadata+Weights) via a universal parser of the common Weights(3)/Metadata(8)/Extension(14) sections.
//   node holo-apps/apps/q/forge/tools/forge-q-pack.mjs
import { openSync, readSync, writeSync, closeSync, statSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
const sha256hex = (b) => createHash("sha256").update(b).digest("hex");

const M = "holo-apps/apps/q/forge/.models";
const OUT = M + "/q-models.holo";
// instant tier FIRST (talk in the fewest bytes), big upgrades after.
// EVERYTHING in ONE κ-addressable file. Body ORDER is the product: instant talk loop FIRST (a new user streams the
// fewest bytes to first-talk), then upgrades light→heavy, the rare/heavy coder-3B LAST (mobile never touches it via
// Range). The single file exceeds GitHub's 2 GiB per-asset cap, so it's delivered in <2 GiB SHARDS (tools/shard-holo)
// stitched by a spanning reader — ONE address, one packKappa, sharding invisible above the rangeReader.
const SOURCES = [
  // INSTANT — the minimal talk loop: ear + endpoint + voice + brain. First-talk streams ONLY these (front of pack).
  { id: "moonshine-tiny-int8", kind: "asr-instant", path: M + "/moonshine-tiny-int8.holo", tier: "instant" },
  { id: "turn-detector", kind: "turn", path: M + "/turn-detector/turn-detector.holo", tier: "instant" },
  { id: "kokoro-82m", kind: "tts", path: M + "/kokoro-82m.holo", tier: "instant" },
  { id: "qwen2.5-0.5b", kind: "respond-brain", path: M + "/qwen2.5-0.5b-instruct.holo", tier: "instant" },
  // UPGRADE — streamed lazily after first-talk, light→heavy so the common upgrades arrive first, coder-3B last.
  { id: "parakeet-joint", kind: "asr-decoder", path: M + "/parakeet-tdt-0.6b-v2-onnx/parakeet-tdt-0.6b-v2-joint.holo", tier: "upgrade" },
  { id: "moonshine-tiny-f16", kind: "asr-upgrade", path: M + "/moonshine-tiny-f16.holo", tier: "upgrade" },
  { id: "parakeet-encoder", kind: "asr-encoder", path: M + "/parakeet-tdt-0.6b-v2-onnx/parakeet-tdt-0.6b-v2-stream.holo", tier: "upgrade" },
  { id: "qwen2.5-1.5b", kind: "respond-brain-upgrade", path: M + "/qwen2.5-1.5b-instruct.holo", tier: "upgrade" },
  { id: "qwen-coder-3b", kind: "agentic-coding", path: M + "/qwen2.5-coder-3b-instruct.holo", tier: "upgrade" },
];
// loose files a faculty needs alongside its .holo (folded in as κ-bodies, attached to a model's `files`).
const LOOSE = { "parakeet-encoder": [
  ["parakeet-encoder-rescale.json", M + "/parakeet-encoder-rescale.json"],
  ["parakeet-encoder-rescale.bin", M + "/parakeet-encoder-rescale.bin"],
  ["parakeet-vocab.txt", M + "/parakeet-vocab.txt"],
  ["parakeet-nemo128.onnx", M + "/parakeet-nemo128.onnx"],
] };

// universal .holo reader (node, fd) — returns the common sections + body dir + per-model name→κ list + extension.
function openHolo(path) {
  const fd = openSync(path, "r"), rd = (off, len) => { const b = Buffer.allocUnsafe(len); readSync(fd, b, 0, len, off); return b; };
  const head = rd(0, 10); if (head.toString("latin1", 0, 4) !== "HOLO") throw new Error("not .holo: " + path);
  const sc = head.readUInt16LE(8), tbl = rd(10, sc * 17), sections = {};
  for (let i = 0, p = 0; i < sc; i++, p += 17) sections[tbl[p]] = { off: Number(tbl.readBigUInt64LE(p + 1)), len: Number(tbl.readBigUInt64LE(p + 9)) };
  const m = sections[8], meta = JSON.parse(rd(m.off, m.len).toString());
  const w = sections[3], count = rd(w.off, 4).readUInt32LE(0), dirB = rd(w.off + 4, count * 48), dir = new Map();
  for (let i = 0, p = 0; i < count; i++, p += 48) dir.set(dirB.subarray(p, p + 32).toString("hex"), { off: Number(dirB.readBigUInt64LE(p + 32)), len: Number(dirB.readBigUInt64LE(p + 40)) });
  let ext = null; if (sections[14]) { const e = sections[14], eb = rd(e.off, e.len), keyLen = eb.readUInt16LE(0); ext = eb.subarray(2 + keyLen); }
  // carry the FULL per-tensor info (dims/type), not just name+κ — stream faculties (moonshine getF32/getQuant) need it.
  const list = (meta.order || meta.files || []).map((o) => ({ ...o, kappa: String(o.kappa).split(":").pop() }));
  return { fd, rd, dir, list, ext, meta };
}

// ── Pass 1: plan (no body bytes held) ──
const uniq = new Map();      // hexκ → { len, src:{path,off,len} | {file} }
const models = {};           // id → { kind, tier, order:[{name,kappa}], ext:base64|null, files:[{name,kappa}] }
const openers = new Map();   // path → opened reader (reused in pass 2)
let sumBytes = 0;
for (const s of SOURCES) {
  if (!existsSync(s.path)) { console.log("  MISSING", s.id, s.path); continue; }
  const h = openHolo(s.path); openers.set(s.path, h);
  // per-model meta the stream loaders read beyond the bodies (model config + optional mel filterbank ref). Kept in the
  // manifest so the pack is SELF-CONTAINED — every faculty opens it with no sidecar.
  const metaLite = { config: h.meta.config, mel: h.meta.mel, arch: h.meta.arch, format: h.meta.format };
  // the per-model baked header (GGUF metadata+tokenizer, can be MBs) is stored as a CONTENT-ADDRESSED κ-BODY referenced
  // by extKappa — NOT inlined as base64 in the front manifest. So opening the pack reads only the tiny manifest + the
  // weights dir (~100 KB) instead of ~29 MB of headers; each faculty lazily fetches its own header on load (ensureHeader).
  let extKappa = null;
  if (h.ext && h.ext.length) { const eb = Buffer.from(h.ext); extKappa = sha256hex(eb); if (!uniq.has(extKappa)) { uniq.set(extKappa, { len: eb.length, src: { buf: eb } }); sumBytes += eb.length; } }
  models[s.id] = { kind: s.kind, tier: s.tier, order: h.list, extKappa, files: [], meta: metaLite };
  for (const o of h.list) { if (!uniq.has(o.kappa)) { const d = h.dir.get(o.kappa); if (!d) throw new Error(`κ ${o.kappa} not in dir of ${s.id}`); uniq.set(o.kappa, { len: d.len, src: { path: s.path, off: d.off, len: d.len } }); sumBytes += d.len; } }
  for (const [name, fp] of (LOOSE[s.id] || [])) {
    if (!existsSync(fp)) { console.log("  loose MISSING", fp); continue; }
    const bytes = readFileSync(fp), k = sha256hex(bytes);
    if (!uniq.has(k)) { uniq.set(k, { len: bytes.length, src: { file: fp } }); sumBytes += bytes.length; }
    models[s.id].files.push({ name, kappa: k });
  }
}

// instant-tier-first body order: assign each unique κ the index of the FIRST model (in SOURCES order) that uses it.
const firstUse = new Map();
for (const s of SOURCES) { const mm = models[s.id]; if (!mm) continue; for (const o of mm.order.concat(mm.files)) if (!firstUse.has(o.kappa)) firstUse.set(o.kappa, s.id); if (mm.extKappa && !firstUse.has(mm.extKappa)) firstUse.set(mm.extKappa, s.id); }
const tierRank = (id) => (models[id] && models[id].tier === "instant" ? 0 : 1);
const orderedKeys = [...uniq.keys()].sort((a, b) => { const ra = tierRank(firstUse.get(a)), rb = tierRank(firstUse.get(b)); return ra - rb; });

// ── layout (sections Extension(14)=manifest, Metadata(8)=tiny, Weights(3)=dir+bodies) ──
const enc = (s) => Buffer.from(s, "utf8");
const manifest = { format: "holo-pack/1", bodies: uniq.size, dedup: { sumMB: +(sumBytes / 1e6).toFixed(1) }, models };
const extKey = enc("q.pack"), manifestBytes = enc(JSON.stringify(manifest));
const extBody = Buffer.concat([Buffer.from([extKey.length & 0xff, (extKey.length >> 8) & 0xff]), extKey, manifestBytes]);
const metaBytes = enc(JSON.stringify({ format: "holo-pack/1", bodies: uniq.size }));
const sectionCount = 3, headSize = 4 + 2 + 2 + 2 + sectionCount * 17;
const extOff = headSize, metaOff = extOff + extBody.length, weightsOff = metaOff + metaBytes.length;
const dirSize = 4 + uniq.size * 48, bodiesStart = weightsOff + dirSize;
let off = bodiesStart; for (const k of orderedKeys) { uniq.get(k).packOff = off; off += uniq.get(k).len; }
const totalSize = off;

// header + section table
const head = Buffer.alloc(headSize); head.write("HOLO", 0, "latin1"); head.writeUInt16LE(2, 4); head.writeUInt16LE(0, 6); head.writeUInt16LE(sectionCount, 8);
const sec = (idx, id, o, l) => { const p = 10 + idx * 17; head.writeUInt8(id, p); head.writeBigUInt64LE(BigInt(o), p + 1); head.writeBigUInt64LE(BigInt(l), p + 9); };
sec(0, 14, extOff, extBody.length); sec(1, 8, metaOff, metaBytes.length); sec(2, 3, weightsOff, dirSize + (totalSize - bodiesStart));
// weights dir
const dirBuf = Buffer.alloc(dirSize); dirBuf.writeUInt32LE(uniq.size, 0);
orderedKeys.forEach((k, i) => { const p = 4 + i * 48; Buffer.from(k, "hex").copy(dirBuf, p); dirBuf.writeBigUInt64LE(BigInt(uniq.get(k).packOff), p + 32); dirBuf.writeBigUInt64LE(BigInt(uniq.get(k).len), p + 40); });

// ── Pass 2: write (stream bodies, ≤16MB chunks) ──
console.log(`forging ${OUT} · ${uniq.size} unique bodies · ${(totalSize / 1e6).toFixed(0)}MB · sum-of-models ${(sumBytes / 1e6).toFixed(0)}MB`);
const ofd = openSync(OUT, "w"); let wpos = 0; const W = (buf) => { writeSync(ofd, buf, 0, buf.length, wpos); wpos += buf.length; };
W(head); W(extBody); W(metaBytes); W(dirBuf);
const hash = createHash("sha256"); hash.update(head); hash.update(extBody); hash.update(metaBytes); hash.update(dirBuf);
const CHUNK = 16 * 1024 * 1024; let done = 0;
for (const k of orderedKeys) {
  const u = uniq.get(k);
  if (u.src.buf) { W(u.src.buf); hash.update(u.src.buf); }                                  // in-memory body (per-model baked header)
  else if (u.src.file) { const b = readFileSync(u.src.file); W(b); hash.update(b); }
  else { const fd = openers.get(u.src.path).fd; let rem = u.src.len, o2 = u.src.off; while (rem > 0) { const n = Math.min(CHUNK, rem); const b = Buffer.allocUnsafe(n); readSync(fd, b, 0, n, o2); W(b); hash.update(b); rem -= n; o2 += n; } }
  if ((++done) % 200 === 0) console.log(`  ${done}/${uniq.size} bodies`);
}
closeSync(ofd);
// packKappa = sha256(whole file) = the pack's did:holo (its one adopt address). Written to a sidecar (embedding
// it would be circular — it's the hash of the bytes that would contain it). The pin / loader read the sidecar.
const packKappa = hash.digest("hex");
writeSync(openSync(OUT + ".kappa", "w"), packKappa + "\n");

console.log(`\nSEALED q-models.holo`);
console.log(`  packKappa did:holo:sha256:${packKappa}`);
console.log(`  ${(totalSize / 1e6).toFixed(0)}MB · ${uniq.size} bodies · ${SOURCES.length} models · dedup ratio ${(sumBytes / totalSize).toFixed(3)} (sum/pack)`);
for (const id in models) console.log(`    ${id.padEnd(22)} ${models[id].order.length} tensors + ${models[id].files.length} files · ${models[id].tier}`);
