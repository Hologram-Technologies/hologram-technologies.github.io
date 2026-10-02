// holo-pointers.mjs — SELF-AUTHENTICATING pointers (V2). The magic case: a Nostr note. Its id IS a
// sha256 of the note (NIP-01: sha256 of [0,pubkey,created_at,kind,tags,content]), so `note1…`/`nevent1…`
// is just a κ on our sha256 axis — fetch it from ANY untrusted relay and re-derive; a relay that lies is
// refused, not trusted (L5/SEC-1). Dep-free + isomorphic (sha256 + WebSocket INJECTED). IPNS/Bluesky next.

const hx = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");

// ── bech32 (BIP-173) decode — Nostr's NIP-19 names (note/npub/nevent/nprofile) ────────────────────────
const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function bech32Words(str) {
  const s = String(str).toLowerCase(); const pos = s.lastIndexOf("1");
  if (pos < 1) throw new Error("not bech32");
  const vals = [];
  for (const c of s.slice(pos + 1)) { const i = B32.indexOf(c); if (i < 0) throw new Error("bad bech32 char"); vals.push(i); }
  return { hrp: s.slice(0, pos), words: vals.slice(0, -6) };          // drop the 6-word checksum
}
function words5to8(words) {                                           // 5-bit groups → bytes
  let acc = 0, bits = 0; const out = [];
  for (const w of words) { acc = (acc << 5) | w; bits += 5; while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); } }
  return Uint8Array.from(out);
}

// decodeNostr(name) → { type, id? (32-byte hex), pubkey?, relays[], author? }. Never decodes a secret.
export function decodeNostr(name) {
  const { hrp, words } = bech32Words(name);
  const bytes = words5to8(words);
  if (hrp === "note") return { type: "note", id: hx(bytes.slice(0, 32)) };
  if (hrp === "npub") return { type: "npub", pubkey: hx(bytes.slice(0, 32)) };
  if (hrp === "nsec") return { type: "nsec" };                        // a secret is NEVER resolved
  if (hrp === "nevent" || hrp === "nprofile" || hrp === "naddr") {
    const relays = []; let special = null, author = null, i = 0;
    while (i + 2 <= bytes.length) {                                   // TLV: type,len,value…
      const t = bytes[i], l = bytes[i + 1], v = bytes.slice(i + 2, i + 2 + l); i += 2 + l;
      if (t === 0) special = v; else if (t === 1) relays.push(new TextDecoder().decode(v)); else if (t === 2) author = hx(v);
    }
    if (hrp === "nevent") return { type: "nevent", id: special ? hx(special) : null, relays, author };
    if (hrp === "nprofile") return { type: "nprofile", pubkey: special ? hx(special) : null, relays };
    return { type: hrp, relays };
  }
  return { type: hrp };
}

// ── NIP-01 event id = sha256 of the canonical serialization. THIS is the self-authentication. ─────────
export async function nostrEventId(ev, sha256hex) {
  const ser = JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags || [], ev.content || ""]);
  return await sha256hex(new TextEncoder().encode(ser));
}
export async function verifyNostrEvent(ev, sha256hex) {
  if (!ev || typeof ev.id !== "string" || typeof ev.pubkey !== "string" || typeof ev.created_at !== "number") return { ok: false, why: "malformed event" };
  const id = await nostrEventId(ev, sha256hex);
  return id === ev.id.toLowerCase() ? { ok: true, id } : { ok: false, why: "event-id-mismatch", got: id, want: ev.id };
}

// ── fetch from raced UNTRUSTED relays (injected WebSocket); first matching id wins, silence otherwise ──
export const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band", "wss://relay.primal.net"];
export function fetchNostrEvent(id, relays, { WebSocket: WS = null, timeout = 5000 } = {}) {
  const Sock = WS || (typeof WebSocket !== "undefined" ? WebSocket : null);
  if (!Sock) return Promise.resolve(null);
  const urls = relays && relays.length ? relays : DEFAULT_RELAYS;
  return new Promise((resolve) => {
    let done = false, pending = urls.length; const socks = [];
    const finish = (v) => { if (done) return; done = true; for (const w of socks) { try { w.close(); } catch {} } resolve(v); };
    const timer = setTimeout(() => finish(null), timeout);
    for (const url of urls) {
      try {
        const ws = new Sock(url); socks.push(ws); const sub = "h" + id.slice(0, 12);
        ws.onopen = () => { try { ws.send(JSON.stringify(["REQ", sub, { ids: [id] }])); } catch {} };
        ws.onmessage = (m) => { try { const d = JSON.parse(typeof m.data === "string" ? m.data : ""); if (d[0] === "EVENT" && d[2] && String(d[2].id).toLowerCase() === id) { clearTimeout(timer); finish(d[2]); } } catch {} };
        ws.onerror = () => { if (--pending <= 0) { clearTimeout(timer); finish(null); } };
      } catch { if (--pending <= 0) { clearTimeout(timer); finish(null); } }
    }
  });
}

// resolveNostr(name, {sha256hex, WebSocket, timeout}) → the verified note as a κ object, or an honest refusal.
export async function resolveNostr(name, { sha256hex, WebSocket = null, timeout } = {}) {
  const d = decodeNostr(name);
  if (d.type === "nsec") return { ok: false, why: "a Nostr secret is never resolved" };
  if (!d.id) return { ok: false, why: d.pubkey ? "a Nostr identity — resolve its notes, not the key" : "unsupported Nostr name" };
  const ev = await fetchNostrEvent(d.id, d.relays, { WebSocket, timeout });
  if (!ev) return { ok: false, why: "no relay produced this note" };
  const v = await verifyNostrEvent(ev, sha256hex);
  if (!v.ok) return { ok: false, why: "a relay served a note that does not match its id (" + v.why + ") — refused" };
  return {
    ok: true, kappa: "sha256:" + d.id, bytes: new TextEncoder().encode(ev.content || ""), event: ev,
    via: "nostr-relay", author: ev.pubkey, trustLevel: "self",
    trust: "self-verifying — the note's id is a sha256 of the note itself (NIP-01); no relay was trusted",
  };
}

// ── Bluesky / atproto (V2 · resolved pointer) — at://<did|handle>/<collection>/<rkey>. handle→DID (DoH /
//    well-known) → DID doc (plc.directory / did:web) → the account's OWN PDS → the record. B-via: anchored
//    by the DID (the stable, self-owned identity); the PDS is the account's, not ours. ────────────────────
async function resolveHandle(handle, fetchFn) {
  // both legs raced with deadlines: well-known (HTTP, what bsky uses) + DoH _atproto TXT — first DID wins.
  const wk = (async () => { try { const r = await fetchFn("https://" + handle + "/.well-known/atproto-did", TMO(6000)); if (r && r.ok) { const t = (await r.text()).trim(); if (/^did:/.test(t)) return t; } } catch {} return null; })();
  const doh = (async () => { try { const r = await fetchFn("https://dns.google/resolve?name=_atproto." + handle + "&type=TXT", TMO(6000, { headers: { accept: "application/dns-json" } })); if (r && r.ok) { const j = await r.json(); for (const a of (j.Answer || [])) { const m = /did=(did:[a-z0-9:._%-]+)/i.exec(a.data || ""); if (m) return m[1]; } } } catch {} return null; })();
  const [a, b] = await Promise.all([wk, doh]); return a || b;
}
async function resolveDID(did, fetchFn) {
  try {
    if (/^did:plc:/i.test(did)) { const r = await fetchFn("https://plc.directory/" + did, TMO(6000)); if (r && r.ok) return await r.json(); }
    else if (/^did:web:/i.test(did)) { const host = did.slice(8).replace(/:/g, "/"); const r = await fetchFn("https://" + host + "/.well-known/did.json", TMO(6000)); if (r && r.ok) return await r.json(); }
  } catch {}
  return null;
}
export async function resolveBluesky(name, { fetchFn } = {}) {
  const s = String(name).replace(/^at:\/\//i, "").replace(/^\/+/, "");
  const [authority, collection, rkey] = s.split("/");
  if (!authority) return { ok: false, why: "empty at:// name" };
  let did = authority, handle = /^did:/i.test(authority) ? null : authority;
  if (handle) { did = await resolveHandle(handle, fetchFn); if (!did) return { ok: false, why: "could not resolve the handle " + authority + " to a DID" }; }
  const doc = await resolveDID(did, fetchFn);
  if (!doc) return { ok: false, why: "could not resolve the DID document for " + did };
  const pds = (doc.service || []).find((x) => /atproto_pds/i.test(x.id || "") || /PersonalDataServer/i.test(x.type || ""));
  const alsoHandle = (doc.alsoKnownAs || []).map((a) => a.replace(/^at:\/\//, ""))[0] || handle;
  if (collection && rkey) {
    if (!pds) return { ok: false, why: "the DID document names no PDS to fetch the record from" };
    const host = (() => { try { return new URL(pds.serviceEndpoint).host; } catch { return "the PDS"; } })();
    const r = await fetchFn(pds.serviceEndpoint + "/xrpc/com.atproto.repo.getRecord?repo=" + encodeURIComponent(did) + "&collection=" + encodeURIComponent(collection) + "&rkey=" + encodeURIComponent(rkey), TMO(8000));
    if (!r || !r.ok) return { ok: false, why: "the account's PDS (" + host + ") did not return this record" };
    const rec = await r.json();
    return { ok: true, kind: "atproto", bytes: new TextEncoder().encode(JSON.stringify(rec.value, null, 2)), cid: rec.cid, author: alsoHandle || did, via: "PDS " + host, trustLevel: "via",
      trust: "resolved via the account's OWN PDS (" + host + "), located through its DID (" + did.slice(0, 28) + "…); the DID anchors which server speaks for this identity" };
  }
  return { ok: true, kind: "atproto", bytes: new TextEncoder().encode(JSON.stringify({ did, handle: alsoHandle, pds: pds && pds.serviceEndpoint }, null, 2)), author: alsoHandle || did, via: did.startsWith("did:plc") ? "plc.directory" : "did:web", trustLevel: "via",
    trust: "identity resolved via its DID document; the DID is the stable, self-owned anchor for this account" };
}

// ── ENS (V3 · resolved pointer) — namehash (keccak256, LOCAL) → contenthash via an UNTRUSTED RPC → a CID
//    the content then self-verifies against (Mode A). Trust is SPLIT and shown: the name→content step
//    trusts the RPC (named in the card); the content step trusts nothing. keccak256 lazy-loaded. ────────
const ENS_REGISTRY = "0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e";
const B32L = "abcdefghijklmnopqrstuvwxyz234567";
const b32 = (u8) => { let bits = 0, val = 0, out = ""; for (const b of u8) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32L[(val >> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32L[(val << (5 - bits)) & 31]; return out; };

export function namehash(name, keccak256) {                          // EIP-137
  let node = new Uint8Array(32);
  if (name) { const labels = name.toLowerCase().split("."); for (let i = labels.length - 1; i >= 0; i--) { const lh = keccak256(new TextEncoder().encode(labels[i])); const cat = new Uint8Array(64); cat.set(node); cat.set(lh, 32); node = keccak256(cat); } }
  return node;
}
export function decodeContenthash(hex) {                             // EIP-1577
  const h = String(hex).replace(/^0x/, "").toLowerCase(); if (!h) return null;
  const b = h.match(/.{2}/g).map((x) => parseInt(x, 16));
  if (b[0] === 0xe3) return { proto: "ipfs", cid: "b" + b32(Uint8Array.from(b.slice(2))) };   // ipfs-ns → CIDv1
  if (b[0] === 0xe5) return { proto: "ipns", cid: "b" + b32(Uint8Array.from(b.slice(2))) };   // ipns-ns
  return { proto: "0x" + (b[0] || 0).toString(16), raw: h };
}
export async function resolveENS(name, { fetchFn, rpcs } = {}) {
  const { keccak256 } = await import("./holo-keccak.mjs");
  const RPCS = rpcs || ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com", "https://cloudflare-eth.com"];
  const node = "0x" + hx(namehash(name, keccak256));
  const call = async (to, data) => {
    for (const rpc of RPCS) { try {
      const r = await fetchFn(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }) });
      if (r && r.ok) { const j = await r.json(); if (j && j.result && j.result !== "0x") return { result: j.result, via: rpc }; }
    } catch {} }
    return null;
  };
  const rslv = await call(ENS_REGISTRY, "0x0178b8bf" + node.slice(2));                        // resolver(bytes32)
  if (!rslv) return { ok: false, why: "no Ethereum RPC answered for this name" };
  const resolver = "0x" + rslv.result.slice(26);
  if (/^0x0+$/.test(resolver)) return { ok: false, why: "this name has no resolver set" };
  const ch = await call(resolver, "0xbc1c58d1" + node.slice(2));                              // contenthash(bytes32)
  if (!ch) return { ok: false, why: "the resolver returned no contenthash (maybe only an address)" };
  const raw = ch.result.replace(/^0x/, ""); const len = parseInt(raw.slice(64, 128) || "0", 16); const data = raw.slice(128, 128 + len * 2);
  if (!data) return { ok: false, why: "this name points to no content (no contenthash record)" };
  const dec = decodeContenthash(data);
  if (!dec || !dec.cid) return { ok: false, why: "unsupported contenthash protocol" };
  const host = (() => { try { return new URL(ch.via).host; } catch { return "an RPC"; } })();
  return { ok: true, name, node, resolver, cid: dec.cid, proto: dec.proto, pointsTo: dec.proto + "://" + dec.cid, via: "ethereum RPC (" + host + ")", trustLevel: "via",
    trust: "name → content resolved via an UNTRUSTED Ethereum RPC (" + host + "); the content then verifies by its " + dec.proto.toUpperCase() + " address — nothing about the bytes is trusted" };
}

// ── IPNS (V2 · SELF-authenticating pointer) — an IPNS name IS an ed25519 public key; the record is
//    signed by it. So `ipns://…` proves itself by signature (zero trust), then chains into Mode A. ─────
function base36(str) {                                               // multibase 'k'
  const A = "0123456789abcdefghijklmnopqrstuvwxyz"; const bytes = [];
  for (const ch of str.toLowerCase()) { let carry = A.indexOf(ch); if (carry < 0) throw new Error("bad base36"); for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 36; bytes[j] = carry & 0xff; carry >>= 8; } while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; } }
  return Uint8Array.from(bytes.reverse());
}
function base32(str) {                                               // multibase 'b'
  let bits = 0, val = 0; const out = [];
  for (const c of str.toLowerCase()) { const i = B32L.indexOf(c); if (i < 0) throw new Error("bad base32"); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >> (bits - 8)) & 0xff); bits -= 8; } }
  return Uint8Array.from(out);
}
// an ed25519 IPNS name → its 32-byte public key. CIDv1 libp2p-key: 01 72 <mh 00 <len> <PublicKey pb>>,
// PublicKey = 08 01 (Ed25519) 12 20 <32-byte key>. Only ed25519 (the common k51… form) is supported.
export function decodeIPNSName(name) {
  const s = String(name).replace(/^ipns:\/\//i, "").replace(/^\/ipns\//i, "").split(/[/?#]/)[0];
  const bytes = s[0] === "k" ? base36(s.slice(1)) : s[0] === "b" ? base32(s.slice(1)) : (() => { throw new Error("unknown multibase"); })();
  if (bytes[0] !== 0x01 || bytes[1] !== 0x72) throw new Error("not a libp2p-key CID");
  if (bytes[2] !== 0x00) throw new Error("non-identity multihash (unsupported key type)");
  const digest = bytes.slice(4);                                     // skip 00 <len>
  if (digest.length < 32) throw new Error("short key"); return digest.slice(digest.length - 32);
}
function pbScan(bytes) {                                             // minimal protobuf: pull the length-delimited fields we need
  const out = {}; let i = 0;
  const varint = () => { let x = 0, s = 0; for (; ;) { const c = bytes[i++]; x += (c & 0x7f) * Math.pow(2, s); if (!(c & 0x80)) break; s += 7; } return x; };
  while (i < bytes.length) { const tag = varint(), field = tag >> 3, wire = tag & 7;
    if (wire === 2) { const len = varint(); const v = bytes.slice(i, i + len); i += len; if (field === 1) out.value = v; else if (field === 8) out.sig = v; else if (field === 9) out.data = v; else if (field === 7) out.pubkey = v; }
    else if (wire === 0) { varint(); } else if (wire === 5) { i += 4; } else if (wire === 1) { i += 8; } else break; }
  return out;
}
export async function verifyIPNS(rec, pubkey) {
  if (!rec.sig || !rec.data) return { ok: false, why: "record missing signatureV2 or data" };
  const prefix = new TextEncoder().encode("ipns-signature:");
  const msg = new Uint8Array(prefix.length + rec.data.length); msg.set(prefix); msg.set(rec.data, prefix.length);
  try { const key = await crypto.subtle.importKey("raw", pubkey, { name: "Ed25519" }, false, ["verify"]); return (await crypto.subtle.verify("Ed25519", key, rec.sig, msg)) ? { ok: true } : { ok: false, why: "ed25519-verify-failed" }; }
  catch (e) { return { ok: false, why: "ed25519:" + String(e && e.message || e).slice(0, 24) }; }
}
// DNSLink (domain-style IPNS) → CID via DoH. dns.google exposes CORS (cloudflare-dns preflight-blocks in
// the browser), so it leads. B-via: the DoH resolver is trusted for name→CID; the content then re-verifies.
// a hanging leg must never wedge the card — every pointer HTTP fetch gets a hard deadline, failing fast
// to the next source (fail-soft, SEC-8 in spirit). AbortSignal.timeout where available, else a no-op.
const TMO = (ms, o = {}) => { try { return { ...o, signal: AbortSignal.timeout(ms) }; } catch { return o; } };

async function resolveDNSLink(domain, fetchFn) {
  const scan = (j) => { for (const a of (j && j.Answer || [])) { const m = /dnslink=(\/ip[fn]s\/[^"\\]+)/.exec(a.data || ""); if (m) return m[1]; } return null; };
  try { const r = await fetchFn("https://dns.google/resolve?name=_dnslink." + domain + "&type=TXT", TMO(6000, { headers: { accept: "application/dns-json" } })); if (r && r.ok) { const l = scan(await r.json()); if (l) return { link: l, via: "dns.google" }; } } catch {}
  try { const r = await fetchFn("https://cloudflare-dns.com/dns-query?name=_dnslink." + domain + "&type=TXT", TMO(6000, { headers: { accept: "application/dns-json" } })); if (r && r.ok) { const l = scan(await r.json()); if (l) return { link: l, via: "cloudflare-dns" }; } } catch {}
  return null;
}
export async function resolveIPNS(name, { fetchFn, gateways } = {}) {
  const clean = String(name).replace(/^ipns:\/\//i, "").replace(/^\/ipns\//i, "").split(/[/?#]/)[0];
  let pubkey = null; try { pubkey = decodeIPNSName(clean); } catch {}
  if (pubkey) {                                                      // key-based IPNS — self-authenticating (ed25519)
    const GW = gateways || ["https://trustless-gateway.link", "https://dweb.link", "https://ipfs.io"];
    let rec = null;
    for (const g of GW) { try { const r = await fetchFn(g + "/ipns/" + clean + "?format=ipns-record", { headers: { accept: "application/vnd.ipfs.ipns-record" } }); if (r && r.ok) { const p = pbScan(new Uint8Array(await r.arrayBuffer())); if (p.sig && p.data && p.value) { rec = p; break; } } } catch {} }
    if (!rec) return { ok: false, why: "no gateway served the signed IPNS record (public gateways block the record fetch by CORS today)" };
    const v = await verifyIPNS(rec, pubkey);
    if (!v.ok) return { ok: false, why: "the IPNS record's signature did not verify (" + v.why + ") — refused" };
    const val = new TextDecoder().decode(rec.value); const m = /\/ipfs\/([A-Za-z0-9]+)/.exec(val);
    if (!m) return { ok: false, why: "the signed IPNS record carries no /ipfs/ value" };
    return { ok: true, cid: m[1], pointsTo: "ipfs://" + m[1], via: "ipns record (ed25519)", trustLevel: "self", trust: "self-verifying — the IPNS record is signed by the ed25519 key the name IS; no gateway was trusted" };
  }
  if (/\./.test(clean)) {                                            // domain-style IPNS → DNSLink via DoH (B-via)
    const d = await resolveDNSLink(clean, fetchFn);
    if (!d) return { ok: false, why: "no DNSLink TXT record found for " + clean };
    const m = /^\/ipfs\/([A-Za-z0-9]+)/.exec(d.link);
    if (m) return { ok: true, cid: m[1], pointsTo: "ipfs://" + m[1], via: "DNSLink via DoH (" + d.via + ")", trustLevel: "via", trust: "name → CID resolved via an untrusted DoH resolver (" + d.via + "); the content then verifies by its IPFS address" };
    return { ok: true, pointsTo: "ipns://" + d.link.replace(/^\/ipns\//, ""), via: "DNSLink via DoH (" + d.via + ")", trustLevel: "via", trust: "DNSLink points at another IPNS name (" + d.via + ")" };
  }
  return { ok: false, why: "unsupported IPNS name (not an ed25519 key or a DNSLink domain)" };
}

export default { decodeNostr, nostrEventId, verifyNostrEvent, fetchNostrEvent, resolveNostr, DEFAULT_RELAYS, namehash, decodeContenthash, resolveENS, decodeIPNSName, verifyIPNS, resolveIPNS, resolveBluesky };
