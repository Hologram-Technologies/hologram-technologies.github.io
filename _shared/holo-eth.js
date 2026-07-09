// holo-eth.js — the UOR Ethereum engine for Holo Etherscan.
//
// First principles: Ethereum is ALREADY content-addressed. A block hash IS
// keccak256(RLP(header)); a transaction hash IS keccak256(typeByte ‖ RLP(fields));
// a contract address, an EIP-55 checksum, an ABI selector, an event topic and an ENS
// namehash are all keccak derivations. So the holospaces Law L5 — "verify by
// re-derivation" — is NATIVE here: every block/tx the explorer receives over JSON-RPC
// is re-hashed in the browser and a mismatch is refused. This module is the compute:
// keccak256 + RLP per the Ethereum Yellow Paper (Appendix B for RLP) and the relevant
// EIPs (155 typed-tx signing, 1559, 2930, 4844, 7702 tx envelopes; 4895 withdrawals;
// 4788 beacon root; 55 checksum; 137 ENS namehash). Zero dependencies, pure ES module
// (runs in the page, in a module Worker, and under Node for the witness).
//
// Authorities (never restated, only realized):
//   Yellow Paper §4.3 (block header) · Appendix B (RLP)
//   Keccak-f[1600], rate 1088 (keccak256, original 0x01 padding — NOT SHA3's 0x06)
//   EIP-55, EIP-137, EIP-155, EIP-1559, EIP-2718/2930, EIP-4844, EIP-4895, EIP-7702

// ── byte / hex utilities ────────────────────────────────────────────────────────────
export const hexToBytes = (h) => {
  if (h == null) return new Uint8Array(0);
  let s = String(h);
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  if (s.length % 2) s = "0" + s;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
};
const HEX = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0"));
export const bytesToHex = (b) => { let s = "0x"; for (let i = 0; i < b.length; i++) s += HEX[b[i]]; return s; };
export const concatBytes = (...arrs) => {
  let n = 0; for (const a of arrs) n += a.length;
  const out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out;
};
export const equalBytes = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const stripLeadingZeros = (b) => { let i = 0; while (i < b.length && b[i] === 0) i++; return b.subarray(i); };
// An Ethereum "quantity": minimal big-endian, no leading zero bytes, 0 → empty string.
export const bytesFromQuantity = (q) => {
  if (q == null || q === "0x" || q === "" ) return new Uint8Array(0);
  if (typeof q === "number") q = BigInt(q);
  if (typeof q === "bigint") { if (q === 0n) return new Uint8Array(0); let s = q.toString(16); if (s.length % 2) s = "0" + s; return hexToBytes(s); }
  return stripLeadingZeros(hexToBytes(q));   // hex string
};

// ── keccak-256 (Keccak-f[1600], BigInt lanes; correctness over micro-optimisation) ───
const MASK64 = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808An, 0x8000000080008000n,
  0x000000000000808Bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008An, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000An,
  0x000000008000808Bn, 0x800000000000008Bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800An, 0x800000008000000An,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n];
// rotation offsets r[x][y] flattened by index (x + 5y)
const R = [0n, 1n, 62n, 28n, 27n, 36n, 44n, 6n, 55n, 20n, 3n, 10n, 43n, 25n, 39n, 41n, 45n, 15n, 21n, 8n, 18n, 2n, 61n, 56n, 14n];
const rotl = (v, n) => n === 0n ? v : ((v << n) | (v >> (64n - n))) & MASK64;
function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    const D = new Array(5);
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x + 5 * y] ^= D[x];
    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], R[x + 5 * y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & MASK64) & B[(x + 2) % 5 + 5 * y]);
    A[0] ^= RC[round];
  }
}
export function keccak256(input) {
  const msg = input instanceof Uint8Array ? input : hexToBytes(input);
  const rate = 136;                                   // 1088 bits; capacity 512 ⇒ 256-bit output
  const A = new Array(25).fill(0n);
  const padLen = rate - (msg.length % rate);          // 1..rate (pad10*1, original Keccak)
  const padded = new Uint8Array(msg.length + padLen);
  padded.set(msg);
  padded[msg.length] |= 0x01;
  padded[padded.length - 1] |= 0x80;
  for (let b = 0; b < padded.length; b += rate) {
    for (let i = 0; i < rate / 8; i++) {              // 17 absorbed lanes
      let lane = 0n;
      for (let j = 0; j < 8; j++) lane |= BigInt(padded[b + i * 8 + j]) << BigInt(8 * j);
      A[i] ^= lane;
    }
    keccakF(A);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) { const lane = A[i]; for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((lane >> BigInt(8 * j)) & 0xffn); }
  return out;
}
export const keccak256Hex = (input) => bytesToHex(keccak256(input));

// ── RLP (Yellow Paper Appendix B) ────────────────────────────────────────────────────
const encodeLength = (len, offset) => {
  if (len < 56) return Uint8Array.of(offset + len);
  const lenBytes = bytesFromQuantity(BigInt(len));
  return concatBytes(Uint8Array.of(offset + 55 + lenBytes.length), lenBytes);
};
// Accepts: Uint8Array (byte string), Array (list), or a value coerced to bytes via toBytes.
export function rlpEncode(input) {
  if (Array.isArray(input)) {
    let payload = new Uint8Array(0);
    for (const item of input) payload = concatBytes(payload, rlpEncode(item));
    return concatBytes(encodeLength(payload.length, 0xc0), payload);
  }
  const b = input instanceof Uint8Array ? input : hexToBytes(input);
  if (b.length === 1 && b[0] < 0x80) return b;        // single low byte is itself
  return concatBytes(encodeLength(b.length, 0x80), b);
}
export function rlpDecode(input) {
  const data = input instanceof Uint8Array ? input : hexToBytes(input);
  const [item, off] = rlpItem(data, 0);
  if (off !== data.length) throw new Error("rlp: trailing bytes");
  return item;
}
function rlpItem(d, p) {
  const b = d[p];
  if (b < 0x80) return [d.subarray(p, p + 1), p + 1];
  if (b < 0xb8) { const len = b - 0x80; return [d.subarray(p + 1, p + 1 + len), p + 1 + len]; }
  if (b < 0xc0) { const ll = b - 0xb7; const len = Number(beToBig(d.subarray(p + 1, p + 1 + ll))); const s = p + 1 + ll; return [d.subarray(s, s + len), s + len]; }
  let len, s;
  if (b < 0xf8) { len = b - 0xc0; s = p + 1; }
  else { const ll = b - 0xf7; len = Number(beToBig(d.subarray(p + 1, p + 1 + ll))); s = p + 1 + ll; }
  const end = s + len, list = []; let q = s;
  while (q < end) { const [it, nq] = rlpItem(d, q); list.push(it); q = nq; }
  return [list, end];
}
const beToBig = (b) => { let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v; };

// ── block header → hash (Law L5 re-derivation), fork-aware ───────────────────────────
// Field order per the Yellow Paper, extended by EIP-1559 (baseFeePerGas), EIP-4895
// (withdrawalsRoot), EIP-4844 (blobGasUsed, excessBlobGas) and EIP-4788
// (parentBeaconBlockRoot). The JSON-RPC block carries a later-fork field only on blocks
// where it applies, so "present ⇒ include" re-derives correctly across every fork.
export function headerFields(blk) {
  const B = (h) => hexToBytes(h);                     // fixed-width field: exact bytes
  const Q = (q) => bytesFromQuantity(q);              // quantity: minimal big-endian
  const f = [
    B(blk.parentHash), B(blk.sha3Uncles), B(blk.miner), B(blk.stateRoot),
    B(blk.transactionsRoot), B(blk.receiptsRoot), B(blk.logsBloom),
    Q(blk.difficulty), Q(blk.number), Q(blk.gasLimit), Q(blk.gasUsed), Q(blk.timestamp),
    B(blk.extraData), B(blk.mixHash), B(blk.nonce),
  ];
  if (blk.baseFeePerGas != null) f.push(Q(blk.baseFeePerGas));
  if (blk.withdrawalsRoot != null) f.push(B(blk.withdrawalsRoot));
  if (blk.blobGasUsed != null) f.push(Q(blk.blobGasUsed));
  if (blk.excessBlobGas != null) f.push(Q(blk.excessBlobGas));
  if (blk.parentBeaconBlockRoot != null) f.push(B(blk.parentBeaconBlockRoot));
  if (blk.requestsHash != null) f.push(B(blk.requestsHash));   // EIP-7685 (Prague)
  return f;
}
export const blockHash = (blk) => keccak256Hex(rlpEncode(headerFields(blk)));
export function verifyBlock(blk) {
  try { const derived = blockHash(blk); return { ok: derived.toLowerCase() === String(blk.hash).toLowerCase(), derived, claimed: blk.hash }; }
  catch (e) { return { ok: false, error: String(e && e.message || e), claimed: blk.hash }; }
}

// ── transaction → hash (typed-tx aware: EIP-2718 envelopes) ──────────────────────────
const accessListRlp = (al) => (al || []).map((e) => [hexToBytes(e.address), (e.storageKeys || []).map(hexToBytes)]);
const toField = (to) => (to == null || to === "0x" ? new Uint8Array(0) : hexToBytes(to));
export function txRaw(tx) {
  const Q = (q) => bytesFromQuantity(q);
  const type = tx.type == null ? 0 : (typeof tx.type === "number" ? tx.type : parseInt(tx.type, 16));
  const data = hexToBytes(tx.input != null ? tx.input : (tx.data || "0x"));
  const yParity = tx.yParity != null ? tx.yParity : tx.v;
  if (type === 0) {
    return rlpEncode([Q(tx.nonce), Q(tx.gasPrice), Q(tx.gas), toField(tx.to), Q(tx.value), data, Q(tx.v), Q(tx.r), Q(tx.s)]);
  }
  if (type === 1) {   // EIP-2930
    const body = [Q(tx.chainId), Q(tx.nonce), Q(tx.gasPrice), Q(tx.gas), toField(tx.to), Q(tx.value), data, accessListRlp(tx.accessList), Q(yParity), Q(tx.r), Q(tx.s)];
    return concatBytes(Uint8Array.of(1), rlpEncode(body));
  }
  if (type === 2) {   // EIP-1559
    const body = [Q(tx.chainId), Q(tx.nonce), Q(tx.maxPriorityFeePerGas), Q(tx.maxFeePerGas), Q(tx.gas), toField(tx.to), Q(tx.value), data, accessListRlp(tx.accessList), Q(yParity), Q(tx.r), Q(tx.s)];
    return concatBytes(Uint8Array.of(2), rlpEncode(body));
  }
  if (type === 3) {   // EIP-4844 (blob)
    const body = [Q(tx.chainId), Q(tx.nonce), Q(tx.maxPriorityFeePerGas), Q(tx.maxFeePerGas), Q(tx.gas), toField(tx.to), Q(tx.value), data, accessListRlp(tx.accessList), Q(tx.maxFeePerBlobGas), (tx.blobVersionedHashes || []).map(hexToBytes), Q(yParity), Q(tx.r), Q(tx.s)];
    return concatBytes(Uint8Array.of(3), rlpEncode(body));
  }
  if (type === 4) {   // EIP-7702 (set-code)
    const auth = (tx.authorizationList || []).map((a) => [bytesFromQuantity(a.chainId), hexToBytes(a.address), bytesFromQuantity(a.nonce), bytesFromQuantity(a.yParity != null ? a.yParity : a.v), bytesFromQuantity(a.r), bytesFromQuantity(a.s)]);
    const body = [Q(tx.chainId), Q(tx.nonce), Q(tx.maxPriorityFeePerGas), Q(tx.maxFeePerGas), Q(tx.gas), toField(tx.to), Q(tx.value), data, accessListRlp(tx.accessList), auth, Q(yParity), Q(tx.r), Q(tx.s)];
    return concatBytes(Uint8Array.of(4), rlpEncode(body));
  }
  throw new Error("unknown tx type " + type);
}
export const txHash = (tx) => keccak256Hex(txRaw(tx));
export function verifyTx(tx) {
  // ok=true match · ok=false mismatch · ok=null not-applicable (a non-standard tx type
  // we don't encode, e.g. OP-stack deposit 0x7e) — so the UI shows "κ —", not "✗".
  try { const derived = txHash(tx); return { ok: derived.toLowerCase() === String(tx.hash).toLowerCase(), derived, claimed: tx.hash }; }
  catch (e) { const msg = String(e && e.message || e); return { ok: /unknown tx type/.test(msg) ? null : false, error: msg, claimed: tx.hash }; }
}

// ── addresses: EIP-55 checksum, contract-address derivation, validation ──────────────
export function toChecksumAddress(addr) {
  const a = String(addr).toLowerCase().replace(/^0x/, "");
  const hash = bytesToHex(keccak256(new TextEncoder().encode(a))).slice(2);
  let out = "0x";
  for (let i = 0; i < a.length; i++) out += parseInt(hash[i], 16) >= 8 ? a[i].toUpperCase() : a[i];
  return out;
}
export const isAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(String(s || ""));
export const isHash32 = (s) => /^0x[0-9a-fA-F]{64}$/.test(String(s || ""));
// CREATE: address = keccak256(rlp([sender, nonce]))[12:]
export function contractAddress(sender, nonce) {
  const raw = rlpEncode([hexToBytes(sender), bytesFromQuantity(nonce)]);
  return toChecksumAddress(bytesToHex(keccak256(raw).subarray(12)));
}

// ── ABI helpers (selectors, event topics, minimal decode/encode) ─────────────────────
const utf8 = (s) => new TextEncoder().encode(s);
export const selector = (sig) => bytesToHex(keccak256(utf8(sig)).subarray(0, 4));   // 4-byte function selector
export const eventTopic = (sig) => keccak256Hex(utf8(sig));                          // 32-byte event topic
// Encode a call with simple static args (address / uintN) — enough for ERC-20/721 reads.
export function encodeCall(sig, args = []) {
  let data = selector(sig);
  for (const a of args) {
    if (isAddress(a)) data += String(a).toLowerCase().replace(/^0x/, "").padStart(64, "0");
    else { let v = typeof a === "bigint" ? a : BigInt(a); let h = v.toString(16); data += h.padStart(64, "0"); }
  }
  return data;
}
// Decode one 32-byte word as the given simple type.
export function decodeWord(dataHex, type, index = 0) {
  const b = hexToBytes(dataHex);
  const word = b.subarray(index * 32, index * 32 + 32);
  if (type === "address") return toChecksumAddress(bytesToHex(word.subarray(12)));
  if (type === "bool") return beToBig(word) !== 0n;
  if (type.startsWith("uint") || type.startsWith("int")) return beToBig(word);
  if (type === "bytes32") return bytesToHex(word);
  return bytesToHex(word);
}
// Decode an ABI-encoded string/bytes return (offset, length, data) — for name()/symbol().
export function decodeString(dataHex) {
  const b = hexToBytes(dataHex);
  if (b.length === 0) return "";
  try {
    const off = Number(beToBig(b.subarray(0, 32)));
    const len = Number(beToBig(b.subarray(off, off + 32)));
    return new TextDecoder().decode(b.subarray(off + 32, off + 32 + len));
  } catch { return ""; }
}

// ── EIP-712 typed-structured-data hashing (sovereign, client-side — no provider, no server) ──
// The standard "sign-in / permit / order" digest dapps ask for. Pure keccak + ABI word encoding;
// the wallet signs hashTypedData(...) with the account key. Witnessed against the EIP-712 spec vector.
const _u8 = (s) => new TextEncoder().encode(s);
const pad32L = (bytes) => { const o = new Uint8Array(32); o.set(bytes.subarray(0, 32), 32 - Math.min(32, bytes.length)); return o; };
const pad32R = (bytes) => { const o = new Uint8Array(32); o.set(bytes.subarray(0, 32)); return o; };
const uint32be = (value) => { let v = BigInt(value); if (v < 0n) v += 1n << 256n; return hexToBytes("0x" + v.toString(16).padStart(64, "0")); };
function eip712EncodeType(primaryType, types) {
  const deps = new Set();
  (function visit(t) { if (deps.has(t) || !types[t]) return; deps.add(t); for (const f of types[t]) { const base = f.type.replace(/\[\d*\]$/, ""); if (types[base]) visit(base); } })(primaryType);
  deps.delete(primaryType);
  return [primaryType, ...[...deps].sort()].map((t) => `${t}(${types[t].map((f) => `${f.type} ${f.name}`).join(",")})`).join("");
}
const eip712TypeHash = (primaryType, types) => keccak256(_u8(eip712EncodeType(primaryType, types)));
function eip712Field(type, value, types) {
  if (types[type]) return keccak256(eip712Data(type, value, types));                 // nested struct
  if (type === "string") return keccak256(_u8(String(value)));
  if (type === "bytes") return keccak256(hexToBytes(value));
  if (type === "address") return pad32L(hexToBytes(value));
  if (type === "bool") return pad32L(Uint8Array.of(value ? 1 : 0));
  if (/^u?int\d*$/.test(type)) return uint32be(value);
  if (/^bytes\d+$/.test(type)) return pad32R(hexToBytes(value));
  const m = type.match(/^(.*)\[\d*\]$/);
  if (m) return keccak256(concatBytes(...value.map((v) => eip712Field(m[1], v, types))));
  throw new Error("EIP-712: unsupported type " + type);
}
function eip712Data(primaryType, data, types) {
  return concatBytes(eip712TypeHash(primaryType, types), ...types[primaryType].map((f) => eip712Field(f.type, data[f.name], types)));
}
export const eip712HashStruct = (primaryType, data, types) => keccak256(eip712Data(primaryType, data, types));
export function hashTypedData({ domain, types, primaryType, message }) {
  const t = { ...types };
  if (!t.EIP712Domain) {
    const order = [["name", "string"], ["version", "string"], ["chainId", "uint256"], ["verifyingContract", "address"], ["salt", "bytes32"]];
    t.EIP712Domain = order.filter(([k]) => domain[k] !== undefined).map(([name, type]) => ({ name, type }));
  }
  return keccak256(concatBytes(Uint8Array.of(0x19, 0x01), eip712HashStruct("EIP712Domain", domain, t), eip712HashStruct(primaryType, message, t)));
}

// ── ENS namehash (EIP-137) ───────────────────────────────────────────────────────────
export function namehash(name) {
  let node = new Uint8Array(32);
  if (name) {
    const labels = String(name).toLowerCase().split(".");
    for (let i = labels.length - 1; i >= 0; i--) node = keccak256(concatBytes(node, keccak256(utf8(labels[i]))));
  }
  return bytesToHex(node);
}

// ── JSON-RPC client + content-addressed (κ) store ────────────────────────────────────
// Networking through one endpoint; storage is the κ-store — block/tx hash IS the key,
// so a cache hit is content-addressed and re-derivation can be skipped once verified.
export class Rpc {
  constructor(url, timeoutMs = 20000) { this.url = url; this.id = 0; this.timeoutMs = timeoutMs; }
  async _post(payload) {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: ac.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (e) { if (e.name === "AbortError") throw new Error("RPC timeout (" + this.timeoutMs + "ms)"); throw e; }
    finally { clearTimeout(to); }
  }
  async call(method, params = []) {
    const j = await this._post({ jsonrpc: "2.0", id: ++this.id, method, params });
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    return j.result;
  }
  async batch(calls) {                                // [{method, params}]
    const body = calls.map((c) => ({ jsonrpc: "2.0", id: ++this.id, method: c.method, params: c.params || [] }));
    const arr = await this._post(body);
    const byId = new Map((Array.isArray(arr) ? arr : [arr]).map((r) => [r.id, r]));
    return body.map((b) => { const r = byId.get(b.id); if (r && r.error) throw new Error(r.error.message); return r ? r.result : null; });
  }
}
export class KappaStore {
  constructor(max = 2000) { this.m = new Map(); this.max = max; }
  get(k) { return this.m.get(String(k).toLowerCase()); }
  put(k, v) { const key = String(k).toLowerCase(); this.m.set(key, v); if (this.m.size > this.max) this.m.delete(this.m.keys().next().value); return v; }
  has(k) { return this.m.has(String(k).toLowerCase()); }
}

// ── self-test: KATs + genesis header re-derivation (external ground truth) ────────────
// A tampered engine fails this immediately — the same discipline as btc.html's
// verifyEngine(): no claim of correctness without an external witness.
const GENESIS = {
  hash: "0xd4e56740f876aef8c010b86a40d5f56745a118d0906a34e69aec8c0db1cb8fa3",
  parentHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  sha3Uncles: "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
  miner: "0x0000000000000000000000000000000000000000",
  stateRoot: "0xd7f8974fb5ac78d9ac099b9ad5018bedc2ce0a72dad1827a1709da30580f0544",
  transactionsRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
  receiptsRoot: "0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421",
  logsBloom: "0x" + "00".repeat(256),
  difficulty: "0x400000000", number: "0x0", gasLimit: "0x1388", gasUsed: "0x0", timestamp: "0x0",
  extraData: "0x11bbe8db4e347b4e8c937c1c8370e4b5ed33adb3db69cbdb7a38e1e50b1b82fa",
  mixHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
  nonce: "0x0000000000000042",
};
export function selfTest() {
  const r = [];
  const chk = (name, got, want) => r.push({ name, ok: String(got).toLowerCase() === String(want).toLowerCase(), got, want });
  chk("keccak256('')", keccak256Hex(new Uint8Array(0)), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  chk("keccak256('abc')", keccak256Hex(utf8("abc")), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  chk("genesis blockHash", blockHash(GENESIS), GENESIS.hash);
  chk("EIP-55 checksum", toChecksumAddress("0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359"), "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359");
  chk("contractAddress nonce0", contractAddress("0x6ac7ea33f8831ea9dcc53393aaa88b25a785dbf0", 0), "0xcd234a471b72ba2f1ccf0a70fcaba648a5eecd8d");
  chk("namehash('eth')", namehash("eth"), "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae");
  chk("Transfer topic", eventTopic("Transfer(address,address,uint256)"), "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
  return { ok: r.every((x) => x.ok), results: r };
}

export const GENESIS_HEADER = GENESIS;
