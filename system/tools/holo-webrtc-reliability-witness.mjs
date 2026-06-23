// holo-webrtc-reliability-witness.mjs — Phase B3 proof. The data channel carries a partial-reliability
// lever (RFC 8831): ordered+reliable by default (unchanged for every existing caller), unordered +
// maxRetransmits:0 for droppable live frames. RTCPeerConnection lives only in a browser, so we stub it
// to capture the exact RTCDataChannelInit passed — proving the plumbing without a browser.
//
//   1. defaultIsReliable   — no option ⇒ { ordered: true }, no maxRetransmits (today's behaviour, no regression)
//   2. partialReliable     — { ordered:false, maxRetransmits:0 } is passed through verbatim (droppable frames)

let captured = null;
class FakeDC { constructor() { this.binaryType = ""; } addEventListener() {} }
class FakePC {
  constructor() { this.iceGatheringState = "complete"; this.localDescription = { sdp: "v=0\r\n" }; }
  createDataChannel(label, cfg) { captured = { label, cfg }; return new FakeDC(); }
  async createOffer() { return { type: "offer", sdp: "v=0\r\n" }; }
  async setLocalDescription() {}
  addEventListener() {} removeEventListener() {} close() {}
}
globalThis.RTCPeerConnection = FakePC;

const { createOfferer } = await import("../os/sbin/holo-webrtc-link.mjs");

const checks = {}; let pass = 0, fail = 0, kn = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56);
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); checks[(slug(name) || "c") + "-" + (++kn)] = !!cond; console.log((cond ? "  ok  " : " FAIL ") + name + (extra ? "  — " + extra : "")); };

await createOfferer({ onChannel: () => {} });
ok("default channel is ordered + reliable (no regression)", captured.cfg.ordered === true && captured.cfg.maxRetransmits === undefined && captured.cfg.maxPacketLifeTime === undefined, JSON.stringify(captured.cfg));

await createOfferer({ onChannel: () => {}, channel: { ordered: false, maxRetransmits: 0 } });
ok("partial-reliability config passes through verbatim (droppable frames)", captured.cfg.ordered === false && captured.cfg.maxRetransmits === 0, JSON.stringify(captured.cfg));

console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass}/${pass + fail}`);
if (fail) process.exit(1);
