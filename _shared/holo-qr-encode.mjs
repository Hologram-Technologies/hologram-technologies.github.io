// holo-qr-encode.mjs — a self-contained QR Code (Model 2) generator. NO vendored library, NO CDN, NO
// network: pure ES math (Galois-field Reed–Solomon, byte-mode segmentation, mask selection) so the OS
// mints a QR offline and serverless, the same in the browser and in Node (the witness). This replaces the
// prior dependency on a vendored `qrcode` bundle that was never present on disk — the reason Share's QR
// rendered blank. Byte mode only (it carries arbitrary UTF-8: links, tokens, JSON), ECC L|M|Q|H, every
// version 1–40 with automatic minimal sizing and the eight masks scored by the spec penalty.
//
// The big constant tables (codeword counts, EC block structure, alignment-pattern centres) are the
// ISO/IEC 18004 values, lifted verbatim from the reference `qrcode` package so they are authoritative;
// the encoder LOGIC is independent and witnessed end to end by decoding its own output with a separate
// reader (tools/holo-qr-witness.mjs). encode(text, { ecc, version }) → { size, version, ecc, modules }.

// ── ISO/IEC 18004 tables (authoritative) ────────────────────────────────────────────────────────────
// total codewords (data + EC) per version 1..40
const CODEWORDS = [26,44,70,100,134,172,196,242,292,346,404,466,532,581,655,733,815,901,991,1085,1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,2323,2465,2611,2761,2876,3034,3196,3362,3532,3706];
// EC blocks per (version,level), level order L,M,Q,H — index (version-1)*4 + level
const EC_BLOCKS = [1,1,1,1,1,1,1,1,1,1,2,2,1,2,2,4,1,2,4,4,2,4,4,4,2,4,6,5,2,4,6,6,2,5,8,8,4,5,8,8,4,5,8,11,4,8,10,11,4,9,12,16,4,9,16,16,6,10,12,18,6,10,17,16,6,11,16,19,6,13,18,21,7,14,21,25,8,16,20,25,8,17,23,25,9,17,23,34,9,18,25,30,10,20,27,32,12,21,29,35,12,23,34,37,12,25,34,40,13,26,35,42,14,28,38,45,15,29,40,48,16,31,43,51,17,33,45,54,18,35,48,57,19,37,51,60,19,38,53,63,20,40,56,66,21,43,59,70,22,45,62,74,24,47,65,77,25,49,68,81];
// total EC codewords per (version,level), same indexing
const EC_CODEWORDS = [7,10,13,17,10,16,22,28,15,26,36,44,20,36,52,64,26,48,72,88,36,64,96,112,40,72,108,130,48,88,132,156,60,110,160,192,72,130,192,224,80,150,224,264,96,176,260,308,104,198,288,352,120,216,320,384,132,240,360,432,144,280,408,480,168,308,448,532,180,338,504,588,196,364,546,650,224,416,600,700,224,442,644,750,252,476,690,816,270,504,750,900,300,560,810,960,312,588,870,1050,336,644,952,1110,360,700,1020,1200,390,728,1050,1260,420,784,1140,1350,450,812,1200,1440,480,868,1290,1530,510,924,1350,1620,540,980,1440,1710,570,1036,1530,1800,570,1064,1590,1890,600,1120,1680,1980,630,1204,1770,2100,660,1260,1860,2220,720,1316,1950,2310,750,1372,2040,2430];
// alignment-pattern centre coordinates per version (empty for v1)
const ALIGN = [[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54],[6,32,58],[6,34,62],[6,26,46,66],[6,26,48,70],[6,26,50,74],[6,30,54,78],[6,30,56,82],[6,30,58,86],[6,34,62,90],[6,28,50,72,94],[6,26,50,74,98],[6,30,54,78,102],[6,28,54,80,106],[6,32,58,84,110],[6,30,58,86,114],[6,34,62,90,118],[6,26,50,74,98,122],[6,30,54,78,102,126],[6,26,52,78,104,130],[6,30,56,82,108,134],[6,34,60,86,112,138],[6,30,58,86,114,142],[6,34,62,90,118,146],[6,30,54,78,102,126,150],[6,24,50,76,102,128,154],[6,28,54,80,106,132,158],[6,32,58,84,110,136,162],[6,26,54,82,110,138,166],[6,30,58,86,114,142,170]];

const LEVELS = { L: 0, M: 1, Q: 2, H: 3 };
const FMT_EC = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };   // EC indicator used in the format string (≠ table order)

// ── GF(256) — primitive polynomial 0x11d, generator 2 ───────────────────────────────────────────────
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

// rsDivisor(degree) → the generator polynomial (the divisor) for `degree` EC codewords. Coefficients are
// stored highest-power first with the leading 1 left implicit (length === degree). (Nayuki formulation.)
function rsDivisor(degree) {
  const result = new Array(degree).fill(0); result[degree - 1] = 1;   // start: the monomial 1
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) { result[j] = gmul(result[j], root); if (j + 1 < result.length) result[j] ^= result[j + 1]; }
    root = gmul(root, 2);
  }
  return result;
}
// ecCodewords(data, degree) → the `degree` Reed–Solomon EC codewords for one data block.
function ecCodewords(data, degree) {
  const divisor = rsDivisor(degree), res = new Array(degree).fill(0);
  for (const b of data) {
    const factor = b ^ res.shift(); res.push(0);
    for (let i = 0; i < divisor.length; i++) res[i] ^= gmul(divisor[i], factor);
  }
  return res;
}

// ── bit buffer ──────────────────────────────────────────────────────────────────────────────────────
class Bits { constructor() { this.bytes = []; this.len = 0; } put(val, n) { for (let i = n - 1; i >= 0; i--) this.push((val >>> i) & 1); } push(b) { if (this.len % 8 === 0) this.bytes.push(0); if (b) this.bytes[this.len >> 3] |= 0x80 >> (this.len & 7); this.len++; } }

const utf8 = (s) => (typeof TextEncoder !== "undefined") ? new TextEncoder().encode(String(s)) : Uint8Array.from(Buffer.from(String(s), "utf8"));

// pick the smallest version (or honour an explicit one) that fits `dataLen` bytes at `level`.
function chooseVersion(dataLen, level, forced) {
  const fits = (v) => { const dataCw = CODEWORDS[v - 1] - EC_CODEWORDS[(v - 1) * 4 + level]; const countBits = v <= 9 ? 8 : 16; const need = 4 + countBits + 8 * dataLen; return need <= dataCw * 8; };
  if (forced) { if (forced < 1 || forced > 40 || !fits(forced)) throw new Error("data too big for the requested QR version"); return forced; }
  for (let v = 1; v <= 40; v++) if (fits(v)) return v;
  throw new Error("data too big to fit in a QR code");
}

// ── matrix ──────────────────────────────────────────────────────────────────────────────────────────
function newMatrix(size) { const m = new Array(size), r = new Array(size); for (let i = 0; i < size; i++) { m[i] = new Int8Array(size).fill(-1); r[i] = new Uint8Array(size); } return { m, r }; }
function set(grid, row, col, dark, fn) { grid.m[row][col] = dark ? 1 : 0; if (fn) grid.r[row][col] = 1; }

function placeFinder(grid, row, col) {
  for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
    const rr = row + r, cc = col + c; if (rr < 0 || rr >= grid.m.length || cc < 0 || cc >= grid.m.length) continue;
    const dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
    set(grid, rr, cc, dark, true);
  }
}
function placeAlignment(grid, cx, cy) { for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) { const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1; set(grid, cy + r, cx + c, dark, true); } }

function buildFunctionPatterns(version) {
  const size = 17 + 4 * version, grid = newMatrix(size);
  placeFinder(grid, 0, 0); placeFinder(grid, 0, size - 7); placeFinder(grid, size - 7, 0);
  // timing patterns
  for (let i = 8; i < size - 8; i++) { const dark = i % 2 === 0; if (grid.m[6][i] < 0) set(grid, 6, i, dark, true); if (grid.m[i][6] < 0) set(grid, i, 6, dark, true); }
  // alignment patterns (skip those overlapping finders)
  const coords = ALIGN[version - 1];
  for (const cy of coords) for (const cx of coords) { if ((cx <= 8 && cy <= 8) || (cx <= 8 && cy >= size - 9) || (cx >= size - 9 && cy <= 8)) continue; placeAlignment(grid, cx, cy); }
  // dark module + reserve format/version areas
  set(grid, 4 * version + 9, 8, true, true);
  reserveFormat(grid, size);
  if (version >= 7) reserveVersion(grid, size);
  return grid;
}
function reserveFormat(grid, size) {
  for (let i = 0; i <= 8; i++) { if (grid.r[8][i] === 0) grid.r[8][i] = 1; if (grid.r[i][8] === 0) grid.r[i][8] = 1; }
  for (let i = 0; i < 8; i++) { grid.r[8][size - 1 - i] = 1; grid.r[size - 1 - i][8] = 1; }
}
function reserveVersion(grid, size) { for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { grid.r[i][size - 11 + j] = 1; grid.r[size - 11 + j][i] = 1; } }

// data placement — upward/downward zigzag, two columns at a time, skipping column 6
function placeData(grid, bits) {
  const size = grid.m.length; let bit = 0; let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (grid.r[row][cc]) continue;
        let dark = false; if (bit < bits.length) { dark = bits[bit] === 1; bit++; }
        grid.m[row][cc] = dark ? 1 : 0;
      }
    }
    upward = !upward;
  }
}

const MASK = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];
function applyMask(grid, mask) { const size = grid.m.length, out = newMatrix(size); for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) { out.r[r][c] = grid.r[r][c]; let v = grid.m[r][c]; if (!grid.r[r][c] && MASK[mask](r, c)) v ^= 1; out.m[r][c] = v; } return out; }

// format/version info — 15-bit and 18-bit BCH codes per spec
function formatBits(level, mask) { const data = (FMT_EC[level] << 3) | mask; const rem = bchRemainder(data << 10, 0x537, 10); return ((data << 10) | rem) ^ 0x5412; }
function versionBits(version) { const rem = bchRemainder(version << 12, 0x1f25, 12); return (version << 12) | rem; }
function bchRemainder(value, gen, deg) { let v = value; const top = msb(gen); while (msb(v) >= top) v ^= gen << (msb(v) - top); return v; }
function msb(n) { let b = -1; while (n) { n >>>= 1; b++; } return b; }

function placeFormat(grid, level, mask) {
  const size = grid.m.length, bitsv = formatBits(level, mask);
  for (let i = 0; i < 15; i++) {
    const bit = (bitsv >> i) & 1;
    // top-left vertical / horizontal
    if (i < 6) grid.m[i][8] = bit; else if (i === 6) grid.m[7][8] = bit; else if (i === 7) grid.m[8][8] = bit; else if (i === 8) grid.m[8][7] = bit; else grid.m[8][14 - i] = bit;
    if (i < 8) grid.m[8][size - 1 - i] = bit; else grid.m[size - 15 + i][8] = bit;
  }
  grid.m[size - 8][8] = 1;   // always-dark module (already set; re-assert)
}
function placeVersion(grid, version) {
  if (version < 7) return; const size = grid.m.length, bitsv = versionBits(version);
  for (let i = 0; i < 18; i++) { const bit = (bitsv >> i) & 1; const r = Math.floor(i / 3), c = i % 3; grid.m[r][size - 11 + c] = bit; grid.m[size - 11 + c][r] = bit; }
}

// penalty score (the four ISO rules) for mask selection
function penalty(grid) {
  const size = grid.m.length, m = grid.m; let score = 0;
  for (let r = 0; r < size; r++) { let run = 1; for (let c = 1; c < size; c++) { if (m[r][c] === m[r][c - 1]) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1; } }
  for (let c = 0; c < size; c++) { let run = 1; for (let r = 1; r < size; r++) { if (m[r][c] === m[r - 1][c]) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1; } }
  for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) score += 3;
  const pat = [1, 0, 1, 1, 1, 0, 1], hasPat = (get) => { for (let i = 0; i + 11 <= size; i++) { let a = true, b = true; for (let k = 0; k < 7; k++) { if (get(i + k) !== pat[k]) a = false; if (get(i + 4 + k) !== pat[k]) b = false; } if (a && [i + 7, i + 8, i + 9, i + 10].every((x) => get(x) === 0)) score += 40; if (b && [i, i + 1, i + 2, i + 3].every((x) => get(x) === 0)) score += 40; } };
  for (let r = 0; r < size; r++) hasPat((x) => m[r][x]);
  for (let c = 0; c < size; c++) hasPat((x) => m[x][c]);
  let dark = 0; for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
  const ratio = (dark * 100) / (size * size); score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

// ── public: encode(text, opts) → { size, version, ecc, modules:boolean[][] } ────────────────────────
export function encode(text, { ecc = "M", version, _forceMask } = {}) {
  const level = LEVELS[ecc] != null ? LEVELS[ecc] : 1; ecc = ["L", "M", "Q", "H"][level];
  const data = utf8(text);
  const ver = chooseVersion(data.length, level, version);
  const countBits = ver <= 9 ? 8 : 16;
  const dataCw = CODEWORDS[ver - 1] - EC_CODEWORDS[(ver - 1) * 4 + level];

  // 1 · data bit stream
  const bb = new Bits();
  bb.put(0b0100, 4); bb.put(data.length, countBits); for (const b of data) bb.put(b, 8);
  const capBits = dataCw * 8;
  for (let i = 0; i < 4 && bb.len < capBits; i++) bb.push(0);          // terminator
  while (bb.len % 8 !== 0) bb.push(0);                                  // byte align
  const padBytes = [0xec, 0x11]; let p = 0;
  while (bb.bytes.length < dataCw) bb.bytes.push(padBytes[p++ % 2]);

  // 2 · split into EC blocks, compute EC, interleave
  const numBlocks = EC_BLOCKS[(ver - 1) * 4 + level];
  const ecPerBlock = EC_CODEWORDS[(ver - 1) * 4 + level] / numBlocks;
  const shortLen = Math.floor(dataCw / numBlocks);
  const numLong = dataCw % numBlocks;                                   // last `numLong` blocks hold one extra data codeword
  const dataBlocks = [], ecBlocks = []; let off = 0;
  for (let b = 0; b < numBlocks; b++) { const len = shortLen + (b >= numBlocks - numLong ? 1 : 0); const blk = bb.bytes.slice(off, off + len); off += len; dataBlocks.push(blk); ecBlocks.push(ecCodewords(blk, ecPerBlock)); }
  const finalCw = [];
  const maxData = shortLen + (numLong ? 1 : 0);
  for (let i = 0; i < maxData; i++) for (let b = 0; b < numBlocks; b++) if (i < dataBlocks[b].length) finalCw.push(dataBlocks[b][i]);
  for (let i = 0; i < ecPerBlock; i++) for (let b = 0; b < numBlocks; b++) finalCw.push(ecBlocks[b][i]);

  // 3 · bit stream incl. remainder bits, place, mask, finish
  const bits = []; for (const cw of finalCw) for (let i = 7; i >= 0; i--) bits.push((cw >> i) & 1);
  const base = buildFunctionPatterns(ver);
  placeData(base, bits);
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) { if (_forceMask != null && mask !== _forceMask) continue; const g = applyMask(base, mask); placeFormat(g, ecc, mask); placeVersion(g, ver); const s = penalty(g); if (s < bestScore) { bestScore = s; best = g; } }
  const size = best.m.length, modules = new Array(size);
  for (let r = 0; r < size; r++) { modules[r] = new Array(size); for (let c = 0; c < size; c++) modules[r][c] = best.m[r][c] === 1; }
  return { size, version: ver, ecc, modules };
}

// toMatrix(text, opts) → the boolean matrix (compat with the prior holo-qr surface).
export function toMatrix(text, opts) { return encode(text, opts); }

// _debugCodewords — witness-only: expose the data + EC codewords for a single-block version.
export function _debugCodewords(text, ecc = "M", version) {
  const level = LEVELS[ecc]; const data = utf8(text); const ver = chooseVersion(data.length, level, version);
  const countBits = ver <= 9 ? 8 : 16; const dataCw = CODEWORDS[ver - 1] - EC_CODEWORDS[(ver - 1) * 4 + level];
  const bb = new Bits(); bb.put(0b0100, 4); bb.put(data.length, countBits); for (const b of data) bb.put(b, 8);
  const capBits = dataCw * 8; for (let i = 0; i < 4 && bb.len < capBits; i++) bb.push(0); while (bb.len % 8 !== 0) bb.push(0);
  const pad = [0xec, 0x11]; let p = 0; while (bb.bytes.length < dataCw) bb.bytes.push(pad[p++ % 2]);
  const numBlocks = EC_BLOCKS[(ver - 1) * 4 + level]; const ecPerBlock = EC_CODEWORDS[(ver - 1) * 4 + level] / numBlocks;
  return { version: ver, data: bb.bytes.slice(), ec: ecCodewords(bb.bytes.slice(0, dataCw), ecPerBlock) };
}

export default { encode, toMatrix };
