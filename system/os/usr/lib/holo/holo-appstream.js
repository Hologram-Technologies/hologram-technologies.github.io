// holo-appstream.js — Holo Hub's data layer: the software-center model, hologram-native.
//
// Strict adherence to the actual specs KDE Discover consumes, WITHOUT its C++/Qt stack:
//
//   • AppStream (freedesktop) — a real parser for *collection* metadata
//     (<components version="…">) and the upstream *MetaInfo* form (a single
//     <component type="desktop-application">): id · name · summary · description
//     (p/ul/li) · <categories> from the freedesktop menu spec · keywords · typed
//     <url>s · <launchable type="url"> (the holospace loader) · <icon> · <screenshots>
//     · <releases> · developer · project_license/metadata_license · content_rating.
//   • The freedesktop Menu spec — the Main Categories, mapped onto Holo Hub's three
//     shelves: Education/Science/System → Learn · Office/Development/Network → Work ·
//     Game/AudioVideo/Audio/Video/Graphics → Play.
//   • ODRS (the Open Desktop Ratings Service, Discover's reviews backend) — its review
//     shape (rating 0–100 = stars×20, summary, description, version, karma up/down) and
//     star aggregation, reimplemented as a serverless, content-addressed CvRDT (sealed
//     reviews keyed by their κ, merged over a same-origin BroadcastChannel substrate —
//     and an optional relay — so reviews converge across peers with no server).
//   • Law L5 — "install" re-derives a loader's bytes and compares to the pinned κ in
//     hub/hub-manifest.json (the content-addressed analog of a Flatpak/OSTree checksum);
//     a mismatch is refused. No CDN, no framework: one vendored script, like the page.

(function () {
  "use strict";
  if (window.HoloAppStream) return;

  // ── freedesktop Menu spec — Main Categories + Holo Hub's three shelves ────────────
  const FD_MAIN = ["AudioVideo", "Audio", "Video", "Development", "Education", "Game",
    "Graphics", "Network", "Office", "Science", "Settings", "System", "Utility"];
  const SHELVES = ["Learn", "Work", "Play"];
  const SHELF_LABEL = { Learn: "Learn", Work: "Work", Play: "Play" };
  const SHELF_BLURB = {
    Learn: "Linux, emulation and the machines underneath — explore and understand.",
    Work: "Office, code, files and calls — get things done, serverless.",
    Play: "Music, video and games — content-addressed and ready to run.",
  };
  // Precedence is deliberate: an Education/Science app is Learn even if it also carries
  // System/Development; a productivity app (Office/Development/Network — including
  // videoconferencing) is Work even if it carries AudioVideo; a remaining media/game app
  // is Play; a bare System/Utility tool falls to Learn (the machines underneath).
  function shelfOf(cats) {
    const c = new Set(cats || []);
    if (c.has("Education") || c.has("Science")) return "Learn";
    if (c.has("Office") || c.has("Development") || c.has("Network")) return "Work";
    if (c.has("Game") || c.has("AudioVideo") || c.has("Audio") || c.has("Video") || c.has("Graphics")) return "Play";
    if (c.has("System") || c.has("Utility") || c.has("Settings")) return "Learn";
    return "Work";
  }

  // ── κ — content address. blake3 via the engine wasm when present, else SHA-256. ────
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  const SUBTLE = { sha256: "SHA-256", sha512: "SHA-512", sha1: "SHA-1" };
  let _wasm;
  async function blake3(u8) {
    try {
      if (_wasm === undefined) { _wasm = null; const m = await import("../pkg/holospaces_web.js").catch(() => null); if (m) { if (m.default) await m.default(); _wasm = m; } }
      if (_wasm && _wasm.kappa) { const k = _wasm.kappa(u8); return k.includes(":") ? k : "blake3:" + k; }
    } catch {}
    return null;
  }
  // The page's preferred κ (blake3 when the engine wasm is present, else SHA-256) — used
  // for display + internal content addresses that stay within one origin/engine.
  async function kappa(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return (await blake3(u8)) || "sha256:" + hex(await crypto.subtle.digest("SHA-256", u8));
  }
  // Digest with a SPECIFIC algorithm — so a re-derivation matches the algorithm its pin
  // was written in (Law L5 demands like-for-like; our manifest pins are sha256).
  async function digestWith(algo, bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (algo === "blake3") return await blake3(u8);
    const subtle = SUBTLE[algo]; if (!subtle) return null;
    return algo + ":" + hex(await crypto.subtle.digest(subtle, u8));
  }
  const enc = (s) => new TextEncoder().encode(s);

  // ── AppStream parser (DOMParser) — collection + metainfo, normalized to one shape ──
  const txt = (el, sel) => { const n = el.querySelector(sel); return n ? n.textContent.trim() : ""; };
  function parseDescription(descEl) {
    // AppStream <description> is restricted HTML: <p>, <ul>/<ol><li>, <em>, <code>.
    if (!descEl) return [];
    const blocks = [];
    for (const child of descEl.children) {
      const tag = child.tagName.toLowerCase();
      if (tag === "p") blocks.push({ p: child.textContent.trim() });
      else if (tag === "ul" || tag === "ol") blocks.push({ list: tag, items: [...child.querySelectorAll("li")].map((li) => li.textContent.trim()) });
    }
    return blocks;
  }
  function parseComponent(el) {
    const cats = [...el.querySelectorAll("categories > category")].map((c) => c.textContent.trim());
    const urls = {};
    for (const u of el.querySelectorAll("url")) urls[u.getAttribute("type") || "homepage"] = u.textContent.trim();
    const launch = el.querySelector('launchable[type="url"]');
    const screenshots = [...el.querySelectorAll("screenshots > screenshot")].map((s) => ({
      default: s.getAttribute("type") === "default",
      caption: txt(s, "caption"),
      images: [...s.querySelectorAll("image")].map((im) => ({
        url: im.textContent.trim(), kind: im.getAttribute("type") || "source",
        w: +im.getAttribute("width") || 0, h: +im.getAttribute("height") || 0,
      })),
    }));
    const releases = [...el.querySelectorAll("releases > release")].map((r) => ({
      version: r.getAttribute("version") || "", date: r.getAttribute("date") || "",
      description: parseDescription(r.querySelector("description")),
    })).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const devEl = el.querySelector("developer");
    const crEl = el.querySelector("content_rating");
    const comp = {
      id: txt(el, "id"),
      name: txt(el, "name"),
      summary: txt(el, "summary"),
      description: parseDescription(el.querySelector("description")),
      icon: txt(el, "icon"),
      categories: cats,
      keywords: [...el.querySelectorAll("keywords > keyword")].map((k) => k.textContent.trim()),
      urls,
      loader: launch ? launch.textContent.trim() : "",
      screenshots,
      releases,
      project_license: txt(el, "project_license"),
      metadata_license: txt(el, "metadata_license"),
      developer: devEl ? (txt(devEl, "name") || devEl.getAttribute("id") || "") : "",
      content_rating: crEl ? (crEl.getAttribute("type") || "") : "",
    };
    comp.version = releases[0] ? releases[0].version : "";
    comp.shelf = shelfOf(cats);
    return comp;
  }
  function parseCatalog(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("catalog.xml is not well-formed XML");
    const root = doc.documentElement;
    const comps = [...root.querySelectorAll(":scope > component, component")]
      .filter((c) => (c.getAttribute("type") || "") === "desktop-application")
      .map(parseComponent)
      .filter((c) => c.id && c.name);
    // de-dupe (a nested query can repeat); keep first by id
    const seen = new Set(), out = [];
    for (const c of comps) if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
    return { origin: root.getAttribute("origin") || "", version: root.getAttribute("version") || "", components: out };
  }

  // ── the κ manifest (Law L5) + install ledger ──────────────────────────────────────
  async function loadManifest(url) {
    const m = await (await fetch(url, { cache: "no-store" })).json();
    return m;
  }
  function pinFor(manifest, loader) {
    return (manifest.loaders && manifest.loaders[loader]) || (manifest.assets && manifest.assets[loader]) ||
      (manifest.screenshots && manifest.screenshots[loader]) || (manifest.catalog && manifest.catalog[loader]) || "";
  }
  // Re-derive a loader's bytes and compare to its pinned κ. The heart of "install".
  // The re-derivation uses the algorithm the pin declares (its prefix, e.g. sha256:),
  // falling back to the manifest's algo — so a match is a true like-for-like check.
  async function verifyLoader(loader, manifest) {
    const want = pinFor(manifest, loader);
    const algo = (want && want.includes(":") ? want.split(":")[0] : (manifest && manifest.algo)) || "sha256";
    let bytes;
    try { bytes = new Uint8Array(await (await fetch(loader, { cache: "no-store" })).arrayBuffer()); }
    catch (e) { return { ok: false, want, got: "", reason: "fetch failed" }; }
    const got = await digestWith(algo, bytes);
    return { ok: !!want && got === want, want, got, bytes };
  }

  const LEDGER = "holo-hub:installed";
  const Installs = {
    all() { try { return JSON.parse(localStorage.getItem(LEDGER) || "{}"); } catch { return {}; } },
    has(id) { return !!this.all()[id]; },
    get(id) { return this.all()[id] || null; },
    record(id, kappa, version) { const a = this.all(); a[id] = { kappa, version: version || "", at: new Date().toISOString() }; localStorage.setItem(LEDGER, JSON.stringify(a)); },
    remove(id) { const a = this.all(); delete a[id]; localStorage.setItem(LEDGER, JSON.stringify(a)); },
    list() { return Object.keys(this.all()); },
  };

  // ── ODRS — reviews (rating 0–100 = stars×20), as a serverless content-addressed CvRDT ──
  const starToRating = (s) => Math.max(0, Math.min(5, s | 0)) * 20;
  const ratingToStar = (r) => Math.round((r || 0) / 20);
  function aggregate(reviews) {
    const counts = [0, 0, 0, 0, 0]; // index 0 = 1★ … 4 = 5★
    let sum = 0, n = 0;
    for (const r of reviews) { const s = ratingToStar(r.rating); if (s >= 1 && s <= 5) { counts[s - 1]++; sum += s; n++; } }
    return { total: n, avg: n ? sum / n : 0, ratingAvg: n ? Math.round((sum / n) * 20) : 0, counts };
  }
  const karmaUp = (r) => Object.values(r.votes || {}).filter((v) => v.dir === "up").length;
  const karmaDown = (r) => Object.values(r.votes || {}).filter((v) => v.dir === "down").length;

  // CvRDT merge: union of reviews by id (immutable body); per-review votes merged LWW
  // per voter. Converges regardless of delivery order / duplication.
  function mergeReview(a, b) {
    if (!a) return b; if (!b) return a;
    const votes = Object.assign({}, a.votes);
    for (const [voter, v] of Object.entries(b.votes || {})) if (!votes[voter] || (v.ts || 0) > (votes[voter].ts || 0)) votes[voter] = v;
    return Object.assign({}, a, { votes });
  }

  class ReviewStore {
    constructor(catalogKappa, opts = {}) {
      this.ns = "holo-hub:odrs:" + (catalogKappa || "default");
      this.byId = new Map();               // reviewId → review
      this.byReviewer = new Map();         // user_hash → (reviewId → review): neighbourhood fetch (HoloRank)
      this.listeners = new Set();
      this.me = this._identity();
      this._load();
      // same-origin substrate: BroadcastChannel (serverless, multi-tab/device-on-origin)
      try {
        this.bc = new BroadcastChannel(this.ns);
        this.bc.onmessage = (e) => this._onWire(e.data);
        this.bc.postMessage({ t: "hello", from: this.me.user_hash });
      } catch { this.bc = null; }
      // optional relay (same protocol, cross-device) — JSON pub/sub over a WebSocket
      if (opts.relay) this._connectRelay(opts.relay);
    }
    _identity() {
      const key = "holo-hub:odrs-id";
      let v; try { v = JSON.parse(localStorage.getItem(key)); } catch {}
      if (!v || !v.user_hash) {
        const rnd = crypto.getRandomValues(new Uint8Array(16));
        v = { user_hash: Array.from(rnd, (b) => b.toString(16).padStart(2, "0")).join(""), user_display: "" };
        localStorage.setItem(key, JSON.stringify(v));
      }
      return v;
    }
    _load() { try { for (const r of JSON.parse(localStorage.getItem(this.ns) || "[]")) { this.byId.set(r.id, r); this._index(r); } } catch {} }
    _save() { try { localStorage.setItem(this.ns, JSON.stringify([...this.byId.values()])); } catch {} }
    onChange(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
    _emit() { for (const cb of this.listeners) try { cb(); } catch {} }
    _ingest(review) {
      const prev = this.byId.get(review.id);
      const merged = mergeReview(prev, review);
      this.byId.set(review.id, merged); this._index(merged);
      this._save(); this._emit();
      return merged;
    }
    _index(r) { let m = this.byReviewer.get(r.user_hash); if (!m) this.byReviewer.set(r.user_hash, m = new Map()); m.set(r.id, r); }
    listByReviewer(u) { const m = this.byReviewer.get(u); return m ? [...m.values()] : []; }   // reviewer → their reviews (O(1) index)
    _publish(review) {
      const msg = { t: "review", review };
      try { this.bc && this.bc.postMessage(msg); } catch {}
      try { this.relay && this.relay.readyState === 1 && this.relay.send(JSON.stringify({ op: "pub", topic: this.ns, data: msg })); } catch {}
    }
    _onWire(m) {
      if (!m || typeof m !== "object") return;
      if (m.t === "review" && m.review) this._ingest(m.review);
      else if (m.t === "hello") for (const r of this.byId.values()) this._publish(r); // anti-entropy gossip
    }
    _connectRelay(url) {
      try {
        const ws = this.relay = new WebSocket(url);
        ws.onopen = () => { ws.send(JSON.stringify({ op: "sub", topic: this.ns })); ws.send(JSON.stringify({ op: "pub", topic: this.ns, data: { t: "hello", from: this.me.user_hash } })); };
        ws.onmessage = (e) => { try { const f = JSON.parse(e.data); if (f.topic === this.ns && f.data) this._onWire(f.data); } catch {} };
      } catch {}
    }
    list(appId) {
      return [...this.byId.values()].filter((r) => r.app_id === appId)
        .sort((a, b) => (karmaUp(b) - karmaDown(b)) - (karmaUp(a) - karmaDown(a)) || (b.date_created || "").localeCompare(a.date_created || ""));
    }
    aggregate(appId) { return aggregate(this.list(appId)); }
    mine(appId) { return this.list(appId).find((r) => r.user_hash === this.me.user_hash) || null; }
    setName(name) { this.me.user_display = (name || "").slice(0, 40); localStorage.setItem("holo-hub:odrs-id", JSON.stringify(this.me)); }
    async submit({ app_id, summary, description, version, star }) {
      const body = {
        app_id, user_hash: this.me.user_hash, user_display: this.me.user_display || "Anonymous",
        summary: (summary || "").slice(0, 120), description: (description || "").slice(0, 4000),
        version: version || "", rating: starToRating(star), date_created: new Date().toISOString(),
      };
      // content address: the id IS the κ of the immutable body (Law L4/L5 — dedupes).
      // sha256 so two peers derive the SAME id whether or not the blake3 wasm is present.
      body.id = await digestWith("sha256", enc(JSON.stringify([body.app_id, body.user_hash, body.summary, body.description, body.version, body.rating, body.date_created])));
      body.votes = {};
      const merged = this._ingest(body); this._publish(merged); return merged;
    }
    vote(reviewId, dir) { // dir: "up" | "down"
      const r = this.byId.get(reviewId); if (!r) return;
      const votes = Object.assign({}, r.votes, { [this.me.user_hash]: { dir, ts: Date.now() } });
      const merged = this._ingest(Object.assign({}, r, { votes })); this._publish(merged);
    }
  }

  window.HoloAppStream = {
    FD_MAIN, SHELVES, SHELF_LABEL, SHELF_BLURB, shelfOf,
    kappa, digestWith, parseCatalog, parseComponent,
    loadManifest, pinFor, verifyLoader, Installs,
    starToRating, ratingToStar, aggregate, karmaUp, karmaDown, mergeReview, ReviewStore,
  };
})();
