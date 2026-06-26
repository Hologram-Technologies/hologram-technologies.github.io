// holo-canvas-transport.mjs — the WIRE under the second-viewer share. One interface, two legs:
//   • makeBroadcastTransport(name) — same-origin cross-TAB (BroadcastChannel). Multi-viewer, zero setup.
//   • makeRTCTransport({ initiator, signaling }) — cross-DEVICE over a real WebRTC RTCDataChannel (P2P).
// The κ frame-tile stream rides whichever leg; only the SIGNALING (SDP/ICE exchange) differs by deployment:
// BroadcastChannel signaling works same-machine today; swap it for holo-dial's serverless rendezvous (ADR-0113)
// and the SAME data path becomes cross-device — the frames never touched the signaling, they ride the DataChannel.
//
// Transport interface: { send(obj), onMessage(cb), close(), ready }  — obj may embed Uint8Arrays (tile bytes).
// RTC encodes obj → binary (U8-aware) and CHUNKS it (a keyframe exceeds the ~256 KB SCTP message limit).

const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
const CHUNK = 16 * 1024;

// ── generic message codec: JSON skeleton + side-channel Uint8Array blobs (so tile bytes stay binary) ──
export function packMessage(obj) {
  const blobs = [];
  const skel = JSON.stringify(obj, (_k, v) => {
    if (v instanceof Uint8Array) { blobs.push(v); return { __u8: blobs.length - 1 }; }
    if (v && v.buffer instanceof ArrayBuffer && typeof v.length === "number" && !Array.isArray(v)) { const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); blobs.push(u); return { __u8: blobs.length - 1 }; }
    return v;
  });
  const enc = new TextEncoder().encode(skel);
  let total = 4 + enc.length; for (const b of blobs) total += 4 + b.length;
  const out = new Uint8Array(total), dv = new DataView(out.buffer); let o = 0;
  dv.setUint32(o, enc.length); o += 4; out.set(enc, o); o += enc.length;
  for (const b of blobs) { dv.setUint32(o, b.length); o += 4; out.set(b, o); o += b.length; }
  return out.buffer;
}
export function unpackMessage(buf) {
  const u = new Uint8Array(buf), dv = new DataView(buf.buffer || buf, buf.byteOffset || 0); let o = 0;
  const sl = dv.getUint32(o); o += 4;
  const skel = JSON.parse(new TextDecoder().decode(u.subarray(o, o + sl))); o += sl;
  const blobs = []; while (o < u.length) { const n = dv.getUint32(o); o += 4; blobs.push(u.subarray(o, o + n)); o += n; }
  const revive = (v) => { if (Array.isArray(v)) return v.map(revive); if (v && typeof v === "object") { if (typeof v.__u8 === "number") return blobs[v.__u8]; const r = {}; for (const k in v) r[k] = revive(v[k]); return r; } return v; };
  return revive(skel);
}

// ── leg 1: BroadcastChannel (cross-tab, multi-viewer) ──
export function makeBroadcastTransport(name) {
  const bc = new BroadcastChannel(name);
  let cb = () => {};
  bc.onmessage = (e) => cb(e.data);
  return { send: (obj) => bc.postMessage(obj), onMessage: (fn) => (cb = fn), close: () => bc.close(), ready: Promise.resolve() };
}

// ── leg 2: WebRTC RTCDataChannel (cross-device, P2P) ──
// wrapDataChannel(dc) → { send, onMessage, ready, close, dc } : the chunked, U8-aware codec over ONE channel.
// Shared by makeRTCTransport (trickle signaling) and the dial-link path (non-trickle, blob signaling).
export function wrapDataChannel(dc) {
  dc.binaryType = "arraybuffer";
  let onMsg = () => {}, readyRes; const ready = new Promise((r) => (readyRes = r));
  if (dc.readyState === "open") readyRes(true); else dc.addEventListener("open", () => readyRes(true));
  const inbox = new Map();                                       // msgId → { total, parts:[] }
  dc.addEventListener("message", (e) => {
    const b = new Uint8Array(e.data), dv = new DataView(b.buffer);
    const id = dv.getUint32(0), seq = dv.getUint32(4), total = dv.getUint32(8);
    let rec = inbox.get(id); if (!rec) inbox.set(id, (rec = { total, parts: [] }));
    rec.parts[seq] = b.subarray(12);
    if (rec.parts.filter(Boolean).length === total) {
      inbox.delete(id);
      const size = rec.parts.reduce((s, p) => s + p.length, 0), full = new Uint8Array(size);
      let o = 0; for (const p of rec.parts) { full.set(p, o); o += p.length; }
      try { onMsg(unpackMessage(full.buffer)); } catch (err) {}
    }
  });
  let msgId = 0;
  const send = (obj) => {
    if (dc.readyState !== "open") return;
    const buf = new Uint8Array(packMessage(obj)); const id = msgId++;
    const total = Math.max(1, Math.ceil(buf.length / CHUNK));
    for (let i = 0; i < total; i++) {
      const slice = buf.subarray(i * CHUNK, (i + 1) * CHUNK);
      const frame = new Uint8Array(12 + slice.length), dv = new DataView(frame.buffer);
      dv.setUint32(0, id); dv.setUint32(4, i); dv.setUint32(8, total); frame.set(slice, 12);
      try { dc.send(frame.buffer); } catch (e) {}
    }
  };
  return { send, onMessage: (fn) => (onMsg = fn), ready, close: () => { try { dc.close(); } catch (e) {} }, dc };
}

// makeRTCTransport({ initiator, signaling }) — a transport over a TRICKLE-signaled channel (live SDP/ICE bus,
// e.g. BroadcastChannel cross-tab). `signaling` = { send(sig), onSignal(cb), close? }.
export function makeRTCTransport({ initiator, signaling, rtcConfig = RTC_CONFIG } = {}) {
  const pc = new RTCPeerConnection(rtcConfig);
  let chan = null, onMsg = () => {}, readyRes;
  const ready = new Promise((r) => (readyRes = r));
  const pendingIce = []; let remoteSet = false;
  const attach = (dc) => { chan = wrapDataChannel(dc); chan.onMessage((m) => onMsg(m)); chan.ready.then(() => readyRes(true)); };

  if (initiator) attach(pc.createDataChannel("holo-share", { ordered: true }));
  else pc.ondatachannel = (e) => attach(e.channel);

  pc.onicecandidate = (e) => { if (e.candidate) signaling.send({ ice: e.candidate }); };
  signaling.onSignal(async (sig) => {
    try {
      if (sig.sdp) {
        await pc.setRemoteDescription(sig.sdp); remoteSet = true;
        for (const c of pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (sig.sdp.type === "offer") { const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); signaling.send({ sdp: pc.localDescription }); }
      } else if (sig.ice) {
        if (remoteSet) await pc.addIceCandidate(sig.ice).catch(() => {}); else pendingIce.push(sig.ice);
      }
    } catch (err) {}
  });
  if (initiator) (async () => { const off = await pc.createOffer(); await pc.setLocalDescription(off); signaling.send({ sdp: pc.localDescription }); })();

  return { send: (obj) => chan && chan.send(obj), onMessage: (fn) => (onMsg = fn), close: () => { chan && chan.close(); try { pc.close(); } catch (e) {} signaling.close && signaling.close(); }, ready, pc };
}

// signaling over BroadcastChannel (same-machine cross-tab today; swap for holo-dial rendezvous → cross-device).
export function makeBroadcastSignaling(name) {
  const bc = new BroadcastChannel(name); let cb = () => {};
  bc.onmessage = (e) => cb(e.data);
  return { send: (sig) => bc.postMessage(sig), onSignal: (fn) => (cb = fn), close: () => bc.close() };
}

// in-memory loopback signaling pair (for the witness — two peers in one page, no network, no server).
export function loopbackSignaling() {
  let a = () => {}, b = () => {};
  return [
    { send: (s) => queueMicrotask(() => b(s)), onSignal: (fn) => (a = fn), close() {} },
    { send: (s) => queueMicrotask(() => a(s)), onSignal: (fn) => (b = fn), close() {} },
  ];
}

// ── holo-dial link signaling (ADR-0113 bootstrap): true cross-DEVICE, server-free ──
// Non-trickle ICE: each side gathers ALL its candidates into the SDP, then emits ONE static blob. The two
// devices exchange just `offerBlob` → `answerBlob` over ANY out-of-band medium (paste, QR, a κ-object, a URL
// hash) — no signaling server, no shared in-process channel. Once the channel opens it is a holo-dial peer:
// hand host.channel.dc to makeDial().addChannel(dc) and the κ-block mesh runs over the same link.
const b64u = {
  enc: (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
};
export function encodeSDP(desc) { return b64u.enc(JSON.stringify({ t: desc.type, s: desc.sdp })); }
export function decodeSDP(blob) { const o = JSON.parse(b64u.dec(blob)); return { type: o.t, sdp: o.s }; }

// resolve once ICE gathering is COMPLETE so the localDescription carries every candidate (single-blob signaling).
function waitIceComplete(pc, timeoutMs = 4000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((res) => {
    const done = () => { try { pc.removeEventListener("icegatheringstatechange", check); } catch (e) {} clearTimeout(to); res(); };
    const check = () => { if (pc.iceGatheringState === "complete") done(); };
    const to = setTimeout(done, timeoutMs);                      // localhost may never flip to complete → bounded
    pc.addEventListener("icegatheringstatechange", check);
  });
}

// host side: open the DataChannel + offer, gather ICE, hand back the offer blob and an accept(answerBlob).
export async function makeDialHost({ rtcConfig = RTC_CONFIG } = {}) {
  const pc = new RTCPeerConnection(rtcConfig);
  const channel = wrapDataChannel(pc.createDataChannel("holo-share", { ordered: true }));
  await pc.setLocalDescription(await pc.createOffer());
  await waitIceComplete(pc);
  return { offerBlob: encodeSDP(pc.localDescription), channel, accept: (answerBlob) => pc.setRemoteDescription(decodeSDP(answerBlob)), pc };
}

// viewer side: consume the offer blob, answer, gather ICE, hand back the answer blob and the (future) channel.
export async function joinDial(offerBlob, { rtcConfig = RTC_CONFIG } = {}) {
  const pc = new RTCPeerConnection(rtcConfig);
  let res; const channel = new Promise((r) => (res = r));
  pc.ondatachannel = (e) => res(wrapDataChannel(e.channel));
  await pc.setRemoteDescription(decodeSDP(offerBlob));
  await pc.setLocalDescription(await pc.createAnswer());
  await waitIceComplete(pc);
  return { answerBlob: encodeSDP(pc.localDescription), channel, pc };
}

export default { makeBroadcastTransport, makeRTCTransport, wrapDataChannel, makeBroadcastSignaling, loopbackSignaling, makeDialHost, joinDial, encodeSDP, decodeSDP, packMessage, unpackMessage };
