// holo-playground-web.mjs — Playground for REAL web pages and tabs in the native browser.
//
// The shell's Playground reaches same-origin holo-app frames it can postMessage into (holo-playground-app.js).
// A real website is the TOP document of a cross-origin tab — there is NO parent shell to post UP to. So the
// agent is injected HOST-SIDE (the CEF response-filter / OnContextCreated splices the bootstrap into the
// page, marked data-holo-ephemeral so the agent's own serialise strips it — Law L5), and its edits mint a
// SNAPSHOT κ: the edited page becomes a content-addressed object you OWN — re-derivable (L5), shareable by
// κ, replayable offline — while the URL stays the live entry point.
//
// HONEST BY CONSTRUCTION: we never reseal the live remote site. "Edit this page" produces a snapshot, not a
// mutation of the origin for everyone. The snapshot is labelled as such; the live URL still loads the live
// site. A byte that doesn't re-derive to its κ is refused, never laundered.
//
// ONE editor, two seal targets. App surface → reseal the app κ (holo-live-edit, existing). Live web → snapshot
// κ (here, through the SAME primitive createLiveEditor). Same agent, same gestures, same content-address law.
//
// Pure + isomorphic (the Atlas discipline): `hash` (the σ-axis content addresser), `pin` (durable store), and
// `urlOf` are dependency-injected, so the exact logic runs in the browser AND in the Node witness with stubs.

import { createLiveEditor } from "./holo-live-edit.mjs";

const HEX = /^[0-9a-f]+$/;
export const SNAP_NS = "did:holo:sha256:";                                   // the σ-axis (open-web κ) — matches holo-edit's sha256 form
export const snapKappa = (hex) => SNAP_NS + hex;
export const holoUrl = (k) => "holo://sha256:" + String(k || "").split(":").pop();
export const shortK = (k) => { const h = String(k || "").split(":").pop(); return h ? h.slice(0, 8) + "…" + h.slice(-6) : "—"; };

// createSnapshotSealer({ hash }) → a SYNC seal(name, source) → { id } for createLiveEditor. The snapshot κ is
// the content address of the EXACT serialised bytes (the agent already strips its own UI + transient classes,
// so these bytes are "user source + user edit", L5). Re-derive the κ from the bytes and it MUST match.
export function createSnapshotSealer({ hash }) {
  if (typeof hash !== "function") throw new Error("createSnapshotSealer needs hash(text)->hex");
  return function seal(_name, source) {
    const hex = String(hash(String(source ?? "")));
    if (!HEX.test(hex)) throw new Error("hash must return lowercase hex (the σ-axis content address)");
    return { id: snapKappa(hex) };
  };
}

// createWebPlaygroundHost — the native-tab half (the analog of the shell's pgCommitInShell, but minting a
// snapshot instead of resealing an app). ONE editable surface: the tab's whole document. The agent mutates
// the live DOM and serialises ephemeral-stripped bytes; commit() seals them to a snapshot κ THROUGH the ONE
// primitive createLiveEditor — so the O(1) no-op (unchanged bytes ⇒ same κ ⇒ no re-render) and the `changed`
// flag come for free, exactly as an app edit. We do NOT touch the live remote site.
//
// Provenance (url → κ, when) is recorded OUT-OF-BAND (a returned edge list), NEVER inside the κ: embedding it
// would change the bytes and break content-addressing (the recipient couldn't re-derive). `pin(source, κ)`
// durably stores the snapshot bytes (best-effort, off the content-address path); `onSnapshot` reports each
// new snapshot to the UI. `render` is a no-op: the live document already IS the edited object.
//   { hash, urlOf?, pin?, onSnapshot?, now? } → { commit, register, kappaOf, lineage, last, describe }
export function createWebPlaygroundHost({ hash, urlOf = () => "", pin = null, onSnapshot = null, now = () => 0 } = {}) {
  const editor = createLiveEditor({ seal: createSnapshotSealer({ hash }) });
  const edges = [];                                                          // OUT-OF-BAND provenance: [{ url, kappa, at }]
  let last = null;

  function ensure(id) {
    id = id || "tab";
    if (!editor.has(id)) editor.register(id, { name: "web-snapshot", render: () => {} });   // the live DOM already reflects the edit
    return id;
  }

  // commit(surfaceId, source) — the agent calls this on Freeze / an element verb. Seal → snapshot κ; on a real
  // change record the provenance edge, pin the bytes (async best-effort), and report. Returns synchronously
  // { ok, kappa, changed, url } so the agent's toast shows the κ immediately.
  function commit(surfaceId, source) {
    const id = ensure(surfaceId);
    const r = editor.edit(id, String(source ?? ""));
    const url = String(urlOf() || "");
    if (!r || !r.ok) return { ok: false, url, reason: r && r.reason };
    if (r.changed) {
      const edge = { url, kappa: r.kappa, at: now() };
      edges.push(edge); last = edge;
      if (typeof pin === "function") { try { Promise.resolve(pin(String(source ?? ""), r.kappa)).catch(() => {}); } catch (e) {} }   // durable, off the κ path; a failed pin never breaks the edit
      if (typeof onSnapshot === "function") { try { onSnapshot({ ...edge, source: String(source ?? "") }); } catch (e) {} }
    }
    return { ok: true, kappa: r.kappa, changed: !!r.changed, url };
  }

  return {
    commit, register: ensure,
    kappaOf: (id) => editor.kappaOf(id),
    lineage: () => edges.slice(),                                            // OUT-OF-BAND edges (not in any κ)
    last: () => last,
    describe: () => ({
      is: "the native-tab Playground host — an element edit on a REAL web page mints a SNAPSHOT κ you own",
      honest: "we never reseal the live remote site; a snapshot is a re-derivable content-addressed copy, the URL stays the live entry",
      onePrimitive: "seals through createLiveEditor (the SAME primitive as app surfaces) — unchanged bytes ⇒ same κ ⇒ O(1) no-op",
      provenance: "url→κ edges are recorded OUT-OF-BAND; embedding them in the bytes would break content-addressing",
    }),
  };
}

// ── self-verifying share link — mirrors holo-edit.js doShare. Pack the (gzipped) snapshot bytes into the URL
// FRAGMENT (never sent to any host) next to its κ, so the recipient RE-DERIVES the κ from the bytes (L5)
// before rendering: serverless, tamper-evident, opens on any device. >128KB ⇒ κ-only (resolved via a source). ─
const b64u = (u8) => { let b = ""; for (let i = 0; i < u8.length; i++) b += String.fromCharCode(u8[i]); return btoa(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (s) => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export async function packSnapshot(u8) {
  let data = u8, mode = "r";
  try { if (typeof CompressionStream !== "undefined") { const cs = new CompressionStream("gzip"); const w = cs.writable.getWriter(); w.write(u8); w.close(); data = new Uint8Array(await new Response(cs.readable).arrayBuffer()); mode = "g"; } } catch (e) {}
  return mode + b64u(data);
}
export async function unpackSnapshot(packed) {
  const mode = String(packed)[0], body = unb64u(String(packed).slice(1));
  if (mode !== "g") return body;
  const ds = new DecompressionStream("gzip"); const w = ds.writable.getWriter(); w.write(body); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
export async function snapshotLink({ origin = "", kappa, bytes, maxInline = 131072 } = {}) {
  const base = origin + "/apps/ui/render.html#k=" + encodeURIComponent(holoUrl(kappa));
  if (bytes && bytes.length <= maxInline) { try { return base + "&o=" + await packSnapshot(bytes); } catch (e) {} }
  return base;                                                              // too big / no bytes → κ-only (needs a source)
}

export default { createSnapshotSealer, createWebPlaygroundHost, snapshotLink, packSnapshot, unpackSnapshot, snapKappa, holoUrl, shortK, SNAP_NS };
