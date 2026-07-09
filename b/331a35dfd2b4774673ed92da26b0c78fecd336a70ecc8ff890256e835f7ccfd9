// holo-m1-boot.mjs — M1: INSTANT SERVERLESS BOOT. One self-verifying link boots the WHOLE messenger.
//
// A single web link that, opened in a COLD browser, brings up the entire Holo Messenger — shell + your
// identity + Q — with ZERO origin servers in the delivery path (every shell byte is a content-addressed κ
// object, served from cache/OPFS on repeat opens). The descriptor travels INSIDE the link (b64url JSON in
// the URL fragment), exactly like holo-chat-link.mjs / holo-together.mjs: a bare browser verifies it LOCALLY
// (Law L5: re-derive the κ), then boots. The κ is SHA-256 of the canonical PUBLIC fields — the shareable,
// tamper-evident id. Any private pairing bearer is EXCLUDED from the κ (whoever holds the link may adopt it).
//
// This commits to the SHELL MANIFEST (the exact asset set the service worker precaches), so a tampered link
// that points the boot at a different/injected asset set breaks integrity and is refused. Laws: L2 canonical,
// L5 verify-by-re-derivation. Additive + fail-soft: if anything here throws, app.html's normal boot proceeds.

export const BOOT_LINK_VERSION = 1;
const ENTRY_PATH = "/apps/holo-messenger/app.html";

// THE SHELL — the minimal asset set required to paint the messenger and reach interactive, and the single
// source of truth the service worker precaches (messenger-sw.js mirrors these basenames; the M1 witness
// asserts the two never drift). Q's brain, the bridges, and all media are DELIBERATELY absent: they are
// deferred (never on the first-paint critical path), so the shell stays tiny and cache-resident.
export const SHELL_MANIFEST = [
  "/apps/holo-messenger/app.html",
  "/apps/holo-messenger/_vendor/ui/chat-ui.bundle.js",
  "/apps/holo-messenger/_vendor/ui/chat-ui.bundle.css",
  "/apps/holo-messenger/holo-messenger-login.mjs",
  "/apps/holo-messenger/holo-messenger-app.mjs",
  "/apps/holo-messenger/messenger-shadcn-ui.mjs",
  "/apps/holo-messenger/holo-messenger-weave.mjs",
  "/apps/holo-messenger/messenger-skin.mjs",
  "/apps/holo-messenger/messenger-skins.css",
  "/apps/holo-messenger/messenger-sw-register.mjs",
  "/apps/holo-messenger/holo-m1-boot.mjs",
  "/apps/holo-messenger/holo-release-boot.mjs",
  "/apps/holo-messenger/holo-release-verify.mjs",
  "/apps/holo-messenger/mail/holo-mail-attach.mjs",
  "/apps/holo-messenger/_vendor/wallpaper-default.jpg",
];

const _te = new TextEncoder();
async function _sha256hex(s) { const h = await (globalThis.crypto || crypto).subtle.digest("SHA-256", _te.encode(s)); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function _b64urlEncode(obj) { const b = btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function _b64urlDecode(str) { const b = String(str).replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(decodeURIComponent(escape(atob(b)))); }

// The shell manifest (shell-manifest.json, minted by _build/gen-shell-manifest.mjs) is the content hash of
// every shell BYTE: [{ path, kappa=SHA-256(bytes) }]. In a browser we fetch it; in Node the caller passes it.
export async function loadShellManifest() {
  try {
    if (typeof fetch === "function" && typeof location !== "undefined") {
      const r = await fetch(new URL("./shell-manifest.json", import.meta.url), { cache: "no-store" });   // module-relative: same file at the OS root or any static mount
      if (r && r.ok) return await r.json();
    }
  } catch {}
  return null;
}

// The ONE hash the boot link commits: SHA-256 over the SORTED per-asset content κs. Any browser re-derives it
// from shell-manifest.json → thereby verifies EVERY shell byte (Law L5). Recomputed from `assets`, never trusting
// the manifest's self-declared `aggregate`, so a forged manifest fails. Empty (unverifiable) → no commitment.
export async function shellAggregate(manifest) {
  const m = manifest || (await loadShellManifest());
  if (!m || !Array.isArray(m.assets) || !m.assets.length) return "";
  return _sha256hex(m.assets.map((a) => String(a.kappa)).sort().join(","));
}

// canonical PUBLIC form — any private `pair` bearer is EXCLUDED so the κ is the shareable id. Commits to the
// entry, the shell set, the display identity (so a tampered "this is <who>'s messenger" card breaks — anti-phish).
function _canon(d) {
  return [
    "v" + (d.v | 0), d.kind || "boot", d.app || "holo-messenger", d.entry || ENTRY_PATH,
    d.shell || "", d.name || "", d.truename || "", d.op || "",
    String(d.created || 0), String(d.expires || 0),
  ].join("␟");
}

// Build the one-link door for the whole messenger. `op`/`name`/`truename` are PUBLIC display identity (the
// landing shows "resume <name>'s messenger"); `pair` is an optional bearer pairing payload (device-roam) and
// is NOT part of the κ. Opening the link still auto-enrolls a sovereign identity unless a pair bearer is honored.
export async function makeBootLink({ op = "", name = "", truename = "", pair = null, ttlSeconds = 30 * 24 * 3600, origin = null, nowMs = null, aggregate = null, manifest = null } = {}) {
  const now = nowMs || Date.now();
  const shell = aggregate || (await shellAggregate(manifest));      // commit the shell BYTES (aggregate content κ)
  const d = {
    v: BOOT_LINK_VERSION, kind: "boot", app: "holo-messenger", entry: ENTRY_PATH,
    shell,
    op: String(op || "").slice(0, 96), name: String(name || "").slice(0, 60), truename: String(truename || "").slice(0, 60),
    created: now, expires: now + ttlSeconds * 1000,
  };
  if (pair) d.pair = pair;                         // bearer pairing payload — NOT part of the κ
  d.kappa = await _sha256hex(_canon(d));
  const payload = _b64urlEncode(d);
  const org = origin || (typeof location !== "undefined" ? location.origin : "");
  return { kappa: d.kappa, payload, descriptor: d,
    https: `${org}${ENTRY_PATH}#m1=${payload}`,     // opens in ANY cold browser
    holo: `holo://os${ENTRY_PATH}#m1=${payload}` }; // in-shell full surface
}

// parse a boot link (URL, holo:// form, `#m1=<payload>`, or bare payload) → { ok, descriptor, integrity, expired }.
export async function parseBootLink(input, { nowMs = null, aggregate = null, manifest = null } = {}) {
  let payload = String(input || "");
  if (payload.includes("#")) payload = payload.split("#").pop();
  payload = payload.replace(/^m1=/, "");
  let d; try { d = _b64urlDecode(payload); } catch { return { ok: false, error: "unreadable boot link" }; }
  if (!d || d.v !== BOOT_LINK_VERSION || d.kind !== "boot" || d.app !== "holo-messenger" || !d.kappa) return { ok: false, error: "not a valid messenger boot link" };
  const integrity = (await _sha256hex(_canon(d))) === d.kappa;                     // Law L5: re-derive; tamper → false
  const current = aggregate != null ? aggregate : (await shellAggregate(manifest));// THIS build's shell-byte aggregate
  const shellMatches = !!current && d.shell === current;                           // link's shell BYTES must match (unverifiable → false)
  const expired = !!(d.expires && (nowMs || Date.now()) > d.expires);
  return { ok: true, descriptor: d, integrity, shellMatches, expired, aggregate: current };
}

// convenience: verify + return the boot descriptor only if it is safe to act on (integrity + shell + fresh).
export async function resolveBootLink(input, opts = {}) {
  const p = await parseBootLink(input, opts);
  if (!p.ok) return { ok: false, reason: p.error };
  if (!p.integrity) return { ok: false, reason: "tampered" };
  if (!p.shellMatches) return { ok: false, reason: "shell-mismatch" };
  if (p.expired) return { ok: false, reason: "expired" };
  return { ok: true, descriptor: p.descriptor, pair: p.descriptor.pair || null };
}

export function describe(d) {
  const who = (d && (d.name || d.truename)) || "someone";
  return { headline: `Resume ${who}'s messenger`, cta: "Open" };
}

export function installM1Boot() {
  if (typeof window === "undefined") return false;
  window.HoloM1Boot = Object.assign(window.HoloM1Boot || {}, { version: BOOT_LINK_VERSION, SHELL_MANIFEST, makeBootLink, parseBootLink, resolveBootLink, describe, loadShellManifest, shellAggregate });
  return true;
}
try { installM1Boot(); } catch {}
