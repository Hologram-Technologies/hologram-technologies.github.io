// _shared/holo-sdk.js — the Hologram native SDK runtime (ADR-0050). ONE import wires a holospace to
// the five OS core modules. The shape STRICTLY follows the QVAC SDK format (github.com/tetherto/qvac)
// so it feels instantly familiar: a single package of FLAT, NAMED, FUNCTIONAL exports with
// options-object arguments — `import { ready, setAccent, disclose, evaluate, address } from
// "@hologram/sdk"` — not an OOP/namespaced object. Like QVAC it is local-first and serverless (no
// cloud, no SaaS); unlike QVAC's npm/monorepo it ships buildless + content-addressed: the
// "@hologram/sdk" specifier resolves through an import map to this file's κ over the Service Worker
// (Law L1), so there is no npm and no bundler — the substrate is the package manager.
//
// It WRAPS the globals the projection + auto-injection already provide — it does NOT re-implement
// them (mirrors how _shared/holo-object.js mirrors holo-object.mjs): no new crypto, no new UI, no
// new gate. The five modules, by the global each exposes:
//   Holo UI       window.HoloUI         theme · typography · density · layout · icons (ADR-0030)
//   Holo UX       window.HoloUX         device-tier resolution + propagation (ADR-028)
//   Holo Terms    window.HoloTerms      MyTerms — effective, default-deny capabilities (IEEE 7012)
//   Holo Privacy  window.HoloPrivacy    minimal, purpose-bound selective disclosure (W3C VC/DPV)
//   Holo Conform  window.HoloConscience the fail-closed constitutional conscience gate (ADR-033)
//   Holo Product  window.HoloProduct    the balanced Holo UI ⊕ Holo UX foundation + method (ADR-0065)
//   Holo PM       window.HoloPM         the full-cycle Pragmatic PM framework, wired (ADR-0066)
// plus the UOR primitive window.HoloObject (address/verify, Law L5) and the <holo-icon> element.
//
// Every function reads window.* LAZILY (on call, never at import), so module load order cannot race.

const g = (typeof window !== "undefined") ? window : globalThis;
const failClosed = (why) => ({ outcome: "block", blocked: ["*"], reason: why });

function waitFor(name, ms = 4000) {                              // a wired global may seal asynchronously
  return new Promise((res) => {
    if (g[name]) return res(g[name]);
    const t0 = Date.now();
    const iv = setInterval(() => { if (g[name] || Date.now() - t0 > ms) { clearInterval(iv); res(g[name] || null); } }, 30);
  });
}

// ── lifecycle (QVAC: load → use → dispose; here ready() is the one-shot wiring step) ─────────────
// ready(options?) — resolve once Holo UI's theme is applied AND the conscience gate has self-verified
// (re-derived the constitution to its pinned κ, Law L5). Safe to call before any wired module loads.
export async function ready({ onProgress } = {}) {
  const step = (m) => { try { onProgress && onProgress(m); } catch (e) {} };
  step("waiting:HoloUI"); const ui = await waitFor("HoloUI");
  if (ui && typeof ui.ready === "function") { try { await ui.ready(); } catch (e) {} }
  step("waiting:HoloConscience"); const con = await waitFor("HoloConscience");
  if (con && typeof con.verifyConstitution === "function" && !(con.sealed && con.sealed())) {
    try { await con.verifyConstitution(); } catch (e) {} }
  step("ready"); return info();
}

// a plain snapshot of what is wired right now — for status UIs and quick diagnostics.
// Terms + Privacy are HOST-enforced: an app needs no in-frame module to be governed — running framed
// under the host (the normal case) means both gates are active above it. So report them as wired when
// the module is present OR the app is framed under the host (where holo-gov.js carries them).
export function info() {
  const ux = g.HoloUX && g.HoloUX.get ? g.HoloUX.get() : null;
  const governed = !!(g.top && g.top !== g);                          // framed under a host that governs
  return { ui: !!g.HoloUI, ux: !!g.HoloUX, terms: !!g.HoloTerms || governed, privacy: !!g.HoloPrivacy || governed,
    conform: sealed(), object: !!g.HoloObject, product: !!g.HoloProduct, pm: !!g.HoloPM, tier: ux ? ux.tier : null,
    accent: (g.HoloUI && g.HoloUI.get) ? (g.HoloUI.get().theme || {}).accent || null : null };
}

// ── Holo UI — theme · typography · density · layout · icons ───────────────────────────────────────
export function getTheme() { return (g.HoloUI && g.HoloUI.get) ? g.HoloUI.get() : null; }
export function setAccent(color) { return g.HoloUI && g.HoloUI.setAccent && g.HoloUI.setAccent(color); }
export function setLayout(idOrTree) { return g.HoloUI && g.HoloUI.setLayout && g.HoloUI.setLayout(idOrTree); }
export function onThemeChange(fn) { return on("holo-ui-change", fn); }

// ── Holo UX — device-tier resolution ──────────────────────────────────────────────────────────────
export function getTier() { return (g.HoloUX && g.HoloUX.get) ? g.HoloUX.get() : null; }
export function refreshTier() { return (g.HoloUX && g.HoloUX.refresh) ? g.HoloUX.refresh() : null; }
export function onTierChange(fn) { return on("holo-ux-change", fn); }

// ── Holo Product — the canonical FOUNDATION (ADR-0065): the balanced bundle of Holo UI ⊕ Holo UX ──
// + the hybrid delivery method, the foundation a native product is built ON. Lazy-loads the data
// doctrine (holo-product.mjs self-registers window.HoloProduct) so an app or an AGENT can read, at
// runtime, the faculties it inherits, the method it follows, and that the two hemispheres are
// balanced — bind the foundation, don't re-decide the basics (Law L2).
let _prodLoad = null;
async function ensureProduct() {
  if (g.HoloProduct) return g.HoloProduct;
  if (!_prodLoad) _prodLoad = import("./holo-product.mjs").catch(() => {});   // path-served/dev; prod resolves via the import map
  await _prodLoad;
  return g.HoloProduct || null;
}
// product() → { faculties, method, frameworks, balance, balanced } — the foundation, read live.
export async function product() {
  const p = await ensureProduct();
  if (!p) return null;
  const ux = p.FACULTIES.filter((f) => f.hemisphere === "ux").length;
  const ui = p.FACULTIES.filter((f) => f.hemisphere === "ui").length;
  return { faculties: p.FACULTIES, method: p.METHOD, frameworks: p.FRAMEWORKS, balance: p.BALANCE, balanced: ux === ui };
}

// ── Holo Product Manager — the full-cycle PM FRAMEWORK (ADR-0066): the Pragmatic Framework (37 boxes
// in 7 categories) wired to the tools that execute it, the bridge from idea to scalable product. The
// canonical pane is holo-pm.html; pm() reads the framework live so an app or agent can drive the
// full cycle (categories · activities · which tool realizes each · the principle/mantras).
let _pmLoad = null;
async function ensurePM() {
  if (g.HoloPM) return g.HoloPM;
  if (!_pmLoad) _pmLoad = import("./holo-pm.mjs").catch(() => {});
  await _pmLoad;
  return g.HoloPM || null;
}
// pm() → { principle, mantras, categories, activities, total, wired, paneUrl } — the framework, live.
export async function pm() {
  const m = await ensurePM();
  if (!m) return null;
  return { principle: m.PRINCIPLE, mantras: m.MANTRAS, categories: m.CATEGORIES, activities: m.ACTIVITIES,
    total: m.TOTAL, wired: m.wiredActivities().length, paneUrl: new URL("./holo-pm.html", import.meta.url).href };
}

// ── QVAC SDK — Tether's local AI SDK, encoded native (ADR-0067) ────────────────────────────────────
// The full QVAC contract (text generation · embeddings · RAG · translation · classification + the
// weight-gated capabilities, the model lifecycle, the OpenAI-compatible server) on the substrate:
// every call is conscience-gated and seals a re-derivable receipt (Law L5). The default brain is the
// deterministic reference floor (always runs, no download); bind Holo Q (QVAC WebGPU) for a real LLM.
// Lazy-loads holo-qvac.js (it self-registers window.HoloQVAC).
let _qvacLoad = null;
async function ensureQVAC() {
  if (g.HoloQVAC) return g.HoloQVAC;
  if (!_qvacLoad) _qvacLoad = import("./holo-qvac.js").catch(() => {});   // path-served/dev; prod via the import map
  await _qvacLoad;
  return g.HoloQVAC || null;
}
// qvac() → the bound HoloQVAC surface (loadModel · completion · embed · rag* · serve · openai · …),
// so an app or an AGENT can run on-device AI with one import and prove every answer (Law L5).
export async function qvac() { return await ensureQVAC(); }

// ── Holo Terms — effective, default-deny capabilities (already gated at mount) ────────────────────
export function getCapabilities() { return (g.HoloTerms && g.HoloTerms.standing) ? g.HoloTerms.standing() : null; }

// ── Holo Privacy — minimal, purpose-bound selective disclosure (default-deny) ─────────────────────
// disclose({ purpose, recipient, claims, reveal? }) → a W3C Verifiable Presentation, or null.
// Privacy is HOST-enforced, like Terms: the wallet/keys live in the host, not this frame. When this
// app runs framed (the normal case), route the request UP to the host gate (holo-gov.js), which
// stamps the recipient from what it mounted (un-forgeable) and gates under the user's stance. Only a
// top-level page with its own wallet uses the in-frame gate directly. Either way: default-deny.
export async function disclose(request = {}) {
  if (g.HoloPrivacy && g.HoloPrivacy.walletStored && g.HoloPrivacy.walletStored() && g.HoloPrivacy.gate) return g.HoloPrivacy.gate(request);
  const hc = hostPrivacy(); if (hc) return await hc.gate(request);                 // framed → the host gate
  return (g.HoloPrivacy && g.HoloPrivacy.gate) ? g.HoloPrivacy.gate(request) : null;
}
// hostPrivacy() — reach the HOST privacy gate over postMessage, even if THIS frame never loaded
// holo-privacy.js (the wallet/keys live in the host, by design). Null when not framed. Lazily wired.
let _hostPriv;
function hostPrivacy() {
  if (_hostPriv !== undefined) return _hostPriv;
  const top = g.top; if (!top || top === g) return (_hostPriv = null);
  let seq = 0; const pending = new Map();
  g.addEventListener("message", (e) => { const d = e.data; if (!d || d.type !== "holo-privacy:res") return; const p = pending.get(d.id); if (!p) return; pending.delete(d.id); d.error ? p.rej(new Error(d.error)) : p.res(d.result); });
  _hostPriv = { gate: (req) => new Promise((res) => { const id = ++seq; pending.set(id, { res, rej: () => res(null) }); top.postMessage({ type: "holo-privacy:rpc", id, method: "gate", args: req }, "*"); setTimeout(() => { if (pending.has(id)) { pending.delete(id); res(null); } }, 8000); }) };
  return _hostPriv;
}

// ── Holo Conform — the fail-closed conscience gate (ADR-033) ──────────────────────────────────────
export function evaluate(decision = {}, opts) { return g.HoloConscience ? g.HoloConscience.evaluate(decision, opts) : failClosed("conscience not loaded — fail closed"); }
export function evaluateText(text = "", opts) { return g.HoloConscience ? g.HoloConscience.evaluateText(text, opts) : failClosed("conscience not loaded — fail closed"); }
export function sealed() { return !!(g.HoloConscience && g.HoloConscience.sealed && g.HoloConscience.sealed()); }

// ── UOR primitives — self-verification by re-derivation (Law L5) ──────────────────────────────────
export function object() { return g.HoloObject || null; }
export function address(obj) { return g.HoloObject ? g.HoloObject.address(obj) : Promise.reject(new Error("HoloObject not loaded")); }
export function verify(obj) { return g.HoloObject ? g.HoloObject.verify(obj) : Promise.reject(new Error("HoloObject not loaded")); }

// ── Holo App — build · run · share (ADR-0051): the three native verbs of every holospace ──────────
// Wraps window.HoloApp (holo-app.mjs) over the shared content-addressed κ-store. An app is a single κ
// derived from its attributes; build → κ, run(κ) → exports (a source κ self-compiles), share(κ) →
// holo://κ. Fast in any browser (O(1) rebind on repeat), serverless, self-verifying (Law L5).
let _appLoad = null;
async function ensureApp() {                                    // self-bootstrap: load holo-app on first use
  if (g.HoloApp) return g.HoloApp;
  if (!_appLoad) _appLoad = import("./holo-app.mjs").catch(() => {});   // path-served/dev; prod resolves via the import map
  await _appLoad;
  return await waitFor("HoloApp");
}
export async function build(source, opts) { const a = await ensureApp(); if (!a) throw new Error("HoloApp not loaded"); return a.build(source, opts); }
export async function run(ref, opts) { const a = await ensureApp(); if (!a) throw new Error("HoloApp not loaded"); return a.run(ref, opts); }
// share is pure: the κ IS the share (holo://κ) — no dependency, resolvable anywhere by content.
export function share(kappa, { base = "" } = {}) { const hex = String(kappa).split(":").pop(); return { kappa, holo: "holo://" + hex, url: (base || "") + "#k=" + encodeURIComponent(kappa) }; }

// ── Holo Route — typed semantic streams · the routing plane (ADR-0069): the DATAFLOW siblings of
// build/run/share. A pipeline is a content-addressed graph of deterministic κ-transforms whose seams are
// type-checked by re-derivation BEFORE a byte flows; the whole run seals as one self-verifying PROV-O κ.
// `pipe(a).to(b).to(c)` (fluent) and `route([a,b,c], input)` (declarative) read like a shell pipe but are
// typed + verifiable. Wraps window.HoloRoute (holo-route.mjs) over the same κ-store as build/run/share.
async function ensureRoute() {
  if (g.HoloRoute) return g.HoloRoute;
  await ensureApp();                                              // Route rides the app's κ-store
  try { await import("./holo-route.mjs"); } catch (e) {}          // self-registers window.HoloRoute on holo-app-ready
  return await waitFor("HoloRoute");
}
const normStage = (s) => (typeof s === "string" ? { kappa: s, entry: "main", in: "i32", out: "i32" } : { entry: "main", in: "i32", out: "i32", ...s });
const specOf = (stages) => { const n = stages.map(normStage); return { entry: n[0].in, exit: n[n.length - 1].out, stages: n }; };
// pipe(κ) → a fluent builder: .to(κ).run(input) / .seal(input). A stage is a κ or { kappa, entry, in, out }.
export async function pipe(first) { const r = await ensureRoute(); if (!r) throw new Error("HoloRoute not loaded"); return r.pipe(first); }
// route(stages, input, opts?) → run the dataflow (opts.seal → seal+share; opts.stream → yield list elements).
export async function route(stages, input, opts) { const r = await ensureRoute(); if (!r) throw new Error("HoloRoute not loaded"); return r.route(stages, input, opts); }
// sealRoute(stages, input) → seal the pipeline to one self-verifying κ (then share() it like any object).
export async function sealRoute(stages, input) { const r = await ensureRoute(); if (!r) throw new Error("HoloRoute not loaded"); return r.seal(specOf(stages), input); }
// verifyRoute(routeκ) → re-derive the sealed pipeline (L5) AND re-run it; reproduce the final output κ.
export async function verifyRoute(routeKappa) { const r = await ensureRoute(); if (!r) throw new Error("HoloRoute not loaded"); return r.verify(routeKappa); }

// ── Holo Telemetry — system-wide observability, native to the substrate (ADR-0073): the OpenTelemetry
// data model + W3C Trace Context as content-addressed UOR objects (not a Prometheus scraper). A span IS
// a PROV-O Activity whose W3C trace-id / span-id are DERIVED from the operation's content (re-derivable,
// Law L5); wall-clock numbers are honestly host-attested, never re-derived; telemetry is local-only by
// default and egress is conscience-gated (Law L1). Wraps window.HoloTelemetry over the same κ-store.
async function ensureTelemetry() {
  if (g.HoloTelemetry) return g.HoloTelemetry;
  await ensureApp();                                             // telemetry rides the app's κ-store
  try { await import("./holo-telemetry.mjs"); } catch (e) {}     // self-registers window.HoloTelemetry on holo-app-ready
  return await waitFor("HoloTelemetry");
}
// telemetry() → the runtime ({ tracer, meter, logger, inject, extract, verify, exportTo }).
export async function telemetry() { const t = await ensureTelemetry(); if (!t) throw new Error("HoloTelemetry not loaded"); return t; }
// trace(name) → a tracer; .startSpan(name, opts) → a span; tracer.seal() → one self-verifying trace κ.
export async function trace(name, version) { const t = await ensureTelemetry(); if (!t) throw new Error("HoloTelemetry not loaded"); return t.tracer(name, version); }
// meter(name) → a meter (counter · gauge · histogram); each .record(v, attrs) seals a metric data-point κ.
export async function meter(name) { const t = await ensureTelemetry(); if (!t) throw new Error("HoloTelemetry not loaded"); return t.meter(name); }
// verifyTelemetry(κ) → re-derive a signal's W3C id / metric-id / log-id from its content (Law L5).
export async function verifyTelemetry(kappa) { const t = await ensureTelemetry(); if (!t) throw new Error("HoloTelemetry not loaded"); return t.verify(kappa); }

// ── Holo Own — verifiable, self-sovereign OWNERSHIP, ambient in every holospace (ADR-053) ─────────
// Wraps holo-own.mjs (Title · transfer · anchor · settle) + holo-own-rail.js (the real Holo Wallet
// rail) over substrate-parity κ. Every object can be owned, transferred, anchored, sold from one
// verb; the operator's self-sovereign identity is the default owner; value moves ONLY through the
// wallet's human-approval gate (Law L4 — no parallel ledger). Lazy-loaded like build/run/share.
let _ownLoad = null, _own = null, _rail = null, _operator = null;
async function ensureOwn() {
  if (_own && _rail) return { own: _own, rail: _rail };
  if (!_ownLoad) _ownLoad = Promise.all([import("./holo-own.mjs"), import("./holo-own-rail.js")])
    .then(([o, r]) => { _own = o; _rail = r; }).catch(() => {});
  await _ownLoad;
  return { own: _own, rail: _rail };
}
// the active owner — the logged-in operator's signing principal. The shell sets this at mount so
// ownership is implicit/ambient; apps may also pass `by` explicitly per call.
export function setOperator(principal) { _operator = principal; return _operator; }
export function operator() { return _operator; }
export async function mintTitle({ owned, rights } = {}, by = _operator) {
  const { own } = await ensureOwn(); if (!own) throw new Error("HoloOwn not loaded");
  if (!by) throw new Error("no operator — call HoloSDK.setOperator(principal) first"); return own.mint({ owned, rights }, by); }
export async function transferTitle({ title, to, rights } = {}, by = _operator, opts = {}) {
  const { own } = await ensureOwn(); if (!by) throw new Error("no operator"); return own.transfer({ title, to, rights }, by, opts); }
export async function ownerOf(titles, opts) { const { own } = await ensureOwn(); return own.resolveOwner(titles, opts); }
export async function verifyTitle(titles, opts) { const { own } = await ensureOwn(); return own.verifyChain(titles, opts); }
// anchor a Title's head κ to a real chain for global scarcity ("anchor wins"), via the wallet seam.
export async function anchorTitle(headKappa, chain = "ethereum", rail) {
  const { own, rail: R } = await ensureOwn(); return own.anchor(headKappa, chain, rail || R.walletRail({ chain })); }
// sell: transfer to the buyer, settle a voucher against the PROVEN Title, move value via the wallet.
export async function sellTitle({ titles, to, amount, chain = "ethereum", rights } = {}, by = _operator, rail) {
  const { own, rail: R } = await ensureOwn(); const r = rail || R.walletRail({ chain });
  const head = titles[titles.length - 1];
  const next = await own.transfer({ title: head, to, rights }, by);
  const buyer = (typeof to === "string" ? to : to.kappa).replace(/^did:holo:/, "");
  const order = { subject: next["@id"], amount: { value: amount, currency: chain }, buyer };
  const settled = await R.settleVia(own, { order, chain: { titles: [...titles, next] } }, r);
  return { title: next, voucher: settled, txid: settled && settled.txid }; }
const own = { setOperator, operator, mint: mintTitle, transfer: transferTitle, owner: ownerOf, verify: verifyTitle, anchor: anchorTitle, sell: sellTitle };

// ── Holo Chain — OMNICHAIN, native in every holospace (ADR-053): the Chain Abstraction Layer unifies
// every blockchain UNDER the κ substrate. CAIP names any chain/account/asset; resolve → a self-verifying
// κ object (one graph); a chain wallet IS a holospace principal (did:pkh); anchor/pay route an INTENT to
// the right chain via the one default-deny wallet seam. The holospace speaks κ + intents, never a chain.
let _chainLoad = null, _ch = null, _chRail = null;
async function ensureChain() {
  if (_ch && _chRail) return { ch: _ch, rail: _chRail };
  if (!_chainLoad) _chainLoad = Promise.all([import("./holo-chain.mjs"), import("./holo-own-rail.js")]).then(([c, r]) => { _ch = c; _chRail = r; }).catch(() => {});
  await _chainLoad; return { ch: _ch, rail: _chRail };
}
// resolve any chain identifier (CAIP-2/10/19) → a self-verifying κ object in the one graph.
export async function resolveChain(caip, data) { const { ch } = await ensureChain(); return ch.resolve(caip, data); }
// a chain wallet (CAIP-10) as a holospace principal (did:pkh) — your existing wallet IS your identity.
export async function chainPrincipal(caip10, wallet) { const { ch } = await ensureChain(); return ch.principal(caip10, wallet); }
// anchor a Title's head κ to a chain by CAIP — an intent the CAL routes via the wallet seam.
export async function anchorOn(headKappa, caipChain, rail) { const { ch, rail: R } = await ensureChain(); return ch.anchorTo(headKappa, caipChain, rail || R.walletRail({ chain: ch.walletChainOf(caipChain) })); }
// pay a CAIP-10 owner — an intent routed to the right chain via the wallet seam.
export async function payOn(caip10Recipient, amount, rail) { const { ch, rail: R } = await ensureChain(); return ch.payTo(caip10Recipient, amount, rail || R.walletRail({ chain: ch.walletChainOf(caip10Recipient) })); }
const chain = { resolve: resolveChain, principal: chainPrincipal, anchor: anchorOn, pay: payOn,
  caip: async (id) => { const { ch } = await ensureChain(); return ch.parseCaip(id); },
  didPkh: async (id) => { const { ch } = await ensureChain(); return ch.didPkh(id); },
  walletChainOf: async (id) => { const { ch } = await ensureChain(); return ch.walletChainOf(id); } };

// ── conveniences ──────────────────────────────────────────────────────────────────────────────────
// a <holo-icon> element from the active OS icon set (recolours with the accent automatically).
export function icon(name, { set, size, label } = {}) {
  if (typeof document === "undefined") return null;
  const el = document.createElement("holo-icon");
  el.setAttribute("name", name);
  if (set) el.setAttribute("set", set);
  if (size != null) el.setAttribute("size", String(size));
  if (label) el.setAttribute("label", label);
  return el;
}

// subscribe to UI / UX changes (returns an unsubscribe). The OS re-broadcasts theme + tier live.
export function on(event, fn) {
  const root = (typeof document !== "undefined") ? document.documentElement : null;
  if (!root) return () => {};
  root.addEventListener(event, fn);                              // 'holo-ui-change' · 'holo-ux-change'
  return () => root.removeEventListener(event, fn);
}

// ── Holo Commands — let the HOST (and Q, the voice agent) DRIVE this app (the in-app task bridge) ──
// "open amp" launches it; registerCommand("play", …) is how Q then makes it PLAY. An app opts in by
// registering named actions; the shell posts {type:"holo-app:command", id, name, params} into this
// frame and gets back {type:"holo-app:command-result", id, result|error}. Default-deny: only registered
// names run. The inbox boots once, lazily, and mirrors the host privacy bridge shape so it feels native.
const _holoCmds = new Map();
let _cmdWired = false;
function bootCommandInbox() {
  if (_cmdWired || typeof g.addEventListener !== "function") return; _cmdWired = true;
  g.addEventListener("message", async (e) => {
    const d = e.data; if (!d || d.type !== "holo-app:command") return;
    const reply = (extra) => { try { (e.source || g.parent || g.top).postMessage(Object.assign({ type: "holo-app:command-result", id: d.id }, extra), "*"); } catch (_) {} };
    if (d.name === "__commands") return reply({ result: Array.from(_holoCmds.keys()) });    // discovery
    const fn = _holoCmds.get(d.name);
    if (!fn) return reply({ error: "no such command: " + d.name });
    try { reply({ result: await fn(d.params || {}) }); }
    catch (err) { reply({ error: (err && err.message) || String(err) }); }
  });
}
// registerCommand(name, fn) — expose an action the shell/agent can invoke. Returns an unregister fn.
export function registerCommand(name, fn) {
  if (typeof name !== "string" || typeof fn !== "function") throw new Error("registerCommand(name, fn): a string name and a function");
  bootCommandInbox(); _holoCmds.set(name, fn);
  return () => _holoCmds.delete(name);
}
export function commands() { return Array.from(_holoCmds.keys()); }

// ── aggregate (for `import HoloSDK from "@hologram/sdk"`, destructuring, and the window global) ────
export const HoloSDK = { ready, info, getTheme, setAccent, setLayout, onThemeChange, getTier, refreshTier,
  onTierChange, getCapabilities, disclose, evaluate, evaluateText, sealed, object, address, verify, icon, on,
  qvac, build, run, share, pipe, route, sealRoute, verifyRoute, registerCommand, commands,
  setOperator, operator, mintTitle, transferTitle, ownerOf, verifyTitle, anchorTitle, sellTitle, own,
  resolveChain, chainPrincipal, anchorOn, payOn, chain };
if (typeof window !== "undefined") window.HoloSDK = HoloSDK;
export default HoloSDK;
