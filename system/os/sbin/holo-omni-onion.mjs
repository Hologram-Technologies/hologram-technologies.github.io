// holo-omni-onion.mjs — the ONION leg of the omni resolver. One function, resolveOnion(ref), turns a Tor
// v3 .onion address into the SAME kind of thing every other omni leg produces: a sealed, κ-addressed object
// (a JSON-LD "card") whose κ = did:holo:sha256:H(jcs(card)), plus a re-derivable egress receipt.
//
//   <56 base32>.onion          → v3 onion service → cryptographically VALIDATED descriptor card
//   <16 base32>.onion          → v2 onion         → REFUSED (deprecated 2021, unsupported)
//
// HONESTY (Law L5). A browser tab cannot natively join the Tor network. So this leg validates the address
// from FIRST PRINCIPLES — a v3 .onion IS base32(ed25519_pubkey ‖ checksum ‖ version), and the checksum is
// SHA3-256(".onion checksum" ‖ pubkey ‖ version)[:2]. That validation proves the address is well-formed and
// self-consistent with NO network and NO transport. The page render (the actual bytes) is a SEPARATE, later
// step that MUST go through an explicit transport (a user-configured Tor SOCKS5 proxy, or an onion HTTP
// gateway) — and the egress receipt PINS which one served it. We never present a gateway-fetched onion page
// as if it were directly, anonymously Tor-routed. When no transport is configured, resolveOnion returns an
// honest null: ok:false, the validated descriptor card, and a receipt with outcome "refused / no-transport".
//
// Pure ESM, no DOM, browser+Node. It REUSES the OS base32 (holo-ipfs) and the κ-sealer (holo-q-receipt);
// the only new primitive is a compact FIPS-202 SHA3-256 (NOT keccak256 — Tor uses SHA3, 0x06 domain pad).

import { base32encode, base32decode } from "../usr/lib/holo/holo-ipfs.js";
import { address } from "../usr/lib/holo/q/holo-q-receipt.mjs";
import { normalizeTransport } from "./holo-omni-onion-transport.mjs";

const enc = (s) => new TextEncoder().encode(s);
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
function concat(...arrs) { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let i = 0; for (const a of arrs) { o.set(a, i); i += a.length; } return o; }

// ── SHA3-256 (FIPS-202) — a compact, self-contained Keccak-f[1600] over BigInt lanes. This is NOT the
// keccak256 in holo-eth.js: Ethereum's Keccak pads with 0x01, FIPS-202 SHA3 pads with 0x06. The Tor v3
// onion checksum is defined over SHA3-256, so the distinction is load-bearing — get it wrong and every
// address "validates", which is worse than no check. One 35-byte hash per address paste; not a hot path. ─
const MASK64 = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [ // rotation offsets, indexed [x][y] (lane index = x + 5*y)
  [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
];
const rotl = (x, n) => n === 0n ? x : (((x << n) | (x >> (64n - n))) & MASK64);
function keccakF1600(s) {
  for (let round = 0; round < 24; round++) {
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    const D = new Array(5);
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = (s[x + 5 * y] ^ D[x]) & MASK64;
    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], BigInt(ROT[x][y]));
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = (B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & MASK64) & B[(x + 2) % 5 + 5 * y])) & MASK64;
    s[0] = (s[0] ^ RC[round]) & MASK64;
  }
}
export function sha3_256(msg) {
  const rate = 136;                                  // SHA3-256: rate 1088 bits = 136 bytes
  const s = new Array(25).fill(0n);
  const padLen = rate - (msg.length % rate);
  const m = new Uint8Array(msg.length + padLen);
  m.set(msg);
  m[msg.length] ^= 0x06;                             // FIPS-202 domain separation + pad10*1 start
  m[m.length - 1] ^= 0x80;                           // pad10*1 end
  for (let off = 0; off < m.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(m[off + i * 8 + b]);   // little-endian lane
      s[i] ^= lane;
    }
    keccakF1600(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) { let lane = s[i]; for (let b = 0; b < 8; b++) { out[i * 8 + b] = Number(lane & 0xffn); lane >>= 8n; } }
  return out;
}

// ── classify (no network) ────────────────────────────────────────────────────────────────────────
// parseOnionRef(s) → { kind:"onion", host, addr, path } | null. null means "not an onion address".
// Accepts onion:// , http(s):// , tor:// schemes or a bare host; preserves the path for later browsing.
export function parseOnionRef(ref) {
  let s = String(ref || "").trim();
  if (!s) return null;
  s = s.replace(/^(onion|tor|https?):\/\//i, "");
  const m = s.match(/^([a-z2-7]{16,56})\.onion\b([:/?#].*)?$/i);
  if (!m) return null;
  const addr = m[1].toLowerCase();
  const host = addr + ".onion";
  let rest = m[2] || "/";
  const pm = rest.match(/\/[^?#]*/);                 // strip any :port, keep the path
  const path = pm ? pm[0] : "/";
  return { kind: "onion", host, addr, path };
}

// validateOnion(addr) → { ok, version?, pubkeyHex?, reason? } — the cryptographic check, no network.
// v3: base32 → 35 bytes = pubkey(32) ‖ checksum(2) ‖ version(1); recompute the SHA3-256 checksum + assert
// version 3. A fabricated or corrupt address fails the checksum and is REFUSED, not silently browsed.
export function validateOnion(addr) {
  const a = String(addr || "").toLowerCase().replace(/\.onion$/, "");
  if (!/^[a-z2-7]+$/.test(a)) return { ok: false, reason: "not base32 — onion addresses use a–z and 2–7 only" };
  if (a.length === 16) return { ok: false, version: 2, reason: "v2 onion address — deprecated since Oct 2021 and unsupported (no v2 introduction points remain)" };
  if (a.length !== 56) return { ok: false, reason: `expected a 56-char v3 address, got ${a.length} chars` };
  let raw; try { raw = base32decode(a); } catch { return { ok: false, reason: "address is not valid base32" }; }
  if (raw.length !== 35) return { ok: false, reason: `address decoded to ${raw.length} bytes, expected 35 (pubkey ‖ checksum ‖ version)` };
  const pub = raw.subarray(0, 32), checksum = raw.subarray(32, 34), version = raw[34];
  if (version !== 3) return { ok: false, version, reason: `unsupported onion version ${version} (expected 3)` };
  const h = sha3_256(concat(enc(".onion checksum"), pub, Uint8Array.of(version)));
  if (h[0] !== checksum[0] || h[1] !== checksum[1]) return { ok: false, reason: "checksum mismatch — address is corrupt or fabricated (the ed25519 key does not match its checksum)" };
  return { ok: true, version: 3, pubkeyHex: hex(pub) };
}

// onionAddressFromPubkey(pub32) → the canonical v3 .onion host for a raw ed25519 public key. The inverse of
// validateOnion; exported so the witness can MINT a guaranteed-valid address with no network or fixtures.
export function onionAddressFromPubkey(pub) {
  if (!(pub instanceof Uint8Array) || pub.length !== 32) throw new Error("pubkey must be 32 bytes");
  const version = 3;
  const checksum = sha3_256(concat(enc(".onion checksum"), pub, Uint8Array.of(version))).subarray(0, 2);
  return base32encode(concat(pub, checksum, Uint8Array.of(version))) + ".onion";
}

// ── the κ-sealed descriptor card + the egress receipt ───────────────────────────────────────────────
const ONION_CTX = { "@context": { schema: "https://schema.org/", holo: "https://hologram.os/ns/onion#", tor: "https://spec.torproject.org/rend-spec-v3#" } };

// transportPin(t) — the honest record of HOW onion bytes would leave the tab. Never omitted from a receipt
// when a transport is set; this is the line between "validated address" and "someone fetched it for you".
function transportPin(t) {
  if (!t) return null;
  return { "hosc:kind": t.kind || null, "hosc:endpoint": t.endpoint || null, ...(t.label ? { "hosc:label": t.label } : {}) };
}
// sealOnionEgress(...) → a re-derivable hosc:Egress receipt. It PINS the transport (or null) and the
// outcome, so the trust story is auditable: a gateway/proxy hop is recorded, never disguised as direct Tor.
async function sealOnionEgress({ verb, host, transport, outcome, reason, generated, caller = "omni" }) {
  const body = {
    "@context": { prov: "http://www.w3.org/ns/prov#", hosc: "https://hologram.os/ns/conscience#" },
    "@type": ["prov:Activity", "hosc:Egress"],
    "hosc:caller": caller, "hosc:verb": verb, "hosc:network": "tor", "hosc:host": host,
    "hosc:transport": transportPin(transport),
    "hosc:grant": transport ? "onion-transport" : "none",
    "hosc:directTor": false,                          // honesty: this OS does NOT carry native Tor circuits
    "hosc:outcome": outcome, ...(reason ? { "hosc:reason": reason } : {}),
    ...(generated ? { "prov:generated": { "@id": generated } } : {}),
  };
  return { id: await address(body), body };
}

// resolveOnion(ref, cfg) → uniform envelope. STAGE 1: validates + seals the descriptor; does NOT fetch.
//   cfg: { transport?: { kind:"socks5"|"gateway", endpoint, label? }, caller? }
//   → { ok:false, kind:"onion", subkind, reason, kappa?, card?, receipt?, transport?, ms }
// ok is false in Stage 1 even for a valid address: the address is proven, but no live render exists yet —
// an honest null, exactly like the other omni legs return when nothing can be served.
export async function resolveOnion(ref, cfg = {}) {
  const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
  const ms = () => (t0 ? Math.round((performance.now ? performance.now() : 0) - t0) : 0);
  const caller = cfg.caller || "omni";
  const p = parseOnionRef(ref);
  if (!p) return { ok: false, kind: "onion", reason: "not a .onion address", ms: ms() };
  const v = validateOnion(p.addr);
  if (!v.ok) return { ok: false, kind: "onion", subkind: "invalid", reason: v.reason, ...(v.version ? { version: v.version } : {}), ms: ms() };

  const card = {
    ...ONION_CTX, "@type": "holo:OnionService",
    "holo:host": p.host, "holo:version": 3, "holo:pubkey": v.pubkeyHex, "holo:path": p.path, "holo:network": "tor",
    "holo:validated": "v3 ed25519 pubkey · SHA3-256 checksum verified — the address re-derives to itself (Law L5)",
    "holo:note": "address proven well-formed with NO network; rendering the page requires an explicit Tor transport",
  };
  const transport = normalizeTransport(cfg.transport);
  if (!transport) {
    const k0 = await address(card);
    const receipt = await sealOnionEgress({ verb: "onion.resolve", host: p.host, transport: null, outcome: "refused", reason: "no-transport", generated: k0, caller });
    return { ok: false, kind: "onion", subkind: "v3", reason: "no Tor transport configured — set a SOCKS5 proxy or an onion HTTP gateway to fetch this service", kappa: k0, card, receipt, transport: null, ms: ms() };
  }
  // A transport IS configured → the service is BROWSABLE. We do NOT fetch the page here (the card is a
  // descriptor, like every omni card); the browser seam fetches + re-derives the bytes on open (Law L5),
  // routing through this transport. The card records HOW it will be reached and the receipt PINS it — the
  // transport is never disguised as direct, anonymous routing (hosc:directTor stays false).
  const browseUrl = "http://" + p.host + p.path;
  const ready = {
    ...card,
    "holo:openVia": { "holo:transport": transport.kind, "holo:endpoint": transport.endpoint },
    "holo:browseUrl": browseUrl,
    "holo:note": "address proven well-formed; the page is fetched + re-derived by the browser seam on open, routed through the configured " + transport.kind + " transport (not direct Tor)",
  };
  const kappa = await address(ready);
  const receipt = await sealOnionEgress({ verb: "onion.resolve", host: p.host, transport, outcome: "transport-ready", reason: null, generated: kappa, caller });
  return { ok: true, kind: "onion", subkind: "v3", kappa, card: ready, receipt, transport: transportPin(transport), browse: { url: browseUrl, via: transport.kind }, ms: ms() };
}

export default { parseOnionRef, validateOnion, onionAddressFromPubkey, resolveOnion, sha3_256 };
