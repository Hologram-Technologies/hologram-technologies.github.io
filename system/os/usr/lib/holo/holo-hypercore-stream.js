// holo-hypercore-stream.js — Hyperliquid HyperCore real-time WebSocket.
//
// One socket, many subscriptions. `allMids` is the global live price ticker (every
// market re-prices continuously); per-coin `trades` is the live trade firehose and
// `l2Book` is the live order book. Views subscribe what they need and unsubscribe on
// leave. Auto-reconnect; on reconnect the active subscriptions are re-sent.

export class HcStream {
  constructor(ws = "wss://api.hyperliquid.xyz/ws") {
    this.url = ws; this.wsk = null; this.closed = false; this.connected = false;
    this.active = new Map();                              // key -> subscription object
    this.listeners = { mids: new Set(), trade: new Set(), book: new Set(), status: new Set() };
    this.mids = {}; this.backoff = 700;
  }
  on(ev, cb) { this.listeners[ev].add(cb); return () => this.listeners[ev].delete(cb); }
  _emit(ev, x) { for (const cb of this.listeners[ev]) { try { cb(x); } catch {} } }
  _key(sub) { return sub.type + (sub.coin ? ":" + sub.coin : ""); }
  connect() {
    if (this.closed) return this;
    let ws; try { ws = new WebSocket(this.url); } catch { this._re(); return this; }
    this.wsk = ws;
    ws.onopen = () => { this.connected = true; this.backoff = 700; this._emit("status", { connected: true }); for (const sub of this.active.values()) this._send("subscribe", sub); };
    ws.onclose = () => { this.connected = false; this._emit("status", { connected: false }); this._re(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
    ws.onmessage = (e) => this._msg(e.data);
    return this;
  }
  _re() { if (this.closed) return; const d = this.backoff; this.backoff = Math.min(15000, Math.round(this.backoff * 1.7)); setTimeout(() => this.connect(), d); }
  _send(method, subscription) { try { this.wsk.send(JSON.stringify({ method, subscription })); } catch {} }
  subscribe(sub) { const k = this._key(sub); if (this.active.has(k)) return; this.active.set(k, sub); if (this.connected) this._send("subscribe", sub); }
  unsubscribe(sub) { const k = this._key(sub); if (!this.active.has(k)) return; this.active.delete(k); if (this.connected) this._send("unsubscribe", sub); }
  _msg(data) {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.channel === "allMids") { this.mids = m.data?.mids || this.mids; this._emit("mids", this.mids); }
    else if (m.channel === "trades") { for (const t of (m.data || [])) this._emit("trade", t); }
    else if (m.channel === "l2Book") { this._emit("book", m.data); }
  }
  close() { this.closed = true; try { this.wsk && this.wsk.close(); } catch {} this.wsk = null; }
}
