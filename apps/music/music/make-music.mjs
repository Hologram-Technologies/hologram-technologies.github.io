#!/usr/bin/env node
// make-music.mjs — generate Holo Music's bundled, content-addressed music library.
//
// These are ORIGINAL, royalty-free tracks synthesized DETERMINISTICALLY (a seeded
// PRNG over a fixed scale — no randomness, no external sample) so every byte re-derives
// to a fixed κ on any box (Law L5). Each track is PCM 16-bit WAV (RIFF/WAVE) that every
// browser decodes via HTMLMediaElement, and — faithful to how a real music server reads
// a library — it carries its metadata IN the file as a standard RIFF **LIST/INFO** chunk
// (INAM·IART·IPRD·IGNR·ICRD·IPRT), so scan-music.mjs is a genuine tag scanner, not a
// sidecar reader. Each album also gets a deterministic cover.svg (procedural from its
// name). The on-disk layout is exactly what you'd point Navidrome at:
//
//   music/<Artist>/<Album>/NN - Title.wav        (audio + embedded tags)
//   music/<Artist>/<Album>/cover.svg             (album art)
//
// Run:  node music/make-music.mjs   → writes the library tree + PROVENANCE.txt.
// Then: node scan-music.mjs         → content-addresses it into a Subsonic catalog.

import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SR = 44100;

// ── deterministic PRNG (mulberry32) seeded by a string hash — no Math.random ──────
const seedOf = (s) => { const h = createHash("sha256").update(s).digest(); return h.readUInt32LE(0) ^ h.readUInt32LE(4); };
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ── note table (equal temperament, A4 = 440) ─────────────────────────────────────
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const freq = (semi) => 440 * Math.pow(2, (semi - 57) / 12);              // semi = oct*12 + pitchClass
const semiOf = (name, oct) => oct * 12 + NAMES.indexOf(name);

// ── voices ────────────────────────────────────────────────────────────────────────
const square = (ph) => (ph % 1 < 0.5 ? 1 : -1);
const triangle = (ph) => 2 * Math.abs(2 * (ph % 1) - 1) - 1;
const saw = (ph) => 2 * (ph % 1) - 1;
const sine = (ph) => Math.sin(2 * Math.PI * ph);
const VOICES = { square, triangle, saw, sine };

// One monophonic line of [semitone|null, beats] events → Float32, with a short ADSR.
function line(seq, { bpm = 120, voice = triangle, gain = 0.22 } = {}) {
  const spb = 60 / bpm;
  const total = seq.reduce((n, [, beats]) => n + Math.round(beats * spb * SR), 0);
  const out = new Float32Array(total);
  let p = 0;
  for (const [semi, beats] of seq) {
    const n = Math.round(beats * spb * SR);
    const f = semi == null ? 0 : freq(semi);
    const a = Math.min(n, (SR * 0.006) | 0), r = Math.min(n, (SR * 0.05) | 0);
    for (let i = 0; i < n; i++) {
      let env = 1;
      if (i < a) env = i / a; else if (i > n - r) env = (n - i) / r;
      out[p + i] = f ? voice((f * (p + i)) / SR) * gain * env : 0;
    }
    p += n;
  }
  return out;
}

// A simple seeded noise-percussion track (kick on the beat, hat on the off) for groove.
function drums(bars, { bpm = 120, beatsPerBar = 4, seed = 1, gain = 0.5 } = {}) {
  const rnd = rng(seed);
  const spb = 60 / bpm, beat = Math.round(spb * SR), total = bars * beatsPerBar * beat;
  const out = new Float32Array(total);
  const hit = (at, len, lo, g) => { for (let i = 0; i < len && at + i < total; i++) { const env = Math.pow(1 - i / len, lo); out[at + i] += (rnd() * 2 - 1) * g * env; } };
  for (let b = 0; b < bars * beatsPerBar; b++) {
    const at = b * beat;
    hit(at, (SR * 0.09) | 0, 6, gain * 0.9);                              // kick-ish (fast decay noise)
    hit(at + (beat >> 1), (SR * 0.03) | 0, 3, gain * 0.35);               // hat
  }
  return out;
}

// Mix several lines (truncating to the shortest) → one master Float32, hard-clipped.
function mix(...lines) {
  const n = Math.min(...lines.map((l) => l.length));
  const out = new Float32Array(n);
  for (const l of lines) for (let i = 0; i < n; i++) out[i] += l[i];
  for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
  return out;
}

// ── scales (semitone offsets from the root) ───────────────────────────────────────
const SCALES = {
  minorPent: [0, 3, 5, 7, 10],
  majorPent: [0, 2, 4, 7, 9],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

// Procedurally compose ONE track from a seed: bass + arp + a random-walk lead + drums.
// Constrained to a scale → always musical; seeded → identical bytes every run (Law L5).
function compose(seed, { root, scale, bpm, bars, voice, drumsOn }) {
  const rnd = rng(seed);
  const deg = SCALES[scale];
  const beatsPerBar = 4;
  // Bass: root / fifth / fourth walk, one note per beat.
  const bassSeq = [];
  for (let b = 0; b < bars * beatsPerBar; b++) {
    const pick = [0, 0, 4, 3][b % 4];                                     // I I V IV feel
    bassSeq.push([semiOf(NAMES[((root % 12) + 12) % 12], 2) + (deg[pick] || 0), 1]);
  }
  // Arp: eighth-notes cycling through a scale-chord shape.
  const arpShape = [deg[0], deg[2 % deg.length], deg[4 % deg.length], deg[2 % deg.length]];
  const arpSeq = [];
  for (let i = 0; i < bars * beatsPerBar * 2; i++) arpSeq.push([semiOf(NAMES[((root % 12) + 12) % 12], 4) + arpShape[i % arpShape.length], 0.5]);
  // Lead: a seeded random walk over the scale (eighths), with occasional rests.
  const leadSeq = [];
  let idx = 0;
  for (let i = 0; i < bars * beatsPerBar * 2; i++) {
    if (rnd() < 0.12) { leadSeq.push([null, 0.5]); continue; }
    idx = Math.max(0, Math.min(deg.length * 2 - 1, idx + (rnd() < 0.5 ? -1 : 1) + (rnd() < 0.2 ? (rnd() < 0.5 ? -2 : 2) : 0)));
    const octShift = idx >= deg.length ? 12 : 0;
    leadSeq.push([semiOf(NAMES[((root % 12) + 12) % 12], 5) + deg[idx % deg.length] + octShift, 0.5]);
  }
  const lines = [
    line(bassSeq, { bpm, voice: square, gain: 0.24 }),
    line(arpSeq, { bpm, voice: triangle, gain: 0.15 }),
    line(leadSeq, { bpm, voice: VOICES[voice] || saw, gain: 0.2 }),
  ];
  if (drumsOn) lines.push(drums(bars, { bpm, beatsPerBar, seed: seed ^ 0x9e3779b9, gain: 0.22 }));
  return mix(...lines);
}

// ── WAV (RIFF/WAVE) with an embedded LIST/INFO metadata chunk (real tag scanning) ──
function infoChunk(tags) {
  const subs = [];
  for (const [id, valRaw] of tags) {
    if (valRaw == null || valRaw === "") continue;
    const val = String(valRaw);
    const data = Buffer.from(val + "\0", "latin1");
    const padded = data.length % 2 ? Buffer.concat([data, Buffer.from([0])]) : data;
    const head = Buffer.alloc(8); head.write(id, 0, "latin1"); head.writeUInt32LE(data.length, 4);
    subs.push(head, padded);
  }
  const body = Buffer.concat([Buffer.from("INFO", "latin1"), ...subs]);
  const head = Buffer.alloc(8); head.write("LIST", 0, "latin1"); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}
function wav(samples, tags) {
  const n = samples.length, info = infoChunk(tags);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(1, 10); // PCM, mono
  fmt.writeUInt32LE(SR, 12); fmt.writeUInt32LE(SR * 2, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22);
  const dataHead = Buffer.alloc(8); dataHead.write("data", 0); dataHead.writeUInt32LE(data.length, 4);
  const payload = Buffer.concat([Buffer.from("WAVE", "latin1"), fmt, info, dataHead, data]);
  const riff = Buffer.alloc(8); riff.write("RIFF", 0); riff.writeUInt32LE(payload.length, 4);
  return Buffer.concat([riff, payload]);
}

// ── deterministic album cover (procedural SVG from the album name) ────────────────
function cover(album, artist, genre) {
  const h = createHash("sha256").update(album + "\0" + artist).digest();
  const hue = h[0] * 360 / 256, hue2 = (hue + 40 + h[1] / 4) % 360;
  const bg1 = `hsl(${hue.toFixed(0)} 64% 22%)`, bg2 = `hsl(${hue2.toFixed(0)} 70% 12%)`, fg = `hsl(${hue.toFixed(0)} 80% 72%)`;
  const rings = [];
  for (let i = 0; i < 5; i++) { const r = 90 + i * 52 + (h[i + 2] % 24); const o = (0.05 + (h[i + 7] % 20) / 100).toFixed(2); rings.push(`<circle cx="${120 + (h[i + 3] % 360)}" cy="${120 + (h[i + 4] % 360)}" r="${r}" fill="none" stroke="${fg}" stroke-width="2" opacity="${o}"/>`); }
  const bars = [];
  for (let i = 0; i < 16; i++) { const bh = 30 + (h[(i * 3) % 32] % 220); bars.push(`<rect x="${36 + i * 33}" y="${430 - bh}" width="18" height="${bh}" rx="3" fill="${fg}" opacity="${(0.18 + (h[i % 32] % 30) / 100).toFixed(2)}"/>`); }
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600" role="img" aria-label="${esc(album)} by ${esc(artist)}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs>
  <rect width="600" height="600" fill="url(#g)"/>
  ${rings.join("\n  ")}
  ${bars.join("\n  ")}
  <text x="40" y="500" font-family="system-ui, sans-serif" font-size="40" font-weight="800" fill="#fff">${esc(album)}</text>
  <text x="40" y="540" font-family="ui-monospace, monospace" font-size="22" fill="${fg}">${esc(artist)}</text>
  <text x="40" y="572" font-family="ui-monospace, monospace" font-size="16" fill="#ffffffaa">${esc(genre)} · Hologram OS</text>
</svg>
`;
}

// ── the library: original artists / albums / tracks (royalty-free, deterministic) ─
const YEAR = 2025;
const ALBUMS = [
  { artist: "Hologram Collective", album: "Kappa Sessions", genre: "Chiptune", year: YEAR,
    root: 9 /*A*/, scale: "minorPent", bpm: 132, voice: "square", drums: true,
    tracks: ["Boot Chime", "Kappa Groove", "Content Address", "Merkle Dance"] },
  { artist: "The Content Address", album: "Law L5", genre: "Synthwave", year: YEAR,
    root: 2 /*D*/, scale: "dorian", bpm: 110, voice: "saw", drums: true,
    tracks: ["Re-derive", "Sealed Bytes", "Verified at Rest", "Forge Refused"] },
  { artist: "Merkle Forest", album: "Verifiable Dawn", genre: "Ambient", year: YEAR,
    root: 0 /*C*/, scale: "major", bpm: 84, voice: "sine", drums: false,
    tracks: ["Quiet Root", "Branch & Leaf", "Proof of Light"] },
];

const safe = (s) => s.replace(/[\\/:*?"<>|]/g, "").trim();
rmSync(join(here, "art"), { recursive: true, force: true });             // art is re-derived by the scanner
let nTracks = 0, totalBytes = 0;
const provLines = [];
for (const A of ALBUMS) {
  const dir = join(here, safe(A.artist), safe(A.album));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "cover.svg"), cover(A.album, A.artist, A.genre));
  A.tracks.forEach((title, i) => {
    const seed = seedOf(`${A.artist}|${A.album}|${title}|v1`);
    const targetSec = 10 + (seed % 4);                                    // 10..13s — lean, deterministic
    const bars = Math.max(4, Math.round(targetSec / (4 * 60 / A.bpm)));   // bars that hit the target at this tempo
    const samples = compose(seed, { root: A.root, scale: A.scale, bpm: A.bpm, bars, voice: A.voice, drumsOn: A.drums });
    const buf = wav(samples, [
      ["INAM", title], ["IART", A.artist], ["IPRD", A.album], ["IGNR", A.genre],
      ["ICRD", String(A.year)], ["IPRT", `${i + 1}/${A.tracks.length}`], ["ISFT", "Hologram make-music"],
    ]);
    const file = `${String(i + 1).padStart(2, "0")} - ${safe(title)}.wav`;
    writeFileSync(join(dir, file), buf);
    nTracks++; totalBytes += buf.length;
    console.log(`  ${A.artist} — ${A.album} — ${file}  ${(buf.length / 1024).toFixed(0)} KB  ${(samples.length / SR).toFixed(1)}s`);
  });
  provLines.push(`${A.artist} — "${A.album}" (${A.genre}, ${A.year}) · ${A.tracks.length} tracks`);
}

writeFileSync(join(here, "PROVENANCE.txt"), [
  "Holo Music — bundled library provenance",
  "",
  "ORIGINAL, royalty-free works. Every track is synthesized DETERMINISTICALLY by",
  "make-music.mjs (a seeded PRNG over a fixed musical scale — no randomness, no",
  "external sample), so it re-derives byte-for-byte to a fixed κ on any machine",
  "(Law L5). PCM 16-bit mono WAV (RIFF/WAVE); metadata is embedded as a standard",
  "RIFF LIST/INFO chunk (INAM·IART·IPRD·IGNR·ICRD·IPRT) and read back by the",
  "library scanner (scan-music.mjs), exactly as a real music server reads tags.",
  "License: Creative Commons CC0 1.0 (public domain dedication).",
  "",
  ...provLines,
  "",
].join("\n"));

console.log(`\n✓ generated ${nTracks} tracks across ${ALBUMS.length} albums (${(totalBytes / 1048576).toFixed(1)} MB)`);
console.log("  next: node scan-music.mjs  → content-addressed Subsonic catalog");
