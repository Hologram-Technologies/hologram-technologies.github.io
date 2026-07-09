// holo-kappa-sync — a `KappaSync` over the κ pub/sub relay (P2 transport).
//
// The browser peer's network pillar: the same three substrate verbs the native
// peer's `KappaSync` exposes, spoken over one WebSocket to a content-blind relay
// (there is no homeserver, ADR-001):
//
//   • announce(topic, κ, bytes) — publish an object you hold under a channel.
//   • subscribe(topic)          — ask to hear other peers' announces.
//   • fetch(κ)                  — pull an object's bytes, verified on receipt.
//
// Isomorphic: uses the global `WebSocket` (present in the browser and in Node
// ≥21), so the same module backs the live UI and the conformance test.

import { OP, encodeMsg, decodeMsg } from "./holo-wire.mjs";

const toU8 = (data) =>
  data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer ?? data);

export class WsKappaSync {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this._gets = new Map(); // κ → [resolve, …] awaiting OBJ/MISS
    this._announce = new Set(); // cb(topic, κ)
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener("open", () => res(this));
      this.ws.addEventListener("error", (e) => rej(e));
    });
    this.ws.addEventListener("message", (ev) => this._onMessage(toU8(ev.data)));
  }

  _onMessage(u8) {
    const m = decodeMsg(u8);
    if (m.op === OP.OBJ || m.op === OP.MISS) {
      const waiters = this._gets.get(m.kappa);
      if (waiters) {
        this._gets.delete(m.kappa);
        const bytes = m.op === OP.OBJ ? m.bytes.slice() : null;
        for (const r of waiters) r(bytes);
      }
    } else if (m.op === OP.ANN) {
      for (const cb of this._announce) cb(m.topic, m.kappa);
    }
  }

  async _send(msg) {
    await this.ready;
    this.ws.send(encodeMsg(msg));
  }

  /** Hear announces from other peers for a channel. `cb(topic, κ)` per announce. */
  async subscribe(topic, cb) {
    if (cb) this._announce.add(cb);
    await this._send({ op: OP.SUB, topic });
  }

  /** Register an announce handler without (re)subscribing. */
  onAnnounce(cb) {
    this._announce.add(cb);
    return () => this._announce.delete(cb);
  }

  /** Publish an object you hold under `topic`: caches it at the relay and
   *  announces its κ to the channel's subscribers. */
  async announce(topic, kappa, bytes) {
    await this._send({ op: OP.PUT, topic, kappa, bytes });
  }

  /**
   * Resolve `kappa` to its bytes, verifying on receipt (Law L5). `verify(κ,
   * bytes) → bool` re-derives the content address; bytes that fail are rejected
   * (returns null) — a lying relay cannot pass off forged content. Returns the
   * bytes, or null on miss / verification failure / timeout.
   */
  async fetch(kappa, { verify, timeoutMs = 10000 } = {}) {
    const bytes = await new Promise((resolve) => {
      const waiters = this._gets.get(kappa) ?? [];
      waiters.push(resolve);
      this._gets.set(kappa, waiters);
      this._send({ op: OP.GET, kappa });
      if (timeoutMs) setTimeout(() => resolve(null), timeoutMs);
    });
    if (bytes && verify && !verify(kappa, bytes)) return null; // L5: refuse forged.
    return bytes;
  }

  close() {
    try { this.ws.close(); } catch { /* already closing */ }
  }
}
