// root-door.mjs — the ROOT DOOR is a UNIVERSAL RESOLVER, not a location redirect.
//
// CSP-safe by construction (external module, no inline script: Discord Activities block inline).
// It reads the URL as an OBJECT — a κ or a name, never a path — and resolves it through the
// UPSTREAM HOLOSPACE RUNTIME: holo-app-index maps a signed κ → its re-derived entry (launching IS
// resolving), and the universal name plane (apps/resolve) inspects any other name (content κ · web
// · chain · ipfs), re-deriving-or-refusing every byte (L5). No `apps/<dir>/` pointer lives here:
// the default surface (the messenger app) is opened BY ITS κ, and its path is what the signed index
// derives from that κ. Axis-agnostic — sha256 today, blake3 the instant the release re-seals.
//
// The query string + hash survive every hop (the Embedded App SDK reads frame_id from the document
// it boots in, and a shared object link carries its κ in the hash).

import { loadAppIndex, findApp } from "./usr/lib/holo/holo-app-index.mjs";
import { parseIntent, chooseTarget, entryFor } from "./holo-root-resolver.mjs";

const here = new URL("./", location.href);
let frame = false;
try { frame = new URLSearchParams(location.search).has("frame_id"); } catch (e) {}

const intent = parseIntent({ search: location.search, hash: location.hash, host: location.hostname, frame });
const carry = location.search + location.hash;
const go = (u) => location.replace(new URL(u, here).href);

// A name/κ that is not an app resolves INLINE, right here at the root — no sub-app, no redirect. The
// universal resolver view mounts in this same document, so github.io/Q/#<name> IS the resolver. Fast +
// ungated + universal: no login, no shell boot. Fail-soft: if the view can't load, an honest line.
async function resolveHere(name) {
  try { const m = await import("./holo-resolve-view.mjs"); m.mount(document.body, name || ""); }
  catch (e) { document.body.innerHTML = '<main style="max-width:720px;margin:9vh auto;padding:0 20px;color:#e9edef;font:15px system-ui,sans-serif"><h1 style="font-size:20px">Holo Resolve</h1><p style="color:#8696a0">The resolver could not load here. Reload, or check your connection.</p></main>'; }
}

(async () => {
  // A CARRY LINK at the root (#recv=1.<sha256>.<payload>.<name>): the bytes are IN THE LINK — the
  // resolver is also the RECEIVER. Render the receive door inline; no app boot, no host, no index.
  if ((location.hash || "").startsWith("#recv=1.")) return resolveHere("");
  try {
    const index = await loadAppIndex({ base: here });          // the SIGNED apps table → one κ per app
    const target = chooseTarget({ index, intent, findApp });
    if (target.kind === "app") return go(entryFor(target.app, target.variant) + carry);   // launch an app BY ITS κ (unchanged)
    return resolveHere(target.name);                           // any other name → the universal resolver, INLINE at the root
  } catch (e) {
    // FLOOR: the signed index couldn't load — still resolve inline (the resolver needs no index for a name).
    return resolveHere(intent.name || decodeURIComponent((location.hash || "").replace(/^#/, "")));
  }
})();
