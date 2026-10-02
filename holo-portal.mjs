// holo-portal.mjs — THE PORTAL. The ONE canonical entry to Hologram.
//
// The URL names a holospace κ; the portal MOUNTS it through the self-contained holospace runtime
// (holospace.mjs `mount(κ)`) — one verb, governed by the holospace laws L1–L5 (content-not-location ·
// canonical forms · the store is the memory · everything through the substrate · verify by re-derivation).
// The device is a PORTAL streaming κ-addressable objects into that runtime; the machine is a κ too, so
// adding a machine (or nesting a whole holospace) is registering one κ — zero change to this door.
//
// Five shapes, one verb:
//   • an APP (default surface, ?app=<κ|dir>, or an app κ) → a `web` holospace. THE BROWSER IS THE MACHINE:
//     the tab BECOMES the app — its own origin, SW, and full boot ceremony. A hand-off, not a wrapper.
//   • a SINGLE-κ HOLOSPACE in the link (#space=<κ>.<bytes>) → the WHOLE, possibly-nested holospace rides
//     self-contained in the URL, re-derived-or-refused (L5) and mounted. Serverless, no store.
//   • a BARE κ (#<κ> · ?k=<κ>) → the portal STREAMS that object's bytes by κ from the tiered κ-CAS
//     (device store → origin b/ → HF mirror → IPFS, each re-derived, L5). If the bytes are a holospace
//     manifest it MOUNTS (launching = resolving); otherwise the universal resolver projects the object.
//   • a COMPOSITION (?tile=<dir,…>) → a `compositor` holospace tiling children IN PLACE, then the address
//     bar becomes that composition's single-κ link (compose → share). Nesting is free.
//   • any OTHER name → the universal resolver, mounted INLINE at the root (ungated, every visitor).
//
// Thin browser glue; pure decisions live in holo-root-resolver.mjs (node-testable). CSP-safe: one external
// module, zero inline script (Discord Activities allow same-origin external scripts only).

import { mount, kappaOf, serialize, makeResolver, isManifest } from "./usr/lib/holo/holospace.mjs";
import { WEB } from "./usr/lib/holo/machine-web.mjs";                            // import = register the `web` machine
import { kappoVerify } from "./usr/lib/holo/holo-kappa.mjs";                     // Law L5 admission (blake3 re-derive)
import { loadAppIndex, findApp } from "./usr/lib/holo/holo-app-index.mjs";
import { parseIntent, chooseTarget, entryFor, isKappa } from "./holo-root-resolver.mjs";
// machine-compositor + holo-names-host load LAZILY (only a composition / bare-κ needs them) — default stays minimal.

const here = new URL("./", location.href);
const carry = location.search + location.hash;
const beacon = (p) => { try { window.HoloLife && window.HoloLife.mark("portal: " + p); } catch (e) {} };
const dec = (u8) => new TextDecoder().decode(u8);

// url-safe base64 of raw bytes ⇄ bytes (a whole holospace rides in the URL; the manifests are small).
const b64url = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64url = (str) => { const b = atob(str.replace(/-/g, "+").replace(/_/g, "/")); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
// the canonical single-κ link for a locally-built holospace: #space=<κhex>.<b64url canonical bytes>.
const spaceLink = (manifest) => "#space=" + kappaOf(manifest).replace(/^did:holo:blake3:/, "") + "." + b64url(serialize(manifest));

// a web-app holospace: addressed by its signed κ (IDENTITY, Law L1), carrying the index-DERIVED entry URL
// as params.url (convenience). fill:true → the tab becomes it (carry query/hash); fill:false → a tiled pane.
const appWeb = (app, variant, fill = true) => ({
  "@type": "holospace.v1", name: app.title || app.dir, machine: WEB,
  image: "did:holo:" + String(app.kappa || ("sha256:" + app.hex)),
  params: { url: entryFor(app, variant) + (fill ? carry : ""), name: app.title || app.dir, fill },
});

// a name that is not an app → the universal resolver, mounted INLINE at the root (unchanged from the door).
async function resolveHere(nameStr) {
  try { const m = await import("./holo-resolve-view.mjs"); m.mount(document.body, nameStr || ""); }
  catch (e) {
    document.body.innerHTML = '<main style="max-width:720px;margin:9vh auto;padding:0 20px;color:#e9edef;' +
      'font:15px system-ui,sans-serif"><h1 style="font-size:20px">Hologram</h1><p style="color:#8696a0">' +
      'The portal could not load here. Reload, or check your connection.</p></main>';
  }
}

// a share affordance for a mounted holospace: a slim, unobtrusive pill that copies the current κ-link (the
// URL already IS the shareable single-κ link). Auto-fades; the surfaces stay the star.
function showShareChip(label) {
  try {
    const el = document.createElement("div");
    el.setAttribute("style", "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483000;" +
      "display:flex;align-items:center;gap:10px;padding:8px 14px;border-radius:999px;font:600 12.5px/1 system-ui,-apple-system,'Segoe UI',sans-serif;" +
      "background:#1f1f1ee6;color:#e9edef;border:1px solid rgba(255,255,255,.12);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);" +
      "box-shadow:0 10px 30px -12px #000c;cursor:pointer;transition:opacity .4s ease;opacity:1;user-select:none");
    const b = document.createElement("span"); b.textContent = "⧉ " + (label || "Copy space link");
    el.appendChild(b);
    el.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(location.href); b.textContent = "✓ Link copied"; }
      catch (e) { b.textContent = location.href.length > 48 ? "Copy from address bar" : location.href; }
      el.style.opacity = "1"; setTimeout(() => (el.style.opacity = "0"), 1800);
    });
    document.body.appendChild(el);
    setTimeout(() => (el.style.opacity = "0.0"), 6000);
    el.addEventListener("mouseenter", () => (el.style.opacity = "1"));
  } catch (e) {}
}

// mount a holospace built HERE (its bytes are warm — held in memory, resolved with zero network, Law L3).
async function mountLocal(manifest) {
  const k = kappaOf(manifest), seed = serialize(manifest);
  const resolve = makeResolver(async (kk) => (kk === k ? seed : null));
  return mount(k, document.body, { resolve });
}

// STREAM a bare κ from the tiered κ-CAS and, if it is a holospace manifest, MOUNT it. The host resolver
// (holo-names-host) does the whole race — device store → origin b/ → HF mirror → IPFS — and re-derives
// every byte (L5). A verified non-holospace κ, or a miss, returns false so the caller projects it instead.
async function tryStreamKappaSpace(name) {
  try {
    const { makeHostResolver } = await import("./usr/lib/holo/holo-names-host.mjs");
    const r = await makeHostResolver({ base: here }).resolve(name);
    if (!r || !r.ok || !r.bytes) return false;
    let m; try { m = JSON.parse(dec(r.bytes)); } catch (e) { return false; }
    if (!isManifest(m)) return false;                                // a κ that is not a holospace → project it
    await import("./usr/lib/holo/machine-compositor.mjs");           // ensure the compositor machine is registered
    const rr = await mount("did:holo:" + (r.kappa || name), document.body, { resolve: async () => m });  // host already re-derived (L5)
    if (rr && rr.ok) { showShareChip(); return true; }
    return false;
  } catch (e) { return false; }
}

(async () => {
  beacon("boot");
  // a CARRY LINK at the root (#recv=1.<axis>.<payload>.<name>): the bytes are IN THE LINK — resolve inline.
  if ((location.hash || "").startsWith("#recv=1.")) return resolveHere("");

  // A SINGLE-κ HOLOSPACE IN THE LINK — the whole (nested) arrangement rides self-contained, verified (L5).
  const spaceM = /^#space=([0-9a-f]{64})\.(.+)$/i.exec(location.hash || "");
  if (spaceM) {
    beacon("space");
    const k = "did:holo:blake3:" + spaceM[1].toLowerCase();
    let bytes = null; try { bytes = unb64url(spaceM[2]); } catch (e) {}
    if (bytes && kappoVerify(bytes, k)) {                              // the link cannot lie — re-derive or refuse
      const { configure } = await import("./usr/lib/holo/machine-compositor.mjs");  // registers the compositor machine
      const resolve = makeResolver(async (kk) => (kk === k ? bytes : null));
      configure({ resolve });
      const r = await mount(k, document.body, { resolve });
      if (r.ok) { showShareChip(); return beacon("space:mounted"); }
    }
    return resolveHere("");                                           // tampered / unknown machine → honest fallback
  }

  let frame = false, tile = "";
  try { const q = new URLSearchParams(location.search); frame = q.has("frame_id"); tile = (q.get("tile") || "").trim(); } catch (e) {}

  let index = null;
  try { index = await loadAppIndex({ base: here }); } catch (e) { index = null; }

  // COMPOSITION — ?tile=<dir,dir,…>: open several apps as ONE tiled holospace, in place, then REWRITE the
  // address bar to the composition's single-κ link so it is instantly shareable (compose → share).
  if (tile && index) {
    const apps = tile.split(",").map((d) => findApp(index, d.trim())).filter(Boolean);
    if (apps.length) {
      beacon("compose:" + apps.length);
      const { COMPOSITOR, configure } = await import("./usr/lib/holo/machine-compositor.mjs");  // lazy: only a composition needs it
      const space = { "@type": "holospace.v1", name: "Hologram", machine: COMPOSITOR,
        image: apps.map((a) => appWeb(a, null, false)), params: { layout: apps.length === 1 ? "single" : "grid" } };
      const k = kappaOf(space), seed = serialize(space);
      const resolve = makeResolver(async (kk) => (kk === k ? seed : null));
      configure({ resolve });
      const r = await mount(k, document.body, { resolve });
      if (r.ok) { try { history.replaceState(null, "", location.pathname + spaceLink(space)); } catch (e) {} showShareChip(); return beacon("composed"); }
    }
    // no resolvable tiles → fall through to the default surface
  }

  // APP / NAME — the door's pure decision, now realized as mount(κ).
  const intent = parseIntent({ search: location.search, hash: location.hash, host: location.hostname, frame });
  if (!index) return resolveHere(intent.name || decodeURIComponent((location.hash || "").replace(/^#/, "")));
  const target = chooseTarget({ index, intent, findApp });

  if (target.kind !== "app") {
    // a bare κ that is not an app → try to STREAM + mount it as a holospace; else project it in the resolver.
    if (isKappa(target.name) && (await tryStreamKappaSpace(target.name))) return beacon("streamed");
    return resolveHere(target.name);
  }

  // an app → a `web` holospace. The browser is the machine: the tab BECOMES it (hand-off, ceremony intact).
  beacon("app:" + (target.app.dir || "app"));
  const r = await mountLocal(appWeb(target.app, target.variant, true));
  if (!r.ok) return resolveHere(target.app.dir || "");              // fail-soft → the inline resolver
})();
