// holo-skin.js — the Holo Browser SKIN engine (holo:BrowserSkin).
//
// First principles. The Holo Browser tab is a real Chromium iframe; the chrome AROUND it (the
// toolbar, the menus, the throbber, the status bar) is ours. A "vintage skin" dresses exactly that
// chrome layer to faithfully wear an old browser's UX (first: NCSA Mosaic), while the page bytes
// (browser-sw.js's κ-minting loading seam) stay untouched. A skin is therefore CHROME-ONLY.
//
// The load-bearing discipline:
//   • A skin is a κ-addressed MANIFEST (holo:BrowserSkin). Every chrome asset — html, css, each
//     glyph, the throbber — is referenced by content address (did:holo:sha256) and re-hashed on load;
//     a flipped byte is REFUSED (Law L5). Same skin-κ ⇒ byte-identical chrome.
//   • appliesTo MUST equal "browser". The engine refuses any other target, so a skin can NEVER
//     repaint the OS-wide shell chrome (that is the separate holo:Theme palette engine's job).
//   • Behavior is a CLOSED vocabulary of action strings (ACTIONS) bound to host callbacks — there is
//     NO executable code in a manifest. A new skin (Netscape, IE, Opera) is a pure data drop: zero
//     change to this engine (proven by the witness's open-model check).
//   • A skin swap is state-preserving: the page iframe is never re-created, only sibling chrome rows
//     are mounted/swapped, so history / URL / scroll / back-forward survive a switch with no reload.
//
// Isomorphic + dependency-free. The resolve / verify / state-derivation core runs in the page, the
// service worker, and Node (the witness imports it). DOM mounting guards on `document` so the module
// imports cleanly headless. Receipts reuse the ONE canonicalization (RFC 8785 JCS + SHA-256) from
// holo-q-receipt.mjs, so a holo:SkinActivation receipt re-derives byte-identically in browser + Node.

import { address, sha256hex } from "./q/holo-q-receipt.mjs";

export const VERSION = "holo-skin 1.0";

// ── the closed vocabularies. A manifest carries DATA referencing these; never code. ─────────────────
export const ACTIONS = ["nav.back", "nav.forward", "nav.home", "nav.reload", "nav.stop", "omni.focus", "tab.new", "tab.close", "about", "noop"];
export const STATE_SOURCES = ["loading", "nav.current.url", "nav.canGoBack", "nav.canGoForward", "securityState"];

const dec = (u8) => new TextDecoder().decode(u8 instanceof Uint8Array ? u8 : new Uint8Array(u8));
const enc = (s) => new TextEncoder().encode(s);

// ── content addresses ───────────────────────────────────────────────────────────────────────────────
// assetKappa(bytes): a bare leaf κ over the raw asset bytes (did:holo:sha256:<hex>). Identical bytes
// converge to one κ — the chrome assets dedup in the κ-store like any other object (Law L3).
export async function assetKappa(bytes) {
  const u8 = typeof bytes === "string" ? enc(bytes) : (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return "did:holo:sha256:" + await sha256hex(u8);
}
// skinKappa(manifest): the manifest's own content address. The @id (the address it names) is excluded
// from the content it names, so the seal is computed identically with or without @id present — a
// tampered manifest then fails to re-derive (Law L5).
export const skinKappa = (manifest) => { const { "@id": _id, ...content } = manifest || {}; return address(content); };
export async function verifySkin(kappa, manifest) { return (await skinKappa(manifest)) === kappa; }

// collect every did:holo:sha256 asset reference the manifest declares (chrome/glyphs/throbber).
function collectRefs(manifest) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === "string") { if (/^did:holo:sha256:/.test(v)) out.add(v); return; }
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") return Object.values(v).forEach(walk);
  };
  walk(manifest["holo:chrome"]); walk(manifest["holo:glyphs"]); walk(manifest["holo:throbber"]); walk(manifest["holo:shellCss"]);
  return out;
}

// ── resolveSkin — fetch + κ-verify a skin into a frozen, ready-to-mount descriptor ──────────────────
// read(relpath) → Promise<bytes>. In the page: fetch("/_shared/skins/<id>/"+rel). In Node: fs.readFile.
// Returns { id, manifestKappa, manifest, chromeHtml, chromeCss, glyphs{name→{kappa,svg,rel}}, throbber,
//           behavior, palette, font }. Throws on any L5 refusal (so a forged skin never mounts).
export async function resolveSkin(skinId, { read, manifest, pin, verify = true } = {}) {
  if (typeof read !== "function") throw new Error("holo-skin: resolveSkin needs a read(relpath) loader");
  manifest = manifest || JSON.parse(dec(await read("skin.json")));
  pin = pin || JSON.parse(dec(await read("skin.pin.json")));
  // the OS-chrome guard — a skin that does not target the browser is refused outright.
  if (manifest["holo:appliesTo"] !== "browser") throw new Error("holo-skin: refused — appliesTo must be 'browser' (OS-chrome guard)");
  // the manifest must re-derive to its own @id (Law L5 on the manifest itself).
  const claimed = manifest["@id"];
  if (verify && claimed) { const ok = (await skinKappa(manifest)) === claimed; if (!ok) throw new Error("holo-skin: L5 refusal — manifest does not re-derive to its @id"); }
  // load + verify every pinned asset against its committed κ; reverse-map κ → relpath.
  const files = (pin && pin.files) || {};
  const byKappa = {}; const assets = {};
  for (const [rel, did] of Object.entries(files)) {
    const bytes = await read(rel);
    if (verify) { const got = await assetKappa(bytes); if (got !== did) throw new Error("holo-skin: L5 refusal — " + rel + " hash mismatch (pin " + did + " got " + got + ")"); }
    assets[did] = bytes; byKappa[did] = rel;
  }
  // every asset the manifest references must be pinned (no dangling / unverified chrome).
  for (const did of collectRefs(manifest)) if (!(did in assets)) throw new Error("holo-skin: manifest references unpinned asset " + did);
  // the behavior menus may only use the closed action vocabulary (no code smuggled as a string).
  const behavior = manifest["holo:behavior"] || {};
  for (const menu of behavior.menus || []) for (const item of menu.items || []) if (!ACTIONS.includes(item.action)) throw new Error("holo-skin: unknown action '" + item.action + "' (closed vocabulary)");
  const text = (did) => did && assets[did] ? dec(assets[did]) : null;
  const glyphSrc = manifest["holo:glyphs"] || {};
  const glyphs = {}; for (const [name, did] of Object.entries(glyphSrc)) glyphs[name] = { kappa: did, rel: byKappa[did], svg: text(did) };
  const thr = manifest["holo:throbber"] || {};
  const throbber = { kind: thr.kind || "svg", fps: thr.fps || 12,
    frames: (thr.frames || []).map((did) => ({ kappa: did, svg: text(did) })),
    svg: thr.svg ? text(thr.svg) : null };
  return Object.freeze({
    id: skinId, manifestKappa: claimed, manifest,
    chromeHtml: text((manifest["holo:chrome"] || {}).html),
    chromeCss: text((manifest["holo:chrome"] || {}).css),
    // holo:shellCss (optional) — a κ-pinned stylesheet the SHELL injects to fully dress its own browser
    // chrome (tab strip · toolbar · omnibox · left dock · bottom bar) beyond the palette-derived defaults:
    // gradients, glass, curves, textures. Pure pinned DATA (no code); re-derived like every other asset.
    shellCss: text(manifest["holo:shellCss"]),
    glyphs, throbber, behavior, palette: manifest["holo:palette"] || {}, font: manifest["holo:font"] || {},
  });
}

// ── state binding (pure) — derive what the chrome SHOWS from a WebContents-shaped state, never mutating
// it. This is the contract the throbber / status bar / nav buttons read; the DOM binder (below) just
// paints this view. Keeping it pure is what makes a skin swap provably state-preserving. ─────────────
export function deriveChromeView(resolved, state) {
  const b = (resolved && resolved.behavior) || {};
  const get = (path) => String(path || "").split(".").reduce((o, k) => (o == null ? undefined : o[k]), state);
  return {
    throbber: !!get(b.throbberSource || "loading"),
    status: String(get(b.statusSource || "nav.current.url") ?? ""),
    backEnabled: !!get(b.backEnabled || "nav.canGoBack"),
    forwardEnabled: !!get(b.forwardEnabled || "nav.canGoForward"),
    security: String(get(b.securityChip || "securityState") ?? "neutral"),
  };
}

// ── holo:SkinActivation receipt — seals WHICH skin is active, pinning its manifest-κ, re-derivable. ─
export async function activationReceipt(skinId, manifestKappa, { at = null, appliesTo = "browser" } = {}) {
  const body = {
    "@context": ["http://www.w3.org/ns/prov#", { holo: "https://hologram.os/ns#" }],
    "@type": ["prov:Activity", "holo:SkinActivation"],
    "holo:skinId": skinId,
    "holo:appliesTo": appliesTo,
    "prov:used": { "@id": manifestKappa, "holo:role": "skin-manifest" },
    ...(at ? { "prov:startedAtTime": at } : {}),
  };
  return { id: await address(body), body };
}

// ── DOM layer (Stage 1 mounting) — guarded so the module imports headless. Mounts the resolved chrome
// INSIDE a <holo-window> shadow root as sibling rows around the slotted iframe; never touches the
// iframe, so swaps preserve all tab state. `bind` maps manifest actions → host callbacks; `getState`
// returns the live WebContents-shaped state for deriveChromeView. ───────────────────────────────────
const hasDOM = () => typeof document !== "undefined";

// STRUCTURAL_CSS — the layout contract EVERY skin shares (so a skin's css carries only era styling, not
// plumbing): the host is display:contents and its two regions flex-order AROUND the slotted page
// (toolbar above, status below), easing in on .skin-shown. Engine-owned, injected before the skin css.
// Regions are VISIBLE, unconditionally. No opacity entrance: a throttled/paused tab (background, or a
// headless preview harness) freezes CSS animations at frame 0 — an opacity:0 keyframe there would leave
// the chrome permanently invisible. The host is display:contents so its two regions flex-order AROUND
// the slotted page (toolbar above, status below). A tiny transform-only slide is the only flourish — if
// it freezes it is a harmless 3px offset, never a hidden chrome.
const STRUCTURAL_CSS = ".skin-chrome{display:contents}"
  + ".skin-chrome .skin-region-top{order:-1}.skin-chrome .skin-region-bottom{order:1}"
  + ".skin-chrome .skin-region-top{animation:holo-skin-in .16s ease}"
  + "@keyframes holo-skin-in{from{transform:translateY(-4px)}}"
  + "@media (prefers-reduced-motion:reduce){.skin-chrome .skin-region-top{animation:none}}";

export function mountChrome(root, resolved, { bind = {}, getState = () => ({}) } = {}) {
  if (!hasDOM() || !root) return null;
  unmountChrome(root);
  // the host is display:contents (CSS): its region children become flex items of the <holo-window>
  // .frame and order themselves AROUND the slotted page (toolbar above, status below) — the iframe is
  // never touched, so a swap preserves all tab state. data-holo-ephemeral keeps it out of re-derivation.
  const host = document.createElement("div");
  host.className = "skin-chrome"; host.setAttribute("data-holo-ephemeral", "");
  const base = document.createElement("style"); base.textContent = STRUCTURAL_CSS;           // engine layout contract
  const style = document.createElement("style"); style.textContent = resolved.chromeCss || ""; // era styling
  const frag = document.createElement("div"); frag.className = "skin-chrome-body"; frag.style.display = "contents"; frag.innerHTML = resolved.chromeHtml || "";
  host.appendChild(base); host.appendChild(style); host.appendChild(frag);
  // wire [data-action] controls to the closed bind table; ignore unknown (defensive).
  frag.querySelectorAll("[data-action]").forEach((el) => {
    const a = el.getAttribute("data-action");
    if (ACTIONS.includes(a) && typeof bind[a] === "function") el.addEventListener("click", (e) => { e.preventDefault(); bind[a](e); });
  });
  // inline each glyph by name + the throbber into their placeholders.
  frag.querySelectorAll("[data-glyph]").forEach((el) => { const g = resolved.glyphs[el.getAttribute("data-glyph")]; if (g && g.svg) el.innerHTML = g.svg; });
  frag.querySelectorAll("[data-throbber]").forEach((el) => { el.innerHTML = resolved.throbber.svg || (resolved.throbber.frames[0] && resolved.throbber.frames[0].svg) || ""; });
  root.appendChild(host);
  const binder = bindState(resolved, host, getState);
  host.__skinBinder = binder;
  binder.update(getState());
  return host;   // the entrance is a pure CSS animation (STRUCTURAL_CSS) — visible even if rAF is throttled
}

export function unmountChrome(root) {
  if (!hasDOM() || !root) return;
  const old = root.querySelector(":scope > .skin-chrome");
  if (old) { try { old.__skinBinder && old.__skinBinder.dispose(); } catch {} old.remove(); }
}

// bindState — paint deriveChromeView() onto the mounted chrome. Returns { update, dispose }.
export function bindState(resolved, host, getState = () => ({})) {
  const apply = (state) => {
    if (!hasDOM() || !host) return;
    const v = deriveChromeView(resolved, state || {});
    host.querySelectorAll("[data-throbber]").forEach((el) => el.classList.toggle("spinning", v.throbber));
    host.querySelectorAll("[data-status]").forEach((el) => { el.textContent = v.throbber ? ("Transferring data from " + v.status + "…") : (v.status ? "Document: Done" : ""); });
    host.querySelectorAll("[data-url]").forEach((el) => { if ("value" in el) el.value = v.status; else el.textContent = v.status; });
    host.querySelectorAll('[data-action="nav.back"]').forEach((el) => el.toggleAttribute("disabled", !v.backEnabled));
    host.querySelectorAll('[data-action="nav.forward"]').forEach((el) => el.toggleAttribute("disabled", !v.forwardEnabled));
    host.querySelectorAll("[data-security]").forEach((el) => el.setAttribute("data-state", v.security));
  };
  return { update: apply, dispose() {} };
}

// swap — the magical switch between two resolved skins. The new chrome eases in via its region
// entrance transition (mountChrome adds .skin-shown next frame); the old is removed first. The iframe +
// tab state are never touched, so the swap is state-preserving and reload-free. ─────────────────────
export async function swap(root, toResolved, opts = {}) {
  if (!hasDOM() || !root) return null;
  return mountChrome(root, toResolved, opts);   // mountChrome unmounts the old, mounts + animates the new
}

// ── selfTest — KAT-style invariants the witness asserts (runs headless). ─────────────────────────────
export async function selfTest() {
  const checks = []; const ok = (c, m) => { checks.push({ ok: !!c, msg: m }); return !!c; };
  ok(ACTIONS.includes("nav.back") && !ACTIONS.includes("eval"), "action vocabulary is closed (no eval)");
  const resolved = { behavior: { throbberSource: "loading", statusSource: "nav.current.url", backEnabled: "nav.canGoBack", forwardEnabled: "nav.canGoForward", securityChip: "securityState" } };
  const state = { loading: true, securityState: "secure", nav: { current: { url: "https://x.test/" }, canGoBack: true, canGoForward: false } };
  const snap = JSON.stringify(state);
  const v = deriveChromeView(resolved, state);
  ok(v.throbber === true && v.status === "https://x.test/" && v.backEnabled === true && v.forwardEnabled === false && v.security === "secure", "deriveChromeView reads state");
  ok(JSON.stringify(state) === snap, "deriveChromeView does NOT mutate state (swap-safe)");
  const r = await activationReceipt("mosaic", "did:holo:sha256:" + "a".repeat(64));
  ok((await address(r.body)) === r.id, "activation receipt re-derives (Law L5)");
  return { ok: checks.every((c) => c.ok), checks };
}

export default { VERSION, ACTIONS, STATE_SOURCES, assetKappa, skinKappa, verifySkin, resolveSkin, deriveChromeView, activationReceipt, mountChrome, unmountChrome, bindState, swap, selfTest };
