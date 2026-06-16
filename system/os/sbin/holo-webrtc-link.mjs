// holo-webrtc-link.mjs — a minimal SERVERLESS browser↔browser WebRTC link (the JS analog of holospaces-web's
// webrtc.rs `WebRtcLink`). NON-TRICKLE ICE: gather all candidates into ONE offer/answer SDP, so MANUAL
// signaling is a single string each way (share-link out → answer back). Public STUN only (a light commons; no
// operator server, no TURN). `onChannel(dc)` fires when the ordered/reliable data channel opens — hand it to
// holo-mesh-blocks.dataChannelWire to run the κ-block exchange (L5 verify-on-receipt). Browser-only (uses
// RTCPeerConnection); imports cleanly in Node (the API is touched at call time).

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:global.stun.twilio.com:3478" }];

// gatherComplete(pc) — non-trickle: resolve once ICE gathering finishes (or a cap elapses → ship what we have).
function gatherComplete(pc, ms = 4000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((res) => {
    const done = () => { try { pc.removeEventListener("icegatheringstatechange", chk); } catch {} clearTimeout(to); res(); };
    const chk = () => { if (pc.iceGatheringState === "complete") done(); };
    const to = setTimeout(done, ms);
    pc.addEventListener("icegatheringstatechange", chk);
  });
}

// createOfferer({onChannel}) → { offer, accept(answerSdp), close } — A: makes the channel + the offer SDP.
export async function createOfferer({ onChannel, iceServers = ICE_SERVERS } = {}) {
  const pc = new RTCPeerConnection({ iceServers });
  const dc = pc.createDataChannel("holo-mesh", { ordered: true });
  dc.binaryType = "arraybuffer";
  dc.addEventListener("open", () => onChannel && onChannel(dc));
  await pc.setLocalDescription(await pc.createOffer());
  await gatherComplete(pc);
  return { pc, dc, offer: pc.localDescription.sdp, accept: (answerSdp) => pc.setRemoteDescription({ type: "answer", sdp: answerSdp }), close: () => { try { pc.close(); } catch {} } };
}

// createAnswerer(offerSdp,{onChannel}) → { answer, close } — B: accepts the offer, makes the answer SDP.
export async function createAnswerer(offerSdp, { onChannel, iceServers = ICE_SERVERS } = {}) {
  const pc = new RTCPeerConnection({ iceServers });
  pc.addEventListener("datachannel", (e) => { const dc = e.channel; dc.binaryType = "arraybuffer"; if (dc.readyState === "open") onChannel && onChannel(dc); dc.addEventListener("open", () => onChannel && onChannel(dc)); });
  await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await gatherComplete(pc);
  return { pc, answer: pc.localDescription.sdp, close: () => { try { pc.close(); } catch {} } };
}

export default { createOfferer, createAnswerer };
