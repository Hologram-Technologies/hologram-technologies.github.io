// holo-ad4m-wan.mjs — carry a Neighbourhood across the REAL internet, still with no server. A Neighbourhood
// is already transport-agnostic: it posts `ad4m:links` / `ad4m:want` messages into an injected sink and
// reads inbound through `onMessage`. Same-machine that sink is a BroadcastChannel; this module swaps in a
// set of real point-to-point channels (WebRTC RTCDataChannels opened out-of-band via holo-webrtc-link +
// holo-pair signaling) so two phones on opposite sides of the planet converge the same Space.
//
// The wire is DUMB. It JSON-frames messages and fans them across every connected peer — and does ZERO
// verification. Trust lives in exactly one place: the Neighbourhood's `verifyAuthoredChain` (Law L5 +
// authorship), which re-derives every inbound chain before adopting. So a peer is a LATENCY source, never a
// trust source: a tampered or forged chain arriving on the wire is refused by the math, not by the messenger.
// No signaling server, no relay, no TURN — point-to-point + an out-of-band invite (holo-pair) + public STUN.
//
// Mirrors holo-zone-net's `attachChannel` and holo-dial's multi-peer fan-out; composes, invents nothing.
// Isomorphic: imports cleanly in Node (mock `{send,onMessage}` wires in the witness) and the browser
// (real RTCDataChannel). The channel contract is the union both speak: a `send`/`postMessage` to write and
// an `addEventListener('message')`/`onmessage` to read.

// ── channel plumbing: adapt ANY point-to-point channel to a uniform { write(str), onRead(fn), close() } ────
function adaptChannel(channel) {
  const write = typeof channel.send === "function"
    ? (s) => { try { channel.send(s); } catch (e) {} }
    : (s) => { try { channel.postMessage(s); } catch (e) {} };
  let handler = null;
  const onRead = (fn) => {
    handler = (ev) => {
      const data = ev && ev.data != null ? ev.data : ev;
      fn(typeof data === "string" ? data : data);
    };
    if (typeof channel.addEventListener === "function") { channel.addEventListener("message", handler); if (typeof channel.start === "function") channel.start(); }
    else { channel.onmessage = handler; }
  };
  const off = () => { try { if (channel.removeEventListener && handler) channel.removeEventListener("message", handler); } catch (e) {} handler = null; };
  return { write, onRead, off };
}

// makeWanBus() — a multi-peer JSON-framed fan-out over untrusted channels.
//   post(msg)            : fan one message across EVERY connected peer (the Neighbourhood's send sink).
//   onInbound(fn)        : bind the receiver (the Neighbourhood's onMessage). Replaces any prior binding.
//   attach(channel,opts) : add a peer channel; returns detach(). A dropped/closed peer is removed and the
//                          rest keep converging. The adapter does NOT verify — that's the Neighbourhood's job.
//   peerCount()          : live channel count.
export function makeWanBus() {
  const peers = new Set();                                   // each: { adapter }
  let inbound = () => {};

  function post(msg) {
    const s = JSON.stringify(msg);
    for (const p of peers) p.adapter.write(s);
  }

  function onInbound(fn) { inbound = typeof fn === "function" ? fn : (() => {}); }

  function attach(channel, { self = null } = {}) {
    const adapter = adaptChannel(channel);
    const peer = { adapter };
    adapter.onRead((data) => { let m; try { m = JSON.parse(data); } catch (e) { return; } try { inbound(m); } catch (e) {} });
    peers.add(peer);
    const detach = () => { peers.delete(peer); adapter.off(); };
    try { channel.addEventListener && channel.addEventListener("close", detach); } catch (e) {}
    return detach;
  }

  return { post, onInbound, attach, peerCount: () => peers.size };
}

// attachNeighbourhood(neighbourhood, bus) — bind a Neighbourhood's receiver to a WAN bus. The Neighbourhood
// must have been constructed with `post: bus.post` (that is the only way a Neighbourhood emits — its send
// sink is fixed at construction), so this wires the INBOUND half. Returns the bus for chaining attach()es.
export function attachNeighbourhood(neighbourhood, bus) {
  if (!neighbourhood || typeof neighbourhood.onMessage !== "function") throw new Error("attachNeighbourhood needs a Neighbourhood");
  bus.onInbound((m) => neighbourhood.onMessage(m));
  return bus;
}

// makeWanTransport({ deliver }) — the FLUX-level transport over a WAN bus, drop-in for makeHoloWeb's
// `transport` seam. Messages are tagged with their Space id so one bus carries every Space; inbound is
// routed to the web's deliver(spaceId, msg) (which itself verifies-before-adopt and re-verifies bodies).
//   spacePost(spaceId, msg) : fan a Space message across all peers.
//   attach(channel, opts)   : add a WebRTC peer (from holo-webrtc-link onChannel). Returns detach().
//   peerCount()             : live peers.
export function makeWanTransport({ deliver, operator = null, baseUrl = "", webrtc = null, pair = null, nowMs } = {}) {
  if (typeof deliver !== "function") throw new Error("makeWanTransport needs a deliver(spaceId, msg) sink");
  const bus = makeWanBus();
  bus.onInbound((framed) => { if (framed && framed.spaceId) deliver(framed.spaceId, framed.m); });
  const transport = {
    spacePost: (spaceId, msg) => bus.post({ spaceId, m: msg }),
    attach: (channel, opts) => bus.attach(channel, opts),
    peerCount: bus.peerCount,
  };
  // the human on-ramp: one shared link → a real WebRTC channel attached to THIS transport. Bound to this
  // transport + the operator (Space owner) so the boot `invite`/`open` verbs just call createInvite/joinInvite.
  transport.createInvite = (space, opts = {}) => createSpaceInvite({ space, operator: opts.operator || operator, transport, baseUrl: opts.baseUrl || baseUrl, webrtc, pair, nowMs });
  transport.joinInvite = (link, opts = {}) => joinSpaceInvite({ link, transport, operator: opts.operator || operator, webrtc, pair, nowMs });
  return transport;
}

// ── the serverless invite handshake: one shared link opens a real WebRTC channel, membership-gated ─────────
// Compose holo-webrtc-link (SDP offer/answer, non-trickle, public STUN) + holo-pair's delegation primitives
// (the operator-signed, re-derivable grant that says WHICH agent κ is admitted to a Space). No signaling
// server, no relay, no TURN: the invite link carries the offer; the joiner hands back an answer + its agent κ
// (the one out-of-band step); the inviter mints a membership grant. webrtc + pair are INJECTED so the whole
// flow is node-testable with the raw RTCPeerConnection stubbed; in the browser they default to the real modules.

const INVITE_V = "holo-space-invite:v1";
const MEMBER_CAP = ["space/member"];
const _te = new TextEncoder(), _td = new TextDecoder();
const _RNG = globalThis.crypto || (typeof require !== "undefined" ? require("node:crypto").webcrypto : null);
const _nonce = () => [..._RNG.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
const _enc = (obj) => { const u = _te.encode(JSON.stringify(obj)); let s = ""; for (const b of u) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const _dec = (frag) => { const b = String(frag).replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(b + "===".slice((b.length + 3) % 4)); return JSON.parse(_td.decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))); };
const _linkFrag = (url, key) => { const m = String(url).match(new RegExp("[#&]" + key + "=([A-Za-z0-9\\-_]+)")); return m ? _dec(m[1]) : null; };

async function _loadWebrtc(injected) { return injected || import("../../sbin/holo-webrtc-link.mjs"); }
async function _loadPair(injected) { return injected || import("./holo-pair.mjs"); }

// _mintMembership(operator, audKappa, spaceId, pair) — an operator-signed UCAN-style membership delegation
// binding the JOINER's AGENT κ (the κ that authors their posts), keyed to this Space. Built from holo-pair's
// exported signing primitives (canon · addressOf · operator.sign) — the same delegation shape holo-pair uses,
// minus the device-linking E2E layer (unneeded: the WebRTC DataChannel is already DTLS-encrypted). The trust
// gate stays holo-pair's verifyDelegation (re-derive issuer κ, check signature/audience/window/attenuation, L5).
async function _mintMembership(operator, audKappa, spaceId, pr, { ttlMs = 30 * 24 * 3600e3, nowMs } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const body = {
    "@type": "HoloDelegation",
    iss: operator.kappa, issLabel: operator.label || "",
    aud: audKappa, audPub: "",
    can: [...MEMBER_CAP],
    channel: "space:" + spaceId,
    nbf: new Date(now).toISOString(), exp: new Date(now + ttlMs).toISOString(),
    nonce: _nonce(),
  };
  const bodyCanon = pr.canon(body);
  const id = await pr.addressOf(_te.encode(bodyCanon));
  const sig = await operator.sign(bodyCanon);                                    // ONLY the Space operator can mint this
  return { id, ...body, issPub: operator.pub, issAlg: operator.alg, sig };
}

// createSpaceInvite({ space, operator, transport }) → { link, complete(answerBlob), offerer }.
//   link            : a /space-invite.html#i=<offer+space> link to share (the offerer's SDP rides inside).
//   complete(answer): accept the joiner's SDP answer (opens the channel → attached to transport), then mint an
//                     operator-signed membership grant for the joiner's AGENT κ. Returns { grant, joiner }.
export async function createSpaceInvite({ space, operator = null, transport, baseUrl = "", webrtc = null, pair = null, nowMs } = {}) {
  if (!space || !transport || typeof transport.attach !== "function") throw new Error("createSpaceInvite needs { space, transport }");
  const rtc = await _loadWebrtc(webrtc);
  const offerer = await rtc.createOfferer({ onChannel: (dc) => transport.attach(dc) });
  const payload = { v: INVITE_V, spaceId: space.id, spaceName: space.name, offer: offerer.offer, inviter: operator ? operator.kappa : null };
  const link = (baseUrl ? baseUrl.replace(/\/$/, "") : "") + "/space-invite.html#i=" + _enc(payload);
  async function complete(answerBlob) {
    const ans = typeof answerBlob === "string" ? _linkFrag(answerBlob, "a") : answerBlob;
    if (!ans || !ans.answer || !ans.joinerKappa) throw new Error("invalid answer");
    await offerer.accept(ans.answer);                                            // SDP answer → the DataChannel opens (attached to transport)
    let grant = null;
    if (operator) { const pr = await _loadPair(pair); grant = await _mintMembership(operator, ans.joinerKappa, space.id, pr, { nowMs }); }
    return { grant, joiner: ans.joinerKappa };
  }
  return { link, complete, offerer };
}

// joinSpaceInvite({ link, transport, operator }) → { spaceId, spaceName, inviter, answerBlob, answerLink,
//                                                    accept(grant), joinerKappa }.
//   answerBlob/answerLink : hand this ONE string back to the inviter (the single out-of-band step) — it carries
//                           only the SDP answer + the joiner's AGENT κ; no secret, nothing signable by others.
//   accept(grant)         : verify the operator-signed membership grant binds THIS agent κ. Returns { operator }.
export async function joinSpaceInvite({ link, transport, operator = null, webrtc = null, pair = null, nowMs } = {}) {
  if (!transport || typeof transport.attach !== "function") throw new Error("joinSpaceInvite needs a transport");
  const inv = _linkFrag(link, "i");
  if (!inv || inv.v !== INVITE_V) throw new Error("not a holo space invite");
  const rtc = await _loadWebrtc(webrtc);
  const pr = await _loadPair(pair);
  const answerer = await rtc.createAnswerer(inv.offer, { onChannel: (dc) => transport.attach(dc) });
  const joinerKappa = operator ? operator.kappa : null;
  const answerBlob = { v: INVITE_V, answer: answerer.answer, joinerKappa };
  const answerLink = "#a=" + _enc(answerBlob);
  async function accept(grant) {
    const v = await pr.verifyDelegation(grant, { expectAud: joinerKappa, allowedCaps: MEMBER_CAP, nowMs });
    if (!v.ok) throw new Error("membership grant rejected: " + v.reason);
    return { operator: grant.iss, can: grant.can, exp: grant.exp };
  }
  return { spaceId: inv.spaceId, spaceName: inv.spaceName, inviter: inv.inviter, answerBlob, answerLink, accept, joinerKappa };
}

export default { makeWanBus, attachNeighbourhood, makeWanTransport, createSpaceInvite, joinSpaceInvite };
