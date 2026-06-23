// holo-messenger-cn.mjs — THE BRIDGE to holowhat's κ-address-native Content Network.
//
// holowhat (github.com/afflom/holowhat, crates/holospaces-web) is the REAL serverless substrate our
// messenger faked: a peer-to-peer Content Network — cn_put(bytes)→κ, cn_announce(κ), cn_discover()→[κ],
// cn_fetch + verify-on-receipt (Law L5) — carried over real WebRTC data channels (WebRtcLink + cn_pump),
// backed by an OPFS κ-store, addressed by blake3 (kappa()/verify_kappa()). This module is the seam that
// lets our messenger ride that CN with NO change to its security model: we publish PQ-epoch-SEALED
// ciphertext envelopes, so the CN (and every peer/relay) is content-blind; the receiver verifies the
// blake3 κ on receipt (holowhat L5), then re-derives our sha256 content κ (our L5), then opens the epoch
// seal (PQ E2EE). Integrity+availability is holowhat's; confidentiality+consent is ours; together complete.
//
// holowhat addresses content by blake3 of the EXACT transmitted bytes. holo-blake3.kappaBlake3(bytes) is
// byte-identical to holowhat's kappa() (both standard blake3, KAT-proven by holo-blake3-witness), so the
// bridge is exact: the κ we compute for an object's wire bytes IS the κ holowhat's cn_put would return.
//
// makeContentPeer() is a faithful LOCAL model of holowhat's Console CN API (same method names/shape) so
// the messenger seams (holo-messenger-secure / -roam) swap in the real `window.HoloNet` WASM peer with no
// code change — only the carrier (a test hub here ↔ a real WebRtcLink/cn_pump in production) differs.
//
// Authority: holowhat Console CN (cn_put/announce/discover/fetch, verify_kappa) · holo-blake3 (κ parity) ·
//   holospaces Law L1/L3/L5 · SEC-1 (verify-on-receipt) · SEC-7 (content-blind carrier).

import { kappaBlake3 } from "./holo-blake3.mjs";

const te = new TextEncoder();
const td = new TextDecoder();
const u8 = (b) => (b instanceof Uint8Array ? b : te.encode(String(b)));

// the exact bytes transmitted for an object, and the holowhat CN κ of those bytes (blake3, = kappa()).
export const cnBytesOf = (object) => te.encode(JSON.stringify(object));
export const cnKappaOf = (object) => kappaBlake3(cnBytesOf(object));       // "blake3:<hex>" — what cn_put returns
// verify-on-receipt (holowhat verify_kappa / Law L5): bytes must re-derive to the claimed κ, else refuse.
export const verifyReceipt = (bytes, kappa) => kappaBlake3(u8(bytes)) === String(kappa);

// makeContentPeer({ send, onObject }) — a local content peer mirroring holowhat's Console CN surface.
//   send(frame)   : the carrier (production: WebRtcLink via cn_pump; tests: a hub). Frames {op,kappa,bytes?,topic?}.
//   onObject(o,κ) : fired when a fresh, VERIFIED object arrives (the receiver then opens + ingests).
// Methods mirror cn_put / cn_announce / cn_discover / cn_fetch; publish() = cn_put + cn_announce.
export function makeContentPeer({ send = () => {}, onObject = () => {}, max = 8192 } = {}) {
  const store = new Map();      // κ → bytes (held locally; the OPFS κ-store in production)
  const fetching = new Map();   // κ → resolve
  const order = [];
  const remember = (k, b) => { if (!store.has(k)) { store.set(k, b); order.push(k); if (order.length > max) store.delete(order.shift()); } };

  function put(bytes) { const k = kappaBlake3(u8(bytes)); remember(k, u8(bytes)); return k; }            // cn_put
  function announce(kappa, topic) { try { send({ op: "ANN", kappa, topic }); } catch (e) {} }            // cn_announce
  function publish(object, topic) { const k = put(cnBytesOf(object)); announce(k, topic); return k; }    // cn_put + cn_announce
  function discover() { return [...store.keys()]; }                                                      // cn_discover (local view)
  function fetch(kappa) { return new Promise((res) => { if (store.has(kappa)) return res(store.get(kappa)); fetching.set(kappa, res); try { send({ op: "GET", kappa }); } catch (e) {} }); }

  function onFrame(frame) {
    if (!frame || !frame.op) return { ok: false };
    if (frame.op === "ANN") { try { send({ op: "GET", kappa: frame.kappa, topic: frame.topic }); } catch (e) {} return { ok: true, learned: frame.kappa }; }  // learn → fetch
    if (frame.op === "GET") { if (store.has(frame.kappa)) try { send({ op: "OBJ", kappa: frame.kappa, bytes: store.get(frame.kappa) }); } catch (e) {} return { ok: true }; }
    if (frame.op === "OBJ") {
      if (!verifyReceipt(frame.bytes, frame.kappa)) return { ok: false, why: "verify-on-receipt-refused" };  // L5: refuse forgery
      remember(frame.kappa, u8(frame.bytes));
      const r = fetching.get(frame.kappa); if (r) { fetching.delete(frame.kappa); r(u8(frame.bytes)); }
      let obj = null; try { obj = JSON.parse(td.decode(u8(frame.bytes))); } catch (e) { return { ok: false, why: "parse" }; }
      try { onObject(obj, frame.kappa); } catch (e) {}
      return { ok: true, kappa: frame.kappa };
    }
    return { ok: false, why: "op-ignored" };
  }

  return { put, publish, announce, discover, fetch, onFrame, has: (k) => store.has(k), get size() { return store.size; } };
}

// ── browser binding ──
// In production this is REPLACED by window.HoloNet (the holowhat WASM peer): put→cn_put, announce→
// cn_announce, discover→cn_discover, fetch→cn_fetch_start/poll, carrier→cn_pump(WebRtcLink). Same shape.
if (typeof window !== "undefined" && !window.HoloMessengerCN) {
  window.HoloMessengerCN = { cnBytesOf, cnKappaOf, verifyReceipt, makeContentPeer };
}
