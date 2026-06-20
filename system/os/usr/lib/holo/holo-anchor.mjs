// holo-anchor.mjs — Bitcoin anchoring of the OS root (decentralized-boot S5). Bitcoin commits the
// canonical os-closure root, never the OS itself: the chain stores a 32-byte COMMITMENT that binds
// (a) the OS image root κ, (b) the prior anchored commitment (an append-only hash-linked release chain),
// and (c) the authorized release-signing keyset. Verification is CLIENT-SIDE and header-only (no node,
// no API): re-derive the commitment (Law L5), check M-of-N authority over it, fold the OTS Merkle path
// to the confirming block's merkle root, and PoW-validate that header. OpenTimestamps now (calendar at
// WRITE time only; the boot/trust path stays serverless), direct OP_RETURN as a sovereign upgrade behind
// the SAME verifier. Authority = a release-signing keyset PINNED in the closure + an M-of-N threshold;
// a new root is canonical only if threshold-signed AND it references the prior commitment.
//
// anchor.json shape (lives at etc/anchor.json once a root is anchored):
//   { v:1, algo:"sha256",
//     root:"did:holo:sha256:<os-closure root>",          // the image this anchor authorizes
//     prev:"<prior commitment hex>"|null,                 // hash-linked release chain (null = genesis)
//     authority:{ threshold:2, keys:["<33B compressed pubkey hex>", …] },   // pinned, sorted
//     commitment:"<32B hex>",                             // = sha256(canonical statement) — re-derivable
//     signatures:[{ key:"<hex>", sig:"<64B compact hex>" }, …],   // ≥ threshold, over the commitment
//     bitcoin?:{ ots:{ leaf:"<hex>", path:[{hash:"<hex>",dir:"L"|"R"}, …] },  // commitment → tx → merkle root
//               block:{ header:"<80B hex>", height:<n> } } }   // the confirming header (PoW-checked)
//
// secp256k1 (noble, browser+node) is re-used from the vetted btc-wallet bundle; SHA-256 via Web Crypto.
// Pure + dependency-light; the in-browser PoW path may instead use prism-btc (sha256d in wasm) — the
// math here is identical and self-contained so the verifier never needs the origin or a server.

import { secp256k1 } from "./btc-wallet/btc-lib.js";

const te = new TextEncoder();
const subtle = (globalThis.crypto && globalThis.crypto.subtle) || null;
const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (h) => { const s = String(h).replace(/^0x/, ""); const o = new Uint8Array(s.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16); return o; };
const kHex = (k) => String(k).split(":").pop().toLowerCase();   // did:holo:sha256:<hex> → <hex>

export async function sha256(bytes) { return new Uint8Array(await subtle.digest("SHA-256", bytes)); }
export async function sha256d(bytes) { return sha256(await sha256(bytes)); }

// Canonical JSON: sorted keys, no whitespace — canonicalize at the ingest boundary (Law 2), so the
// commitment is byte-stable across machines and re-derivations.
export function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}

// The signed/anchored statement: exactly the fields that fix identity + authority + chain position.
export function statement({ root, prev, authority }) {
  const keys = [...authority.keys].map((k) => k.toLowerCase()).sort();
  return te.encode(canonical({ v: 1, root: kHex(root), prev: prev ? String(prev).toLowerCase() : null, authority: { threshold: authority.threshold, keys } }));
}
export async function commitmentOf(parts) { return toHex(await sha256(statement(parts))); }

// Build a signable anchor object; signWith = array of 32-byte secret keys (≥ threshold of the pinned set).
export async function buildAnchor({ root, prev = null, authority, signWith }) {
  const commitment = await commitmentOf({ root, prev, authority });
  const msg = fromHex(commitment);
  const signatures = signWith.map((sk) => {
    const key = toHex(secp256k1.getPublicKey(sk));
    return { key, sig: toHex(secp256k1.sign(msg, sk)) };
  });
  return { v: 1, algo: "sha256", root: kHex(root) === String(root) ? "did:holo:sha256:" + kHex(root) : String(root), prev, authority: { threshold: authority.threshold, keys: [...authority.keys].map((k) => k.toLowerCase()).sort() }, commitment, signatures };
}

// bits (compact target) → BigInt target. mantissa·256^(exp-3).
export function bitsToTarget(bits) {
  const exp = bits >>> 24, mant = BigInt(bits & 0x007fffff);
  return exp <= 3 ? mant >> BigInt(8 * (3 - exp)) : mant << BigInt(8 * (exp - 3));
}
// PoW: sha256d(header) read little-endian (Bitcoin display order is reversed) must be ≤ target(bits).
export async function powValid(header80) {
  const h = header80 instanceof Uint8Array ? header80 : fromHex(header80);
  if (h.length !== 80) return false;
  const bits = (h[75] << 24) | (h[74] << 16) | (h[73] << 8) | h[72];   // bytes 72..75, little-endian
  const dh = await sha256d(h);
  let hashLE = 0n; for (let i = dh.length - 1; i >= 0; i--) hashLE = (hashLE << 8n) | BigInt(dh[i]);   // reverse → big number
  return hashLE <= bitsToTarget(bits >>> 0);
}
export function headerMerkleRoot(header80) {   // bytes 36..68, stored little-endian
  const h = header80 instanceof Uint8Array ? header80 : fromHex(header80);
  return toHex(h.subarray(36, 68));
}

// Fold an OTS-style Merkle inclusion path (each step a sibling + side) from leaf to root (sha256d, as in
// a Bitcoin tx merkle tree). Returns the computed root hex.
export async function merkleFold(leafHex, path) {
  let acc = fromHex(leafHex);
  for (const step of path) {
    const sib = fromHex(step.hash);
    const pair = step.dir === "L" ? new Uint8Array([...sib, ...acc]) : new Uint8Array([...acc, ...sib]);
    acc = await sha256d(pair);
  }
  return toHex(acc);
}

// THE verifier. opts: { liveRoot (κ the running OS re-derived to), prevCommitment (the chain link this
// must reference), requireBitcoin (default false — an authority-valid root not yet Bitcoin-confirmed is
// honestly "pending", not invalid) }. Returns { ok, checks, reasons }.
export async function verifyAnchor(anchor, opts = {}) {
  const checks = {}; const reasons = [];
  const fail = (k, why) => { checks[k] = false; reasons.push(`${k}: ${why}`); };

  // 1 · commitment re-derives from the statement (Law L5)
  const recomputed = await commitmentOf(anchor);
  checks.commitment = recomputed === String(anchor.commitment).toLowerCase();
  if (!checks.commitment) fail("commitment", `recomputed ${recomputed} ≠ ${anchor.commitment}`);

  // 2 · the anchor binds the ACTUAL running OS root
  if (opts.liveRoot != null) { checks.rootBinds = kHex(anchor.root) === kHex(opts.liveRoot); if (!checks.rootBinds) fail("rootBinds", `anchor root ≠ live root`); }

  // 3 · M-of-N authority: ≥ threshold DISTINCT pinned keys validly signed the commitment
  const pinned = new Set(anchor.authority.keys.map((k) => k.toLowerCase()));
  const msg = fromHex(anchor.commitment);
  const signers = new Set();
  for (const s of anchor.signatures || []) {
    const key = String(s.key).toLowerCase();
    if (!pinned.has(key) || signers.has(key)) continue;                 // unknown or duplicate → ignored
    try { if (secp256k1.verify(fromHex(s.sig), msg, fromHex(key))) signers.add(key); } catch {}
  }
  checks.authority = signers.size >= anchor.authority.threshold;
  if (!checks.authority) fail("authority", `${signers.size}/${anchor.authority.threshold} valid distinct signatures`);

  // 4 · hash-linked release chain
  if (opts.prevCommitment !== undefined) { checks.chain = (anchor.prev || null) === (opts.prevCommitment || null); if (!checks.chain) fail("chain", `prev ${anchor.prev} ≠ expected ${opts.prevCommitment}`); }

  // 5 · Bitcoin leg (OTS Merkle inclusion → confirming header PoW). Optional unless requireBitcoin.
  if (anchor.bitcoin) {
    const { ots, block } = anchor.bitcoin;
    const folded = await merkleFold(ots.leaf || anchor.commitment, ots.path || []);
    checks.ots = folded === headerMerkleRoot(block.header);
    if (!checks.ots) fail("ots", `folded merkle ${folded} ≠ header merkle root`);
    checks.pow = await powValid(block.header);
    if (!checks.pow) fail("pow", `confirming block header fails PoW`);
  } else if (opts.requireBitcoin) {
    fail("bitcoin", "no Bitcoin proof present (root authority-valid but not yet anchored)");
  }

  const required = ["commitment", "authority", ...(opts.liveRoot != null ? ["rootBinds"] : []), ...(opts.prevCommitment !== undefined ? ["chain"] : []), ...(anchor.bitcoin || opts.requireBitcoin ? ["ots", "pow"] : [])];
  const ok = required.every((k) => checks[k] === true);
  return { ok, checks, reasons, anchored: !!anchor.bitcoin };
}

export const HoloAnchor = { sha256, sha256d, canonical, statement, commitmentOf, buildAnchor, bitsToTarget, powValid, headerMerkleRoot, merkleFold, verifyAnchor };
export default HoloAnchor;
