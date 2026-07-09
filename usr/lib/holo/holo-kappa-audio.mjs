// holo-kappa-audio.mjs — native κ-addressed LOSSLESS audio for Hologram (the audio twin of holo-media).
//
// A κ-audio track is a content-addressed DAG: an ordered list of byte chunks, EACH ONE a κ, plus the
// whole-file κ (trackKappa). Identity is the bytes, never the URL (Law L1). loadKappaAudio() pulls every
// chunk BY ITS κ (κ-store/OPFS dedup → origin), and RE-DERIVES each chunk against its κ (Law L5) BEFORE a
// single byte reaches the decoder — a tampered chunk changes its κ and is refused, never fed. The whole
// file is re-derived against trackKappa too. This is strictly stronger than a normal player: the decoder
// only ever sees content-verified, bit-exact bytes. Cut the origin and a resident track still plays from
// the κ-store (serverless). Honest by design (Law L5): lossless means bit-exact to the master — we never
// fabricate detail; the proof is that every byte hashes back to its declared κ.
//
//   import { resolveKappaTrack, loadKappaAudio } from "../../../_shared/holo-kappa-audio.mjs";
//   const t = await resolveKappaTrack("/apps/music/feed/kappa/.../manifest.json");
//   audioEl.src = t.blobUrl;     // a same-origin Blob of the VERIFIED lossless bytes → any <audio>/Web Audio chain
//
// Two surfaces:
//   • ISOMORPHIC (Node · browser · SW) — the chunk algebra + L5 verification (chunkKappa · verifyChunk ·
//     assemble · verifyManifest). The witness imports these; no DOM/fetch/OPFS needed.
//   • BROWSER — loadKappaAudio() (κ-store-backed fetch + verify) and resolveKappaTrack() (→ Blob URL).
//
// Manifest schema (v1): { v, kind:"holo-kappa-audio", title, artist, album?, mime, sampleRate?, channels?,
//   bits?, durationSec?, bytes, trackKappa, chunkBytes, chunks:[{ file, kappa, bytes }] }
//
// Authorities: holospaces Laws L1 (content not location) · L5 (verify by re-derivation). Reuses the OS
// content-addressing (holo-uor.sha256hex) and κ-store (holo-opfs-kappastore), exactly like holo-media.

import { sha256hex } from "./holo-uor.mjs";

const SHA = "did:holo:sha256:";

// ── isomorphic chunk algebra + L5 verification ───────────────────────────────────────────────────────
export const hexOf = (k) => String(k).split(":").pop().toLowerCase();
// chunkKappa(bytes) — the content address of one chunk (byte-identical to the /.holo/sha256/<hex> route).
export const chunkKappa = (bytes) => SHA + sha256hex(bytes);
// verifyChunk(bytes, κ) — Law L5: re-derive the content address and compare. The single trust boundary;
// a wrong byte changes the κ and is refused.
export const verifyChunk = (bytes, kappa) => sha256hex(bytes) === hexOf(kappa);
// assemble(parts) — concat verified chunks into the whole lossless file, in order.
export function assemble(parts) {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
// verifyManifest(manifest, getBytes) — pure check used by the witness. getBytes(i, chunk) → Uint8Array.
// Returns { ok, verified, total, trackOk } and never throws on a mismatch (it reports it).
export function verifyManifest(manifest, getBytes) {
  const chunks = (manifest && manifest.chunks) || []; let verified = 0; const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    const u8 = getBytes(i, chunks[i]);
    if (!verifyChunk(u8, chunks[i].kappa)) return { ok: false, verified, total: chunks.length, trackOk: false, at: i };
    parts.push(u8); verified++;
  }
  const whole = assemble(parts);
  const trackOk = !manifest.trackKappa || verifyChunk(whole, manifest.trackKappa);
  return { ok: trackOk, verified, total: chunks.length, trackOk, bytes: whole.length };
}

// ── browser: a tiny default κ-store (OPFS, dedup + serverless), lazily opened and shared ───────────────
let _storeP = null;
async function defaultStore() {
  if (_storeP) return _storeP;
  _storeP = (async () => {
    try { const m = await import("./holo-opfs-kappastore.mjs"); return await m.OpfsKappaStore.open("holo-kappa-audio"); }
    catch (e) { return null; }                                   // no OPFS → plain origin fetch + verify (still L5-safe)
  })();
  return _storeP;
}

// ── browser: load + VERIFY-BEFORE-DECODE → the whole lossless file as bytes ────────────────────────────
// opts: { base, store (null=default OPFS, false=none), fetchImpl }. Throws on any κ mismatch (refusal).
export async function loadKappaAudio(manifest, opts = {}) {
  const f = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  const base = opts.base || "";
  const store = opts.store === false ? null : (opts.store || await defaultStore());
  const chunks = (manifest && manifest.chunks) || [];
  if (!chunks.length) throw new Error("κ-audio: empty manifest");
  const parts = []; let verified = 0, originBytes = 0;
  for (const ch of chunks) {
    const hex = hexOf(ch.kappa); let u8 = null, fromStore = false;
    if (store) { try { if (await store.hasKey("sha256", hex)) { u8 = await store.getByKey("sha256", hex); fromStore = true; } } catch (e) {} }
    if (!u8) {
      if (!f) throw new Error("κ-audio: no fetch + chunk not resident");
      const r = await f(base + ch.file, { cache: "no-store" });
      if (!r.ok) throw new Error("κ-audio: chunk HTTP " + r.status);
      u8 = new Uint8Array(await r.arrayBuffer()); originBytes += u8.length;
    }
    if (!verifyChunk(u8, ch.kappa)) throw new Error("κ-audio: chunk κ mismatch — refused (" + hex.slice(0, 12) + "…)");  // L5 BEFORE decode
    if (store && !fromStore) { try { await store.putVerified("sha256", hex, u8); } catch (e) {} }
    parts.push(u8); verified++;
  }
  const bytes = assemble(parts);
  if (manifest.trackKappa && !verifyChunk(bytes, manifest.trackKappa)) throw new Error("κ-audio: track κ mismatch — refused");
  return {
    bytes, verified, total: chunks.length,
    fromStore: originBytes === 0,                                // true ⇒ played entirely from the κ-store (serverless / dedup)
    originBytes, mime: manifest.mime || "application/octet-stream", trackKappa: manifest.trackKappa || chunkKappa(bytes),
    meta: { title: manifest.title || "", artist: manifest.artist || "", album: manifest.album || "",
      sampleRate: manifest.sampleRate || 0, channels: manifest.channels || 0, bits: manifest.bits || 0, durationSec: manifest.durationSec || 0,
      lossless: true, loudness: manifest.loudness || null, normalizeDb: (typeof manifest.normalizeDb === "number" ? manifest.normalizeDb : 0), targetLufs: manifest.targetLufs || 0 },
  };
}

// ── browser: → a same-origin Blob URL of the verified lossless bytes (feeds any <audio>/Web Audio chain) ─
// Accepts a manifest object OR a manifest URL (chunk `file` paths resolve relative to the manifest's dir).
export async function resolveKappaTrack(manifestOrUrl, opts = {}) {
  const f = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  let manifest = manifestOrUrl, base = opts.base || "";
  if (typeof manifestOrUrl === "string") {
    if (!f) throw new Error("κ-audio: no fetch to load manifest");
    const r = await f(manifestOrUrl, { cache: "no-store" });
    if (!r.ok) throw new Error("κ-audio: manifest HTTP " + r.status);
    manifest = await r.json();
    if (!base) { try { base = new URL(".", new URL(manifestOrUrl, (typeof location !== "undefined" ? location.href : undefined))).href; } catch (e) { base = ""; } }
  }
  const loaded = await loadKappaAudio(manifest, { ...opts, base });
  const blob = new Blob([loaded.bytes], { type: loaded.mime });
  const blobUrl = (typeof URL !== "undefined" && URL.createObjectURL) ? URL.createObjectURL(blob) : null;
  return { ...loaded, blob, blobUrl, dispose: () => { try { if (blobUrl) URL.revokeObjectURL(blobUrl); } catch (e) {} } };
}

// expose a window global too, so classic (non-module) scripts (e.g. holo-vinyl.js) can use it after import()
try { if (typeof window !== "undefined") window.HoloKappaAudio = { resolveKappaTrack, loadKappaAudio, verifyManifest, chunkKappa, verifyChunk, assemble, hexOf }; } catch (e) {}
