// holo-rendezvous.mjs — TWO DEVICES THAT HOLD THE SAME κ FIND EACH OTHER, WITH NO SERVER.
// CANONICAL HOME: holo-os/system/os/usr/lib/holo/ (T1, L4 — ONE module). The browser closure receives a
// byte-identical assembly copy at apps/browser/_shared/ — never hand-fork; edit HERE, re-copy there.
// R1+R2 (proven live over public relays) + T2: the sealed offer may carry the sharer's SIGNED share token
// (holo-teleport, SEC-4) and the answerer verifies WHO shared before any channel is created — possession
// of the link (SEC-5 seal) stops being enough to impersonate a sharer. This "first hello" lights up the
// browser's device-mesh exit peer AND teleport/dial cross-device — a phone on cellular pairs to a desktop
// at home with one tap, no IP, no LAN, no operator signaling server.
//
// THE LAWS, made concrete:
//   L1/L2/SEC-5 — the meeting point is DERIVED, not assigned: coordinate(pairκ) = blake3(pairκ ‖ "holo-rdv/v1").
//                 Both link-holders converge on the same address; an outsider cannot compute it. The κ IS the room.
//   SEC-7       — the mailbox (public Nostr relays) is CONTENT-BLIND transport: it shuttles an opaque sealed blob
//                 at a coordinate it cannot invert, on an EPHEMERAL kind it does not persist, raced over several
//                 relays so no single one matters. It never sees the SDP, the pairκ, or who is talking.
//   SEC-5/4     — the blob is AES-GCM sealed under a key HKDF-derived from pairκ. Only a link-holder can decrypt
//                 (capability). A blob that fails the GCM tag is REFUSED before any channel opens (provenance).
//   L5          — UNTOUCHED and untrusted: once the RTCDataChannel opens, holo-peer-egress runs its framed fetch
//                 and browser-sw mints + re-derives every byte the peer carries. A hostile relay or a substituted
//                 peer cannot forge content — worst case is a stall, and the egress ladder falls past it. The
//                 relay's honesty is therefore IRRELEVANT TO CORRECTNESS. That is the definition of laws-compliant.
//
// SHAPE (the milestone's public surface):
//   coordinate(pairKappa)                              → hex tag
//   makeNostrMailbox({ relays })                       → { put(coord, blob, ttlSec), get(coord, sinceSec) → blob[], close }
//   makeMemoryMailbox()                                → same interface, in-process (the pure witness backend)
//   offerSide({ pairKappa, mailbox, onChannel })       → A: seal offer → PUT → poll answer → accept → channel
//   answerSide({ pairKappa, mailbox, onChannel })      → B: GET offer → unseal(refuse bad) → answer → PUT → channel
//
// Isomorphic: browser (RTCPeerConnection, WebSocket, crypto.subtle) + Node witness (WebCrypto global; the RTC
// halves are touched only at call time, exactly like holo-webrtc-link.mjs, so the pure parts witness in Node).

import { blake3, toHex, toBytes, fromHex, concat } from "./holo-ipfs.js";
// webrtc-link loads LAZILY and location-agnostically, so this ONE file runs byte-identical from
// usr/lib/holo (link lives in ../../../sbin), from the browser closure's _shared (link is a sibling
// copy), and under Node from the OS root. RTC is touched only at call time, as before.
let _link = null;
const loadLink = () => (_link ||= import("./holo-webrtc-link.mjs").catch(() => import("../../../sbin/holo-webrtc-link.mjs")));

const SUBTLE = (globalThis.crypto && globalThis.crypto.subtle) || null;
const RDV_TAG = "holo-rdv/v1";
const KIND = 20001;                       // Nostr ephemeral event kind (NIP-16 range 20000..29999 — relays don't persist)
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band",
  "wss://relay.snort.social", "wss://nostr.wine",
];

// ── coordinate — the derived meeting point (L2/SEC-5). One-way: outsiders can't invert it to pairκ. ──
export function coordinate(pairKappa) {
  return toHex(blake3(concat(toBytes(String(pairKappa)), toBytes(":" + RDV_TAG))));
}

// ── seal / unseal — AES-GCM under a key HKDF'd from pairκ (SEC-7 content-blind, SEC-5 capability, SEC-4
// provenance-by-authenticated-decryption). WebCrypto only; no hand-rolled symmetric crypto. Sealed blob is
// base64(iv12 ‖ ciphertext‖tag) — what the mailbox carries, and all it ever sees. ────────────────────────
async function keyFromPair(pairKappa) {
  const ikm = await SUBTLE.importKey("raw", toBytes(String(pairKappa)), "HKDF", false, ["deriveKey"]);
  return SUBTLE.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: toBytes(RDV_TAG), info: toBytes("seal") },
    ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function seal(pairKappa, obj) {
  const key = await keyFromPair(pairKappa);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const pt = toBytes(JSON.stringify(obj));
  const ct = new Uint8Array(await SUBTLE.encrypt({ name: "AES-GCM", iv }, key, pt));
  return b64.enc(concat(iv, ct));
}
// returns the parsed object, or null when the blob was not produced by a pairκ holder (GCM tag fails) —
// a wrong/forged/relay-swapped blob is REFUSED here, before a channel is ever created (SEC-4).
async function unseal(pairKappa, blob) {
  try {
    const raw = b64.dec(blob); if (raw.length < 13) return null;
    const key = await keyFromPair(pairKappa);
    const pt = await SUBTLE.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, key, raw.subarray(12));
    return JSON.parse(new TextDecoder().decode(new Uint8Array(pt)));
  } catch { return null; }
}

const b64 = {
  enc: (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },
  dec: (b) => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; },
};

// ── mint a fresh pairing κ (the invite; SEC-5 capability). 128 bits of entropy → a κ. ────────────────
export function mintPairKappa() {
  return toHex(blake3(globalThis.crypto.getRandomValues(new Uint8Array(32))));
}
// short human-groupable code ⇄ pairκ. The code IS the pairκ (hex), grouped for reading/typing. A QR
// carries the whole link; this is the fallback a human can read aloud. First 20 hex = 80 bits, ample here.
export function codeFromPair(pairKappa) { const h = String(pairKappa).slice(0, 20); return h.match(/.{1,5}/g).join("-"); }
export function pairFromCode(code) { return String(code).replace(/[^0-9a-f]/gi, "").toLowerCase(); }

// ── in-memory mailbox — the pure, network-free backend for the Node/browser-local witness. Same interface
// as the Nostr backend, so the handshake state machine is exercised identically without a relay. ─────────
export function makeMemoryMailbox() {
  const box = new Map();   // coord → [{ blob, ts }]
  return {
    async put(coord, blob) { if (!box.has(coord)) box.set(coord, []); box.get(coord).push({ blob, ts: Date.now() }); },
    async get(coord) { return (box.get(coord) || []).map((e) => e.blob); },
    close() { box.clear(); },
  };
}

// ── Nostr mailbox — the first real backend (SEC-7). A coordinate becomes a "#t" topic tag on an EPHEMERAL
// event; the sealed blob is the content; relays are raced so any one suffices. Events are signed by a
// THROWAWAY key minted per mailbox — the signature only satisfies relay acceptance, it is NOT a trust root
// (the trust is the pairκ seal + L5). Uses BIP-340 Schnorr (holoSchnorr below), pure-JS + witnessed. ─────
export async function makeNostrMailbox({ relays = DEFAULT_RELAYS, WebSocketImpl = globalThis.WebSocket } = {}) {
  const sk = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const pk = holoSchnorr.getPublicKey(sk);                 // 32-byte x-only pubkey (hex)
  const socks = [];
  for (const url of relays) {
    try { const ws = new WebSocketImpl(url); ws.binaryType = "arraybuffer"; socks.push({ url, ws, open: false, subs: new Map() }); } catch {}
  }
  await Promise.all(socks.map((s) => new Promise((res) => {
    let done = false; const fin = (ok) => { if (done) return; done = true; s.open = ok; res(); };
    try { s.ws.addEventListener("open", () => fin(true)); s.ws.addEventListener("error", () => fin(false)); s.ws.addEventListener("close", () => { s.open = false; }); }
    catch { fin(false); }
    setTimeout(() => fin(false), 4000);
  })));
  const live = () => socks.filter((s) => s.open && s.ws.readyState === 1);

  async function put(coord, blob, ttlSec = 180) {
    const nowSec = Math.floor(Date.now() / 1000);
    const ev = await holoSchnorr.finalizeEvent({ kind: KIND, created_at: nowSec, tags: [["t", coord], ["expiration", String(nowSec + ttlSec)]], content: blob }, sk, pk);
    const msg = JSON.stringify(["EVENT", ev]);
    let sent = 0; for (const s of live()) { try { s.ws.send(msg); sent++; } catch {} }
    return sent;                                            // 0 → no relay carried it (honest; caller may fall back)
  }
  // get() opens a short subscription per relay filtered by the coordinate topic and collects contents seen.
  function get(coord, sinceSec, onData) {
    const since = sinceSec || Math.floor(Date.now() / 1000) - 300;
    const subId = "rdv-" + coord.slice(0, 12) + "-" + (msgCtr++);
    const filter = { kinds: [KIND], "#t": [coord], since };
    const seen = new Set(), out = [];
    for (const s of live()) {
      try {
        s.ws.send(JSON.stringify(["REQ", subId, filter]));
        const on = (e) => {
          try { const m = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data));
            if (m[0] === "EVENT" && m[1] === subId && m[2] && !seen.has(m[2].id)) { seen.add(m[2].id); out.push(m[2].content); if (onData) { try { onData(m[2].content); } catch {} } } } catch {}   // onData = event-driven push (low-latency): drain on arrival, not on a poll
        };
        s.ws.addEventListener("message", on); s.subs.set(subId, () => { try { s.ws.send(JSON.stringify(["CLOSE", subId])); s.ws.removeEventListener("message", on); } catch {} });
      } catch {}
    }
    return {
      collected: out,                                       // live-growing array the poller reads
      close() { for (const s of live()) { const c = s.subs.get(subId); if (c) { c(); s.subs.delete(subId); } } },
    };
  }
  return {
    put,
    async get(coord, sinceSec) { const sub = get(coord, sinceSec); return { ...sub }; },  // returns { collected, close }
    liveGet: get,
    relayCount: () => live().length,
    close() { for (const s of socks) { try { s.ws.close(); } catch {} } },
  };
}
let msgCtr = 0;

// ── the handshake — offerSide / answerSide over holo-webrtc-link (non-trickle, one blob each way) ────────
// Both take a mailbox with put(coord, blob) and either get(coord)→{collected,close} (Nostr) or get→blob[]
// (memory). pollGet normalizes the two shapes and waits for a matching sealed blob of the wanted role.
async function pollGet(mailbox, coord, pairKappa, wantRole, { timeoutMs = 30000, intervalMs = 1200, accept = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  let sub = null, staticList = null;
  const g = await mailbox.get(coord);
  if (g && Array.isArray(g.collected)) sub = g; else staticList = Array.isArray(g) ? g : [];
  try {
    while (Date.now() < deadline) {
      const list = sub ? sub.collected.slice() : (Array.isArray(staticList) ? (await mailbox.get(coord)) : []);
      for (const blob of list) {
        const obj = await unseal(pairKappa, blob);          // refuses non-holder blobs (seal capability) silently
        if (obj && obj.role === wantRole && obj.sdp && (!accept || (await accept(obj)))) return obj;   // accept may be async (T2 token verify)
      }
      await sleep(intervalMs);
    }
  } finally { if (sub && sub.close) sub.close(); }
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// an answer names the offer it answers (`for` = blake3 tag of the offer SDP), so a SECOND opener on the
// same pairκ never adopts a retained stale answer meant for the first — serve-many is race-free.
const sdpTag = (sdp) => toHex(blake3(toBytes(String(sdp)))).slice(0, 16);

// A (requester / browsing device): make offer → PUT → wait for the answer → accept → channel opens.
// T2: `token` (a SIGNED holo-teleport share token, or any signed provenance object) rides INSIDE the
// sealed offer — the mailbox never sees it (SEC-7); the answerer may demand it (verifyToken below).
export async function offerSide({ pairKappa, mailbox, onChannel, timeoutMs = 30000, iceServers, token = null, link = null } = {}) {
  const coord = coordinate(pairKappa);
  let channel = null;
  const { createOfferer } = link || await loadLink();   // `link` injectable → the FULL handshake is Node-provable (real RTC gated in the browser witness)
  const offerer = await createOfferer({ onChannel: (dc) => { channel = dc; onChannel && onChannel(dc); }, iceServers });
  await mailbox.put(coord, await seal(pairKappa, { role: "offer", sdp: offerer.offer, ts: Date.now(), ...(token ? { token } : {}) }), Math.ceil(timeoutMs / 1000) + 30);
  const mine = sdpTag(offerer.offer);
  const ans = await pollGet(mailbox, coord, pairKappa, "answer", { timeoutMs, accept: (o) => o.for === mine });
  if (!ans) { offerer.close(); throw new Error("rendezvous: no answer within " + timeoutMs + "ms (is the other device armed on this pairing?)"); }
  await offerer.accept(ans.sdp);
  return { coord, close: () => offerer.close(), channel: () => channel, pc: offerer.pc };
}

// B (answerer / exit device): wait for an offer → verify(unseal) → make answer → PUT → channel opens.
// Re-arm the caller re-invokes; each completed handshake yields one channel (one served viewer).
// T2 (SEC-4): pass `verifyToken: async (token) → boolean` to demand WHO shared, not just link-possession —
// an offer whose token is absent, tampered, or wrong-signer is REFUSED here, before createAnswerer ever
// runs. Composes with `accept` (the served-offer dedup predicate); both must pass. Omit → R1 behaviour.
export async function answerSide({ pairKappa, mailbox, onChannel, timeoutMs = 60000, iceServers, accept = null, verifyToken = null, link = null } = {}) {
  const coord = coordinate(pairKappa);
  const gate = !verifyToken ? accept : async (obj) => {
    if (accept && !(await accept(obj))) return false;
    try { return !!(await verifyToken(obj.token || null)); } catch { return false; }   // fail-closed (SEC-4)
  };
  const off = await pollGet(mailbox, coord, pairKappa, "offer", { timeoutMs, accept: gate });
  if (!off) throw new Error("rendezvous: no offer within " + timeoutMs + "ms");
  let channel = null;
  const { createAnswerer } = link || await loadLink();
  const answerer = await createAnswerer(off.sdp, { onChannel: (dc) => { channel = dc; onChannel && onChannel(dc); }, iceServers });
  await mailbox.put(coord, await seal(pairKappa, { role: "answer", sdp: answerer.answer, ts: Date.now(), for: sdpTag(off.sdp) }), Math.ceil(timeoutMs / 1000) + 30);
  return { coord, close: () => answerer.close(), channel: () => channel, pc: answerer.pc };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════
// holoSchnorr — BIP-340 Schnorr over secp256k1, pure JS, for Nostr event signing ONLY (relay acceptance).
// Witnessed against the official BIP-340 test vectors (rendezvous.witness.mjs). Not a trust root here: per
// SEC-7 the relay/signature honesty is irrelevant — the pairκ AES-GCM seal + L5 carry all correctness.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════
export const holoSchnorr = (() => {
  const P = 2n ** 256n - 2n ** 32n - 977n;                 // secp256k1 field prime
  const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;  // curve order
  const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
  const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
  const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
  const pow = (b, e, m) => { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = mod(r * b, m); b = mod(b * b, m); e >>= 1n; } return r; };
  const inv = (a, m) => pow(a, m - 2n, m);
  // Jacobian point add/double on secp256k1 (a=0). Point = [X,Y,Z]; identity Z=0.
  const jDouble = ([X, Y, Z]) => {
    if (Z === 0n) return [0n, 0n, 0n];
    const A = mod(X * X), B = mod(Y * Y), C = mod(B * B);
    let D = mod(2n * (mod((X + B) ** 2n) - A - C)); const E = mod(3n * A), F = mod(E * E);
    const X3 = mod(F - 2n * D), Y3 = mod(E * (D - X3) - 8n * C), Z3 = mod(2n * Y * Z);
    return [X3, Y3, Z3];
  };
  const jAdd = (p, q) => {
    if (p[2] === 0n) return q; if (q[2] === 0n) return p;
    const [X1, Y1, Z1] = p, [X2, Y2, Z2] = q;
    const Z1Z1 = mod(Z1 * Z1), Z2Z2 = mod(Z2 * Z2);
    const U1 = mod(X1 * Z2Z2), U2 = mod(X2 * Z1Z1);
    const S1 = mod(Y1 * Z2 * Z2Z2), S2 = mod(Y2 * Z1 * Z1Z1);
    if (U1 === U2) { if (S1 !== S2) return [0n, 0n, 0n]; return jDouble(p); }
    const H = mod(U2 - U1), I = mod((2n * H) ** 2n), J = mod(H * I);
    const r = mod(2n * (S2 - S1)), V = mod(U1 * I);
    const X3 = mod(r * r - J - 2n * V), Y3 = mod(r * (V - X3) - 2n * S1 * J), Z3 = mod(((Z1 + Z2) ** 2n - Z1Z1 - Z2Z2) * H);
    return [X3, Y3, Z3];
  };
  const jMul = (k, p) => { let r = [0n, 0n, 0n], a = p; while (k > 0n) { if (k & 1n) r = jAdd(r, a); a = jDouble(a); k >>= 1n; } return r; };
  const toAffine = ([X, Y, Z]) => { if (Z === 0n) return null; const zi = inv(Z, P), zi2 = mod(zi * zi); return [mod(X * zi2), mod(Y * zi2 * zi)]; };
  const G = [Gx, Gy, 1n];
  const bytesToBig = (b) => BigInt("0x" + toHex(b));
  const bigTo32 = (n) => fromHex(n.toString(16).padStart(64, "0"));
  const taggedHash = async (tag, msg) => {
    const th = new Uint8Array(await SUBTLE.digest("SHA-256", toBytes(tag)));
    return new Uint8Array(await SUBTLE.digest("SHA-256", concat(th, th, msg)));
  };
  const liftX = (x) => {
    if (x >= P) return null;
    const c = mod(x ** 3n + 7n); let y = pow(c, (P + 1n) / 4n, P);
    if (mod(y * y) !== c) return null;
    return (y & 1n) === 0n ? y : P - y;
  };
  function getPublicKey(sk) {
    const d0 = bytesToBig(sk instanceof Uint8Array ? sk : fromHex(sk));
    const Paff = toAffine(jMul(d0, G));
    return toHex(bigTo32(Paff[0]));                         // x-only, hex
  }
  async function sign(msg32, sk, auxRand) {
    const skb = sk instanceof Uint8Array ? sk : fromHex(sk);
    const m = msg32 instanceof Uint8Array ? msg32 : fromHex(msg32);
    let d0 = bytesToBig(skb); if (d0 <= 0n || d0 >= N) throw new Error("bad sk");
    const Paff = toAffine(jMul(d0, G)); const Px = Paff[0], Py = Paff[1];
    const d = (Py & 1n) === 0n ? d0 : N - d0;
    const aux = auxRand || globalThis.crypto.getRandomValues(new Uint8Array(32));
    const t = bigTo32(d ^ bytesToBig(await taggedHash("BIP0340/aux", aux)));
    let k0 = mod(bytesToBig(await taggedHash("BIP0340/nonce", concat(t, bigTo32(Px), m))), N);
    if (k0 === 0n) throw new Error("k0=0");
    const Raff = toAffine(jMul(k0, G)); const k = (Raff[1] & 1n) === 0n ? k0 : N - k0;
    const e = mod(bytesToBig(await taggedHash("BIP0340/challenge", concat(bigTo32(Raff[0]), bigTo32(Px), m))), N);
    return toHex(concat(bigTo32(Raff[0]), bigTo32(mod(k + e * d, N))));
  }
  // finalizeEvent — NIP-01: id = sha256(serialized), sig = schnorr(id). Returns a ready-to-send event.
  async function finalizeEvent(ev, sk, pk) {
    const pubkey = pk || getPublicKey(sk);
    const serial = JSON.stringify([0, pubkey, ev.created_at, ev.kind, ev.tags, ev.content]);
    const id = toHex(new Uint8Array(await SUBTLE.digest("SHA-256", toBytes(serial))));
    const sig = await sign(id, sk);
    return { id, pubkey, created_at: ev.created_at, kind: ev.kind, tags: ev.tags, content: ev.content, sig };
  }
  return { getPublicKey, sign, finalizeEvent, _internals: { liftX, taggedHash, mod, P, N, bigTo32, bytesToBig } };
})();

// test hook — the seal/unseal primitives are private (callers only ever see the handshake). The witness
// asserts SEC-7/SEC-4 on them directly; nothing else imports this.
export const __test = { seal, unseal, keyFromPair };

export default { coordinate, mintPairKappa, codeFromPair, pairFromCode, makeNostrMailbox, makeMemoryMailbox, offerSide, answerSide, holoSchnorr, DEFAULT_RELAYS };
