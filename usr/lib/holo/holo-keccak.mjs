// holo-keccak.mjs — keccak-256 (Ethereum flavour, 0x01 padding), pure + dependency-free. The keccak256
// σ-axis of KappaLabel71 (upstream `Axis::Keccak256`) and the hash ENS namehash is built on. Lane model
// is 25×64-bit via BigInt (correctness over speed — a resolver hashes occasional small inputs, not a hot
// loop). Verified against published vectors in holo-keccak.witness.mjs (empty · "abc" · namehash('eth')).

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const R = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const M = (1n << 64n) - 1n;
const rotl = (x, n) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M;

function keccakF(s) {
  for (let round = 0; round < 24; round++) {
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    const D = new Array(5);
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] ^= D[x];
    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], R[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = B[x + 5 * y] ^ (~B[(x + 1) % 5 + 5 * y] & B[(x + 2) % 5 + 5 * y]) & M;
    s[0] ^= RC[round];
  }
}

// keccak256(bytes: Uint8Array) → Uint8Array(32)
export function keccak256(input) {
  const rate = 136;                                        // 1088 bits
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const padLen = rate - (bytes.length % rate);
  const buf = new Uint8Array(bytes.length + padLen);
  buf.set(bytes);
  buf[bytes.length] ^= 0x01;                               // Ethereum keccak padding (SHA3 would be 0x06)
  buf[buf.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < buf.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 0; b < 8; b++) lane |= BigInt(buf[off + i * 8 + b]) << BigInt(8 * b);   // little-endian lanes
      s[i] ^= lane;
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) { let lane = s[i]; for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; } }
  return out;
}
export function keccak256hex(input) { return Array.from(keccak256(input), (b) => b.toString(16).padStart(2, "0")).join(""); }

export default { keccak256, keccak256hex };
