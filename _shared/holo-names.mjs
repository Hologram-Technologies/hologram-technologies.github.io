// holo-names.mjs — THE UNIVERSAL NAME PLANE (S1 of HOLO-SEMANTIC-RESOLVER-PROMPT.md).
// One dependency-free, isomorphic module that recognizes EVERY name the internet has and, for
// content-derived names, translates it onto the κ substrate LOSSLESSLY:
//
//   · κ labels on the five upstream σ-axes (holospaces `Axis`, tokens VERBATIM — drift is a gate fail)
//   · did:holo · bare 64-hex · holo:// member URLs · truenames (slug~proquint)
//   · IPFS CIDv1 ⇄ `sha256:` (raw-leaf 1:1; dag-pb honestly notes it commits the DAG ROOT, not file bytes)
//   · Ethereum tx/block hashes → `keccak256:` · addresses recognized (keccak-derived entity, not content)
//   · SRI (`sha256-<b64>`) ⇄ `sha256:` · magnet/btih REFUSED BY NAME (sha1 = weak axis, upstream excludes it)
//   · .onion (a transport rung — the Tor initiative) · *.eth ENS · model tags (org/name:tag)
//
// Laws: L1 (all of these NAME one address space), L2 (translation is canonicalization, never re-hashing),
// L5 (a translated κ is still verified on receipt — classification grants nothing). Two name categories
// only: CONTENT-DERIVED (axis translation, lossless — `kappa` field set) and MUTABLE POINTERS
// (dereferenced at the ingest boundary into signed name-records; `kappa` absent by design).
//
// Layering (do not confuse the two resolvers): holo-resolve.mjs is the INTENT front door (navigation
// lane vs Q-intent lane) and sits ABOVE this module — its navigation detector should consult
// classify() here. holo-dweb.js DELEGATES its universal kinds here (the fork the resolver matrix
// flagged, healed on the OS side). classify() returns null for what the HOST surface owns
// (web / dnslink / app-directory / free-text search), so delegators keep their own fallthrough.

export const VERSION = 1;
// the upstream σ-axis registry — holospaces crates/holospaces/src/realizations.rs `Axis`, tokens verbatim.
export const AXES = Object.freeze({ blake3: 64, sha256: 64, "sha3-256": 64, keccak256: 64, sha512: 128 });
export const WEAK_AXES = Object.freeze(["sha1", "md5"]);   // recognized only to REFUSE by name

// ── tiny pure codecs (no imports — this module stays dependency-free) ─────────────────────────────────
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function b32decode(s) { let bits = 0, val = 0; const out = []; for (const c of s) { const i = B32.indexOf(c); if (i < 0) throw new Error("b32"); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >> (bits - 8)) & 255); bits -= 8; } } return Uint8Array.from(out); }
function b32encode(u8) { let bits = 0, val = 0, out = ""; for (const b of u8) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(val << (5 - bits)) & 31]; return out; }
const hexOf = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h) => Uint8Array.from(h.match(/.{2}/g), (x) => parseInt(x, 16));
const unb64 = (s) => { const bin = globalThis.atob ? atob(s) : Buffer.from(s, "base64").toString("binary"); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };

// ── CID ⇄ κ (the IPFS door of the unification; multihash sha2-256 = the sha256 σ-axis, 1:1) ───────────
export function cidToKappa(cid) {
  const s = String(cid || "").trim();
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(s)) return { cid: s, version: 0, codec: "dag-pb", kappa: null, note: "CIDv0/dag-pb commits the DAG ROOT, not file bytes — resolve via IPFS, verify the DAG" };
  if (!/^b[a-z2-7]{20,}$/.test(s)) throw new Error("not a base32 CIDv1");
  const raw = b32decode(s.slice(1));
  if (raw[0] !== 1) throw new Error("unsupported CID version " + raw[0]);
  const codec = raw[1], hashfn = raw[2], len = raw[3];
  if (hashfn !== 0x12 || len !== 0x20) return { cid: s, version: 1, codec, kappa: null, note: "non-sha2-256 multihash — no direct axis" };
  const digest = hexOf(raw.subarray(4, 4 + 32));
  if (codec === 0x55) return { cid: s, version: 1, codec: "raw", kappa: "sha256:" + digest };             // raw leaf: CID digest IS the byte hash
  return { cid: s, version: 1, codec: codec === 0x70 ? "dag-pb" : "0x" + codec.toString(16), kappa: null, rootDigest: "sha256:" + digest, note: "digest commits the DAG ROOT node, not the file bytes (honesty clause)" };
}
export function kappaToCid(kappa) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(String(kappa || "").trim());
  if (!m) throw new Error("kappaToCid: sha256 axis only");
  return "b" + b32encode(Uint8Array.from([1, 0x55, 0x12, 0x20, ...unhex(m[1].toLowerCase())]));           // CIDv1, raw leaf
}

// ── SRI ⇄ κ ────────────────────────────────────────────────────────────────────────────────────────────
export function sriToKappa(sri) {
  const m = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+=*)$/.exec(String(sri || "").trim());
  if (!m) throw new Error("not an SRI value");
  const hex = hexOf(unb64(m[2]));
  if (m[1] === "sha256") return { kappa: "sha256:" + hex, axis: "sha256" };
  if (m[1] === "sha512") return { kappa: "sha512:" + hex, axis: "sha512" };
  return { kappa: null, axis: m[1], hex, note: "sha384 has no upstream axis — recognized, not translated" };
}

// ── classify — one grammar table for every universal name. Returns null for host-owned fallthrough. ───
const AXIS_LABEL = new RegExp("^(" + Object.keys(AXES).join("|") + "):([0-9a-fA-F]{64,128})$");
const WEAK_LABEL = new RegExp("^(" + WEAK_AXES.join("|") + "):([0-9a-fA-F]{32,40})$", "i");
export function classify(raw) {
  const s = String(raw || "").trim();
  if (!s) return { kind: "empty" };
  let m;
  if ((m = AXIS_LABEL.exec(s))) { const axis = m[1], hex = m[2].toLowerCase(); if (hex.length !== AXES[axis]) return { kind: "refused", target: s, note: "wrong digest length for " + axis }; return { kind: "kappa", target: s, kappa: axis + ":" + hex, axis, hex }; }
  // BitTorrent v2 (btmh) is content-addressed on sha256 — translate it; v1 (btih) is sha1 → refused below.
  if (/^magnet:\?.*xt=urn:btmh:/i.test(s)) { const m = /urn:btmh:1220([0-9a-f]{64})/i.exec(s); if (m) return { kind: "torrent", target: s, kappa: "sha256:" + m[1].toLowerCase(), axis: "sha256", note: "BitTorrent v2 — content-addressed (sha256)" }; return { kind: "torrent", target: s, note: "BitTorrent v2 — non-sha256 multihash" }; }
  if (WEAK_LABEL.test(s) || /^magnet:\?xt=urn:btih:/i.test(s)) return { kind: "refused", target: s, note: "weak axis (sha1/md5 — incl. BitTorrent v1 btih) — upstream excludes it; refused by name, never silently accepted" };
  if (/^did:holo:/i.test(s)) { const p = s.split(":"); const axis = p[2], hex = (p[3] || "").toLowerCase(); return AXES[axis] && hex.length === AXES[axis] ? { kind: "did", target: s, kappa: axis + ":" + hex, axis, hex } : { kind: "did", target: s }; }
  if (/^did:/i.test(s)) return { kind: "did", target: s };
  if (/^[0-9a-fA-F]{64}$/.test(s)) return { kind: "kappa", target: s, axis: null, hex: s.toLowerCase(), note: "bare hex — axis resolved against the store in registry order" };
  if (/^holo:\/\//i.test(s)) return { kind: "holo", target: s };
  if (/^ipns:\/\//i.test(s) || /^\/ipns\//i.test(s)) return { kind: "ipns", target: s };
  if (/^ipfs:\/\//i.test(s) || /^\/ipfs\//i.test(s) || /^(b[a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44})(\/|$)/.test(s)) {
    const head = s.replace(/^ipfs:\/\//i, "").replace(/^\/ipfs\//i, "").split("/")[0];
    try { const t = cidToKappa(head); return { kind: "ipfs", target: s, ...(t.kappa ? { kappa: t.kappa, axis: "sha256" } : { note: t.note }) }; } catch { return null; }
  }
  if (/^(sha256|sha384|sha512)-[A-Za-z0-9+/]{20,}=*$/.test(s)) { try { const t = sriToKappa(s); return { kind: "sri", target: s, ...(t.kappa ? { kappa: t.kappa, axis: t.axis } : { note: t.note }) }; } catch { return null; } }
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return { kind: "eth-tx", target: s, kappa: "keccak256:" + s.slice(2).toLowerCase(), axis: "keccak256" };
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { kind: "eth-address", target: s, note: "keccak-derived account — an entity, not content; resolve via chain name-records" };
  // data: URI — content is INLINE, so it is trivially self-verifying (κ = hash of its own decoded bytes)
  if (/^data:/i.test(s)) return { kind: "data", target: s, note: "inline content — self-verifying (κ is the hash of its own bytes)" };
  // distinctive BARE web3 forms (no scheme prefix): Nostr (bech32) · Lightning · Bitcoin (bech32)
  if (/^(npub|note|nevent|nprofile|naddr|nsec)1[023456789acdefghjklmnpqrstuvwxyz]{20,}$/.test(s)) { const t = s.slice(0, s.indexOf("1")); return { kind: "nostr", target: s, note: t === "npub" || t === "nprofile" ? "a Nostr identity" : t === "nsec" ? "a Nostr secret — never resolved" : "a Nostr event" }; }
  if (/^ln(bc|tb|bcrt)[0-9][a-z0-9]{50,}$/i.test(s)) return { kind: "payment", target: s, note: "a Lightning invoice" };
  if (/^(bc1|tb1)[a-z0-9]{20,}$/i.test(s)) return { kind: "account", target: s, note: "a Bitcoin address" };
  // scheme-prefixed pointers across web2 + web3 — recognized and routed to their own door (mutable names /
  // gateway-served content dereference at the ingest boundary → a signed name-record; L1: location is a hint).
  const scheme = (s.match(/^([a-z][a-z0-9+.-]*):/i) || [])[1];
  const SCHEME = { ar: "arweave", hyper: "p2pweb", dat: "p2pweb", sia: "p2pstore", storj: "p2pstore", ssb: "scuttlebutt", gemini: "altweb", gopher: "altweb", ftp: "web", ftps: "web", sftp: "web", ws: "socket", wss: "socket", mailto: "contact", tel: "contact", sms: "contact", ethereum: "payment", bitcoin: "payment", lightning: "payment", solana: "account", matrix: "chat", xmpp: "chat", at: "atproto", nostr: "nostr", blob: "local", file: "local", ed2k: "p2p", stun: "socket", turn: "socket" };
  if (scheme) { const k = SCHEME[scheme.toLowerCase()]; if (k) return { kind: k, target: s, note: "a " + scheme.toLowerCase() + ": name — dereferenced through its own protocol at the ingest boundary" }; }
  const host = (s.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0] || "").toLowerCase();
  if (host.endsWith(".onion")) return { kind: "onion", target: s, note: "transport rung — content still κ-verified whatever carried it (SEC-7)" };
  if (/\.eth$/i.test(host)) return { kind: "ens", target: s, note: "an Ethereum name (ENS) → on-chain contenthash" };
  if (/\.(crypto|nft|x|wallet|bitcoin|dao|888|blockchain|zil)$/i.test(host)) return { kind: "ens", target: s, note: "a web3 domain (Unstoppable) → on-chain contenthash" };
  if (/^[a-z0-9][a-z0-9-]*~[a-z]{5}(-[a-z]{5})+$/.test(s)) return { kind: "truename", target: s, note: "hint, not proof — resolve re-derives slug + κ prefix (L5)" };
  if (/^[A-Za-z0-9][A-Za-z0-9_-]*\/[A-Za-z0-9._-]+(:[A-Za-z0-9._-]+)?$/.test(s) && !s.split("/")[0].includes(".")) return { kind: "model", target: s, note: "weights pointer — resolves to a κ-manifest name-record" };
  return null;   // http(s) / dnslink / app-directory / free text: the host surface's own business
}

// ── THE ONE VERB — resolve(name, caps) → verified bytes (S1 slice 2) ──────────────────────────────────
// The JS twin of upstream `get_with_fetch`: classify → κ → cache → RACED mirrors → verify-on-receipt.
// Dependency-INJECTED (the house pattern: makeStrand/makeRunAhead) so this module stays pure:
//   fetchFn  — fetch-compatible; returns { ok, arrayBuffer() }.
//   hashers  — { axis: async(bytes)→hex } for the axes this HOST can verify (sha256 via subtle,
//              blake3 via holo-blake3/WGSL). An unverifiable axis is REFUSED, never trusted (L5).
//   mirrors  — [{ name, url({axis,hex})→string|null }] — a mirror may decline an axis (null). The
//              emerging same-origin grammar is `/.holo/<algo>/<hex>` (root-sw); legacy `b/<hex>` fits too.
//   caps     — SEC-2/5 attenuation PER CALL: { kinds:[...]?, transports:[...]? } — a frame that may not
//              perceive a kind or use a transport CANNOT; absent caps = the host's defaults, never escalation.
// Every rung is untrusted plumbing: the race takes the FIRST bytes that RE-DERIVE (SEC-1); losers and
// liars are indistinguishable from silence. Warm hits come from a bounded LRU (SEC-8; the store proper
// — OPFS/SW cache — is the host binding's business and slots in as mirror #0).
export function makeNameResolver({ fetchFn, hashers = {}, mirrors = [], lruSize = 512 } = {}) {
  if (typeof fetchFn !== "function") throw new Error("makeNameResolver needs fetchFn");
  const lru = new Map();   // "axis:hex" → Uint8Array (verified at admission; bounded — SEC-8)
  const remember = (k, bytes) => { if (lru.has(k)) lru.delete(k); lru.set(k, bytes); if (lru.size > lruSize) lru.delete(lru.keys().next().value); };
  const verifyBytes = async (axis, hex, bytes) => { const h = hashers[axis]; if (!h) return { ok: false, why: "unverifiable-axis:" + axis }; return (await h(bytes)) === hex ? { ok: true } : { ok: false, why: "kappa-mismatch" }; };

  async function fetchVerified(axis, hex, admitted, kind = null) {
    const urls = admitted.map((m) => [m.name, m.url({ axis, hex, kind })]).filter(([, u]) => !!u);   // kind lets a mirror decline names it can't serve (e.g. a gateway only serves IPFS)
    if (!urls.length) return { ok: false, why: "no-transport-admitted" };
    return await new Promise((done) => {
      let pending = urls.length; const whys = [];
      for (const [name, url] of urls) (async () => {
        let out = null;
        try {
          const r = await fetchFn(url);
          if (r && r.ok) { const bytes = new Uint8Array(await r.arrayBuffer()); const v = await verifyBytes(axis, hex, bytes); out = v.ok ? { ok: true, bytes, source: name } : { why: name + ":" + v.why }; }
          else out = { why: name + ":http" };
        } catch (e) { out = { why: name + ":" + String(e && e.message || e).slice(0, 30) }; }
        if (out.ok) { if (pending > 0) { pending = 0; done(out); } }                 // first VERIFIED wins
        else { whys.push(out.why); if (--pending === 0) done({ ok: false, why: whys.join(" · ") }); }
      })();
    });
  }

  // resolve(name, caps) → { ok, kind, kappa?, bytes?, source? } | { ok:false, why | needsIngest }
  async function resolve(name, caps = null) {
    const rec = classify(name);
    if (!rec) return { ok: false, kind: "host-owned", why: "web/dnslink/free-text — the host surface routes these" };
    if (rec.kind === "refused" || rec.kind === "empty") return { ok: false, kind: rec.kind, why: rec.note || rec.kind };
    if (caps && Array.isArray(caps.kinds) && !caps.kinds.includes(rec.kind)) return { ok: false, kind: rec.kind, why: "kind-not-admitted" };   // SEC-2/5
    const admitted = caps && Array.isArray(caps.transports) ? mirrors.filter((m) => caps.transports.includes(m.name)) : mirrors;
    const hex = rec.hex || (rec.kappa ? rec.kappa.split(":")[1] : null);   // translated names (CID/SRI/eth) carry κ, not raw hex
    const axes = rec.axis ? [rec.axis] : hex ? Object.keys(AXES).filter((a) => AXES[a] === hex.length) : [];
    if (!axes.length || !hex) return { ok: false, kind: rec.kind, needsIngest: true, why: "mutable pointer — dereference at the ingest boundary (name-records, S3)" };
    for (const axis of axes) { const hit = lru.get(axis + ":" + hex); if (hit) return { ok: true, kind: rec.kind, kappa: axis + ":" + hex, bytes: hit, source: "cache" }; }
    const whys = [];
    for (const axis of axes) {                                        // bare hex tries the registry in axis order
      const r = await fetchVerified(axis, hex, admitted, rec.kind);
      if (r.ok) { remember(axis + ":" + hex, r.bytes); return { ok: true, kind: rec.kind, kappa: axis + ":" + hex, bytes: r.bytes, source: r.source }; }
      whys.push(axis + "(" + r.why + ")");
    }
    return { ok: false, kind: rec.kind, why: whys.join(" · ") };
  }

  return { resolve, classify, stats: () => ({ cached: lru.size }) };
}

export default { VERSION, AXES, WEAK_AXES, classify, cidToKappa, kappaToCid, sriToKappa, makeNameResolver };
