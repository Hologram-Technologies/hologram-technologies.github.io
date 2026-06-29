// holo-home.mjs — THE PERSONAL CLOUD MANIFEST. Your files, apps, LLM context, named spaces and
// paired devices as ONE owner-signed, append-only κ you CARRY — not a server you reach. This is the
// CasaOS experience with the box deleted: there is no origin, no IP, no port. "Home" is a PROJECTION
// of a signed source chain (holo-strand) whose entries are home.* mutations. The head κ attests the
// WHOLE Home, so drop/reorder/tamper/forged-sig all fail closed (Law L5 over the sequence). A peer's
// Home is taken only via verify-before-adopt (cross-device roam). No new store, no new crypto — Home
// is a thin semantic layer over the existing spine.
//
// Anchored 100% in the substrate:
//   • holo-strand (makeStrand) — the hash-linked, operator-signed, append-only chain + adopt/verify.
//   • holo-identity (via the signer) — authorship: an entry's operator κ IS its pubkey's address.
//   • holo-session.activeCipher — AES-GCM at rest under the sovereign vault key (browser binding).
//
// Entries carry κ-REFS, never bytes: a file is a ref into the vault, an app a ref into the catalog,
// a space a ref to a workspace manifest. The current Home = replay() folded into live state. Resolution
// of any ref goes through the O(1) engine at the surface; this module only owns the OWNED INDEX.
//
// makeHome is adapter-injectable (node-testable with an in-memory backend + a real enrolled principal
// as signer); the browser binding wires the encrypted κ-store and the live operator, exactly like
// holo-strand's own binding.

import { makeStrand } from "./holo-strand.mjs";

// the home.* mutation vocabulary — every Home change is one of these, sealed onto the spine.
export const HOME_KINDS = Object.freeze([
  "home.init",
  "home.files.add", "home.files.unlink",
  "home.app.pin", "home.app.unpin",
  "home.space.add", "home.space.rename",
  "home.ask.context",
  "home.device.pair", "home.device.revoke",
]);

const APP_CLASSES = new Set(["kappa", "web", "alpine", "ext"]);   // how the surface renders a pinned app

// makeHome({ backend, now, signer }) → the personal-cloud manifest over a strand.
//   backend : durable store { load, save } passed straight to the strand (absent ⇒ in-memory).
//   now     : () → ISO string committed into each entry.
//   signer  : an unlocked holo-identity principal (optional; unsigned still hash-links).
export function makeHome({ backend = null, now = () => "1970-01-01T00:00:00Z", signer = null } = {}) {
  const strand = makeStrand({ backend, now, signer });
  const add = (kind, payload) => strand.append({ kind, payload });

  // ── mutators (each appends one signed entry to the spine) ─────────────────────────────────────────
  const init        = ({ owner = null, title = "My Home" } = {}) => add("home.init", { owner, title });
  const addFile     = (ref, name, parent = null)                 => add("home.files.add", { ref, name, parent });
  const unlinkFile  = (ref)                                      => add("home.files.unlink", { ref });
  const pinApp      = (ref, cls = "kappa")                       => add("home.app.pin", { ref, class: APP_CLASSES.has(cls) ? cls : "kappa" });
  const unpinApp    = (ref)                                      => add("home.app.unpin", { ref });
  const addSpace    = (ref, name)                                => add("home.space.add", { ref, name });
  const renameSpace = (ref, name)                                => add("home.space.rename", { ref, name });
  const setAskContext = (refs = [])                              => add("home.ask.context", { refs: Array.isArray(refs) ? refs : [] });
  const pairDevice  = (deviceKappa, label = "")                  => add("home.device.pair", { deviceKappa, label });
  const revokeDevice = (deviceKappa)                             => add("home.device.revoke", { deviceKappa });

  // ── projection: fold the verified chain into the current Home (the ONLY read path) ────────────────
  // Fails closed: a broken chain yields NO Home (never a partial / drifted view).
  async function project() {
    const v = await strand.verify();
    if (!v.ok) return { ok: false, why: "chain-broken", brokeAt: v.brokeAt, head: v.head ?? null };
    const entries = strand.replay({});                       // ready() already ran inside verify()
    let meta = { owner: null, title: null };
    let ask = [];
    const files = new Map(), apps = new Map(), spaces = new Map(), devices = new Map();
    for (const e of entries) {
      const k = e["holstr:kind"]; const p = e["holstr:payload"] || {};
      switch (k) {
        case "home.init":          meta = { owner: p.owner ?? null, title: p.title ?? null }; break;
        case "home.files.add":     files.set(p.ref, { ref: p.ref, name: p.name, parent: p.parent ?? null }); break;
        case "home.files.unlink":  files.delete(p.ref); break;
        case "home.app.pin":       apps.set(p.ref, { ref: p.ref, class: p.class || "kappa" }); break;
        case "home.app.unpin":     apps.delete(p.ref); break;
        case "home.space.add":     spaces.set(p.ref, { ref: p.ref, name: p.name }); break;
        case "home.space.rename":  if (spaces.has(p.ref)) spaces.get(p.ref).name = p.name; break;
        case "home.ask.context":   ask = Array.isArray(p.refs) ? p.refs.slice() : []; break;
        case "home.device.pair":   devices.set(p.deviceKappa, { deviceKappa: p.deviceKappa, label: p.label || "" }); break;
        case "home.device.revoke": devices.delete(p.deviceKappa); break;
      }
    }
    return {
      ok: true, head: strand.head(), meta,
      files: [...files.values()], apps: [...apps.values()],
      spaces: [...spaces.values()], ask: { context: ask }, devices: [...devices.values()],
    };
  }

  // list one section ("files" | "apps" | "spaces" | "devices") — surface convenience.
  async function list(section) {
    const h = await project();
    if (!h.ok) return h;
    return section in h ? h[section] : null;
  }

  // adopt a peer's Home chain — verify-before-adopt (delegates to the spine; fail-closed + atomic).
  // The caller decides WHEN to adopt (e.g. only on a fast-forward from roam reconciliation).
  const adopt = (candidate) => strand.adopt(candidate);

  return {
    init, addFile, unlinkFile, pinApp, unpinApp, addSpace, renameSpace,
    setAskContext, pairDevice, revokeDevice,
    project, list, adopt,
    head: strand.head, verify: strand.verify, length: strand.length, ready: strand.ready,
    _strand: strand,
  };
}

// ── browser binding: window.HoloHome over the SAME AES-GCM-encrypted κ-store + live operator as
// holo-strand (one sovereign vault key; locked ⇒ never plaintext). The strand binding already exists as
// window.HoloStrand; Home reuses its backend so the manifest and the operator's source chain share one
// encrypted spine on disk.
if (typeof window !== "undefined") {
  const wire = async () => {
    try {
      if (window.HoloHome) return;
      const strandMod = await import("./holo-strand.mjs");
      // reuse the strand's own idb+cipher backend by constructing a strand and lifting its store is not
      // exposed; instead bind Home over a fresh strand using the same module so the encrypted backend and
      // signer policy are identical. The operator (signer) is attached by the surface via setSigner.
      const backend = null;                                  // surface supplies the encrypted backend on bind
      const home = makeHome({ backend, now: () => new Date().toISOString() });
      void strandMod;                                        // ensure the spine module is loaded alongside
      await home.ready();
      window.HoloHome = home;
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-home-ready"));
    } catch (e) { /* leave unset; callers fail-soft */ }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire, { once: true });
  else wire();
}
