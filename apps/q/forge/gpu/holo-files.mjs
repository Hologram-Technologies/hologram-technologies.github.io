// holo-files.mjs — serve a file-bundle .holo (seal-files-holo.mjs) by κ in the browser: HTTP-Range fetch
// each file body by its content address, per-block SHA-256 L5 verify, OPFS cache (instant + offline on the
// 2nd load). Reconstructs files as bytes / Blob object-URLs so an existing runtime (onnxruntime-web,
// kokoro-js, transformers.js) can consume a κ-addressable model with no flat download and no trust in transport.
//   openHoloFiles(url) → { meta, files:[{name,kappa,len}], getFile(name)->Uint8Array, objectURL(name)->url, stats }
const MAGIC = [0x48, 0x4f, 0x4c, 0x4f];
const hexOf = (b) => { let s = ""; for (const x of b) s += x.toString(16).padStart(2, "0"); return s; };
const sha256hex = async (buf) => hexOf(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)));
async function opfsGet(k) { try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("holo-kappa", { create: true }); return new Uint8Array(await (await (await d.getFileHandle(k)).getFile()).arrayBuffer()); } catch { return null; } }
async function opfsPut(k, b) { try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("holo-kappa", { create: true }); const w = await (await d.getFileHandle(k, { create: true })).createWritable(); await w.write(b); await w.close(); return true; } catch { return false; } }

export async function openHoloFiles(url, { useOpfs = true, release = "" } = {}) {
  const stats = { ranges: 0, bytesFetched: 0, verifies: 0, opfsHits: 0, opfsWrites: 0, releaseRoute: false };
  let whole = null, activeUrl = url, triedRelease = false;
  const rd = async (off, len) => {
    if (whole) return whole.subarray(off, off + len);
    stats.ranges++;
    let r = null; try { r = await fetch(activeUrl, { headers: { Range: `bytes=${off}-${off + len - 1}` } }); } catch (e) { r = null; }
    if ((!r || !r.ok) && release && activeUrl !== release && !triedRelease) {   // big bundle lives as a GitHub Release asset
      triedRelease = true; activeUrl = release; stats.releaseRoute = true;
      try { r = await fetch(activeUrl, { headers: { Range: `bytes=${off}-${off + len - 1}` } }); } catch (e) { r = null; }
    }
    if (!r || !r.ok) throw new Error("holo fetch failed (" + (r ? r.status : "network") + "): " + activeUrl);
    const u = new Uint8Array(await r.arrayBuffer()); stats.bytesFetched += u.length;
    if (r.status === 206) return u;
    if (u.length > len) { whole = u; return whole.subarray(off, off + len); }
    return u;
  };
  const head = await rd(0, 64), hdv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  for (let i = 0; i < 4; i++) if (head[i] !== MAGIC[i]) throw new Error("not a .holo");
  const sc = hdv.getUint16(8, true);
  const tbl = await rd(10, sc * 17), tdv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength), sections = {};
  for (let i = 0, p = 0; i < sc; i++, p += 17) sections[tbl[p]] = { off: Number(tdv.getBigUint64(p + 1, true)), len: Number(tdv.getBigUint64(p + 9, true)) };
  const m = sections[8], meta = JSON.parse(new TextDecoder().decode(await rd(m.off, m.len)));
  const w = sections[3], cntB = await rd(w.off, 4), count = new DataView(cntB.buffer, cntB.byteOffset, cntB.byteLength).getUint32(0, true);
  const dirB = await rd(w.off + 4, count * 48), ddv = new DataView(dirB.buffer, dirB.byteOffset, dirB.byteLength), dir = new Map();
  for (let i = 0, p = 0; i < count; i++, p += 48) dir.set(hexOf(dirB.subarray(p, p + 32)), { off: Number(ddv.getBigUint64(p + 32, true)), len: Number(ddv.getBigUint64(p + 40, true)) });
  const byName = new Map(meta.files.map((f) => [f.name, f])), cache = new Map();

  async function bodyByKappa(hex) {
    if (useOpfs) { const c = await opfsGet(hex); if (c) { stats.verifies++; if (await sha256hex(c) === hex) { stats.opfsHits++; return c; } } }
    const d = dir.get(hex); if (!d) throw new Error("κ not in holo: " + hex);
    const b = await rd(d.off, d.len);
    stats.verifies++; if (await sha256hex(b) !== hex) throw new Error("L5 REFUSE " + hex);
    if (useOpfs && await opfsPut(hex, b)) stats.opfsWrites++;
    return b;
  }
  async function getFile(name) { if (cache.has(name)) return cache.get(name); const f = byName.get(name); if (!f) throw new Error("no file " + name); const b = await bodyByKappa(f.kappa); cache.set(name, b); return b; }
  async function objectURL(name, mime = "application/octet-stream") { return URL.createObjectURL(new Blob([await getFile(name)], { type: mime })); }
  return { meta, files: meta.files, getFile, objectURL, bodyByKappa, stats };
}
