// holo-loudness.witness.mjs — proves the EBU R128 loudness measurement + normalization are real & sane.
//
// On the real lossless album it asserts, per track:
//   1. integrated LUFS is finite and in a plausible music range (−40…0 LUFS).
//   2. true peak ≥ sample peak (oversampling never under-reports) and both ≤ +3 dBTP.
//   3. RESPONDS correctly: scaling the PCM by −6.02 dB drops measured LUFS by ~6.02 (±0.3) — a real meter,
//      not a constant.
//   4. normalizeGainDb hits the target: predicted loudness ≤ target AND predicted true peak ≤ ceiling
//      (loudness-up is clamped so it can never clip).
// And across the album: reports the loudness spread that normalization removes.
//
//   node holo-loudness.witness.mjs
// exit 0 = all green · 1 = a failure · 2 = setup error. Never prints a false green.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseWav, wavToChannels } from "./holo-audio-ingest.mjs";
import { measure, normalizeGainDb } from "../os/usr/lib/holo/holo-loudness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ALBUM = join(here, "..", "..", "..", "holo-apps", "apps", "music", "music", "Hologram Collective", "Kappa Sessions");
const TRACKS = ["01 - Boot Chime.wav", "02 - Kappa Groove.wav", "03 - Content Address.wav", "04 - Merkle Dance.wav"];
const TARGET = -16, CEILING = -1;

function channelsOf(path) { const buf = readFileSync(path); const info = parseWav(buf); return { ch: wavToChannels(buf, info), sr: info.sampleRate }; }
const scale = (chans, g) => chans.map((c) => { const o = new Float32Array(c.length); for (let i = 0; i < c.length; i++) o[i] = c[i] * g; return o; });

function main() {
  if (!existsSync(join(ALBUM, TRACKS[0]))) { console.error("witness: no album at " + ALBUM); process.exit(2); }
  let pass = 0, fail = 0; const log = (ok, msg) => { console.log((ok ? "  ✓ " : "  ✗ ") + msg); ok ? pass++ : fail++; };
  console.log("holo-loudness witness — EBU R128 / BS.1770, target " + TARGET + " LUFS, ceiling " + CEILING + " dBTP");
  const lufsAll = [];
  for (const name of TRACKS) {
    const { ch, sr } = channelsOf(join(ALBUM, name)); if (!ch) { log(false, name + " — could not decode PCM"); continue; }
    const m = measure(ch, sr); lufsAll.push(m.lufs);
    const inRange = isFinite(m.lufs) && m.lufs > -40 && m.lufs <= 0;
    const peakOk = m.truePeakDbtp >= m.samplePeakDbfs - 0.01 && m.truePeakDbtp <= 3;
    // responds to a known −6.02 dB attenuation
    const m2 = measure(scale(ch, 0.5), sr); const drop = m.lufs - m2.lufs; const responds = Math.abs(drop - 6.02) < 0.3;
    // normalization respects both target and ceiling
    const g = normalizeGainDb({ lufs: m.lufs, truePeakDbtp: m.truePeakDbtp }, TARGET, CEILING);
    const normOk = (m.lufs + g) <= TARGET + 0.01 && (m.truePeakDbtp + g) <= CEILING + 0.01;
    log(inRange && peakOk && responds && normOk,
      name.replace(/\.wav$/, "") + " — " + m.lufs + " LUFS · TP " + m.truePeakDbtp + " dBTP · −6dB→Δ" + drop.toFixed(2) + " · norm " + (g >= 0 ? "+" : "") + g + "dB → " + (m.lufs + g).toFixed(1) + " LUFS");
  }
  const spread = lufsAll.length ? +(Math.max(...lufsAll) - Math.min(...lufsAll)).toFixed(2) : 0;
  console.log("  · album loudness spread before normalization: " + spread + " LU (normalization aligns every track to " + TARGET + " LUFS)");
  console.log((fail ? "FAIL" : "PASS") + " — " + pass + "/" + (pass + fail) + " checks");
  process.exit(fail ? 1 : 0);
}

main();
