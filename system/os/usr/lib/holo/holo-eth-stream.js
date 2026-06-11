// holo-eth-stream.js — the real-time, low-latency layer for Holo Etherscan.
//
// Reads Ethereum as CLOSE TO THE SOURCE as a browser can, with the lowest latency:
//   • PUSH over WebSocket (not polling) to OPEN, key-less public nodes (publicnode — a
//     public good — and a second open node), subscribing eth_subscribe("newHeads") +
//     eth_subscribe("newPendingTransactions", true) for the FULL live mempool.
//   • REDUNDANT SOURCE RACING — multiple node connections, the FIRST arrival of each
//     block/tx wins (dedup by hash). More paths ⇒ lower tail latency, like multipath I/O.
//   • ONE WARM PIPE — every JSON-RPC request (the κ re-derivation fetches) is multiplexed
//     over the SAME persistent socket (request/response by id), so there is no per-call
//     TLS/HTTP handshake; a κ check is a single in-flight frame on an open connection.
//
// UOR magic: a `newHeads` notification carries the whole header, so each block is
// re-derived (keccak256/RLP) and κ-verified the MOMENT it arrives — zero extra round
// trip. Latency (block-timestamp→arrival) and live WS round-trip (RTT) are measured so
// the speed is visible. Auto-reconnect per source; warm ring buffers; bounded dedup.

export class EthStream {
  constructor(urls, { verify = null } = {}) {
    this.urls = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
    this.verify = verify; this.closed = false;
    this.conns = this.urls.map((u) => ({ url: u, ws: null, connected: false, subs: new Map(), openSub: new Map(), backoff: 700 }));
    this.callId = 0; this.calls = new Map();                 // id -> { resolve, reject, timer }
    this.listeners = { block: new Set(), pending: new Set(), status: new Set() };
    this.blocks = []; this.mempool = [];
    this.seenBlocks = new Set(); this.seenPending = new Set(); this._pendOrder = [];
    this.pendingCount = 0; this._stamps = [];
    this.lastBlockLatencyMs = null; this.rttMs = null; this._ping = null;
  }
  on(ev, cb) { this.listeners[ev].add(cb); return () => this.listeners[ev].delete(cb); }
  _emit(ev, x) { for (const cb of this.listeners[ev]) { try { cb(x); } catch {} } }
  get connected() { return this.conns.some((c) => c.connected); }
  get sources() { return this.conns.filter((c) => c.connected).length; }

  connect() { for (const c of this.conns) this._open(c); if (!this._ping) this._ping = setInterval(() => this._pingOnce(), 4000); return this; }
  _open(c) {
    if (this.closed) return;
    let ws; try { ws = new WebSocket(c.url); } catch { return this._re(c); }
    c.ws = ws;
    ws.onopen = () => { c.connected = true; c.backoff = 700; this._status(); this._sub(c, "newHeads", "block"); this._sub(c, "newPendingTransactions", "pending", true); };
    ws.onclose = () => { c.connected = false; c.subs.clear(); c.openSub.clear(); this._status(); this._re(c); };
    ws.onerror = () => { try { ws.close(); } catch {} };
    ws.onmessage = (e) => this._msg(c, e.data);
  }
  _re(c) { if (this.closed) return; const d = c.backoff; c.backoff = Math.min(15000, Math.round(c.backoff * 1.7)); setTimeout(() => this._open(c), d); }
  _status() { this._emit("status", { connected: this.connected, sources: this.sources }); }
  _sub(c, method, kind, full) { const id = "s" + ++this.callId; c.openSub.set(id, kind); try { c.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method: "eth_subscribe", params: full ? [method, true] : [method] })); } catch {} }

  // multiplexed JSON-RPC over the warm socket (no per-call HTTP/TLS)
  call(method, params = [], timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const c = this.conns.find((x) => x.connected); if (!c) return reject(new Error("no live socket"));
      const id = "c" + ++this.callId;
      const timer = setTimeout(() => { this.calls.delete(id); reject(new Error("ws call timeout")); }, timeoutMs);
      this.calls.set(id, { resolve, reject, timer });
      try { c.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })); } catch (e) { clearTimeout(timer); this.calls.delete(id); reject(e); }
    });
  }
  batch(calls) { return Promise.all(calls.map((x) => this.call(x.method, x.params || []))); }

  _msg(c, data) {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.id != null) {
      if (c.openSub.has(m.id)) { if (m.result) c.subs.set(m.result, c.openSub.get(m.id)); c.openSub.delete(m.id); return; }
      const call = this.calls.get(m.id);
      if (call) { clearTimeout(call.timer); this.calls.delete(m.id); m.error ? call.reject(new Error(m.error.message || "rpc error")) : call.resolve(m.result); }
      return;
    }
    if (m.method !== "eth_subscription") return;
    const kind = c.subs.get(m.params.subscription), r = m.params.result;
    if (kind === "block" && r && r.parentHash) this._block(r);
    else if (kind === "pending" && r && typeof r === "object" && r.hash) this._pending(r);
  }
  _block(h) {
    if (this.seenBlocks.has(h.hash)) return;                 // first source to deliver wins
    this.seenBlocks.add(h.hash); if (this.seenBlocks.size > 80) this.seenBlocks = new Set([...this.seenBlocks].slice(-48));
    let kappa = null; try { kappa = this.verify ? this.verify(h) : null; } catch { kappa = null; }
    h._kappa = kappa; h._t = Date.now();
    const ts = parseInt(h.timestamp, 16) * 1000; if (ts > 0) this.lastBlockLatencyMs = Math.max(0, Date.now() - ts);
    this.blocks.unshift(h); this.blocks = this.blocks.slice(0, 18);
    this._emit("block", h);
  }
  _pending(tx) {
    if (this.seenPending.has(tx.hash)) return;               // dedup across racing sources
    this.seenPending.add(tx.hash); this._pendOrder.push(tx.hash);
    if (this._pendOrder.length > 6000) for (const old of this._pendOrder.splice(0, 2000)) this.seenPending.delete(old);
    tx._t = Date.now();
    this.mempool.unshift(tx); this.mempool = this.mempool.slice(0, 120);
    this.pendingCount++; const now = Date.now(); this._stamps.push(now); const cut = now - 5000; while (this._stamps.length && this._stamps[0] < cut) this._stamps.shift();
    this._emit("pending", tx);
  }
  rate() { const cut = Date.now() - 5000; while (this._stamps.length && this._stamps[0] < cut) this._stamps.shift(); return this._stamps.length / 5; }
  async _pingOnce() { if (!this.connected) return; const t0 = performance.now(); try { await this.call("eth_blockNumber", [], 4000); const dt = performance.now() - t0; this.rttMs = this.rttMs == null ? dt : this.rttMs * 0.6 + dt * 0.4; } catch {} }
  close() { this.closed = true; clearInterval(this._ping); this._ping = null; for (const c of this.conns) { try { c.ws && c.ws.close(); } catch {} c.ws = null; } }
}
