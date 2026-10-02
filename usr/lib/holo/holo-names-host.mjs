// holo-names-host.mjs — THE ONE HOST BINDING for the universal resolver (I1 of the instant milestone,
// E1 of the Q-is-the-resolver fusion). holo-names.mjs stays pure and injected; THIS is the only place
// a browser wires it to the real world — every surface (inspector, omnibox, κ-paste, launcher) builds
// its resolver HERE, and per-page wiring is deleted (L4).
//
//   makeHostResolver({ base, wasmGlue?, fetchFn?, lruSize? }) → { resolve, resolveOrExplain, classify, stats }
//
//   TIER 0 — THE LOCAL STORE (L3): CacheStorage is consulted BEFORE any network rung exists — a warm
//   object fires ZERO requests (latency AND privacy: warm resolves are invisible to every mirror).
//   TIER 1 — THE RACE: `/.holo/<axis>/<hex>` (root-sw) · `b/<hex>` (static) · the HF κ-mirror — the
//   pure verb races them; first bytes that RE-DERIVE win (SEC-1).
//   HASHERS by size, never by hope: sha256 = subtle · blake3 ≤256KB = holo-blake3 pure JS · >256KB =
//   the UPSTREAM RUNTIME's own kappa() (wasmGlue, lazy — downstream consumption made literal); no
//   glue → pure JS still verifies: slow is acceptable, unverified never is (L5).
//
// Glue only (≤5KB). Nothing here can widen what the verb admits — caps attenuate per call (SEC-2/5),
// refusals stay named, the LRU stays bounded (SEC-8).

import { makeNameResolver, classify, AXES, kappaToCid } from "./holo-names.mjs";

const hex2 = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
export const SMALL = 262144;   // ≤256KB: hash on the calling thread without jank (I0-measured line)

// ── data: URI — content is INLINE, so it is its own proof (V1 Mode A, zero network). Decode the bytes,
//    the κ is the hash of exactly those bytes — nothing is fetched, nothing is trusted. ────────────────
export function decodeDataURI(s) {
  const m = /^data:([^,]*),(.*)$/is.exec(String(s || ""));
  if (!m) return null;
  const meta = m[1] || "", body = m[2] || "", isB64 = /;base64/i.test(meta);
  const mime = (meta.split(";")[0] || "text/plain").trim() || "text/plain";
  try {
    let bytes;
    if (isB64) { const bin = globalThis.atob ? atob(body) : Buffer.from(body, "base64").toString("binary"); bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); }
    else { const txt = decodeURIComponent(body); bytes = new TextEncoder().encode(txt); }
    return { bytes, mime };
  } catch { return null; }
}

export function makeHostResolver({ base, wasmGlue = null, fetchFn = null, lruSize = 256, mirrors = null } = {}) {
  const BASE = base ? new URL(String(base)) : (typeof location !== "undefined" ? new URL("./", location.href) : null);
  if (!BASE) throw new Error("makeHostResolver needs base (the bundle root URL)");
  const rawFetch = fetchFn || ((u, o) => fetch(u, o));

  let _b3 = null, _wasm = null, _kec = null;
  const b3small = async (b) => { if (!_b3) _b3 = (await import("./holo-blake3.mjs")).blake3hex; return _b3(b); };
  const hashers = {
    sha256: async (b) => hex2(await crypto.subtle.digest("SHA-256", b)),
    keccak256: async (b) => { if (!_kec) _kec = (await import("./holo-keccak.mjs")).keccak256hex; return _kec(b); },   // completes the σ-axis: eth content verifies too
    blake3: async (b) => {
      if (b.length > SMALL && wasmGlue) {
        try {
          // wasmGlue: a URL string (legacy path import) OR an async () => module — the κ-resolved
          // runtime (holo-runtime.mjs runtimeModule): pointer-signed, every byte re-derived before init.
          if (!_wasm) _wasm = (typeof wasmGlue === "function") ? await wasmGlue() : await (async () => { const m = await import(/* @vite-ignore */ wasmGlue); if (m.default) await m.default(); return m; })();
          return String(_wasm.kappa(b)).replace(/^blake3:/, "");
        } catch {}
      }
      return b3small(b);
    },
  };

  const spellings = (axis, hex) => [new URL("b/" + hex, BASE).href, new URL(".holo/" + axis + "/" + hex, BASE).href];
  // a sha256 κ that is ALSO a raw-leaf IPFS CID can be fetched from ANY public gateway: the raw-leaf CID
  // digest IS the sha256 of the bytes, so the gateway is just another untrusted mirror the race re-derives
  // (SEC-1). Reconstruct the CID from the κ. Gateways are named transports → caps can refuse them (privacy).
  const ipfsGw = (host) => ({ axis, hex, kind }) => { if (axis !== "sha256" || (kind !== "ipfs" && kind !== "torrent")) return null; try { return host + kappaToCid("sha256:" + hex); } catch { return null; } };
  const RUNGS = mirrors || [
    { name: "origin", url: ({ axis, hex }) => new URL(".holo/" + axis + "/" + hex, BASE).href },
    { name: "origin-b", url: ({ axis, hex }) => (axis === "sha256" ? new URL("b/" + hex, BASE).href : null) },
    { name: "hf-mirror", url: ({ axis, hex }) => (axis === "sha256" ? "https://huggingface.co/HOLOGRAMTECH/holo-messenger-shell/resolve/main/b/" + hex : null) },
    { name: "ipfs-gw", url: ipfsGw("https://ipfs.io/ipfs/") },        // public gateway — untrusted, re-derived
    { name: "ipfs-dweb", url: ipfsGw("https://dweb.link/ipfs/") },    //   raced with a second, no single point
  ];
  const store = { name: "store", url: ({ axis, hex }) => "cache://" + axis + "/" + hex };
  // O2 (HOLO-SOVEREIGN-OFFLINE): the persistent device κ-store joins TIER 0 beside CacheStorage —
  // a pinned object resolves with ZERO network forever, not just while the SW cache lives. The rung
  // re-derives before returning (and the pure verb re-derives again — belt and braces, both cheap);
  // a poisoned entry is purged by the rung and misses here, then TIER 1's write-back OVERWRITES it
  // with verified bytes — the store self-heals. Rung trouble → exactly the pre-O2 TIER 0 (fail-soft).
  let _rung = null, _rungP = null;
  const rungOf = () => (_rung !== null ? Promise.resolve(_rung) : (_rungP ||= import("./holo-store-rung.mjs")
    .then((m) => (_rung = m.makeStoreRung())).catch(() => (_rung = false))));
  const storeFetch = async (url) => {   // TIER 0: CacheStorage + device store; a miss is silence, never a request
    const m = /^cache:\/\/([^/]+)\/([0-9a-f]+)$/.exec(String(url));
    if (!m) return { ok: false };
    if (typeof caches !== "undefined") {
      try { for (const s of spellings(m[1], m[2])) { const hit = await caches.match(s, { ignoreSearch: true }); if (hit && hit.ok) return hit; } } catch {}
    }
    try { const R = await rungOf(); if (R) { const u8 = await R.get(m[1], m[2]); if (u8) return new Response(u8); } } catch {}
    return { ok: false };
  };

  const R0 = makeNameResolver({ fetchFn: storeFetch, hashers, mirrors: [store], lruSize });
  const R1 = makeNameResolver({ fetchFn: rawFetch, hashers, mirrors: RUNGS, lruSize });

  // THE WARM CACHE (L3 — the store IS the memory). A once-resolved object lives here keyed by its κ; a
  // repeat resolve is a SYNCHRONOUS Map hit (~µs) that fires ZERO network AND skips the async store probe
  // (caches.match is hundreds of µs — it must never be on the warm path). Bounded (SEC-8). Cold falls
  // through: TIER 0 store (0-egress if the SW cached it) → TIER 1 the raced network rungs.
  const warm = new Map();                                  // "axis:hex" → { kind, kappa, bytes }
  const bump = (k, v) => { if (warm.has(k)) warm.delete(k); warm.set(k, v); if (warm.size > lruSize) warm.delete(warm.keys().next().value); };
  const warmKeyOf = (rec) => {                             // the κ a content-derived name commits to
    const hex = rec.hex || (rec.kappa ? rec.kappa.split(":").pop() : null);
    if (!hex) return null;
    const axis = rec.axis || (rec.kappa ? rec.kappa.split(":")[0] : null);
    return (axis || "*") + ":" + hex;                      // bare hex: axis unknown until resolved → probe both
  };

  async function resolve(name, caps = null) {
    if (!caps) {                                           // caps present → honor attenuation, skip the warm shortcut
      const rec = classify(name);
      // Nostr note (V2): a SELF-authenticating pointer — the id IS a sha256 of the note (NIP-01), so it
      // resolves from ANY untrusted relay and re-derives. Lazy-load the pointer module (keeps host lean).
      if (rec && rec.kind === "nostr") {
        try {
          const { resolveNostr } = await import("./holo-pointers.mjs");
          const r = await resolveNostr(name, { sha256hex: hashers.sha256, WebSocket: (typeof WebSocket !== "undefined" ? WebSocket : null) });
          if (r.ok) { bump(r.kappa, { kind: "nostr", kappa: r.kappa, bytes: r.bytes }); return { ok: true, kind: "nostr", kappa: r.kappa, bytes: r.bytes, source: r.via, trust: r.trust, trustLevel: r.trustLevel, author: r.author, event: r.event }; }
          return { ok: false, kind: "nostr", why: r.why };
        } catch (e) { return { ok: false, kind: "nostr", why: String(e && e.message || e).slice(0, 60) }; }
      }
      // Bluesky / atproto (V2): at://<did|handle>/… → DID doc → the account's own PDS → the record (B-via).
      if (rec && rec.kind === "atproto") {
        try {
          const { resolveBluesky } = await import("./holo-pointers.mjs");
          const b = await resolveBluesky(name, { fetchFn: rawFetch });
          return b.ok ? { ok: true, kind: "atproto", bytes: b.bytes, source: b.via, author: b.author, trust: b.trust, trustLevel: b.trustLevel, cid: b.cid } : { ok: false, kind: "atproto", why: b.why };
        } catch (err) { return { ok: false, kind: "atproto", why: String(err && err.message || err).slice(0, 60) }; }
      }
      // IPNS (V2 self-auth): the name IS an ed25519 key; the record is signed by it → CID → Mode A.
      if (rec && rec.kind === "ipns") {
        try {
          const { resolveIPNS } = await import("./holo-pointers.mjs");
          const p = await resolveIPNS(name, { fetchFn: rawFetch });
          if (!p.ok) return { ok: false, kind: "ipns", why: p.why };
          let content = null; try { content = await resolve(p.pointsTo); } catch {}
          if (content && content.ok) return { ok: true, kind: "ipns", kappa: content.kappa, bytes: content.bytes, source: "ipns→" + content.source, pointsTo: p.pointsTo, via: p.via, trust: p.trust, trustLevel: p.trustLevel };
          return { ok: true, kind: "ipns", pointsTo: p.pointsTo, cid: p.cid, via: p.via, trust: p.trust, trustLevel: p.trustLevel };
        } catch (err) { return { ok: false, kind: "ipns", why: String(err && err.message || err).slice(0, 60) }; }
      }
      // ENS (V3): namehash local → contenthash via an untrusted RPC → a CID the content verifies against.
      if (rec && rec.kind === "ens") {
        try {
          const { resolveENS } = await import("./holo-pointers.mjs");
          const e = await resolveENS(name, { fetchFn: rawFetch });
          if (!e.ok) return { ok: false, kind: "ens", why: e.why };
          let content = null; try { content = await resolve(e.pointsTo); } catch {}   // chain the CID into Mode A
          if (content && content.ok) return { ok: true, kind: "ens", kappa: content.kappa, bytes: content.bytes, source: "ens→" + content.source, pointsTo: e.pointsTo, via: e.via, trust: e.trust, trustLevel: e.trustLevel };
          return { ok: true, kind: "ens", pointsTo: e.pointsTo, cid: e.cid, via: e.via, trust: e.trust, trustLevel: e.trustLevel };   // a directory (dag-pb) → point at it, honestly
        } catch (err) { return { ok: false, kind: "ens", why: String(err && err.message || err).slice(0, 60) }; }
      }
      // data: URI — inline, self-verifying, zero network. Decode → the κ is the hash of its own bytes (L5).
      if (rec && rec.kind === "data") {
        const d = decodeDataURI(name);
        if (!d) return { ok: false, kind: "data", why: "malformed data: URI" };
        const kappa = "sha256:" + (await hashers.sha256(d.bytes));
        bump(kappa, { kind: "data", kappa, bytes: d.bytes });
        return { ok: true, kind: "data", kappa, bytes: d.bytes, source: "inline", mime: d.mime };
      }
      if (rec && (rec.kappa || rec.hex)) {
        const k = warmKeyOf(rec);
        let hit = k && warm.get(k);
        if (!hit && rec.hex && !rec.axis) for (const a of Object.keys(AXES)) { hit = warm.get(a + ":" + rec.hex); if (hit) break; }   // bare hex: any axis
        if (hit) return { ok: true, kind: hit.kind, kappa: hit.kappa, bytes: hit.bytes, source: "warm" };
      }
    }
    let r = await R0.resolve(name, caps);                  // TIER 0: local store (SW/OPFS), 0-egress
    let fromNet = false;
    if (!(r.ok || r.needsIngest || r.kind === "refused" || r.kind === "host-owned" || r.why === "kind-not-admitted")) { r = await R1.resolve(name, caps); fromNet = true; }   // TIER 1: the raced rungs
    if (r.ok && r.kappa && !caps) bump(r.kappa, { kind: r.kind, kappa: r.kappa, bytes: r.bytes });
    // O2 write-back: a verified TIER 1 win enters the device store (fire-and-forget, never on the
    // return path) — the next resolve of this κ is TIER 0, zero egress, radio-independent.
    if (fromNet && r.ok && r.kappa && r.bytes) {
      const parts = String(r.kappa).split(":");
      const hex = parts.pop(), axis = parts.pop() || "sha256";
      rungOf().then((R) => R && R.put(axis, hex, r.bytes)).catch(() => {});
    }
    return r;
  }

  // the surface-facing sugar: one honest sentence for every non-ok outcome (V-MAGIC — never a term to learn)
  async function resolveOrExplain(name, caps = null) {
    const r = await resolve(name, caps);
    if (r.ok) return r;
    r.explain = r.needsIngest
      ? "This names a place, not bytes — opening it goes through its own door (web, chain, or IPFS)."
      : r.kind === "host-owned"
        ? "This belongs to the open web — the browser opens it."
        : r.kind === "refused"
          ? "Refused: " + (r.why || "this name cannot be verified.")
          : "No source could produce bytes that re-derive to this name — nothing unverified is ever shown.";
    return r;
  }

  return { resolve, resolveOrExplain, classify, stats: () => ({ warm: warm.size, store: R0.stats().cached, net: R1.stats().cached }), AXES };
}

export default { makeHostResolver, SMALL };
