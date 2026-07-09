// holo-load2bit.mjs — the LOAD-DIRECT consumer (the "load" half of the 7B infra). Given a pre-compiled
// 2-bit κ-object (manifest.json + content-addressed b/<κ>.gz blocks, produced by compile2bit.mjs), it builds
// the engine manifest + a fetchTensor that streams blocks, verifies each by re-deriving its κ (Law L5),
// gunzips, and hands the engine the weights ALREADY 2-bit — no re-quant at load. The engine reads
// manifest.preQuantized=true (parts() returns the blocks verbatim) and incoherent=false (LDLQ ⇒ no FWHT).
// Hosting = serve the κ-object dir from anywhere; the κ-verify makes any mirror untrusted-safe.
//
// A family FINETUNE is stored as `base-κ + delta` (format "holo-delta/1"); loadKappaObject detects that and
// transparently delegates to holo-load-delta.mjs, which reconstructs the finetune's blocks and returns the
// SAME { manifest, fetchTensor } shape — so the engine, KV-cache, and Q's brain loader need no changes.
import { f16ToF32 } from "./qvac-ingest.mjs";

async function gunzip(u8) { const ds = new DecompressionStream("gzip"); const w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// ── PERSISTENT κ-CACHE (the returning-user path): a κ-object's manifest + blocks are content-addressed and
// IMMUTABLE, so once fetched they can live in the browser's Cache API FOREVER, keyed by their own URL. A
// returning user then loads Q from local disk — ~0 network, no server (serverless by construction). It is
// untrusted-safe: every cached block is still L5 re-derived below, so a poisoned cache entry is rejected
// exactly like a poisoned network body. First visit warms the cache; every visit after is disk-speed. ──
const KCACHE = "holo-kappa-v1";
let _persistAsked = false;
async function _askPersist() {
  if (_persistAsked) return; _persistAsked = true;                       // once per session: ask the browser NOT to evict the model under storage pressure
  try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) {}
}
// fetch a URL as bytes, disk-cached by URL. cache HIT → no network. MISS → fetch once (no-store bounds the
// in-flight RAM to one body) then store to disk. All failures fall back to a plain fetch (never block a load).
const _inflight = new Map();   // URL → in-flight fetch promise, so a parallel prefetch + the engine's read of the
                               // SAME block share ONE network fetch (never double-download).
async function cachedBytes(url) {
  let cache = null;
  try { cache = await caches.open(KCACHE); const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch (e) { cache = null; }
  if (_inflight.has(url)) return _inflight.get(url);
  const p = (async () => {
    const buf = await (await fetch(url, { cache: "no-store" })).arrayBuffer();
    if (cache) { try { await cache.put(url, new Response(buf.slice(0), { headers: { "Content-Type": "application/octet-stream" } })); _askPersist(); } catch (e) {} }
    return new Uint8Array(buf);
  })();
  _inflight.set(url, p);
  try { return await p; } finally { _inflight.delete(url); }
}
// FAST FIRST LOAD: warm the whole block cache with bounded concurrency, so the engine's sequential per-tensor
// reads hit the cache instead of paying one HF round-trip at a time (~1.5 blocks/s → tens of blocks/s over HTTP/2).
// Fire-and-forget; the engine's getBlock shares any in-flight fetch (no double-download). Cross-origin-CDN safe.
function prefetchBlocks(baseUrl, kappas, conc = 12) {
  try {
    const urls = [...new Set(kappas.filter(Boolean))].map((k) => baseUrl + "/b/" + String(k).replace(":", "_") + ".gz");
    let i = 0;
    const worker = async () => { while (i < urls.length) { const u = urls[i++]; try { await cachedBytes(u); } catch (e) {} } };
    Promise.all(Array.from({ length: Math.min(conc, urls.length) }, worker)).catch(() => {});
  } catch (e) {}
}

// reshape a raw (gunzipped) block to what the engine reads. PURE — shared with the delta loader so both
// paths apply identical per-fmt handling. 2bit+fp16 → 2bit+f32 scales; everything else verbatim.
export function reshapeTensor(rec, raw) {
  if (rec.fmt === "2bit" && rec.fp16) {                  // [2-bit packed][fp16 scales] → [2-bit][f32 scales]
    const Kp = rec.K, q2 = (rec.N * Kp) / 4, nsc = rec.N * (Kp / 32);
    const f16 = new Uint16Array(raw.buffer, raw.byteOffset + q2, nsc);
    const out = new Uint8Array(q2 + nsc * 4); out.set(raw.subarray(0, q2), 0);
    const f32 = new Float32Array(out.buffer, q2, nsc); for (let i = 0; i < nsc; i++) f32[i] = f16ToF32(f16[i]);
    return out;
  }
  return raw;                                            // 2bit+f32 (incoherence), q8 (embed), f32 (norms) — verbatim
}

// build the engine manifest from model meta + normalized tensor records {name→{N,K,fmt,s?}}. PURE — shared.
export function buildEngineManifest(man, normRecs, e8lutData) {
  const tensors = Object.entries(normRecs).map(([name, rec]) => ({ name, N: rec.N, K: rec.K, blk: rec.fmt !== "f32", fmt: rec.fmt, ...(rec.s !== undefined ? { s: rec.s } : {}) }));
  const native = man.mode === "q4" || man.mode === "q3" || man.mode === "e8" || man.mode === "bitnet";   // native-bits κ-object
  return {
    d: man.d, n_heads: man.n_heads, n_kv_heads: man.n_kv_heads, ff: man.ff, vocab: man.vocab, n_layers: man.n_layers, hd: man.hd,
    bits: native ? man.bits : 8, layout: man.layout, rope_base: man.rope_base, ...(man.maskId !== undefined ? { maskId: man.maskId, diffusion: true } : {}), attn_bias: man.attn_bias, qk_norm: man.qk_norm, qk_norm_dim: man.qk_norm_dim, tied: man.tied,
    ...(man.sub_norm ? { sub_norm: true } : {}), ...(man.bitlinear ? { bitlinear: true } : {}), ...(man.ffn_act ? { ffn_act: man.ffn_act } : {}), ...(man.moe ? { moe: man.moe } : {}),
    ...(native ? {} : { twoBit: true, incoherent: man.incoherent === true, preQuantized: true }), tensors, ...(e8lutData ? { e8lutData } : {}),
  };
}

export async function loadKappaObject(baseUrl, opts = {}) {
  // Law L5: the manifest is the ROOT that names every block's κ. Verify the manifest's OWN bytes
  // re-derive to a pinned κ BEFORE trusting man.tensors[*].kappa — otherwise a tampered manifest can
  // re-point every block to a forged-but-self-consistent κ and each per-block check passes against the
  // forgery. The pin is an EXTERNAL anchor (catalog/lock), never the manifest's own self-asserted root.
  const manRaw = await cachedBytes(baseUrl + "/manifest.json");   // disk-cached (pinned + verified below), so a returning user's load is 0-network end to end
  const manKappa = "sha256:" + hex(await crypto.subtle.digest("SHA-256", manRaw));
  const pin = opts.expectKappa ? String(opts.expectKappa).replace(/^did:holo:/, "") : null;
  if (pin) { if (manKappa !== pin) throw new Error("manifest κ MISMATCH (Law L5): " + manKappa.slice(0, 24) + "… ≠ pinned " + pin.slice(0, 24) + "…"); }
  else if (!opts.allowUnpinned) throw new Error("manifest unpinned (Law L5): pass opts.expectKappa (catalog pin) or opts.allowUnpinned for dev");
  const man = JSON.parse(new TextDecoder().decode(manRaw));
  // CANONICAL BLAKE3 (Law L1), best-effort + fully gated: if the object publishes a sha256→blake3 map,
  // verify each block's canonical BLAKE3 κ IN ADDITION to its sha256 transport κ (both over the stored
  // gzipped block — sha256(gz)=name, blake3(gz)=canonical; proven on real q-bitnet-2b). Absent map or no
  // wasm → b3 stays null → sha256-only, i.e. byte-for-byte today's behavior (no-op until the map ships).
  let b3map = null, b3 = null;
  if (opts.blake3 !== false) try {
    const fn = (await import("./pkg/holospaces_web.js")).kappa;
    let ok = false; try { ok = fn(new Uint8Array([1])).startsWith("blake3:"); } catch (e) { ok = false; }  // wasm already init'd by loader.ready()
    if (ok) {
      if (opts.blake3Map) b3map = opts.blake3Map;                                          // injected map (test before the HF upload)
      else { const mr = await fetch(baseUrl + "/sha256-to-blake3.map.json"); if (mr.ok) b3map = await mr.json(); }
      if (b3map) b3 = fn;
    }
  } catch (e) { b3map = null; b3 = null; }
  // FAMILY FINETUNE: a `base-κ + delta` object — reconstruct via the delta loader (same return shape).
  if (man.format === "holo-delta/1") return (await import("./holo-load-delta.mjs")).loadDeltaObject(baseUrl, { ...opts, manifest: man });
  // FAST FIRST LOAD: prefetch every block into the cache in parallel while the engine builds (turns a
  // latency-bound sequential stream into a bandwidth-bound one — critical when serving off a remote CDN like HF).
  if (opts.prefetch !== false) { try { prefetchBlocks(baseUrl, Object.values(man.tensors || {}).map((r) => r.kappa)); } catch (e) {} }
  // RAM-bounded, DISK-cached: the engine fetches each tensor once, so decoded blocks are handed over and
  // released — in-flight RAM stays ~one block (a 7B κ-object decompresses to >2.6 GB). The gzipped block
  // bytes are persisted to the Cache API by their content-addressed URL (cachedBytes), so a returning user
  // reads them from disk with no network. Every block — cached or fresh — is L5 re-derived (κ must match),
  // so the cache is untrusted-safe.
  const getBlock = async (kappa) => {
    const gz = await cachedBytes(baseUrl + "/b/" + kappa.replace(":", "_") + ".gz");
    const got = "sha256:" + hex(await crypto.subtle.digest("SHA-256", gz));         // Law L5: re-derive the transport κ
    if (got !== kappa) throw new Error("κ MISMATCH " + kappa.slice(0, 24));
    if (b3 && b3map) { const want = b3map[kappa]; if (want) { if (b3(gz) !== want) throw new Error("BLAKE3 κ MISMATCH " + kappa.slice(0, 24)); if (typeof window !== "undefined") window.__b3n = (window.__b3n || 0) + 1; } }  // Law L1 canonical axis
    return await gunzip(gz);
  };
  const fetchTensor = async (name) => {
    const rec = man.tensors[name]; if (!rec) return new Uint8Array(0);
    return reshapeTensor(rec, await getBlock(rec.kappa));
  };
  // E₈ codebook (mode e8): the 256×8 LUT is its own content-addressed block — fetch + κ-verify (Law L5)
  let e8lutData;
  if (man.e8lut) { const b = await getBlock(man.e8lut.replace(/^did:holo:/, "")); e8lutData = new Float32Array(b.buffer, b.byteOffset, 2048); }
  const manifest = buildEngineManifest(man, man.tensors, e8lutData);
  // bundled tokenizer (SERVERLESS load): the header (tokenizer + arch) should load same-origin/on-device, no
  // external host. A RELATIVE `source` already resolves against the κ-object's own dir. When the manifest
  // declares a REMOTE (http) source but the κ-object ALSO ships a local tokenizer.gguf, PREFER the bundle —
  // one cheap HEAD probe, and the manifest bytes (hence its Law-L5 pin) stay untouched. No bundle served →
  // fall back to the declared source. This makes a κ-object with a bundled header 100% serverless to load.
  const base = baseUrl.replace(/\/+$/, "");
  if (man.source && !/^https?:\/\//.test(man.source)) man.source = base + "/" + man.source;
  else if (man.source && /^https?:\/\//.test(man.source)) {
    try { const h = await fetch(base + "/tokenizer.gguf", { method: "HEAD" }); if (h && h.ok) man.source = base + "/tokenizer.gguf"; } catch (e) {}
  }
  return { manifest, fetchTensor, info: man };
}
