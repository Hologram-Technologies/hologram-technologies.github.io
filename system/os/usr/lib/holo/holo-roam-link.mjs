// holo-roam-link.mjs — open a real WebRTC datachannel between two PAIRED devices and attach it to the device
// relay (window.HoloRelay), so Session Roam crosses MACHINES. Pure glue over already-proven primitives:
//   • holo-webrtc-link createOfferer/createAnswerer — serverless SDP offer/answer, public STUN, no TURN.
//   • holo-pair postGrant/pollGrant — the content-blind /.pair relay carries the ONE signaling exchange,
//     keyed by the pairing channel (sub-topics so it can't collide with the grant blob).
// The channel is a DUMB pipe: WebRTC gives DTLS, AND roam payloads are E2E-encrypted under the pair key
// (holo-session-roam), so a relay/peer is a latency source, never a trust source. Browser-only (RTCPeerConnection).
//
// Cross-MACHINE liveness needs two real devices + the /.pair relay → verify there. The dc→attach→roam path is
// the same one the loopback browser smoke + the witnesses cover. See [[holo-session-roam]].

const OFFER = (ch) => "roam-offer:" + ch, ANSWER = (ch) => "roam-answer:" + ch;

// roamOffer(channel, attach, {base, signal}) — device A: make the offer, publish it, await B's answer, complete
// → datachannel opens → attach(dc) (e.g. window.HoloRelay.attach). Returns the offerer handle (has .close()).
export async function roamOffer(channel, attach, { base = "", signal } = {}) {
  const [{ createOfferer }, { postGrant, pollGrant }] = await Promise.all([
    import("../../../sbin/holo-webrtc-link.mjs"), import("./holo-pair.mjs")]);
  const o = await createOfferer({ onChannel: (dc) => { try { attach(dc); } catch (e) {} } });
  await postGrant(OFFER(channel), { sdp: o.offer }, { base });
  const ans = await pollGrant(ANSWER(channel), { base, signal });
  if (ans && ans.sdp) await o.accept(ans.sdp);
  return o;
}

// roamAnswer(channel, attach, {base, signal}) — device B: read A's offer, make + publish the answer
// → datachannel opens → attach(dc). Returns the answerer handle.
export async function roamAnswer(channel, attach, { base = "", signal } = {}) {
  const [{ createAnswerer }, { postGrant, pollGrant }] = await Promise.all([
    import("../../../sbin/holo-webrtc-link.mjs"), import("./holo-pair.mjs")]);
  const off = await pollGrant(OFFER(channel), { base, signal });
  if (!off || !off.sdp) return null;
  const a = await createAnswerer(off.sdp, { onChannel: (dc) => { try { attach(dc); } catch (e) {} } });
  await postGrant(ANSWER(channel), { sdp: a.answer }, { base });
  return a;
}

export default { roamOffer, roamAnswer };
