// holo-ingest.mjs — THE PORT. The single universal intake behind "the +": one function that turns
// ANY source (a file, a pasted blob, a fetched URL body, a stream chunk) into κ-objects on the
// substrate. This is S0 of the "Universal κ-Ingest → Hypergraph → Q Proactive Insight" north star:
// the swappable, off-substrate EDGE that seals raw bytes by content address, classifies them, and —
// for text-like sources — also seals a canonical decoded text VIEW that the MAP layer (S1) reads to
// extract entities. Pure ESM, isomorphic (Node · browser · service worker), fetch/clock/hash injected
// so it is Node-witnessable and re-derives identically wherever it runs (Law L2: one canonical hash).
//
// THE TWO RULES THIS LAYER GUARANTEES (ADR acceptance for S0):
//   1 · NEVER A SILENT DROP. Every input yields ≥1 κ-object. Unknown/binary types are sealed raw with
//       an honest {supported:false} view marker — stored, addressable, never discarded.
//   2 · CONTENT-ADDRESSED. The same bytes always seal to the same κ (this is what makes S2 dedup free
//       and S5 provenance structural — the source κ IS the evidence anchor an insight will cite).
//
// The substrate is SOURCE-AGNOSTIC. Acquisition (reading a disk file, fetching a URL, pulling a stream)
// is the only non-substrate step and lives in thin adapters (ingestFile / ingestUrl below, or a caller's
// own). Once bytes are in hand, sealIngest is identical regardless of where they came from.

import { sha256hex, didHolo, jcs } from "./holo-uor.mjs";

const SHA = "sha256";
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });

// ── type classification ─────────────────────────────────────────────────────────────────────────
// Mirrors ANIMA's ingestion rule: "Text fallback decodes ANY file as UTF-8, not just known text
// extensions." We classify by extension AND by content sniff, so an unlabelled text file is still
// treated as text. The KIND is a routing hint for the MAP layer — it is advisory, never a gate.
const TEXT_EXT = new Set([
  "txt","md","markdown","rst","log","csv","tsv","json","jsonl","ndjson","xml","html","htm","svg",
  "js","mjs","cjs","ts","tsx","jsx","css","scss","yaml","yml","toml","ini","cfg","conf","env",
  "py","rs","go","java","c","h","cpp","rb","php","sh","bat","ps1","sql","srt","vtt","tex","bib",
]);
const STRUCTURED_EXT = new Set(["csv","tsv","json","jsonl","ndjson","xml","yaml","yml","toml","ini","sql"]);

const extOf = (name) => { const m = /\.([A-Za-z0-9]+)$/.exec(String(name || "")); return m ? m[1].toLowerCase() : ""; };

// looksTextual — content sniff over the first 8 KiB: reject if it holds a NUL byte (the classic binary
// tell) or if too many bytes fall outside printable/UTF-8-continuation ranges. Conservative on purpose:
// a false "binary" only costs a missing text view (still sealed raw), never a wrong decode.
function looksTextual(bytes) {
  const n = Math.min(bytes.length, 8192);
  if (n === 0) return true; // empty file is trivially "text" (yields an empty view, still ≥1 κ)
  let suspicious = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 0) return false;                                   // NUL → binary
    if (b < 0x09 || (b > 0x0d && b < 0x20)) suspicious++;        // control chars (allow \t\n\v\f\r)
  }
  return suspicious / n < 0.10;
}

// classify(name, bytes) → { kind, supported } where kind ∈ {structured,text,document,binary}.
// supported=true means we can produce a decoded text view this layer understands; false means
// "sealed raw, honest about it" (e.g. an image, a model weight, an unknown container).
export function classify(name, bytes) {
  const ext = extOf(name);
  if (STRUCTURED_EXT.has(ext)) return { kind: "structured", supported: true };
  if (TEXT_EXT.has(ext))       return { kind: "text",       supported: true };
  // No known extension → sniff. Textual bytes still become a text view (ANIMA's UTF-8 fallback).
  if (looksTextual(bytes))     return { kind: ext ? "document" : "text", supported: true };
  return { kind: "binary", supported: false };
}

// ── seal ────────────────────────────────────────────────────────────────────────────────────────
// sealIngest({ name, bytes, mime }, { hash, now }) → an IngestSource manifest (a κ-DAG node).
//   - source κ      : the raw bytes, content-addressed (the evidence anchor, byte-exact, never transcoded)
//   - view          : for text-like sources, the canonical UTF-8 text, sealed as ITS OWN κ (what S1 reads)
//   - closure κ     : a non-circular root over the child κs — the one address that pins this whole ingest
// `hash` defaults to the canonical sha256hex but is injectable so a witness can prove determinism, and a
// browser/SW caller can pass the same primitive. `now` is injected so the id is content-derived, not clock-
// derived (witness: same bytes under two clocks → same source κ).
export function sealIngest({ name = "untitled", bytes, mime = null } = {}, { hash = sha256hex, now = () => 0 } = {}) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || 0);
  const kOf = (b) => didHolo(SHA, hash(b));

  const { kind, supported } = classify(name, bytes);
  const sourceKappa = kOf(bytes);

  let view;
  if (supported) {
    const text = dec.decode(bytes);
    const textBytes = enc.encode(text);                          // canonical UTF-8 bytes of the decoded view
    view = { mode: "text", supported: true, kappa: kOf(textBytes), chars: text.length, bytes: textBytes.length };
  } else {
    // honest non-drop: no decode we trust, but the raw bytes ARE sealed and addressable.
    view = { mode: "raw", supported: false, kappa: sourceKappa, bytes: bytes.length };
  }

  const manifest = {
    "@context": { holo: "https://hologram.os/ns#", schema: "http://schema.org/" },
    "@type": "holo:IngestSource",
    "schema:name": name,
    mime: mime || null,
    kind,
    bytes: bytes.length,
    source: sourceKappa,                                         // raw bytes κ — the immutable evidence anchor
    view,                                                        // decoded text view κ (or raw marker)
    "prov:generatedAtTime": now(),
  };
  // closure κ: hash over the canonical form of the child κs ONLY (non-circular — never includes itself).
  manifest["holo:ingestClosure"] = didHolo(SHA, hash(enc.encode(jcs({ source: manifest.source, view: manifest.view.kappa }))));
  return manifest;
}

// ── thin acquisition adapters (the off-substrate edge; everything below is Node-only) ─────────────
// ingestFile(path) — read a local file and seal it. ingestUrl(url) — fetch a URL body and seal it.
// Both converge on sealIngest the instant bytes are in hand: the substrate doesn't know or care where
// the bytes came from. A folder/stream adapter is the same shape (iterate → sealIngest each).
export async function ingestFile(path, opts = {}) {
  const { readFile } = await import("node:fs/promises");
  const { basename } = await import("node:path");
  const buf = await readFile(path);
  return sealIngest({ name: basename(path), bytes: new Uint8Array(buf) }, opts);
}

export async function ingestUrl(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!fetchImpl) throw new Error("no fetch available — pass opts.fetchImpl");
  const r = await fetchImpl(url);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const name = (() => { try { return new URL(url).pathname.split("/").pop() || url; } catch { return url; } })();
  return sealIngest({ name, bytes, mime: r.headers && r.headers.get ? r.headers.get("content-type") : null }, opts);
}

// ── S7 · THE ROUTER — one Port, every media/file/stream family ────────────────────────────────────
// classify() decides text-vs-binary; familyOf() is the coarser routing axis the router dispatches on. The
// router NEVER drops: an unhandled family is sealed raw (≥1 κ, honest {supported:false}) and the note records
// what a production adapter WOULD do — so coverage() can log exactly what is real vs sealed-raw (ADR: no silent caps).
const FAMILY_EXT = {
  structured: STRUCTURED_EXT,
  image: new Set(["png","jpg","jpeg","gif","webp","bmp","tif","tiff","avif","heic","ico"]),
  audio: new Set(["mp3","wav","flac","aac","ogg","oga","opus","m4a","weba"]),
  video: new Set(["mp4","webm","mkv","mov","avi","m4v","ts","m3u8","mpd"]),
  model: new Set(["gguf","onnx","safetensors","holo","pt","pth","bin","ckpt"]),
  richdoc: new Set(["pdf","docx","pptx","xlsx","odt","rtf","epub"]),
  archive: new Set(["zip","tar","gz","tgz","7z","rar","bz2","xz"]),
};
export function familyOf(name, mime = "", bytes = new Uint8Array(0)) {
  const ext = extOf(name);
  for (const [fam, set] of Object.entries(FAMILY_EXT)) if (set.has(ext)) return fam;
  const m = String(mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("model/") || /octet-stream/.test(m)) return "binary";
  if (TEXT_EXT.has(ext) || (m.startsWith("text/") || /json|xml|yaml|csv/.test(m))) return TEXT_EXT.has(ext) && STRUCTURED_EXT.has(ext) ? "structured" : "text";
  return looksTextual(bytes) ? "text" : "binary";
}

// the production adapters and what each WOULD produce (referenced by note; injected live in the browser):
//   video   → holo-tube-ingest.mjs  (MediaGraph: init + per-segment κs, bit-exact)
//   audio   → holo-kappa-audio.mjs  (lossless κ-album) + holo-moonshine-asr.mjs createMoonshineASR().transcribe → transcript text view
//   image   → a vision model (caption/OCR → text view); richdoc → pdf/docx text extractor → text view
//   model   → the Forge (GGUF/ONNX → .holo κ)
const FAMILY_NOTE = {
  text: "decoded UTF-8 text view (native)", structured: "decoded text view (native; tabular parse downstream)",
  image: "production: vision caption/OCR → text view (Forge); sealed raw until wired",
  audio: "production: κ-audio (lossless) + Moonshine transcript → text view; sealed raw until wired",
  video: "production: Holo Tube MediaGraph (per-segment κ); sealed raw until wired",
  model: "production: Forge GGUF/ONNX → .holo κ; sealed raw until wired",
  richdoc: "production: pdf/docx text extractor → text view; sealed raw until wired",
  archive: "production: expand → re-route each member; sealed raw until wired", binary: "no text view derivable; sealed raw (addressable)",
};

// makeRouter({ adapters, hash, now }) → { route, coverage }. An adapter is:
//   async (source {name,bytes,mime}) → { kappas:[κ...], textView?:{kappa,text,chars}, kind?, bounded?:string }
// kappas = every κ-object the adapter sealed (≥1); textView = decoded text for MAP (or omitted); bounded = an
// honest note if the adapter capped/sampled (e.g. "first 90s of video") so coverage() can surface it.
export function makeRouter({ adapters = {}, hash = sha256hex, now = () => 0 } = {}) {
  const families = Object.keys(FAMILY_NOTE);
  async function route(source) {
    const bytes = source.bytes instanceof Uint8Array ? source.bytes : new Uint8Array(source.bytes || 0);
    const family = familyOf(source.name, source.mime, bytes);
    const adapter = adapters[family];
    if (adapter) {
      const r = await adapter({ ...source, bytes });
      const kappas = Array.isArray(r.kappas) ? r.kappas : [];
      return { family, viaAdapter: true, dropped: false, kappas,
               textView: r.textView || null, bounded: r.bounded || null,
               note: r.bounded ? `adapter (bounded: ${r.bounded})` : "adapter", kind: r.kind || family };
    }
    // FALLBACK — no adapter: seal via the native Port. Text-like → text view; else raw (never dropped).
    const manifest = sealIngest({ name: source.name, bytes, mime: source.mime }, { hash, now });
    const kappas = [manifest.source]; if (manifest.view.kappa !== manifest.source) kappas.push(manifest.view.kappa);
    return { family, viaAdapter: false, dropped: false, kappas,
             textView: manifest.view.supported ? { kappa: manifest.view.kappa, text: dec.decode(bytes), chars: manifest.view.chars } : null,
             bounded: null, note: FAMILY_NOTE[family] || FAMILY_NOTE.binary, kind: manifest.kind, manifest };
  }
  // coverage() — the honest map: which families have a REAL adapter wired vs are sealed-raw with no text view.
  function coverage() {
    return families.map((f) => ({ family: f, adapter: !!adapters[f],
      textViewNative: f === "text" || f === "structured", note: FAMILY_NOTE[f] }));
  }
  return { route, coverage, families };
}

export default { classify, familyOf, sealIngest, ingestFile, ingestUrl, makeRouter };

// ── CLI (acquisition is the user's call; sealing is the substrate's) ──────────────────────────────
if (import.meta.url === (globalThis.process && process.argv[1] ? new URL(`file://${process.argv[1].split("\\").join("/")}`).href : "")) {
  const arg = process.argv[2];
  if (!arg) { console.error("usage: node sbin/holo-ingest.mjs <file|url>"); process.exit(2); }
  const m = /^https?:\/\//.test(arg) ? await ingestUrl(arg) : await ingestFile(arg);
  console.log(JSON.stringify(m, null, 2));
}
