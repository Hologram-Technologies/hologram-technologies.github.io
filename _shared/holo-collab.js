// holo-collab.js — the serverless real-time COLLABORATION engine for the
// Holo Docs holospace (Writer · Calc · Impress).
//
// One reusable engine (the idiom of _shared/holo-rtc.js / _shared/holo-gpu.js):
// `docs.html` and any other holospace drive it to co-edit a document live —
// Google-Docs-style multi-user editing — with NO application server. This is the
// honest serverless answer to LibreOffice's collaboration brief
// (help.libreoffice.org/.../collab.html): simultaneous multi-writer editing with
// per-cell conflict resolution and change tracking, but with none of LibreOffice's
// shared-file lock server or a central document service.
//
// HOW (first principles): a document is a CvRDT (a state-based, convergent
// replicated data type). Every edit is a tiny CRDT *delta*; merge is the only
// integration primitive and it is commutative, associative and idempotent, so any
// set of concurrent edits converges to the same document on every peer with no
// coordinator and no lost data. Two primitives compose every document:
//   • RGA  (Replicated Growable Array) — an ordered sequence with stable element
//     ids + tombstones. Backs Writer text, Impress slides, and the shapes on a
//     slide. Concurrent inserts at the same caret converge by a deterministic id
//     tiebreak.
//   • LWWMap (last-writer-wins map, Lamport-timestamped) — a sparse key→value
//     register set. Backs Calc cells, inline text marks, element geometry and all
//     document properties. Concurrent writes to the same key resolve by Lamport
//     clock (deterministic), and the loser is *retained* so the UI can surface the
//     LibreOffice "Resolve Conflicts" choice (Keep Mine / Keep Other / …).
//
// UOR content addressing is leveraged throughout (security · privacy · leanness ·
// integrity · scalability), exactly as Hologram Meet does for signalling:
//   • Every delta / presence / snapshot object is JSON, SEALED with an AES-256-GCM
//     room key HKDF-derived (WebCrypto) from the URL-fragment secret (#k=…),
//     published as a content-addressed κ object (κ = sha256 of the sealed bytes)
//     on the repo's content-blind κ pub/sub (holo-kappa-sync / holo-broker-sync),
//     and re-derived to its κ on receipt (Law L5). The relay sees only ciphertext
//     on an unguessable topic — content-blind. Sealing also AUTHENTICATES.
//   • A SAVED document IS its content address: snapshot → seal → κ. The canonical,
//     hologram-native URL of a document is holo://<κ>. Opening a document is
//     fetch-by-κ + verify (a lying relay can withhold but never forge a doc).
//   • Late joiners catch up by fetching a peer's sealed snapshot BY κ and merging
//     it (idempotent) — a serverless, content-addressed state-transfer with no
//     document server.
//   • Lean: the "engine" is the platform's own WebCrypto + the repo's existing κ
//     pub/sub — no vendored CRDT library, no CDN.
//
// Pure and dependency-free. Exposes a small event API (HoloCollab.open) plus the
// raw CvRDT (HoloCollab.Doc) and a no-network convergence self-test
// (HoloCollab.crdtSelftest) the witness runs in-page.

(function () {
  "use strict";
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  if (G.HoloCollab) return;

  const te = new TextEncoder();
  const td = new TextDecoder();
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const rid = () => hex(crypto.getRandomValues(new Uint8Array(8)));
  async function sha256Hex(u8) { return hex(await crypto.subtle.digest("SHA-256", u8)); }

  // ── room-secret → unguessable topic + AES-GCM key (WebCrypto HKDF) ────────────
  async function deriveRoom(secret) {
    const ikm = await crypto.subtle.importKey("raw", te.encode(String(secret)), "HKDF", false, ["deriveKey", "deriveBits"]);
    const salt = te.encode("holo-office/v1");
    const topicBits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: te.encode("doc-topic") }, ikm, 256);
    const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: te.encode("doc-key") }, ikm,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return { topic: "office:" + b64u(topicBits).slice(0, 32), key };
  }

  // Seal a JS value (or raw bytes) → { kappa, bytes }. iv(12) ‖ AES-GCM(ct).
  // κ = sha256 of the sealed bytes (Law-L5 verifiable).
  async function sealBytes(key, plain) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
    const bytes = new Uint8Array(iv.length + ct.length); bytes.set(iv, 0); bytes.set(ct, iv.length);
    return { kappa: "sha256:" + (await sha256Hex(bytes)), bytes };
  }
  const seal = (key, obj) => sealBytes(key, te.encode(JSON.stringify(obj)));
  async function openBytes(key, bytes) {
    const iv = bytes.subarray(0, 12), ct = bytes.subarray(12);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
  }
  async function open(key, bytes) { try { return JSON.parse(td.decode(await openBytes(key, bytes))); } catch { return null; } }
  // Law L5: re-derive the sealed bytes' κ and compare to the announced label.
  const verifier = (kappa, bytes) => sha256Hex(bytes).then((h) => "sha256:" + h === kappa);

  // Coalesce two CRDT deltas into one (concat per named RGA/map) — lets rapid local
  // edits (e.g. every keystroke) collapse into a SINGLE sealed κ object on the wire.
  function mergeDelta(a, b) {
    const out = { rga: { ...(a.rga || {}) }, map: { ...(a.map || {}) } };
    if (b.rga) for (const n in b.rga) out.rga[n] = (out.rga[n] || []).concat(b.rga[n]);
    if (b.map) for (const n in b.map) out.map[n] = (out.map[n] || []).concat(b.map[n]);
    if (!Object.keys(out.rga).length) delete out.rga;
    if (!Object.keys(out.map).length) delete out.map;
    return out;
  }

  // ── id helpers ───────────────────────────────────────────────────────────────
  // An element id is "<clock>@<site>" (clock = Lamport time of creation). A total
  // order on ids gives every replica the SAME deterministic tiebreak.
  const idStr = (clock, site) => clock + "@" + site;
  const idClock = (id) => parseInt(id, 10);
  const idSite = (id) => id.slice(id.indexOf("@") + 1);
  // returns >0 if id a should sort BEFORE id b among same-origin concurrent items
  // (newer/greater wins the spot nearest the origin — classic RGA).
  function cmpId(a, b) {
    const ca = idClock(a), cb = idClock(b);
    if (ca !== cb) return ca - cb;                 // higher clock first
    const sa = idSite(a), sb = idSite(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;          // tie: higher site id first
  }
  // Lamport timestamp compare for LWW: [lamport, site]; higher wins.
  function cmpTs(a, b) { if (a[0] !== b[0]) return a[0] - b[0]; return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; }

  // ── RGA — a causal-tree sequence CRDT (ordered, convergent, no interleaving) ───
  // Each item's `origin` is the id of the element it was inserted AFTER (its parent
  // in a tree; null = document root). Siblings are kept in a deterministic id order
  // (greater id first), so the tree — and the pre-order DFS that flattens it to
  // document order — is identical on every replica regardless of arrival order:
  // convergent and idempotent. Because a typed run chains each char to the
  // previous one, concurrent runs stay contiguous (no interleaving anomaly).
  class RGA {
    constructor() { this.items = new Map(); this.kids = new Map(); this._order = null; } // id→{id,origin,val,del}; kids: parentKey→[childIds]
    _kidList(p) { const k = p == null ? "" : p; let a = this.kids.get(k); if (!a) { a = []; this.kids.set(k, a); } return a; }
    // true if sibling id `a` should sort BEFORE id `b` (greater id first)
    _before(a, b) { return cmpId(a, b) > 0; }
    _integrate(it) {
      const cur = this.items.get(it.id);
      if (cur) { if (it.del) cur.del = true; return; }     // tombstones are monotone
      this.items.set(it.id, it);
      const list = this._kidList(it.origin);
      let i = 0; while (i < list.length && this._before(list[i], it.id)) i++;
      list.splice(i, 0, it.id); this._order = null;
    }
    merge(items) { for (const it of items) this._integrate(it); }
    // iterative pre-order DFS → document order (no recursion: chains can be deep)
    order() {
      if (this._order) return this._order;
      const order = [], stack = [];
      const roots = this._kidList(null);
      for (let i = roots.length - 1; i >= 0; i--) stack.push(roots[i]);
      while (stack.length) {
        const id = stack.pop(); order.push(id);
        const ch = this.kids.get(id);
        if (ch) for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
      }
      this._order = order; return order;
    }
    liveIds() { const r = []; for (const id of this.order()) if (!this.items.get(id).del) r.push(id); return r; }
    vals() { const r = []; for (const id of this.order()) { const it = this.items.get(id); if (!it.del) r.push(it.val); } return r; }
    text() { let s = ""; for (const id of this.order()) { const it = this.items.get(id); if (!it.del) s += it.val; } return s; }
    len() { return this.liveIds().length; }
    // origin anchor so a new char appears at visible index k: the live char to its left
    originForVisible(k) { if (k <= 0) return null; const live = this.liveIds(); return live[k - 1] ?? (live.length ? live[live.length - 1] : null); }
    liveIdAt(k) { return this.liveIds()[k] ?? null; }
    snapshot() { return [...this.items.values()].map((it) => [it.id, it.origin, it.val, it.del ? 1 : 0]); }
    load(arr) { this.merge(arr.map(([id, origin, val, del]) => ({ id, origin, val, del: !!del }))); }
  }

  // ── LWWMap — last-writer-wins register map (convergent), retains losers ───────
  class LWWMap {
    constructor() { this.e = new Map(); } // key → {val, ts:[lamport,site], hist:[{val,ts,site}]}
    _merge1(key, val, ts) {
      const cur = this.e.get(key);
      if (!cur) { this.e.set(key, { val, ts, hist: [] }); return true; }
      if (cmpTs(ts, cur.ts) > 0) { cur.hist.push({ val: cur.val, ts: cur.ts }); if (cur.hist.length > 8) cur.hist.shift(); cur.val = val; cur.ts = ts; return true; }
      if (cmpTs(ts, cur.ts) < 0) { cur.hist.push({ val, ts }); if (cur.hist.length > 8) cur.hist.shift(); }
      return false;
    }
    merge(entries) { for (const [k, v, ts] of entries) this._merge1(k, v, ts); }
    get(key) { const c = this.e.get(key); return c ? c.val : undefined; }
    has(key) { return this.e.has(key); }
    keys() { return [...this.e.keys()]; }
    entriesObj() { const o = {}; for (const [k, c] of this.e) o[k] = c.val; return o; }
    losers(key) { const c = this.e.get(key); return c ? c.hist.slice() : []; } // for Resolve-Conflicts UI
    snapshot() { return [...this.e].map(([k, c]) => [k, c.val, c.ts]); }
    load(arr) { this.merge(arr); }
  }

  // ── Doc — a CvRDT container of named RGAs + LWWMaps ───────────────────────────
  class Doc {
    constructor(kind) { this.kind = kind || "writer"; this.rgas = new Map(); this.maps = new Map(); this.clock = 0; this.site = rid().slice(0, 6); }
    rga(name) { let r = this.rgas.get(name); if (!r) { r = new RGA(); this.rgas.set(name, r); } return r; }
    map(name) { let m = this.maps.get(name); if (!m) { m = new LWWMap(); this.maps.set(name, m); } return m; }
    tick() { return ++this.clock; }
    observe(ts) { if (Array.isArray(ts) && ts[0] > this.clock) this.clock = ts[0]; }

    // ── local ops → return a delta to broadcast (and mutate locally) ────────────
    insert(name, visIndex, vals) {
      const r = this.rga(name); const items = [];
      let origin = r.originForVisible(visIndex);
      for (const val of vals) {
        const id = idStr(this.tick(), this.site);
        const it = { id, origin, val, del: false };
        r._integrate(it); items.push([it.id, it.origin, it.val, 0]); origin = id;
      }
      return { rga: { [name]: items } };
    }
    delete(name, visIndex, count) {
      const r = this.rga(name); const ids = r.liveIds(); const items = [];
      for (let i = 0; i < count && visIndex + i < ids.length; i++) {
        const id = ids[visIndex + i]; const it = r.items.get(id); if (it) { it.del = true; items.push([id, it.origin, it.val, 1]); }
      }
      return { rga: { [name]: items } };
    }
    deleteIds(name, idList) {
      const r = this.rga(name); const items = [];
      for (const id of idList) { const it = r.items.get(id); if (it) { it.del = true; items.push([id, it.origin, it.val, 1]); } }
      return { rga: { [name]: items } };
    }
    set(name, key, val) {
      const ts = [this.tick(), this.site]; this.map(name)._merge1(key, val, ts);
      return { map: { [name]: [[key, val, ts]] } };
    }
    setMany(name, kv) {
      const out = []; for (const [k, v] of kv) { const ts = [this.tick(), this.site]; this.map(name)._merge1(k, v, ts); out.push([k, v, ts]); }
      return { map: { [name]: out } };
    }

    // ── integrate a remote delta (convergent + idempotent) ──────────────────────
    applyDelta(d) {
      if (!d) return;
      if (d.rga) for (const name in d.rga) { const arr = d.rga[name]; this.rga(name).load(arr); for (const it of arr) this.observe([idClock(it[0]), 0]); }
      if (d.map) for (const name in d.map) { const arr = d.map[name]; this.map(name).merge(arr); for (const e of arr) this.observe(e[2]); }
    }
    snapshot() {
      const rgas = {}, maps = {};
      for (const [n, r] of this.rgas) rgas[n] = r.snapshot();
      for (const [n, m] of this.maps) maps[n] = m.snapshot();
      return { kind: this.kind, clock: this.clock, rgas, maps };
    }
    // Deterministic canonical form (sorted) → the document's STABLE content address.
    // Converged replicas produce byte-identical canonical bytes (clock excluded: it
    // is replica bookkeeping, not content), so holo://<sha256(canonical)> is the
    // document's hologram-native URL and re-derives on every peer (Law L5).
    canonical() {
      const byKey = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      const rgas = {}, maps = {};
      for (const n of [...this.rgas.keys()].sort()) rgas[n] = this.rgas.get(n).snapshot().slice().sort(byKey);
      for (const n of [...this.maps.keys()].sort()) maps[n] = this.maps.get(n).snapshot().slice().sort(byKey);
      return JSON.stringify({ kind: this.kind, rgas, maps });
    }
    async contentAddress() { return "sha256:" + (await sha256Hex(te.encode(this.canonical()))); }
    load(snap) {
      if (!snap) return; if (snap.kind) this.kind = snap.kind; this.observe([snap.clock || 0, 0]);
      for (const n in (snap.rgas || {})) this.rga(n).load(snap.rgas[n]);
      for (const n in (snap.maps || {})) this.map(n).load(snap.maps[n]);
    }
  }

  // ── Session — wires a Doc to the content-blind κ pub/sub (mirrors the Meet
  //    data-plane: seal → content-address → announce → fetch+verify → merge) ─────
  class Session {
    constructor(opts) {
      this.opts = opts; this.sync = opts.sync; this.myId = rid();
      this.kind = opts.kind || "writer";
      this.doc = new Doc(this.kind);
      this.name = opts.name || "Guest-" + this.myId.slice(0, 4);
      this.color = opts.color || "#2dd4bf";
      this._seen = new Set(); this._store = new Map(); // κ → sealed bytes we serve (snapshots/images)
      this.peers = new Map();  // peerId → {name,color,cursor,sel,last}
      this._timers = []; this._snapTimer = null; this.started = false;
      this._pending = null; this._flushT = null; this.coalesceMs = opts.coalesceMs == null ? 60 : opts.coalesceMs; // op-coalescing
      const noop = () => {};
      this.cb = {
        onchange: opts.onchange || noop, onpresence: opts.onpresence || noop,
        onpeer: opts.onpeer || noop, onleave: opts.onleave || noop,
        onsaved: opts.onsaved || noop, onconflict: opts.onconflict || noop, onerror: opts.onerror || noop,
      };
    }

    async start() {
      const { topic, key } = await deriveRoom(this.opts.secret);
      this.topic = topic; this.key = key;
      if (this.opts.snapshot) this.doc.load(this.opts.snapshot);   // seed (e.g. opened by κ)
      await this.sync.subscribe(this.topic, (t, kappa) => { if (t === this.topic) this._recv(kappa); });
      await this._announce({ t: "hello", ...this._presenceMsg() });
      await this._announce({ t: "sync-req" });                     // ask peers for current state
      this._timers.push(setInterval(() => this._announce({ t: "presence", ...this._presenceMsg() }), 4000));
      this._timers.push(setInterval(() => this._gcPeers(), 6000));
      this.started = true; this.cb.onchange();
      return this;
    }

    _presenceMsg() { return { name: this.name, color: this.color, cursor: this.cursor || null, sel: this.sel || null }; }

    async _announce(msg) {
      const full = { ...msg, from: this.myId };
      const { kappa, bytes } = await seal(this.key, full);
      this._seen.add(kappa);
      await this.sync.announce(this.topic, kappa, bytes);
    }
    // seal an out-of-band blob (snapshot / image) and serve it by κ
    async _put(obj) {
      const { kappa, bytes } = await seal(this.key, obj);
      this._store.set(kappa, bytes); await this.sync.announce(this.topic, kappa, bytes); return kappa;
    }
    async _getByKappa(kappa) {
      let bytes = this._store.get(kappa) || await this.sync.fetch(kappa, { verify: verifier });
      if (!bytes) return null; return open(this.key, bytes);
    }

    // Buffer a local op; render immediately (responsive), but seal+announce the
    // COALESCED delta once per coalesce window — far fewer κ objects + less crypto
    // and network for the same edits (lean, low-latency). coalesceMs=0 = immediate.
    _queue(delta) {
      this._pending = this._pending ? mergeDelta(this._pending, delta) : delta;
      this.cb.onchange();
      if (this.coalesceMs <= 0) return this._flush();
      if (!this._flushT) this._flushT = setTimeout(() => this._flush(), this.coalesceMs);
    }
    _flush() { clearTimeout(this._flushT); this._flushT = null; const d = this._pending; this._pending = null; if (d) this._announce({ t: "op", delta: d }); }

    async _recv(kappa) {
      if (this._seen.size > 5000) this._seen.clear();   // bound memory (dedup is best-effort; applyDelta is idempotent)
      if (this._seen.has(kappa)) return; this._seen.add(kappa);
      const bytes = await this.sync.fetch(kappa, { verify: verifier }); if (!bytes) return;
      this._store.set(kappa, bytes);
      const m = await open(this.key, bytes); if (!m || !m.from || m.from === this.myId) return;
      try { await this._dispatch(m); } catch (e) { this.cb.onerror(e); }
    }

    async _dispatch(m) {
      switch (m.t) {
        case "hello": this._seePeer(m); this._announce({ t: "presence", ...this._presenceMsg() }); this._sendSnapshot(); break;
        case "presence": this._seePeer(m); break;
        case "op": this.doc.applyDelta(m.delta); this._detectConflicts(m.delta); this.cb.onchange(); break;
        case "snap": { const snap = await this._getByKappa(m.kappa); if (snap) { this.doc.load(snap); this.cb.onchange(); } break; }
        case "sync-req": this._sendSnapshot(); this._announce({ t: "presence", ...this._presenceMsg() }); break;
        case "bye": if (this.peers.delete(m.from)) { this.cb.onleave(m.from); this.cb.onpresence(this.roster()); } break;
      }
    }

    _seePeer(m) {
      const had = this.peers.has(m.from);
      const p = this.peers.get(m.from) || {};
      p.name = m.name || p.name || m.from.slice(0, 6); p.color = m.color || p.color || "#888";
      if ("cursor" in m) p.cursor = m.cursor; if ("sel" in m) p.sel = m.sel; p.last = Date.now();
      this.peers.set(m.from, p);
      if (!had) this.cb.onpeer(m.from, p);
      this.cb.onpresence(this.roster());
    }
    _gcPeers() { const now = Date.now(); let changed = false; for (const [id, p] of this.peers) if (now - p.last > 15000) { this.peers.delete(id); this.cb.onleave(id); changed = true; } if (changed) this.cb.onpresence(this.roster()); }

    // snapshot send for late joiners (sealed, content-addressed, fetched by κ)
    async _sendSnapshot() { try { const kappa = await this._put(this.doc.snapshot()); await this._announce({ t: "snap", kappa }); } catch (e) { this.cb.onerror(e); } }

    // surface genuine same-key concurrent writes (LibreOffice "Resolve Conflicts")
    _detectConflicts(delta) {
      if (!delta || !delta.map) return;
      for (const name in delta.map) for (const [key] of delta.map[name]) {
        const losers = this.doc.map(name).losers(key);
        if (losers.length) this.cb.onconflict({ map: name, key, value: this.doc.map(name).get(key), losers });
      }
    }

    // ── editor-facing API: mutate locally + broadcast the delta ─────────────────
    insert(name, index, vals) { const d = this.doc.insert(name, index, vals); this._queue(d); return d; }
    delete(name, index, count) { const d = this.doc.delete(name, index, count); this._queue(d); return d; }
    deleteIds(name, ids) { const d = this.doc.deleteIds(name, ids); this._queue(d); return d; }
    set(name, key, val) { const d = this.doc.set(name, key, val); this._queue(d); return d; }
    setMany(name, kv) { const d = this.doc.setMany(name, kv); this._queue(d); return d; }

    // reads
    seqIds(name) { return this.doc.rga(name).liveIds(); }
    seqVals(name) { return this.doc.rga(name).vals(); }
    text(name) { return this.doc.rga(name).text(); }
    val(name, key) { return this.doc.map(name).get(key); }
    mapObj(name) { return this.doc.map(name).entriesObj(); }
    mapKeys(name) { return this.doc.map(name).keys(); }
    losers(name, key) { return this.doc.map(name).losers(key); }

    // presence
    setCursor(cursor, sel) { this.cursor = cursor || null; this.sel = sel || null; this._throttlePresence(); }
    _throttlePresence() { if (this._presT) return; this._presT = setTimeout(() => { this._presT = null; this._announce({ t: "presence", ...this._presenceMsg() }); }, 120); }
    setName(name) { this.name = String(name).slice(0, 40) || this.name; this._announce({ t: "presence", ...this._presenceMsg() }); return this.name; }
    setColor(c) { this.color = c; this._announce({ t: "presence", ...this._presenceMsg() }); }
    roster() { return [{ id: this.myId, name: this.name, color: this.color, cursor: this.cursor, sel: this.sel, you: true },
      ...[...this.peers].map(([id, p]) => ({ id, name: p.name, color: p.color, cursor: p.cursor, sel: p.sel, you: false }))]; }
    peerCount() { return this.peers.size + 1; }

    // ── content-addressed document persistence (a saved doc IS its κ) ────────────
    // The document's canonical content address (stable holo:// URL) + the raw
    // snapshot, so the shell can persist it locally and publish it for peers.
    async save() {
      this._flush();                                       // push any buffered ops to peers
      const ca = await this.doc.contentAddress();          // stable holo://<ca>
      const snapshot = this.doc.snapshot();
      try { await this._put(snapshot); } catch {}          // also seal+serve for live peers
      this.cb.onsaved(ca, snapshot); return ca;
    }
    async contentAddress() { return this.doc.contentAddress(); }
    loadSnapshot(snap) { if (snap) { this.doc.load(snap); this.cb.onchange(); return true; } return false; }
    async load(kappa) { const snap = await this._getByKappa(kappa); if (snap) { this.doc.load(snap); this.cb.onchange(); return true; } return false; }
    // content-addressed embedded asset (e.g. an Impress image): seal → κ → serve
    async putAsset(bytes) { const { kappa, bytes: sealed } = await sealBytes(this.key, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); this._store.set(kappa, sealed); await this.sync.announce(this.topic, kappa, sealed); return kappa; }
    async getAsset(kappa) { let b = this._store.get(kappa) || await this.sync.fetch(kappa, { verify: verifier }); if (!b) return null; return openBytes(this.key, b); }

    async leave() { this._flush(); this._timers.forEach(clearInterval); this._timers = []; try { await this._announce({ t: "bye" }); } catch {} try { this.sync && this.sync.close && this.sync.close(); } catch {} }
  }

  async function openSession(opts) { const s = new Session(opts); await s.start(); return s; }

  // ── pure, no-network convergence self-test (the witness runs this in-page) ─────
  // Two independent docs apply the SAME ops in DIFFERENT orders and must converge
  // to byte-identical text + cells — the CvRDT correctness guarantee.
  function crdtSelftest() {
    const a = new Doc("test"), b = new Doc("test");
    a.site = "aaa"; b.site = "bbb";
    const dA = a.insert("t", 0, [..."HELLO"]);          // A types HELLO
    const dB = b.insert("t", 0, [..."WORLD"]);          // B concurrently types WORLD at same caret
    b.applyDelta(dA); a.applyDelta(dB);                  // exchange (different local order)
    const textConverged = a.rga("t").text() === b.rga("t").text();
    // concurrent same-cell write (LWW + retained loser → Resolve-Conflicts)
    const cA = a.set("cells", "A1", "10"); const cB = b.set("cells", "A1", "20");
    a.applyDelta(cB); b.applyDelta(cA);
    const cellConverged = a.map("cells").get("A1") === b.map("cells").get("A1");
    const loserRetained = a.map("cells").losers("A1").length > 0;
    // delete converges
    const dD = a.delete("t", 0, 1); b.applyDelta(dD);
    const afterDelete = a.rga("t").text() === b.rga("t").text();
    // idempotent re-merge changes nothing
    const before = a.rga("t").text(); a.applyDelta(dA); a.applyDelta(dB);
    const idempotent = a.rga("t").text() === before;
    return { textConverged, cellConverged, loserRetained, afterDelete, idempotent,
      ok: textConverged && cellConverged && loserRetained && afterDelete && idempotent };
  }

  G.HoloCollab = { open: openSession, deriveRoom, seal, unseal: open, sealBytes, openBytes, verifier, Doc, RGA, LWWMap, Session, crdtSelftest };
  if (typeof module !== "undefined" && module.exports) module.exports = G.HoloCollab;
})();
