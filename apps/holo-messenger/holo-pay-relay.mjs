// holo-pay-relay.mjs - the cross-internet rendezvous for the κ-ledger gossip. BroadcastChannel covers same-origin
// tabs; this extends gossip to DISTANT devices (the stranger who opened the link on their phone). The claim page is
// served BY the host, so a relay endpoint on that same origin is reachable by every claimer - no extra infra.
//
// The relay is a DUMB, UNTRUSTED mailbox: it stores opaque transitions per κ and hands them back. It cannot forge or
// alter anything - every replica re-validates each transition's signature on merge (holo-ledger.validTransition), so
// a malicious or buggy relay can at worst withhold messages, never mint a fake claim. Security is end-to-end.
//
// Two halves in one file (framework-free, no deps): `relayTransport(base)` is the client (same post/postPull/onMessage
// interface as the BroadcastChannel transport); `payRelay(req,res)` is the server handler you mount into any http
// server (returns true if it handled the request), backed by an in-memory per-κ append-log with a cursor.

// ── client transport ─────────────────────────────────────────────────────────────────────────────────────────
export function relayTransport(base, { pollMs = 1500, fetchImpl = null } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return null;                                   // no fetch (ancient runtime) → caller falls back cleanly
  const url = (k) => `${base.replace(/\/$/, "")}/pay/relay/${k}`;
  const cursors = new Map();                             // kappa -> how many transitions we've already pulled
  const active = new Set();                              // kappa we're tracking
  let handler = null, timer = null;

  const pollOne = async (k) => {
    try {
      const since = cursors.get(k) || 0;
      const r = await f(`${url(k)}?since=${since}`, { method: "GET" });
      if (!r.ok) return;
      const data = await r.json();
      const txs = (data && data.transitions) || [];
      if (data && typeof data.cursor === "number") cursors.set(k, data.cursor);
      if (txs.length && handler) handler({ type: "tx", kappa: k, transitions: txs });
    } catch {}
  };
  const tick = () => { for (const k of active) pollOne(k); };
  const ensurePolling = () => { if (!timer && typeof setInterval !== "undefined") timer = setInterval(tick, pollMs); };

  return {
    post: async (k, transitions) => {
      active.add(k); ensurePolling();
      try { await f(url(k), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(transitions) }); } catch {}
    },
    postPull: (k) => { active.add(k); ensurePolling(); pollOne(k); },   // immediate catch-up, then keep polling
    onMessage: (cb) => { handler = cb; },
    close: () => { if (timer) { clearInterval(timer); timer = null; } active.clear(); },
  };
}

// ── server handler (mount into any http.createServer) ─────────────────────────────────────────────────────────
const _MAILBOX = new Map();   // kappa -> { order: [transition,...], ids: Set(tid) }   (in-memory; swap for a κ-store)
function _box(k) { let b = _MAILBOX.get(k); if (!b) { b = { order: [], ids: new Set() }; _MAILBOX.set(k, b); } return b; }

function _readBody(req) {
  return new Promise((resolve) => {
    let buf = ""; req.on("data", (c) => { buf += c; if (buf.length > 1 << 20) req.destroy(); });   // 1MB cap - transitions are tiny
    req.on("end", () => resolve(buf)); req.on("error", () => resolve(""));
  });
}

// returns true if it handled the request (POST appends, GET reads), false to let other routes try.
export async function payRelay(req, res) {
  const m = /^\/pay\/relay\/([0-9a-f]{64})(?:\?|$)/i.exec((req.url || "").split("#")[0]);
  if (!m) return false;
  const k = m[1].toLowerCase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return true; }

  if (req.method === "POST") {
    let txs = []; try { txs = JSON.parse(await _readBody(req)) || []; } catch {}
    const b = _box(k); let added = 0;
    for (const t of Array.isArray(txs) ? txs : []) {
      if (!t || !t.tid || b.ids.has(t.tid)) continue;     // dedup by content id; relay does NOT validate (replicas do)
      b.ids.add(t.tid); b.order.push(t); added++;
    }
    res.statusCode = 200; res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: true, added, cursor: b.order.length }));
    return true;
  }

  // GET ?since=<n> → the slice the caller hasn't seen + the new cursor
  const since = Math.max(0, parseInt((/[?&]since=(\d+)/.exec(req.url || "") || [])[1] || "0", 10));
  const b = _box(k);
  res.statusCode = 200; res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ transitions: b.order.slice(since), cursor: b.order.length }));
  return true;
}

// test/diagnostic only - reset the in-memory mailbox.
export function _resetRelay() { _MAILBOX.clear(); }

// ── fanout: gossip over SEVERAL transports at once (e.g. BroadcastChannel + relay) ────────────────────────────
export function fanoutTransport(transports) {
  const ts = (transports || []).filter(Boolean);
  return {
    post: (k, txs) => ts.forEach((t) => { try { t.post(k, txs); } catch {} }),
    postPull: (k) => ts.forEach((t) => { try { t.postPull(k); } catch {} }),
    onMessage: (cb) => ts.forEach((t) => t.onMessage(cb)),
    close: () => ts.forEach((t) => { try { t.close && t.close(); } catch {} }),
  };
}
