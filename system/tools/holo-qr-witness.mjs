#!/usr/bin/env node
// holo-qr-witness.mjs — prove the self-contained QR encoder (usr/lib/holo/holo-qr-encode.mjs) is correct
// two independent ways, neither of which trusts the encoder's own math:
//
//   1 · MODULE-EXACT vs the authoritative `qrcode` package. For every version 1..40 and every ECC level,
//       with the mask FORCED to the same value on both sides, the entire module matrix must match bit for
//       bit. This proves data segmentation, Reed–Solomon, block interleaving, placement, masking, and the
//       format/version info — the whole pipeline — against a reference implementation.
//   2 · SCANNABLE via an independent reader (jsQR): a representative spread is rendered to pixels and read
//       back byte-exact, proving the codes are not just structurally right but actually decodable.
//
// Both oracles are dev-only (under .holo-qr-witness/, never shipped). Exit 0 only if every case passes.
//
//   node tools/holo-qr-witness.mjs

import { encode, _debugCodewords } from "../os/usr/lib/holo/holo-qr-encode.mjs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../../.holo-qr-witness/x.js"));
let QR, jsQR;
try { QR = require("qrcode"); jsQR = require("jsqr").default || require("jsqr"); }
catch { console.error("oracles missing — run: cd .holo-qr-witness && npm i qrcode jsqr"); process.exit(2); }

const CODEWORDS = [26,44,70,100,134,172,196,242,292,346,404,466,532,581,655,733,815,901,991,1085,1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,2323,2465,2611,2761,2876,3034,3196,3362,3532,3706];
const EC_CW = [7,10,13,17,10,16,22,28,15,26,36,44,20,36,52,64,26,48,72,88,36,64,96,112,40,72,108,130,48,88,132,156,60,110,160,192,72,130,192,224,80,150,224,264,96,176,260,308,104,198,288,352,120,216,320,384,132,240,360,432,144,280,408,480,168,308,448,532,180,338,504,588,196,364,546,650,224,416,600,700,224,442,644,750,252,476,690,816,270,504,750,900,300,560,810,960,312,588,870,1050,336,644,952,1110,360,700,1020,1200,390,728,1050,1260,420,784,1140,1350,450,812,1200,1440,480,868,1290,1530,510,924,1350,1620,540,980,1440,1710,570,1036,1530,1800,570,1064,1590,1890,600,1120,1680,1980,630,1204,1770,2100,660,1260,1860,2220,720,1316,1950,2310,750,1372,2040,2430];
const LVL = ["L", "M", "Q", "H"];

// the maximum byte-mode payload that fits exactly in (version, level)
function maxBytes(v, li) { const dataCw = CODEWORDS[v - 1] - EC_CW[(v - 1) * 4 + li]; const countBits = v <= 9 ? 8 : 16; return Math.floor((dataCw * 8 - 4 - countBits) / 8); }
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_/:.#";
const rnd = (n) => { let s = ""; for (let i = 0; i < n; i++) s += ALPHA[(i * 1103515245 + 12345) % ALPHA.length]; return s; };

// 1 · module-exact vs qrcode, mask forced to the same value
let pass = 0, fail = 0; const fails = [];
for (let v = 1; v <= 40; v++) for (let li = 0; li < 4; li++) {
  const ecc = LVL[li];
  for (const frac of [0.3, 1.0]) {
    const len = Math.max(1, Math.floor(maxBytes(v, li) * frac));
    const text = rnd(len);
    for (const mask of [0, 5]) {
      let mine; try { mine = encode(text, { ecc, version: v, _forceMask: mask }); }
      catch (e) { fail++; fails.push(`v${v}-${ecc} m${mask} ${len}B encode threw: ${e.message}`); continue; }
      const ref = QR.create(text, { errorCorrectionLevel: ecc, version: v, maskPattern: mask });
      const size = ref.modules.size; let diff = 0, at = null;
      if (size !== mine.size) { fail++; fails.push(`v${v}-${ecc} size ${mine.size}≠${size}`); continue; }
      for (let r = 0; r < size && diff === 0; r++) for (let c = 0; c < size; c++) { const a = ref.modules.data[r * size + c] ? 1 : 0, b = mine.modules[r][c] ? 1 : 0; if (a !== b) { diff++; at = `r${r}c${c} ref${a}/mine${b}`; break; } }
      if (diff) { fail++; fails.push(`v${v}-${ecc} m${mask} ${len}B mismatch @ ${at}`); } else pass++;
    }
  }
}
console.log(`module-exact vs qrcode: ${pass} passed, ${fail} failed (40 versions × 4 levels × sizes × masks)`);

// 2 · scannable via jsQR — a representative spread (lower versions decode reliably at this scale)
function toRGBA({ size, modules }, scale = 5, quiet = 4) {
  const dim = (size + quiet * 2) * scale, data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const x = (c + quiet) * scale + dx, y = (r + quiet) * scale + dy, i = (y * dim + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
  return { data, width: dim, height: dim };
}
const REAL = [
  ["https://hologram.os/shell.html#wks=" + rnd(700), "M", "wks link"],
  ["did:holo:sha256:" + "a".repeat(64), "M", "did token"],
  ["http://localhost:8300/shell.html?wks=did:holo:sha256:" + "f".repeat(64), "M", "token query"],
  ["https://trustless-gateway.link/ipfs/bafkreih" + rnd(50), "Q", "gateway url"],
  ["HELLO-1234", "H", "short"],
];
let spass = 0, sfail = 0;
for (const [text, ecc, label] of REAL) {
  const qr = encode(text, { ecc }); const img = toRGBA(qr); const got = jsQR(img.data, img.width, img.height);
  if (got && got.data === text) spass++; else { sfail++; fails.push(`scan "${label}" v${qr.version}: ${got ? "wrong bytes" : "unreadable"}`); }
}
console.log(`scannable via jsQR: ${spass}/${REAL.length} read back byte-exact`);

if (fail || sfail) { console.log(`\nFAILURES:`); for (const f of fails.slice(0, 30)) console.log("  ✗ " + f); process.exit(1); }
console.log("\n✓ encoder is module-exact with the reference across all 40 versions × 4 ECC levels, and its output scans");
