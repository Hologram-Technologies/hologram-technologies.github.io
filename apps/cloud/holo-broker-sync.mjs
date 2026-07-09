// holo-broker-sync — a `KappaSync` over a public MQTT-over-WebSocket broker.
//
// Zero infrastructure: point this at a free public broker (e.g.
// wss://broker.emqx.io:8084/mqtt) and the messenger runs entirely from a static
// host like GitHub Pages — no relay you operate. The broker is content-blind: it
// routes opaque (κ, ciphertext) frames on **unguessable per-workspace topics**
// (derived from the workspace secret), so it only ever sees ciphertext and
// random-looking topics. Minimal MQTT 3.1.1 QoS-0 client, no dependencies.
//
// Caveat vs our own relay: a public broker is live pub/sub with no durable
// store, so there is no offline-history replay, and brokers cap message size
// (~256 KB) — large file blobs won't fit. Good for a synchronous team test.

import { OP, encodeMsg, decodeMsg } from "./holo-wire.mjs";

// ── MQTT 3.1.1 binary codec (pure, dependency-free) ─────────────────────────
const te = new TextEncoder();
const td = new TextDecoder();
function concat(arrs) { let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; }
function remLen(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; out.push(b); } while (n > 0); return new Uint8Array(out); }
function mqttStr(s) { const b = te.encode(s); return concat([new Uint8Array([(b.length >> 8) & 0xff, b.length & 0xff]), b]); }
function packet(type, flags, body) { return concat([new Uint8Array([(type << 4) | flags]), remLen(body.length), body]); }

export function encodeConnect(clientId) {
  const body = concat([mqttStr("MQTT"), new Uint8Array([0x04, 0x02, 0x00, 0x3c]), mqttStr(clientId)]);
  return packet(1, 0, body);
}
export function encodeSubscribe(pid, topic) {
  return packet(8, 2, concat([new Uint8Array([(pid >> 8) & 0xff, pid & 0xff]), mqttStr(topic), new Uint8Array([0x00])]));
}
export function encodePublish(topic, payload) {
  return packet(3, 0, concat([mqttStr(topic), payload]));
}
// Parse complete MQTT packets out of a buffer; returns { packets:[{type,body}], rest }.
export function parsePackets(buf) {
  const packets = []; let off = 0;
  for (;;) {
    if (buf.length - off < 2) break;
    let mult = 1, val = 0, i = off + 1, b;
    do { if (i >= buf.length) return { packets, rest: buf.subarray(off) }; b = buf[i]; val += (b & 0x7f) * mult; mult *= 128; i++; } while (b & 0x80);
    const total = i + val; if (buf.length < total) break;
    packets.push({ type: buf[off] >> 4, body: buf.subarray(i, total) });
    off = total;
  }
  return { packets, rest: buf.subarray(off) };
}
export function parsePublish(body) {
  const tl = (body[0] << 8) | body[1];
  return { topic: td.decode(body.subarray(2, 2 + tl)), payload: body.subarray(2 + tl) };
}

class Mqtt {
  constructor(url) {
    this.ws = new WebSocket(url, "mqtt");
    this.ws.binaryType = "arraybuffer";
    this.onmsg = null; this.buf = new Uint8Array(0); this.pid = 1;
    this.ready = new Promise((res, rej) => { this._res = res; this.ws.addEventListener("error", rej); });
    this.ws.addEventListener("open", () => this.ws.send(encodeConnect("holo-" + Math.random().toString(16).slice(2, 10))));
    this.ws.addEventListener("message", (e) => this._feed(new Uint8Array(e.data)));
    this._ping = setInterval(() => { if (this.ws.readyState === 1) this.ws.send(new Uint8Array([0xc0, 0x00])); }, 30000);
  }
  _feed(chunk) {
    this.buf = concat([this.buf, chunk]);
    const { packets, rest } = parsePackets(this.buf);
    this.buf = rest;
    for (const p of packets) {
      if (p.type === 2) this._res(this);               // CONNACK
      else if (p.type === 3 && this.onmsg) { const m = parsePublish(p.body); this.onmsg(m.topic, m.payload); }
    }
  }
  subscribe(topic) { this.ws.send(encodeSubscribe(this.pid++, topic)); }
  publish(topic, payload) { this.ws.send(encodePublish(topic, payload)); }
  close() { clearInterval(this._ping); try { this.ws.close(); } catch { /* already closing */ } }
}

export class BrokerKappaSync {
  constructor(url) {
    this.mqtt = new Mqtt(url);
    this.cache = new Map();   // κ → bytes (the broker doesn't store; peers carry bytes inline)
    this.cbs = new Map();     // our-topic → cb
    this.subs = new Set();
    this.mqtt.onmsg = (_t, payload) => this._on(payload);
    this.ready = this.mqtt.ready.then(() => { for (const t of this.subs) this.mqtt.subscribe(this._t(t)); return this; });
  }
  _t(topic) { return "holo/" + topic.replace(/[+#/]/g, "_"); } // MQTT-safe topic
  _on(u8) {
    let m; try { m = decodeMsg(u8); } catch { return; }
    if (m.op === OP.PUT) { this.cache.set(m.kappa, m.bytes.slice()); const cb = this.cbs.get(m.topic); if (cb) cb(m.topic, m.kappa); }
  }
  async subscribe(topic, cb) { if (cb) this.cbs.set(topic, cb); this.subs.add(topic); await this.mqtt.ready; this.mqtt.subscribe(this._t(topic)); }
  async announce(topic, kappa, bytes) { this.cache.set(kappa, bytes); await this.mqtt.ready; this.mqtt.publish(this._t(topic), encodeMsg({ op: OP.PUT, topic, kappa, bytes })); }
  async fetch(kappa, { verify } = {}) { const b = this.cache.get(kappa); if (!b) return null; if (verify && !verify(kappa, b)) return null; return b; }
  close() { this.mqtt.close(); }
}

// Pure round-trip self-test (no network) — verifies the MQTT codec carries a
// holo-wire frame intact, the bit the live broker relies on.
export function brokerCodecSelftest() {
  const frame = encodeMsg({ op: OP.PUT, topic: "blake3:chan", kappa: "blake3:msg", bytes: new Uint8Array([1, 2, 3, 250]) });
  const pkt = encodePublish("holo/blake3:chan", frame);
  const { packets } = parsePackets(pkt);
  const pub = parsePublish(packets[0].body);
  const m = decodeMsg(pub.payload);
  return { type: packets[0].type, topic: pub.topic, kappa: m.kappa, bytesOk: [...m.bytes].join(",") === "1,2,3,250", chanTopic: m.topic };
}
