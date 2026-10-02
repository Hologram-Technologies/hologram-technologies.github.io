// holo-seal.mjs — the UNIVERSAL LOSSLESS ENCODER (H1 of HOLO-SHOWCASE-COMPLETE-PROMPT.md).
//
// The inverse verb: resolve() reads a κ into bytes; seal() turns ANY bytes into a κ-object you can
// carry, hold, or share — and `unseal(seal(x)) === x`, byte-exact, zero trusted hosts (the spine
// identity, CI-enforced and shown live on the front door).
//
// COMPOSITION, not invention (one codec, not two): T1 rides holo-carry VERBATIM — the link IS the file
// (#recv= fragment: deflate-raw + base64url + sha256 re-derived on open = L5 on the wire; measured tiers:
// qr ≤2300-char URL · link ≤~600KB raw · above = HONEST null, never truncation). This module adds the
// BLAKE3 κ (the object's NAME on the canonical axis) and T2: the κ-hold — bytes sealed into THIS
// device's origin store (OPFS), resolving warm here. Badges must say what is true:
//   T1 "the link carries the file — no host, anywhere"
//   T2 "held on this device, this site"   (OPFS is per-origin — never claim more)
//
// seal(input, {name, base, hold}) → { kappa, sha256, bytes, link:{url,tier,chars}|null, held }
// unseal(hashOrUrl)               → { kappa, sha256, name, bytes } | { error }   (never throws)
// hold(kappaHex, bytes) / recall(kappaHex) — the T2 store (OPFS, κ-named, guarded where absent)

import { carryEncode, carryDecode, QR_URL_MAX, LINK_PAYLOAD_MAX } from "./holo-carry.mjs";
import { blake3hex } from "./holo-blake3.mjs";

export { QR_URL_MAX, LINK_PAYLOAD_MAX };

const toU8 = async (input) => input instanceof Uint8Array ? input
  : typeof input === "string" ? new TextEncoder().encode(input)
  : new Uint8Array(await input.arrayBuffer());

// ── T2: the κ-hold (OPFS, per-origin; absent → held:false, honestly) ─────────────────────────────────
async function sealedDir() {
  if (!globalThis.navigator?.storage?.getDirectory) return null;
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle("sealed", { create: true });
}
export async function hold(kappaHex, bytes) {
  try {
    const dir = await sealedDir(); if (!dir) return false;
    const fh = await dir.getFileHandle(kappaHex, { create: true });
    const w = await fh.createWritable(); await w.write(bytes); await w.close();
    return true;
  } catch (e) { return false; }
}
export async function recall(kappaHex) {
  try {
    const dir = await sealedDir(); if (!dir) return null;
    const f = await (await dir.getFileHandle(kappaHex)).getFile();
    const bytes = new Uint8Array(await f.arrayBuffer());
    return (await blake3hex(bytes)) === kappaHex ? bytes : null;      // the hold re-derives too (L5)
  } catch (e) { return null; }
}

// ── the verb ──────────────────────────────────────────────────────────────────────────────────────────
export async function seal(input, { name = "sealed", base = null, hold: doHold = false } = {}) {
  const u8 = await toU8(input);
  const kappa = await blake3hex(u8);
  const t1 = await carryEncode(u8, { name, base });
  const held = doHold ? await hold(kappa, u8) : false;
  return {
    kappa: "blake3:" + kappa,
    sha256: t1.hex || null,
    bytes: u8.length,
    link: t1.tier ? { url: t1.url, tier: t1.tier, chars: t1.url.length } : null,   // null = honest ceiling
    payloadChars: t1.payloadChars,
    held,
  };
}

export async function unseal(hashOrUrl) {
  const d = await carryDecode(hashOrUrl);
  if (d.error) return d;
  return { ...d, kappa: "blake3:" + (await blake3hex(d.bytes)) };     // κ re-derived from the delivered bytes
}
