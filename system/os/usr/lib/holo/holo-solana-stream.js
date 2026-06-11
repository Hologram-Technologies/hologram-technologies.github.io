// holo-solana-stream.js — Solana's real-time firehose.
//
// Solana has no public mempool (transactions go straight to the leader). The live,
// "alive" equivalent is the CONFIRMED-transaction firehose: eth-style push over a
// WebSocket via logsSubscribe("all") streams every transaction's signature + program
// logs the instant it lands — at ~3000+ TPS this is a torrent. Plus slotSubscribe for
// the advancing slot. Auto-reconnect, warm ring buffer, live rate. Each streamed
// signature is content-addressed (base58) and can be ed25519-verified on click.

export class SolStream {
  constructor(wsUrl) {
    this.url = wsUrl; this.ws = null; this.id = 0; this.closed = false; this.connected = false;
    this.subs = new Map(); this._open = new Map();
    this.listeners = { tx: new Set(), slot: new Set(), status: new Set() };
    this.txs = []; this.slot = null; this.seen = 0; this._stamps = []; this.backoff = 700;
  }
  on(ev, cb) { this.listeners[ev].add(cb); return () => this.listeners[ev].delete(cb); }
  _emit(ev, x) { for (const cb of this.listeners[ev]) { try { cb(x); } catch {} } }
  connect() {
    if (this.closed) return this;
    let ws; try { ws = new WebSocket(this.url); } catch { this._re(); return this; }
    this.ws = ws;
    ws.onopen = () => { this.connected = true; this.backoff = 700; this._emit("status", { connected: true }); this._sub("slotSubscribe", "slot", []); this._sub("logsSubscribe", "logs", ["all", { commitment: "processed" }]); };
    ws.onclose = () => { this.connected = false; this.subs.clear(); this._open.clear(); this._emit("status", { connected: false }); this._re(); };
    ws.onerror = () => { try { ws.close(); } catch {} };
    ws.onmessage = (e) => this._msg(e.data);
    return this;
  }
  _sub(method, kind, params) { const id = ++this.id; this._open.set(id, kind); try { this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })); } catch {} }
  _re() { if (this.closed) return; const d = this.backoff; this.backoff = Math.min(15000, Math.round(this.backoff * 1.7)); setTimeout(() => this.connect(), d); }
  _msg(data) {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.id != null && this._open.has(m.id)) { if (m.result != null) this.subs.set(m.result, this._open.get(m.id)); this._open.delete(m.id); return; }
    if (m.method === "slotNotification") { this.slot = m.params?.result?.slot ?? this.slot; this._emit("slot", this.slot); return; }
    if (m.method === "logsNotification") {
      const v = m.params?.result?.value, slot = m.params?.result?.context?.slot;
      if (!v || !v.signature) return;
      const tx = { sig: v.signature, err: v.err, slot, logs: v.logs || [], _t: Date.now() };
      this.txs.unshift(tx); this.txs = this.txs.slice(0, 120); this.seen++;
      const now = Date.now(); this._stamps.push(now); const cut = now - 5000; while (this._stamps.length && this._stamps[0] < cut) this._stamps.shift();
      this._emit("tx", tx);
    }
  }
  rate() { const cut = Date.now() - 5000; while (this._stamps.length && this._stamps[0] < cut) this._stamps.shift(); return this._stamps.length / 5; }
  close() { this.closed = true; try { this.ws && this.ws.close(); } catch {} this.ws = null; }
}
