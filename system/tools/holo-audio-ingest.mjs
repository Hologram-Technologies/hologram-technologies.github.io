// holo-audio-ingest.mjs — turn a LOSSLESS audio file into a κ-addressed chunk-DAG + manifest.
//
// Lossless PASSTHROUGH: we never transcode. We slice the source bytes into fixed-size chunks, content-
// address each (sha256 → κ), and emit a manifest the κ-audio loader verifies BEFORE decode (Law L5). The
// reassembled bytes are byte-identical to the input — that's what "lossless · verified" means here.
//
//   node holo-audio-ingest.mjs <input.wav|.flac> <outDir> [--chunk=262144] [--title=..] [--artist=..] [--album=..]
//
// Emits: <outDir>/chunk-0000.bin … and <outDir>/manifest.json.  Also usable as a library: ingest(bytes, opts).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";
import { measure, normalizeGainDb } from "../os/usr/lib/holo/holo-loudness.mjs";

const sha = (u8) => createHash("sha256").update(u8).digest("hex");
const SHA = "did:holo:sha256:";
const MIME = { ".wav": "audio/wav", ".flac": "audio/flac", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".opus": "audio/ogg", ".mp3": "audio/mpeg" };

// Best-effort canonical WAV header parse → { sampleRate, channels, bits, durationSec, audioFormat, dataOffset, dataLen }.
function parseWav(buf) {
  try {
    if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return {};
    let off = 12, fmt = null, dataLen = 0, dataOffset = 0;
    while (off + 8 <= buf.length) {
      const id = buf.toString("ascii", off, off + 4), sz = buf.readUInt32LE(off + 4); const body = off + 8;
      if (id === "fmt ") fmt = { audioFormat: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), byteRate: buf.readUInt32LE(body + 8), bits: buf.readUInt16LE(body + 14) };
      else if (id === "data") { dataLen = sz; dataOffset = body; }
      off = body + sz + (sz & 1);
    }
    if (!fmt) return {};
    return { sampleRate: fmt.sampleRate, channels: fmt.channels, bits: fmt.bits, audioFormat: fmt.audioFormat, dataOffset, dataLen, durationSec: fmt.byteRate ? +(dataLen / fmt.byteRate).toFixed(3) : 0 };
  } catch (e) { return {}; }
}
export { parseWav, wavToChannels };
// PCM → per-channel Float32 in [-1,1]. Supports 16/24/32-bit int + 32-bit float. Returns null on unsupported.
function wavToChannels(buf, info) {
  try {
    const { channels, bits, audioFormat, dataOffset, dataLen } = info; if (!channels || !bits || !dataOffset) return null;
    const bytes = bits / 8, frames = Math.floor(dataLen / (bytes * channels)), out = [];
    for (let c = 0; c < channels; c++) out.push(new Float32Array(frames));
    for (let f = 0; f < frames; f++) for (let c = 0; c < channels; c++) {
      const p = dataOffset + (f * channels + c) * bytes; let v;
      if (audioFormat === 3 && bits === 32) v = buf.readFloatLE(p);
      else if (bits === 16) v = buf.readInt16LE(p) / 32768;
      else if (bits === 24) { let x = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16); if (x & 0x800000) x |= ~0xffffff; v = x / 8388608; }
      else if (bits === 32) v = buf.readInt32LE(p) / 2147483648;
      else return null;
      out[c][f] = v;
    }
    return out;
  } catch (e) { return null; }
}

// Pure: bytes → { manifest, chunks:[{name, bytes}] }. The witness uses this in-memory (no disk).
export function ingest(bytes, opts = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const chunkBytes = Math.max(1, opts.chunkBytes || 262144);     // 256 KiB chunks
  const ext = (opts.ext || ".wav").toLowerCase();
  const buf = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
  const wav = ext === ".wav" ? parseWav(buf) : {};
  // real EBU R128 loudness + true-peak, measured once at ingest and carried in the manifest (deterministic).
  let loudness = null, normalizeDb = 0;
  if (ext === ".wav" && wav.sampleRate) {
    const chans = wavToChannels(buf, wav);
    if (chans) { const m = measure(chans, wav.sampleRate); loudness = { lufs: m.lufs, samplePeakDbfs: m.samplePeakDbfs, truePeakDbtp: m.truePeakDbtp }; normalizeDb = normalizeGainDb(loudness, opts.targetLufs || -16, opts.ceilingDbtp || -1); }
  }
  const chunks = [], files = [];
  for (let i = 0, n = 0; i < u8.length; i += chunkBytes, n++) {
    const slice = u8.subarray(i, Math.min(i + chunkBytes, u8.length));
    const name = "chunk-" + String(n).padStart(4, "0") + ".bin";
    chunks.push({ file: name, kappa: SHA + sha(slice), bytes: slice.length });
    files.push({ name, bytes: slice });
  }
  const manifest = {
    v: 1, kind: "holo-kappa-audio",
    title: opts.title || "", artist: opts.artist || "", album: opts.album || "",
    mime: opts.mime || MIME[ext] || "application/octet-stream",
    sampleRate: wav.sampleRate, channels: wav.channels, bits: wav.bits, durationSec: wav.durationSec,
    bytes: u8.length, trackKappa: SHA + sha(u8), chunkBytes,
    ...(loudness ? { loudness, normalizeDb, targetLufs: opts.targetLufs || -16 } : {}),
    chunks,
  };
  return { manifest, chunks: files };
}

function arg(name, dflt) { const p = process.argv.find((a) => a.startsWith("--" + name + "=")); return p ? p.slice(name.length + 3) : dflt; }

function main() {
  const input = process.argv[2], outDir = process.argv[3];
  if (!input || !outDir) { console.error("usage: node holo-audio-ingest.mjs <input> <outDir> [--chunk=N] [--title=..] [--artist=..] [--album=..]"); process.exit(2); }
  const bytes = new Uint8Array(readFileSync(input));
  const { manifest, chunks } = ingest(bytes, {
    ext: extname(input), chunkBytes: +arg("chunk", 262144) || 262144,
    title: arg("title", basename(input, extname(input))), artist: arg("artist", ""), album: arg("album", ""),
  });
  mkdirSync(outDir, { recursive: true });
  for (const c of chunks) writeFileSync(join(outDir, c.name), Buffer.from(c.bytes));
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  process.stderr.write("κ-audio: " + manifest.chunks.length + " chunks · " + manifest.bytes + " bytes · track " + manifest.trackKappa.slice(0, 24) + "… → " + outDir + "\n");
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
