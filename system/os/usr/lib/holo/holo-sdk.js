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
export function info() {
  const ux = g.HoloUX && g.HoloUX.get ? g.HoloUX.get() : null;
  return { ui: !!g.HoloUI, ux: !!g.HoloUX, terms: !!g.HoloTerms, privacy: !!g.HoloPrivacy,
    conform: sealed(), object: !!g.HoloObject, tier: ux ? ux.tier : null,
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

// ── Holo Terms — effective, default-deny capabilities (already gated at mount) ────────────────────
export function getCapabilities() { return (g.HoloTerms && g.HoloTerms.standing) ? g.HoloTerms.standing() : null; }

// ── Holo Privacy — minimal, purpose-bound selective disclosure (default-deny) ─────────────────────
// disclose({ purpose, recipient, claims, reveal? }) → a W3C Verifiable Presentation, or null.
export async function disclose(request = {}) {
  if (!g.HoloPrivacy || !g.HoloPrivacy.gate) return null;
  return g.HoloPrivacy.gate(request);
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

// ── aggregate (for `import HoloSDK from "@hologram/sdk"`, destructuring, and the window global) ────
export const HoloSDK = { ready, info, getTheme, setAccent, setLayout, onThemeChange, getTier, refreshTier,
  onTierChange, getCapabilities, disclose, evaluate, evaluateText, sealed, object, address, verify, icon, on,
  build, run, share,
  setOperator, operator, mintTitle, transferTitle, ownerOf, verifyTitle, anchorTitle, sellTitle, own,
  resolveChain, chainPrincipal, anchorOn, payOn, chain };
if (typeof window !== "undefined") window.HoloSDK = HoloSDK;
export default HoloSDK;
