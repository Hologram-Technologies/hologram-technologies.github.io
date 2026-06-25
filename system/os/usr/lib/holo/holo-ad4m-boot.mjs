// holo-ad4m-boot.mjs — THE ONE FRONT DOOR. Nine witnessed modules + a heartbeat collapse behind a single
// flat object, window.HoloWeb, with eight plain verbs that BOTH a human UI and an AI agent use — the same
// path, no privileged surface. Everything engine (Perspective, Expression, Neighbourhood, Social DNA,
// Language, Synergy, the ambient nervous system) lives behind it and never surfaces a single jargon word.
//
//   me()                  → your identity (a name/handle, never a raw DID)
//   spaces()              → your Spaces
//   open(thing)           → open anything: a Space (created if new), a Thing, or an invite (joins)
//   post(space, content)  → share a Thing into a Space (text / link / file); Social-DNA-gated
//   search(space, query)  → private search; each result carries an origin
//   invite(space)         → a link that brings a device or a person into a Space
//   people(space)         → who's here (names, never raw κ)
//   onChange(fn)          → subscribe; the nervous system keeps everything current
//
// This module COMPOSES; it adds no behavior. Browser-only seams (WAN transport, the opener) are injected so
// it is fully node-testable with an in-memory store and a real enrolled principal. Fail-soft: guest/locked
// still yields a verifying web (unsigned content still hash-links). The substrate is the executor — no daemon.

import { makeAd4m } from "./holo-ad4m.mjs";
import { makeNeighbourhood } from "./holo-ad4m-neighbourhood.mjs";
import { makeDna, defineRuleset } from "./holo-ad4m-dna.mjs";
import { makeSynergy } from "./holo-ad4m-synergy.mjs";
import { makeAd4mAgent } from "./holo-ad4m-mcp.mjs";
import { wireAd4mFaculties } from "./holo-ad4m-ambient.mjs";
import { recordIngest } from "./holo-strand-provenance.mjs";

// a friendly handle from a κ — a short fingerprint, never the raw DID (Law: names on the surface, κ underneath)
const handleOf = (kappa) => (kappa ? "@" + String(kappa).split(":").pop().slice(0, 6) : "@guest");
const slug = (name) => String(name || "space").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "space";
// the default Social DNA for a Space: a post must carry the triple; members only (set per Space).
const SPACE_DNA = defineRuleset({ name: "space-default", version: 1, rules: { "ad4m:link": { require: ["source", "predicate", "target"] } } });

// makeHoloWeb(opts) → the eight-verb web bound to one operator. Injected seams keep it pure + node-testable:
//   signer      : an unlocked holo-identity principal (the human). Absent ⇒ guest (unsigned but verifying).
//   store, now  : the κ store + clock (defaults: in-memory Map + wall clock).
//   ambient     : the ONE holo-ambient instance to register organs on (optional; wired if present).
//   transport   : { spacePost(spaceId,msg)→void, createInvite(space)→link } for WAN (optional; local if absent).
//   opener      : (thing)→Promise for the one open path (defaults to window.HoloOpen, else a no-op).
//   displayName : the human's name for me() (default "You"). names: Map<κ,name> for peers (optional).
export function makeHoloWeb({ signer = null, store = new Map(), now = () => "1970-01-01T00:00:00Z",
  ambient = null, transport = null, opener = null, displayName = "You", names = new Map() } = {}) {
  const ad4m = makeAd4m({ signer, store, now });
  const meKappa = ad4m.me();
  // a per-INSTANCE id (this tab/device), used only to suppress transport echoes. It must be unique per
  // endpoint, NOT per operator: two guests, or the same person on two devices, are distinct peers that must
  // still converge. Random, not identity-derived — identity lives in the signed strand, not the wire id.
  const instanceId = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : "inst-" + Math.random().toString(36).slice(2);
  const spacesById = new Map();                       // id → { id, name, perspective, neighbourhood, dna, synergy, ... }
  const listeners = new Set();
  const ingestQueue = [];                             // pending content the nervous system drains into Expressions
  const backendFor = () => ({ load: async () => [], save: async () => {} }); // a fresh durable backend per Space spine

  const nameOf = (k) => names.get(k) || (k === meKappa ? displayName : handleOf(k));
  const emit = (kind, detail) => { for (const fn of listeners) { try { fn({ kind, ...detail }); } catch (e) {} } };

  // ensureSpace(name) — open a Space by name, creating it the first time (one open path, no "create" verb).
  function ensureSpace(name) {
    const id = slug(name);
    if (spacesById.has(id)) return spacesById.get(id);
    const members = new Set([meKappa].filter(Boolean));
    const perspective = ad4m.perspective({ backend: backendFor(id) });
    // self must be UNIQUE per endpoint (not per Space, not per operator) or two contexts in the same Space
    // would treat each other's broadcasts as their own echo and never converge. Scope it by this instance.
    const self = instanceId + "@" + id;
    const neighbourhood = makeNeighbourhood({ perspective, me: meKappa, self, post: (m) => { try { transport && transport.spacePost && transport.spacePost(id, m); } catch (e) {} } });
    const dna = makeDna({ perspective, ruleset: SPACE_DNA, me: meKappa, isMember: (a) => !members.size || members.has(a) });
    const sessionK = "did:holo:sha256:" + (id + "0".repeat(64)).replace(/[^0-9a-f]/g, "0").slice(0, 64);
    const provStrand = ad4m.perspective({ backend: backendFor() }).raw;
    const creditStrand = ad4m.perspective({ backend: backendFor() }).raw;
    const synergy = makeSynergy({ provStrand, creditStrand });
    // gated=false ⇒ OPEN Space: anyone who converges is shown (the default, P12). gated=true ⇒ INVITE-only:
    // only posts authored by a member κ render (membership is established by an operator-signed invite grant).
    const space = { id, name, perspective, neighbourhood, dna, synergy, provStrand, creditStrand, sessionK, members, gated: false };
    spacesById.set(id, space);
    emit("space", { space: { id, name } });
    // announce presence: ask peers for their strands and advertise mine (the want/have round). A peer answers
    // by publishing its Links AND re-shipping its Expression bodies (see deliver), so a late joiner backfills.
    if (transport) { try { neighbourhood.join(); } catch (e) {} }
    return space;
  }

  // classify content → { language, data, text } — text/link/file all become an Expression (live Language
  // resolvers swap in behind this unchanged; today a link/file is sealed as a Thing referencing its origin).
  function classifyContent(content) {
    if (content && typeof content === "object") {
      if (content.url) return { language: "literal", data: { kind: "link", url: content.url, title: content.title || content.url }, text: content.title || content.url };
      if (content.file || content.name) return { language: "literal", data: { kind: "file", name: content.name, mime: content.mime || null }, text: content.name };
      if (content.text != null) return { language: "literal", data: { kind: "note", text: String(content.text) }, text: String(content.text) };
    }
    return { language: "literal", data: { kind: "note", text: String(content) }, text: String(content) };
  }

  // ── the eight verbs ──────────────────────────────────────────────────────────────────────────────────
  const me = () => ({ name: displayName, handle: handleOf(meKappa), guest: !meKappa });

  const spaces = () => [...spacesById.values()].map((s) => ({ id: s.id, name: s.name, people: s.members.size }));

  // postsOf(space) — the Things shared into a Space, resolved to plain { id, text, by, at } for rendering.
  // Renders the MERGED Neighbourhood graph (my Links ∪ every adopted peer's), not just my own strand, so a
  // post that synced from another device shows up here. Each target Expression is re-verified on read (L5):
  // if its body is absent (not yet synced) or doesn't re-derive to its κ (tampered), the post simply does
  // not render — verify-before-render, the same fail-closed law the strand uses, now at the surface.
  function postsOf(s) {
    return s.neighbourhood.sharedLinks({ predicate: "posted" })
      // an INVITE-only (gated) Space renders only members' posts: a peer can shout on the wire, but without an
      // operator-signed membership grant its κ is not in s.members, so its posts simply do not appear. An OPEN
      // Space (default) shows everyone who converges. The author is always a member-or-not by the math, never the messenger.
      .filter((l) => !s.gated || s.members.has(l.author) || l.author === meKappa)
      .map((l) => {
        const e = ad4m.getExpression(l.target);
        if (!e) return null;
        const d = e["ad4m:data"];
        const text = d ? (d.text || d.title || d.name || d.url || l.target) : l.target;
        return { id: l.target, text, by: nameOf(l.author), at: l.at };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  async function open(thing) {
    const t = String(thing || "").trim();
    if (!t) return { ok: false, reason: "nothing to open" };
    // an invite link → join the Space; a bare name → open/create a Space (returning its posts); else the one open path
    // a WAN invite link (carries a real WebRTC offer): join over the channel, become a verifying member.
    if (transport && transport.joinInvite && /#i=/.test(t)) {
      try {
        const j = await transport.joinInvite(t);
        const s = ensureSpace(j.spaceName || j.spaceId); s.gated = true;
        const accept = async (grant) => { const r = await j.accept(grant); if (r && r.operator) s.members.add(r.operator); return r; };
        return { ok: true, opened: "invite", space: { id: s.id, name: s.name }, answer: j.answerLink, answerBlob: j.answerBlob, accept, posts: postsOf(s) };
      } catch (e) { return { ok: false, reason: (e && e.message) || "invite invalid" }; }
    }
    if (/#invite/.test(t) || /^holo:\/\/space\//.test(t)) { const name = decodeURIComponent(t.replace(/^holo:\/\/space\//, "").split("#")[0]) || t; const s = ensureSpace(name); return { ok: true, opened: "space", space: { id: s.id, name: s.name }, posts: postsOf(s) }; }
    if (opener && /[:/]/.test(t)) { try { await opener(t); return { ok: true, opened: t }; } catch (e) { return { ok: false, reason: (e && e.message) || "open failed" }; } }
    const s = ensureSpace(t); return { ok: true, opened: "space", space: { id: s.id, name: s.name }, posts: postsOf(s) };
  }

  async function post(spaceName, content) {
    const s = ensureSpace(spaceName);
    const c = classifyContent(content);
    const { url, expr } = ad4m.createExpression(c.language, c.data);
    const r = await s.dna.addLink({ source: meKappa || "guest", predicate: "posted", target: url });
    if (!r.ok) return { ok: false, reason: r.why || "post refused", violations: r.violations };
    try { s.synergy.index({ url, text: c.text, owner: meKappa }); await recordIngest(s.provStrand, { source: url, name: c.text.slice(0, 24) }); } catch (e) {}
    // converge: advertise my updated strand to peers (Links), AND ship the sealed Expression body so a peer
    // can rehydrate it into its own store and render the real text. The body is content-addressed, so a peer
    // re-verifies it on read — shipping it over an untrusted channel adds no trust assumption (Law L5).
    try { if (transport) { s.neighbourhood.publish(); if (transport.spacePost) transport.spacePost(s.id, { t: "ad4m:expr", from: s.id, body: expr }); } } catch (e) {}
    emit("post", { space: { id: s.id, name: s.name }, post: { id: url, text: c.text, by: me().handle } });
    return { ok: true, post: { id: url, text: c.text, by: me().name } };
  }

  async function search(spaceName, query) {
    const s = ensureSpace(spaceName);
    if (!signer) return { ok: false, reason: "sign in to search privately" };
    const terms = Array.isArray(query) ? query : String(query || "").split(/\s+/).filter(Boolean);
    if (!terms.length) return { ok: true, results: [] };
    try {
      const r = await s.synergy.privateSearch(terms, { worker: signer, session: s.sessionK });
      const results = (r.results || []).map((x) => ({ id: x.url, score: x.score, from: nameOf(x.owner), origin: !!x.provenance }));
      return { ok: r.ok !== false, results };
    } catch (e) { return { ok: false, reason: (e && e.message) || "search failed" }; }
  }

  async function invite(spaceName) {
    const s = ensureSpace(spaceName);
    if (transport && transport.createInvite) {
      try {
        const r = await transport.createInvite({ id: s.id, name: s.name });
        if (r && r.link && typeof r.complete === "function") {        // WAN: a real rendezvous link + the handshake completion
          s.gated = true;                                            // an invited Space is membership-gated
          const complete = async (answerBlob) => { const out = await r.complete(answerBlob); if (out && out.joiner) s.members.add(out.joiner); return out; };
          return { ok: true, link: r.link, complete };
        }
        if (typeof r === "string") return { ok: true, link: r };      // legacy string-returning transport
      } catch (e) { /* fall through to the local placeholder */ }
    }
    return { ok: true, link: "holo://space/" + encodeURIComponent(s.name) + "#invite" };  // local placeholder (offline)
  }

  function people(spaceName) {
    const s = ensureSpace(spaceName);
    return s.neighbourhood.members().map((k) => ({ name: nameOf(k), handle: handleOf(k), you: k === meKappa }));
  }

  function onChange(fn) { if (typeof fn === "function") listeners.add(fn); return () => listeners.delete(fn); }

  const web = { me, spaces, open, post, search, invite, people, onChange };

  // ── behind the door: the agent face (same instances) + the nervous system (one heartbeat) ─────────────
  // the AI agent reaches the SAME web through the MCP face; a default Space backs its Perspective verbs.
  const agentSpace = () => ensureSpace("Home");
  const agentFace = makeAd4mAgent({ ad4m, perspective: agentSpace().perspective, neighbourhood: agentSpace().neighbourhood });

  // the ambient adapter: the organs drive THESE instances. Drains the ingest queue, syncs every Space, etc.
  const ambientAdapter = {
    neighbourhoods: () => [...spacesById.values()].map((s) => s.neighbourhood),
    drainIngest: async (max) => { let n = 0; while (ingestQueue.length && n < max) { const { space, content } = ingestQueue.shift(); await post(space, content); n++; } return n; },
    indexNew: async () => 0,                            // post() already indexes; the organ is a no-op hook here
    wan: { keepAlive: async () => { try { transport && transport.keepAlive && (await transport.keepAlive()); } catch (e) {} } },
    reconcileProvenance: () => ({ unprovenanced: [] }),
    heal: async () => { for (const s of spacesById.values()) { try { await s.perspective.verify(); } catch (e) {} } return { ok: true }; },
  };
  let unwireAmbient = () => {};
  if (ambient && typeof ambient.register === "function") unwireAmbient = wireAd4mFaculties(ambient, ambientAdapter);

  // deliver(spaceId, msg) — the inbound side of the transport: a peer's broadcast arrives here. A Links
  // advertisement is handed to that Space's Neighbourhood (which verifies-before-adopt); an Expression body
  // is rehydrated into the store (re-verified later on read by getExpression). Then the live web re-renders.
  // shipBodies(s) — re-broadcast the Expression bodies of every Thing I've posted into a Space, so a peer that
  // just joined can render real text for the Links it adopts (Links travel on the strand; bodies travel here).
  function shipBodies(s) {
    if (!transport || !transport.spacePost) return;
    for (const l of s.perspective.links({ predicate: "posted" })) {
      const e = ad4m.getExpression(l.target);
      if (e) { try { transport.spacePost(s.id, { t: "ad4m:expr", from: s.id, body: e }); } catch (err) {} }
    }
  }

  async function deliver(spaceId, msg) {
    const s = spacesById.get(spaceId);
    if (!s || !msg) return;
    if (msg.t === "ad4m:expr") {
      try { const hex = String((msg.body && msg.body.id) || "").split(":").pop(); if (hex) ad4m.store.set(hex, msg.body); } catch (e) {}
      emit("sync", { space: { id: s.id, name: s.name } });
      return;
    }
    // a peer asking for history (want): the Neighbourhood publishes my Links; I also re-ship my bodies.
    if (msg.t === "ad4m:want") { try { await s.neighbourhood.onMessage(msg); } catch (e) {} shipBodies(s); emit("sync", { space: { id: s.id, name: s.name } }); return; }
    try { await s.neighbourhood.onMessage(msg); emit("sync", { space: { id: s.id, name: s.name } }); } catch (e) {}
  }

  // internal escape hatches (NOT part of the public eight) — used by the app shell + witness only.
  web._internal = { ad4m, agentFace, ambientAdapter, ensureSpace, deliver, enqueueIngest: (space, content) => ingestQueue.push({ space, content }), unwireAmbient, spacesById };
  return web;
}

// ── browser binding: build the one front door on the live operator + the OS heartbeat, expose window.HoloWeb.
if (typeof window !== "undefined") {
  const wire = () => {
    try {
      if (window.HoloWeb) return;
      const signer = window.HoloPrincipal || null;
      // a serverless local transport: separate tabs/windows are real peers over one BroadcastChannel. Each
      // message is tagged with its Space id; inbound is routed to deliver() (verify-before-adopt). This is the
      // WAN-less leg — a real κ-DHT/WebRTC relay swaps in behind the same spacePost/deliver seam, no UI change.
      let transport = null, bc = null;
      if (typeof BroadcastChannel !== "undefined") {
        bc = new BroadcastChannel("holo-flux-net");
        transport = { spacePost: (spaceId, m) => { try { bc.postMessage({ spaceId, m }); } catch (e) {} } };
      }
      const web = makeHoloWeb({
        signer,
        now: () => new Date().toISOString(),
        ambient: window.HoloAmbient || null,
        transport,
        opener: (t) => (window.HoloOpen ? window.HoloOpen(t) : Promise.resolve()),
        displayName: (signer && signer.label) || "You",
      });
      if (bc) bc.onmessage = (e) => { try { const d = e.data || {}; if (d.spaceId) web._internal.deliver(d.spaceId, d.m); } catch (err) {} };
      window.HoloWeb = web;
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-web-ready"));
    } catch (e) { /* leave unset; the app falls back to guest */ }
  };
  if (document.documentElement) { document.documentElement.addEventListener("holo-ambient-ready", wire); }
  wire();
}

export default { makeHoloWeb };
