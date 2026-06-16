#!/usr/bin/env node
// holo-skin-witness.mjs — proves the Holo Browser SKIN engine (holo:BrowserSkin) is a hot-swappable,
// κ-addressed, state-preserving chrome dress that is honest by re-derivation (Law L5) and structurally
// confined to browser tabs (it can NEVER repaint OS chrome). First skin under test: NCSA Mosaic.
//
// Checks (all must hold):
//   1 engineSelfTest        — holo-skin.selfTest() passes (pure invariants: state read-only, receipt re-derives).
//   2 manifestReDerives     — skinKappa(mosaic) === mosaic["@id"] (Law L5 on the manifest itself).
//   3 chromeAssetsResolve   — resolveSkin("mosaic") returns chromeHtml/css + every glyph + the globe, all verified.
//   4 pinsEnforced          — flipping ONE byte of a pinned asset makes resolveSkin REFUSE (L5), with a clear reason.
//   5 appliesToBrowserOnly  — a manifest whose appliesTo ≠ "browser" is refused outright (the OS-chrome guard).
//   6 behaviorVocabClosed   — every menu action is in the closed ACTIONS set; an unknown action is refused.
//   7 swapPreservesState    — deriving the chrome view for modern→mosaic→modern leaves the state object byte-identical.
//   8 reDerivationParity    — resolveSkin("mosaic") twice → byte-identical chrome (same κ ⇒ same chrome).
//   9 activationReceipt     — activationReceipt pins the manifest-κ, types holo:SkinActivation, and RE-DERIVES (L5).
//  10 openModelZeroEngine   — a synthetic second skin resolves through the SAME engine, no code change (Constraint 5).
//
// Honest L5 (caveats[]): the Mosaic globe + glyphs are RE-AUTHORED web SVG, not byte-derived from the
// upstream Motif pixmaps; Annotate/Hotlist menu items map to action "noop" (no backend). Recorded, not faked.
//
// Authority: NCSA Mosaic X11/Motif client (github.com/alandipert/ncsa-mosaic) · W3C Web Components
// (shadow DOM) · W3C DID Core + multiformats (κ = did:holo:sha256) · W3C PROV-O (activation receipt) ·
// holospaces Laws L1/L5. Usage: node tools/holo-skin-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveSkin, skinKappa, activationReceipt, selfTest, ACTIONS, deriveChromeView } from "../os/usr/lib/holo/holo-skin.js";
import { address } from "../os/usr/lib/holo/q/holo-q-receipt.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-skin-witness.result.json"), JSON.stringify(r, null, 2) + "\n");
const skinDir = join(here, "..", "os", "usr", "lib", "holo", "skins", "mosaic");
const reader = (base) => (rel) => new Uint8Array(readFileSync(join(base, rel)));
const checks = {}; const caveats = [];

const manifest = JSON.parse(readFileSync(join(skinDir, "skin.json"), "utf8"));

// ── 1 · engine self-test ─────────────────────────────────────────────────────────────────────────
{ const st = await selfTest(); checks.engineSelfTest = st.ok; if (!st.ok) caveats.push("selfTest: " + st.checks.filter((c) => !c.ok).map((c) => c.msg).join("; ")); }

// ── 2 · the manifest re-derives to its own @id ─────────────────────────────────────────────────────
{ checks.manifestReDerives = (await skinKappa(manifest)) === manifest["@id"]; }

// ── 3 · every chrome asset resolves + verifies ─────────────────────────────────────────────────────
let resolved;
{
  resolved = await resolveSkin("mosaic", { read: reader(skinDir) });
  const glyphs = resolved.glyphs;
  checks.chromeAssetsResolve = !!resolved.chromeHtml && /menubar/i.test(resolved.chromeHtml) && !!resolved.chromeCss &&
    ["back", "forward", "home", "reload", "open", "stop", "newwin"].every((g) => glyphs[g] && /<svg/.test(glyphs[g].svg)) &&
    resolved.throbber.kind === "svg" && /<svg/.test(resolved.throbber.svg);
}

// ── 4 · pin enforcement — a flipped byte is refused (Law L5) ───────────────────────────────────────
{
  const tamperRead = (rel) => { const b = reader(skinDir)(rel); if (rel === "chrome.html") { const c = b.slice(); c[c.length - 2] ^= 1; return c; } return b; };
  let refused = false, reason = "";
  try { await resolveSkin("mosaic", { read: tamperRead }); } catch (e) { refused = true; reason = String(e.message || e); }
  checks.pinsEnforced = refused && /L5|mismatch/i.test(reason);
}

// ── 5 · the OS-chrome guard — appliesTo ≠ "browser" is refused ─────────────────────────────────────
{
  const badManifest = { ...manifest, "holo:appliesTo": "os-shell" };
  let refused = false;
  try { await resolveSkin("mosaic", { read: reader(skinDir), manifest: badManifest, verify: false }); } catch { refused = true; }
  checks.appliesToBrowserOnly = refused;
}

// ── 6 · the behavior vocabulary is closed — an unknown action is refused ───────────────────────────
{
  const allActions = (manifest["holo:behavior"].menus || []).flatMap((m) => m.items.map((i) => i.action));
  const allKnown = allActions.every((a) => ACTIONS.includes(a));
  const evil = JSON.parse(JSON.stringify(manifest));
  evil["holo:behavior"].menus[0].items[0].action = "eval";
  let refused = false;
  try { await resolveSkin("mosaic", { read: reader(skinDir), manifest: evil, verify: false }); } catch { refused = true; }
  checks.behaviorVocabClosed = allKnown && refused;
}

// ── 7 · a skin swap preserves tab state — deriveChromeView never mutates the state object ──────────
{
  const state = { loading: true, securityState: "secure", nav: { current: { url: "https://news.ycombinator.com/" }, canGoBack: true, canGoForward: false } };
  const snap = JSON.stringify(state);
  const modern = { behavior: {} };                 // default chrome: empty behavior → falls back to source defaults
  deriveChromeView(modern, state); deriveChromeView(resolved, state); deriveChromeView(modern, state);
  const v = deriveChromeView(resolved, state);
  checks.swapPreservesState = JSON.stringify(state) === snap && v.throbber === true && v.status === "https://news.ycombinator.com/" && v.backEnabled === true && v.forwardEnabled === false;
}

// ── 8 · re-derivation parity — same skin resolved twice is byte-identical ──────────────────────────
{
  const a = await resolveSkin("mosaic", { read: reader(skinDir) });
  const b = await resolveSkin("mosaic", { read: reader(skinDir) });
  checks.reDerivationParity = a.manifestKappa === b.manifestKappa && a.chromeHtml === b.chromeHtml && a.chromeCss === b.chromeCss && a.throbber.svg === b.throbber.svg;
}

// ── 9 · the activation receipt pins the manifest-κ + re-derives (Law L5) ───────────────────────────
{
  const r = await activationReceipt("mosaic", manifest["@id"]);
  const b = r.body;
  const shape = Array.isArray(b["@type"]) && b["@type"].includes("holo:SkinActivation") &&
    b["holo:skinId"] === "mosaic" && b["holo:appliesTo"] === "browser" && b["prov:used"]["@id"] === manifest["@id"];
  checks.activationReceipt = shape && (await address(b)) === r.id;
}

// ── 10 · open model — a synthetic second skin resolves through the SAME engine, zero code change ────
{
  const html = new TextEncoder().encode("<div class='menubar'>x</div>");
  const css = new TextEncoder().encode(".skin-chrome{}");
  const { assetKappa } = await import("../os/usr/lib/holo/holo-skin.js");
  const kHtml = await assetKappa(html), kCss = await assetKappa(css);
  const m2 = { "@type": "holo:BrowserSkin", "holo:skinId": "netscape", "holo:appliesTo": "browser",
    "holo:chrome": { html: kHtml, css: kCss }, "holo:glyphs": {}, "holo:throbber": {},
    "holo:behavior": { menus: [{ label: "File", items: [{ label: "Open", action: "omni.focus" }] }] } };
  m2["@id"] = await skinKappa(m2);
  const synthRead = (rel) => rel === "h" ? html : css;
  const pin2 = { files: { h: kHtml, c: kCss } };
  // rewrite chrome refs to the relpaths the synthetic reader serves
  const r2 = await resolveSkin("netscape", { read: synthRead, manifest: m2, pin: pin2 });
  checks.openModelZeroEngine = r2.id === "netscape" && r2.chromeHtml === "<div class='menubar'>x</div>" && r2.manifestKappa === m2["@id"];
}

// ── 11 · every SHIPPED skin resolves, κ-verifies, and re-derives (L5) ──────────────────────────────
{
  const shipped = ["netscape", "ie", "opera", "winxp", "lcars", "aqua", "holographic", "win98", "hhgttg", "win11", "bigsur", "crt", "lotr", "foundation"]; let allOk = true; const detail = {};
  for (const id of shipped) {
    try {
      const dir = join(here, "..", "os", "usr", "lib", "holo", "skins", id);
      const m = JSON.parse(readFileSync(join(dir, "skin.json"), "utf8"));
      const r = await resolveSkin(id, { read: reader(dir) });
      const menuActions = (m["holo:behavior"].menus || []).flatMap((mn) => mn.items.map((i) => i.action));
      const ok = m["holo:appliesTo"] === "browser" && (await skinKappa(m)) === m["@id"] &&
        !!r.chromeHtml && /menubar/i.test(r.chromeHtml) && !!r.chromeCss &&
        ["back", "forward", "home", "reload", "open", "stop", "newwin"].every((g) => r.glyphs[g] && /<svg/.test(r.glyphs[g].svg)) &&
        /<svg/.test(r.throbber.svg) && menuActions.every((a) => ACTIONS.includes(a));
      detail[id] = ok; if (!ok) allOk = false;
    } catch (e) { detail[id] = String(e.message || e); allOk = false; }
  }
  checks.shippedSkinsResolve = allOk;
  if (!allOk) caveats.push("shipped skins: " + JSON.stringify(detail));
}

// ── 12 · the additive holo:shellCss capability — a κ-pinned shell stylesheet resolves + re-derives ──
{
  let ok = true; const detail = {};
  for (const id of ["winxp", "lcars", "aqua", "holographic", "win98", "hhgttg", "win11", "bigsur", "crt", "lotr", "foundation"]) {
    try {
      const dir = join(here, "..", "os", "usr", "lib", "holo", "skins", id);
      const m = JSON.parse(readFileSync(join(dir, "skin.json"), "utf8"));
      const r = await resolveSkin(id, { read: reader(dir) });
      // the manifest must DECLARE a κ-pinned shellCss, the resolver must surface its bytes, and a flipped
      // byte must be REFUSED (collectRefs now walks holo:shellCss, so it is pin-enforced like any asset).
      const declared = typeof m["holo:shellCss"] === "string" && /^did:holo:sha256:/.test(m["holo:shellCss"]);
      const surfaced = typeof r.shellCss === "string" && r.shellCss.length > 0 && /#tabstrip|#navbar|#holo-/.test(r.shellCss);
      let refused = false;
      const tamper = (rel) => { const b = reader(dir)(rel); if (rel === "shell.css") { const c = b.slice(); c[c.length - 2] ^= 1; return c; } return b; };
      try { await resolveSkin(id, { read: tamper }); } catch { refused = true; }
      detail[id] = declared && surfaced && refused; if (!detail[id]) ok = false;
    } catch (e) { detail[id] = String(e.message || e); ok = false; }
  }
  checks.shellCssCapability = ok;
  if (!ok) caveats.push("shellCss: " + JSON.stringify(detail));
}

// honest caveats (recorded, never faked green)
caveats.push("globe + toolbar glyphs are re-authored web SVG, not byte-derived from upstream Motif pixmaps");
caveats.push("Annotate / Window-History / Options menu items map to action 'noop' (no backend in Stage 1)");

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "The Holo Browser chrome is a hot-swappable, κ-addressed skin (holo:BrowserSkin). Every chrome asset (html/css/glyphs/the spinning NCSA globe) is referenced by content address and re-hashed on load — a flipped byte is refused (Law L5); the manifest re-derives to its own @id; a skin can ONLY target browser tabs (appliesTo='browser', so it can never repaint OS chrome); behavior is a CLOSED action vocabulary (no code in a manifest, so a new skin is a zero-engine-change data drop); and a swap is state-preserving (the chrome view derivation never mutates tab state). First skin: NCSA Mosaic, re-authored faithfully as web chrome.",
  authority: "NCSA Mosaic X11/Motif client (github.com/alandipert/ncsa-mosaic) · W3C Web Components (shadow DOM) · W3C DID Core + multiformats · W3C PROV-O · holospaces Laws L1/L5",
  witnessed,
  covers: witnessed ? ["manifest-re-derives", "chrome-assets-verified", "pin-enforced-l5", "applies-to-browser-only", "behavior-vocab-closed", "swap-preserves-state", "re-derivation-parity", "activation-receipt-l5", "open-model-zero-engine-change", "shipped-skins-15-browsers-winxp-win98-aqua-bigsur-win11-lcars-holographic-hhgttg-crt-lotr-foundation", "shell-css-capability-pinned"] : [],
  caveats,
  checks,
});
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ Holo Browser skin engine is κ-honest, browser-confined, state-preserving (Law L5)" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
