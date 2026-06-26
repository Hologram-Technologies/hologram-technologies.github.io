// holo-deliver.mjs — NAMELESS, VERIFIED DELIVERY PAST A NAME-SHAPED FILTER. The ISP filter reads names; this
// path emits none it can read, and trusts no peer it pulls from. Two moves:
//
//   resolveNameless(host, { root, doh }) — get the content κ for a host WITHOUT a plaintext DNS query the
//     filter can inspect. First try κ-roots (holo-root.resolveName — pure math / pinned anchors, NO DNS at
//     all). Else an ENCRYPTED DoH answer (handed in by the caller; the query rides inside TLS to the DoH
//     endpoint, never the ISP resolver), DNSSEC-gated and re-derived via holo-dns.bridgeIn, yielding the
//     published `_holo.<host> TXT "holo=<κ>"` binding's content address. The ISP resolver is never queried.
//
//   fetchVerified(kappa, { stream }) — pull the bytes BY content address from a peer (the shared substrate,
//     a WebRTC zone-net DataChannel — any (async) iterable of Bao chunks), verifying EVERY chunk against the
//     single root κ as it arrives (holo-bao.verifiedChunks, Law L5). No ClientHello carrying the blocked SNI,
//     no socket to the blocked origin. The peer is UNTRUSTED: a tampered byte is refused by the math, not by
//     trusting the messenger — the property a VPN/Tor exit cannot give you.
//
// Axis note (honest): the κ-roots/zone layer labels a bare hash on its SHA-256 BRIDGE axis (did:holo:sha256:…)
// while Bao verifies on the canonical BLAKE3 σ-axis. fetchVerified consumes only the HEX TAIL of the address,
// which is the blake3 root of the bytes — so a binding minted as a bare blake3 hex verifies correctly today.
// Unifying the label under the one BLAKE3 κ is the canonical-κ migration tracked elsewhere; not blocking here.
//
// Pure assembly over existing seams — no new crypto, no I/O of its own (the DoH transport + the peer stream
// are injected, so this is node-testable with a loopback peer and live over WebRTC unchanged). Law L1/L2/L5.

import bao from "./holo-bao.mjs";
import { hexOf, isKappa } from "./holo-kappa.mjs";
import holoDns from "../../../sbin/holo-dns.mjs";

// resolveNameless(host, { root, doh }) → { ok, kappa, via } | { ok:false, why }.
//   root : an opened holo-root (makeRoot) — resolves names with zero DNS. Optional.
//   doh  : { fetch(host) → { dohJson, holoTxt } } — an ENCRYPTED DoH transport the caller supplies. Optional.
// At least one path must yield a κ, else fail closed (no plaintext-DNS fallback — that would defeat the point).
export async function resolveNameless(host, { root = null, doh = null } = {}) {
  const name = String(host || "").trim();
  if (!name) return { ok: false, why: "empty-host" };

  // 1 · κ-roots — pure math / pinned anchors. No DNS query leaves the device at all.
  if (root && typeof root.resolveName === "function") {
    try {
      const r = await root.resolveName(name);
      if (r && r.ok && r.kappa) return { ok: true, kappa: r.kappa, via: "kappa-roots" };
    } catch (e) { /* fall through to DoH */ }
  }

  // 2 · encrypted DoH → DNSSEC-gated bridge → the published _holo binding's content κ. The ISP resolver is
  //     bypassed: the name travels inside TLS to the DoH endpoint, and the answer is verify-before-trust.
  if (doh && typeof doh.fetch === "function") {
    try {
      const ans = (await doh.fetch(name)) || {};
      const bridged = await holoDns.bridgeIn(name, ans.dohJson, { requireSecure: true, source: "doh" });
      if (!bridged.ok) return { ok: false, why: "doh:" + bridged.why };
      const kappa = holoDns.parseHoloTxt(ans.holoTxt);     // _holo.<host>. IN TXT "holo=did:holo:…"
      if (kappa) return { ok: true, kappa, via: "doh-bridge" };
      return { ok: false, why: "doh-no-holo-binding" };
    } catch (e) { return { ok: false, why: "doh-error:" + String(e && e.message || e) }; }
  }

  return { ok: false, why: "unresolved-nameless" };
}

// fetchVerified(kappa, { stream }) → { ok, bytes, root, source } | { ok:false, why }.
//   stream : a (sync or async) iterable of { index, bytes, proof } — the exact shape holo-bao.encode(bytes)
//            .chunks produces, i.e. what a peer serves over the shared substrate / a WebRTC DataChannel.
// Every chunk is verified against hexOf(kappa) (the blake3 root) as it arrives; the FIRST unverified chunk
// throws and nothing it carried is admitted (Law L5 — streaming never trusts an unproven byte).
export async function fetchVerified(kappa, { stream = null } = {}) {
  if (!kappa || !isKappa(kappa)) return { ok: false, why: "bad-kappa" };
  if (!stream || typeof stream[Symbol.iterator] !== "function" && typeof stream[Symbol.asyncIterator] !== "function")
    return { ok: false, why: "no-stream" };
  const root = hexOf(kappa);
  const parts = [];
  try {
    for await (const ev of bao.verifiedChunks(root, stream)) parts.push(ev.bytes);   // L5 refuse-on-tamper inside
  } catch (e) {
    return { ok: false, why: "verify-refused", detail: String(e && e.message || e) };
  }
  let total = 0; for (const p of parts) total += p.length;
  const bytes = new Uint8Array(total);
  let off = 0; for (const p of parts) { bytes.set(p, off); off += p.length; }
  // Belt-and-braces: the reassembled whole must itself re-derive to the root (catches a dropped/duplicated chunk).
  if (bao.rootHex(bytes) !== root) return { ok: false, why: "reassembly-mismatch" };
  return { ok: true, bytes, root, source: "kappa-peer" };
}

// deliver(host, observed, ctx) — the one call the block-fallback makes: given a detected block on `host`,
// resolve it nameless and pull it verified. ctx = { root, doh, openStream(kappa) → stream }. openStream is the
// transport bind (shared-substrate get / zone-net want-have); it returns the Bao chunk stream for a κ, or null.
export async function deliver(host, { root = null, doh = null, openStream = null } = {}) {
  const res = await resolveNameless(host, { root, doh });
  if (!res.ok) return { ok: false, stage: "resolve", why: res.why };
  if (typeof openStream !== "function") return { ok: false, stage: "transport", why: "no-openStream" };
  const stream = await openStream(res.kappa);
  if (!stream) return { ok: false, stage: "transport", why: "no-peer-has-it", kappa: res.kappa };
  const got = await fetchVerified(res.kappa, { stream });
  if (!got.ok) return { ok: false, stage: "fetch", why: got.why, kappa: res.kappa };
  return { ok: true, kappa: res.kappa, via: res.via, bytes: got.bytes, source: got.source };
}

export default { resolveNameless, fetchVerified, deliver };
