// holo-wire — the κ pub/sub message codec for the messenger transport (P2).
//
// One binary frame per message, isomorphic across the browser peer and the Node
// relay. The relay is content-blind: it routes and caches opaque (κ, bytes)
// pairs and never inspects them — peers verify every byte on receipt by
// re-deriving its κ (Law L5), so an untrusted relay cannot forge content.
//
// Layout:  [op:u8][topicLen:u16le][topic][kappaLen:u16le][kappa][payload…]
//   topic  — a channel κ string (the pub/sub subject); empty for GET.
//   kappa  — the object's content-address label (`<axis>:<hex>`).
//   payload— the object's canonical bytes (PUT / OBJ only).

export const OP = Object.freeze({
  PUT: 1,  // peer→relay: here are an object's bytes under `topic`; cache + announce.
  GET: 2,  // peer→relay: send me the bytes for `kappa`.
  OBJ: 3,  // relay→peer: the bytes for `kappa`.
  ANN: 4,  // relay→peer: a peer announced `kappa` under `topic`.
  SUB: 5,  // peer→relay: subscribe me to announces for `topic`.
  MISS: 6, // relay→peer: I do not hold `kappa`.
});

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeMsg({ op, topic = "", kappa = "", bytes = new Uint8Array(0) }) {
  const t = enc.encode(topic);
  const k = enc.encode(kappa);
  const out = new Uint8Array(1 + 2 + t.length + 2 + k.length + bytes.length);
  const view = new DataView(out.buffer);
  let o = 0;
  out[o++] = op;
  view.setUint16(o, t.length, true); o += 2;
  out.set(t, o); o += t.length;
  view.setUint16(o, k.length, true); o += 2;
  out.set(k, o); o += k.length;
  out.set(bytes, o);
  return out;
}

export function decodeMsg(u8) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let o = 0;
  const op = u8[o++];
  const tLen = view.getUint16(o, true); o += 2;
  const topic = dec.decode(u8.subarray(o, o + tLen)); o += tLen;
  const kLen = view.getUint16(o, true); o += 2;
  const kappa = dec.decode(u8.subarray(o, o + kLen)); o += kLen;
  const bytes = u8.subarray(o);
  return { op, topic, kappa, bytes };
}
