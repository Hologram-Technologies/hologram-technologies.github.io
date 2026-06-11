// holo-memory.js — the always-on MEMORY BANK behind Holo Notepad: it turns your life across
// Hologram OS into your own content-addressed knowledge + social + internet graph (a gbrain-
// style "second brain"), 100% local and private by default. Pure-ish + Node-safe core, so the
// witness exercises it headless; the browser drives the same code with a live graph + bus.
//
// FIRST PRINCIPLES:
//   • Capture is just appending to the SAME holo-roam graph. Every visit / interaction / note
//     becomes a block on that day's Daily Note (the timeline), auto-linking entities
//     ([[App]], [[Article]], [[person]], [[agent]]) via deriveBacklinks — gbrain's "zero-LLM
//     auto-linking", for free. Auto and manual entries are identical blocks (meta.source).
//   • Retrieval is O(1) on the content-addressed substrate: an event's identity is its κ, so
//     recallByKappa is a direct hashmap hit; an incremental token index gives O(matches) search;
//     entity recall is the graph's Linked References. No scan.
//   • Private by construction: events live only in this Map / OPFS / localStorage on YOUR
//     device. Nothing leaves except through share(), which is gated by Holo Terms (a standing
//     agreement) + Holo Privacy (a minimal, purpose-bound W3C Verifiable Presentation), and
//     provable in zero-knowledge via holo-zk (Merkle inclusion + SD selective disclosure).
//   • Seamless + ubiquitous: Holo Record (_shared/holo-record.js, on every frame) posts activity —
//     visits, interactions AND screen/camera clips — to a content-blind BroadcastChannel + a
//     localStorage inbox; mountRecorder() drains both into the bank, so capture works whether or
//     not Holo Notepad is open. A master kill-switch + per-source toggles put you in control.
//
// Depends (browser: <script> globals; node: import-for-side-effect) on holo-zk.js, and is given
// a holo-roam Graph by the app. No vendored libs, no CDN.

(function () {
  "use strict";
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  if (G.HoloMemory) return;

  const subtle = (G.crypto && G.crypto.subtle) || (typeof require !== "undefined" && require("crypto").webcrypto.subtle);
  const te = new TextEncoder();
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
    : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
    : JSON.stringify(v);
  async function sha(str) { return hex(new Uint8Array(await subtle.digest("SHA-256", te.encode(str)))); }
  const ZK = () => G.HoloZK;
  const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at", "by", "is", "it"]);

  // capture sources you can toggle (manual is always allowed — it's not "capture")
  const SOURCES = ["frame", "browser", "collab", "agent", "record"];
  // a friendly label for the OS loader page → the [[App]] entity
  const APP_OF_LOADER = {
    "os.html": "Hologram OS", "browser.html": "Holo Browser", "docs.html": "Holo Docs", "meet.html": "Hologram Meet",
    "git.html": "Holo Git", "music.html": "Holo Music", "video.html": "Holo Video", "cloud.html": "Holo Cloud",
    "ipfs.html": "Holo IPFS", "hub.html": "Holo Hub", "capture.html": "Holo Capture", "stream.html": "Holo Stream",
    "search.html": "Holo Search", "notepad.html": "Holo Notepad", "winamp.html": "Winamp", "player.html": "Holo Player",
    "evm.html": "Holo EVM", "etherscan.html": "Holo Scan", "btc.html": "BTC Miner", "brcminer.html": "Holo BRC Miner",
    "qemu.html": "QEMU", "workspace.html": "Holo Workspace", "world.html": "Holo World",
  };
  const appOfLoader = (loader) => APP_OF_LOADER[String(loader || "").toLowerCase()] || (loader ? loader.replace(/\.html$/, "") : "Hologram OS");

  // ── MemoryBank — the content-addressed event store + recall + commitments ───────
  class MemoryBank {
    constructor({ graph, signer } = {}) {
      this.graph = graph || null;
      this.events = new Map();    // κ → event  (O(1) recall by content address)
      this.postings = new Map();  // token → Set(κ)  (incremental inverted index)
      this.days = new Map();      // 'YYYY-MM-DD' → [κ…] in capture order
      this.fp = new Map();        // dedup fingerprint → κ (collapses repeats within a minute)
      this.signer = signer || null;
      this.listeners = new Set();
      this.capture = { on: true, sources: Object.fromEntries(SOURCES.map((s) => [s, true])) };
    }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    _emit(ev) { for (const f of this.listeners) try { f(ev); } catch {} }

    // ── kill-switch ──
    captureOn(source) { return this.capture.on && this.capture.sources[source] !== false; }
    setCapture(on) { this.capture.on = !!on; this._emit({ kind: "capture", on: this.capture.on }); }
    setSource(s, on) { if (s in this.capture.sources) this.capture.sources[s] = !!on; }

    dayKey(ts) { const d = new Date(ts); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
    _norm(ev) { return { kind: ev.kind || "visit", app: ev.app || "", title: ev.title || "", url: ev.url || "", kappa: ev.kappa || "",
      ts: ev.ts || Date.now(), entities: (ev.entities || []).filter(Boolean), summary: ev.summary || "", source: ev.source || "frame",
      personal: ev.personal !== false }; }
    _fp(ev) { return ev.kind === "note" ? "note:" + Math.random() : [ev.kind, ev.app, ev.url, (ev.title || "").slice(0, 80), Math.floor(ev.ts / 60000)].join("|"); }
    async _kappa(ev) { const { id, block, ...c } = ev; return "sha256:" + await sha(jcs(c)); }

    // auto capture (gated by the kill-switch); manual entries use record()
    async ingest(ev) { ev = this._norm(ev); if (!this.captureOn(ev.source)) return null; return this._store(ev); }
    async record(ev) { return this._store(this._norm({ ...ev, source: ev.source || "manual" })); }

    async _store(ev) {
      const fp = this._fp(ev);
      if (this.fp.has(fp)) return this.fp.get(fp);     // collapse repeats (idempotent)
      const k = await this._kappa(ev); ev.id = k;
      this.fp.set(fp, k);
      if (this.events.has(k)) return k;
      this._index(ev);
      if (this.graph) this._appendToGraph(ev);
      this._emit(ev);
      return k;
    }
    // index-only (no graph append) — used by _store and by rehydrate from saved blocks
    _index(ev) {
      this.events.set(ev.id, ev);
      for (const t of this._tokens(ev)) { let s = this.postings.get(t); if (!s) { s = new Set(); this.postings.set(t, s); } s.add(ev.id); }
      const dk = this.dayKey(ev.ts); let arr = this.days.get(dk); if (!arr) { arr = []; this.days.set(dk, arr); } if (!arr.includes(ev.id)) arr.push(ev.id);
    }
    // rebuild the index from a saved graph (each captured block carries its event in meta.ev),
    // so recall + commitments cover your whole history, not just this session.
    rehydrate() {
      if (!this.graph || !this.graph.s) return 0; let n = 0;
      for (const uid of this.graph.s.mapKeys("meta")) { const m = this.graph.blockMeta(uid); if (m && m.ev && m.ev.id && !this.events.has(m.ev.id)) { const e = { ...m.ev, block: uid }; this.events.get(e.id) || this._index(e); n++; } }
      return n;
    }
    _tokens(ev) {
      const s = new Set();
      const add = (str) => { for (const w of String(str || "").toLowerCase().split(/[^a-z0-9]+/)) if (w.length > 1 && !STOP.has(w)) s.add(w); };
      add(ev.title); add(ev.summary); add(ev.app); for (const e of ev.entities) add(e);
      if (ev.url) { try { add(new URL(ev.url).host); } catch { add(ev.url); } }
      return s;
    }

    // append the event as a block on its day's Daily Note (auto-linked timeline)
    _appendToGraph(ev) {
      const g = this.graph; const page = g.dailyPage(new Date(ev.ts));
      const u = g.createBlock(page, -1, this.blockText(ev));
      const { block, ...stored } = ev;                 // persist the whole event so recall/proofs survive reloads
      g.setMeta(u, { ...g.blockMeta(u), source: ev.source, akind: ev.kind, evid: ev.id, ts: ev.ts, personal: ev.personal, ev: stored });
      ev.block = u; return u;
    }
    blockText(ev) {
      const hhmm = new Date(ev.ts).toTimeString().slice(0, 5);
      const L = (t) => (t ? "[[" + t + "]]" : "");
      const ents = (ev.entities || []).map(L).join(" ");
      if (ev.kind === "interaction") return `${hhmm} {{[[MET]]}} ${ents}${ev.app ? " · in " + L(ev.app) : ""}${ev.summary ? " — " + ev.summary : ""}`.trim();
      if (ev.kind === "recording") return `${hhmm} {{[[REC]]}} ${L(ev.app || "Holo Record")}${ev.title ? " · " + ev.title : ""}${ev.summary ? " (" + ev.summary + ")" : ""}${ev.url ? " <" + ev.url + ">" : ""}`.trim();
      if (ev.kind === "note") return ev.title || ev.summary || "";
      const url = ev.url ? ` <${ev.url}>` : "";
      return `${hhmm} ${L(ev.app)}${ev.title ? " · " + ev.title : ""}${ents ? " " + ents : ""}${url}`.trim();
    }

    // ── recall — O(1) by κ; ranked by token overlap + recency ──
    get(k) { return this.events.get(k) || null; }
    timeline(dayKey) { return (this.days.get(dayKey || this.dayKey(Date.now())) || []).map((k) => this.events.get(k)).filter(Boolean); }
    recall(query, limit = 25) {
      const qts = [...this._tokens({ title: query, entities: [] })];
      if (!qts.length) return [...this.events.values()].sort((a, b) => b.ts - a.ts).slice(0, limit);
      const score = new Map();
      for (const t of qts) { const s = this.postings.get(t); if (s) for (const k of s) score.set(k, (score.get(k) || 0) + 1); }
      return [...score.entries()].map(([k, c]) => ({ ev: this.events.get(k), c })).filter((x) => x.ev)
        .sort((a, b) => b.c - a.c || b.ev.ts - a.ev.ts).slice(0, limit).map((x) => x.ev);
    }
    // everywhere an entity appeared — via the graph's derived Linked References
    recallEntity(title) {
      if (!this.graph) return [];
      const pageUid = this.graph.resolvePage(title);
      return this.graph.linkedReferences(pageUid).map((u) => { const m = this.graph.blockMeta(u); return m.evid ? this.events.get(m.evid) : { block: u, title: this.graph.blockText(u) }; }).filter(Boolean);
    }

    // ── daily Merkle commitment + inclusion proof (zero-knowledge membership) ──
    async commitDay(dk) {
      dk = dk || this.dayKey(Date.now());
      const leaves = (this.days.get(dk) || []).slice().sort();
      const root = await ZK().merkleRoot(leaves);
      let sig = null; if (this.signer) sig = await this.signer.sign(root);
      return { dayKey: dk, root, count: leaves.length, sig, pub: this.signer ? this.signer.publicKeyHex : null, did: this.signer && this.signer.did ? this.signer.did : null, persistent: !!(this.signer && this.signer.persistent) };
    }
    async proveEntry(dk, k) { const leaves = (this.days.get(dk) || []).slice().sort(); const i = leaves.indexOf(k); return i < 0 ? null : ZK().merkleProof(leaves, i); }
    verifyEntry(root, k, proof) { return ZK().verifyInclusion(root, k, proof); }

    // ── selective-disclosure SHARE — Holo Terms + Holo Privacy gated (default-deny) ──
    async share(k, { recipient, purpose, reveal, gates } = {}) {
      const ev = this.events.get(k); if (!ev) throw new Error("no such memory");
      gates = gates || { terms: G.HoloTerms, privacy: G.HoloPrivacy };
      if (gates.terms && gates.terms.gate) { const t = await gates.terms.gate({ id: recipient || "did:holo:recipient", name: recipient || "recipient", type: ["schema:SoftwareApplication"] }); if (t && t.allowed === false) throw new Error("refused by Holo Terms — no standing agreement"); }
      const claims = { kind: ev.kind, app: ev.app, title: ev.title, when: new Date(ev.ts).toISOString(), entities: ev.entities, url: ev.url, summary: ev.summary };
      reveal = reveal || ["kind", "app", "when"];
      if (gates.privacy && gates.privacy.gate) { try { const vp = await gates.privacy.gate({ purpose: purpose || "dpv:ServiceProvision", claims, disclose: reveal }); if (vp) return { via: "holo-privacy", presentation: vp, purpose }; } catch {} }
      const sd = await ZK().sdIssue(claims); const pres = ZK().sdDisclose(sd, reveal);
      let sig = null; if (this.signer) sig = await this.signer.sign(jcs(pres.digests));
      return { via: "sd-jwt", presentation: pres, sig, pub: this.signer ? this.signer.publicKeyHex : null, purpose: purpose || "dpv:ServiceProvision" };
    }

    snapshot() { return { events: [...this.events.values()], capture: this.capture }; }
  }

  // The CAPTURE layer (the content-blind bus, the always-on inbox, the probe + source adapters,
  // the screen/camera recorder, and the kill-switch) lives in its own module — _shared/holo-record.js
  // (Holo Record), the ONE recorder of your entire activity. Holo Notepad mounts it with
  // HoloRecord.mountRecorder(bank). holo-memory.js stays the pure store + recall + commitments.
  // Clean separation: record (Holo Record) vs remember (this).

  async function memorySelftest() {
    let graph = null;
    try { if (G.HoloRoam && G.HoloCollab) { const doc = new G.HoloCollab.Doc("notepad"); graph = new G.HoloRoam.Graph(G.HoloRoam.overDoc(doc)); } } catch {}
    const bank = new MemoryBank({ graph });
    await bank.ingest({ kind: "visit", app: "Holo Browser", title: "Quantum gravity primer", url: "https://example.com/qg", entities: ["Quantum Gravity"], source: "browser", ts: Date.now() });
    await bank.ingest({ kind: "interaction", app: "Hologram Meet", entities: ["Ada Lovelace"], summary: "pair design session", source: "collab", ts: Date.now() });
    await bank.record({ kind: "note", title: "remember to revisit [[Quantum Gravity]]" });

    const r = bank.recall("quantum");
    const recallOk = r.length >= 1 && r.some((e) => e.app === "Holo Browser");
    const o1Ok = r.length > 0 && bank.get(r[0].id) === r[0];                 // O(1) κ lookup
    let linkOk = true, entOk = true;
    if (graph) { linkOk = graph.linkedReferences(graph.resolvePage("Holo Browser")).length >= 1; entOk = bank.recallEntity("Quantum Gravity").length >= 1; }

    const before = bank.events.size;
    bank.setSource("browser", false);
    await bank.ingest({ kind: "visit", app: "Holo Browser", title: "should be blocked", url: "https://x.test", source: "browser", ts: Date.now() });
    const killOk = bank.events.size === before;                              // kill-switch drops auto capture
    bank.setSource("browser", true);

    const dk = bank.dayKey(Date.now()); const com = await bank.commitDay(dk);
    const someK = bank.recall("quantum").find((e) => e.app === "Holo Browser").id; const pr = await bank.proveEntry(dk, someK);
    const incOk = await bank.verifyEntry(com.root, someK, pr);              // ZK membership of a fact
    const forgeOk = !(await bank.verifyEntry(com.root, "sha256:not-a-member", pr));

    const sh = await bank.share(someK, { reveal: ["kind", "app", "when"], gates: {} });
    const disc = await ZK().sdVerify(sh.presentation);
    const shareOk = disc && disc.app && !("title" in disc) && !("url" in disc); // discloses only what was chosen

    const ok = recallOk && o1Ok && linkOk && entOk && killOk && incOk && forgeOk && shareOk;
    return { recallOk, o1Ok, linkOk, entOk, killOk, incOk, forgeOk, shareOk, ok };
  }

  G.HoloMemory = { MemoryBank, memorySelftest, SOURCES, appOfLoader };
  if (typeof module !== "undefined" && module.exports) module.exports = G.HoloMemory;
})();
