// holo-whisper-stream.mjs — load Whisper weights 100% from the .holo, native to the κ substrate:
//   • HTTP-Range fetch of each tensor body by its κ (content address) — only what's needed, in any order
//   • per-block WebCrypto SHA-256 L5 verify (re-derive every byte before accepting it)
//   • OPFS cache keyed by κ → second load is instant + offline (serverless), still L5-verified
//   • dequant verbatim ggml bytes (F16/F32) → f32 for the WebGPU kernels
// No flat blob, no trust in the transport: identity is the hash, exactly like the rest of Hologram.
const MAGIC = [0x48, 0x4f, 0x4c, 0x4f];
const hexOf = (b) => { let s = ""; for (const x of b) s += x.toString(16).padStart(2, "0"); return s; };

// f16→f32 via a 64K lookup table (IEEE half, incl. subnormals/inf/nan) — built once.
const F16 = new Float32Array(65536);
for (let h = 0; h < 65536; h++) { const s = (h >> 15) & 1, e = (h >> 10) & 0x1f, m = h & 0x3ff; let v; if (e === 0) v = Math.pow(2, -14) * (m / 1024); else if (e === 31) v = m ? NaN : Infinity; else v = Math.pow(2, e - 15) * (1 + m / 1024); F16[h] = s ? -v : v; }

const sha256hex = async (buf) => hexOf(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)));

async function opfsGet(key) { try { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle("holo-kappa", { create: true }); const fh = await d.getFileHandle(key); return new Uint8Array(await (await fh.getFile()).arrayBuffer()); } catch { return null; } }
async function opfsPut(key, bytes) { try { const r = await navigator.storage.getDirectory(); const d = await r.getDirectoryHandle("holo-kappa", { create: true }); const fh = await d.getFileHandle(key, { create: true }); const w = await fh.createWritable(); await w.write(bytes); await w.close(); return true; } catch { return false; } }

// align a (possibly offset) body view to a fresh ArrayBuffer for typed-array views
const aligned = (u) => (u.byteOffset % 4 === 0) ? u : new Uint8Array(u.slice().buffer);

export async function streamHolo(url, { useOpfs = true, kappa = "", release = "" } = {}) {
  const stats = { ranges: 0, bytesFetched: 0, verifies: 0, opfsHits: 0, opfsWrites: 0, support206: false, kappaRoute: false, releaseRoute: false };
  let wholeBuf = null;          // set when the server returns the 200 full body → serve all reads from memory
  let activeUrl = url, switched = false, triedRelease = false;
  const fetchRange = (u, off, len) => fetch(u, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
  const rangeReader = async (off, len) => {
    if (wholeBuf) return wholeBuf.subarray(off, off + len);     // no-Range server: one full fetch, then in-memory slices
    stats.ranges++;
    let r = null; try { r = await fetchRange(activeUrl, off, len); } catch (e) { r = null; }
    // DEPLOY TIER 2: weights too large for Pages (100MB/file) live as a GitHub Release asset (2GB/file).
    if ((!r || !r.ok) && release && activeUrl !== release && !triedRelease) {
      triedRelease = true; activeUrl = release; stats.releaseRoute = true;
      try { r = await fetchRange(activeUrl, off, len); } catch (e) { r = null; }
    }
    // STATIC/IPFS DEPLOY: the gitignored .holo isn't at its path → heal by κ (/.holo/sha256/<κ>), the
    // Service Worker pulls it from IPFS/mesh. Same fallback as Q's .holo brain (holo-brain-engine).
    if ((!r || !r.ok) && kappa && !switched) {
      switched = true; activeUrl = "/.holo/sha256/" + kappa; stats.kappaRoute = true;
      try { r = await fetchRange(activeUrl, off, len); } catch (e) { r = null; }
    }
    if (!r || !r.ok) throw new Error("holo fetch failed (" + (r ? r.status : "network") + "): " + activeUrl);
    stats.support206 = stats.support206 || r.status === 206;
    const u = new Uint8Array(await r.arrayBuffer());
    stats.bytesFetched += u.length;
    if (r.status === 206) return u;                              // true partial response → use as-is
    if (u.length > len) { wholeBuf = u; return wholeBuf.subarray(off, off + len); }   // got whole file → cache, slice (every block still L5-verified)
    return u;
  };
  // ── parse head / sections / metadata / weights directory ──
  const head = await rangeReader(0, 64), hdv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  for (let i = 0; i < 4; i++) if (head[i] !== MAGIC[i]) throw new Error("not a .holo");
  const sc = hdv.getUint16(8, true);
  const tbl = await rangeReader(10, sc * 17), tdv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength), sections = {};
  for (let i = 0, p = 0; i < sc; i++, p += 17) sections[tbl[p]] = { off: Number(tdv.getBigUint64(p + 1, true)), len: Number(tdv.getBigUint64(p + 9, true)) };
  const m = sections[8], metaB = await rangeReader(m.off, m.len);
  const meta = JSON.parse(new TextDecoder().decode(metaB));
  // Extension (kind 14) = [keyLen u16][key][ggml whisper head bytes] → hparams + mel filterbank + vocab
  const ex = sections[14], exB = ex ? await rangeReader(ex.off, ex.len) : null;
  const headerBytes = exB ? exB.subarray(2 + new DataView(exB.buffer, exB.byteOffset, exB.byteLength).getUint16(0, true)) : null;
  const w = sections[3], cntB = await rangeReader(w.off, 4), count = new DataView(cntB.buffer, cntB.byteOffset, cntB.byteLength).getUint32(0, true);
  const dirB = await rangeReader(w.off + 4, count * 48), ddv = new DataView(dirB.buffer, dirB.byteOffset, dirB.byteLength), dir = new Map();
  for (let i = 0, p = 0; i < count; i++, p += 48) dir.set(hexOf(dirB.subarray(p, p + 32)), { off: Number(ddv.getBigUint64(p + 32, true)), len: Number(ddv.getBigUint64(p + 40, true)) });
  // fetch+verify one body by κ (OPFS-cached) — REFUSE on hash mismatch (L5)
  async function bodyByKappa(hex) {
    if (useOpfs) { const c = await opfsGet(hex); if (c) { stats.verifies++; if (await sha256hex(c) === hex) { stats.opfsHits++; return c; } } }
    const d = dir.get(hex); if (!d) throw new Error("κ not in holo: " + hex);
    const b = await rangeReader(d.off, d.len);
    stats.verifies++; if (await sha256hex(b) !== hex) throw new Error("L5 REFUSE " + hex);
    if (useOpfs && await opfsPut(hex, b)) stats.opfsWrites++;
    return b;
  }
  const views = buildHoloViews(meta, headerBytes, bodyByKappa);
  return Object.assign({}, views, { dir, sections, stats });
}

// the dequant accessors (getF32/getQuant/getMelFilters) over a meta + a body fetcher — extracted so the unified pack
// reuses the EXACT decode (holo-q-pack-provider's streamHoloFromPackModel passes the pack view's L5 getBody here).
// getBody(hex) → Promise<Uint8Array> (already L5-verified by the caller). meta.order carries name/dims/type/kappa.
export function buildHoloViews(meta, headerBytes, getBody) {
  const byName = new Map(meta.order.map((o) => [o.name, o]));
  const norm = (k) => String(k).split(":").pop();
  async function getF32(name) {
    const o = byName.get(name); if (!o) throw new Error("no tensor " + name);
    const n = o.dims.reduce((a, b) => a * b, 1), body = aligned(await getBody(norm(o.kappa)));
    if (o.type === 0) return new Float32Array(body.buffer, body.byteOffset, n);               // F32 verbatim
    if (o.type === 1) { const u = new Uint16Array(body.buffer, body.byteOffset, n), f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = F16[u[i]]; return f; }  // F16→F32
    if (o.type === 9) {   // per-row int8: [f32 scale × rows][int8 × n] → F32
      const rows = o.dims[0], cols = n / rows, scales = new Float32Array(body.buffer, body.byteOffset, rows), q = new Int8Array(body.buffer, body.byteOffset + rows * 4, n), f = new Float32Array(n);
      for (let r = 0; r < rows; r++) { const sc = scales[r], b = r * cols; for (let c = 0; c < cols; c++) f[b + c] = q[b + c] * sc; }
      return f;
    }
    throw new Error("unhandled ggml type " + o.type);
  }
  async function getQuant(name) {
    const o = byName.get(name); if (!o) throw new Error("no tensor " + name);
    const n = o.dims.reduce((a, b) => a * b, 1);
    if (o.type === 9) { const body = aligned(await getBody(norm(o.kappa))), rows = o.dims[0];
      return { q8: true, rows, cols: n / rows, scales: new Float32Array(body.buffer, body.byteOffset, rows), int8: new Uint8Array(body.buffer, body.byteOffset + rows * 4, n) }; }
    return { q8: false, f32: await getF32(name) };
  }
  async function getMelFilters() {
    const mk = meta.mel && meta.mel.kappa; if (!mk) throw new Error("no mel filterbank in .holo");
    const body = aligned(await getBody(norm(mk)));
    return new Float32Array(body.buffer, body.byteOffset, meta.mel.n_mel * meta.mel.n_fft);
  }
  return { meta, getF32, getQuant, getMelFilters, bodyByKappa: (h) => getBody(norm(h)), headerBytes, names: meta.order.map((o) => o.name) };
}
