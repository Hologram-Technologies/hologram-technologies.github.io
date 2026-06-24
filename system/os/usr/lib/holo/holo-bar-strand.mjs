// holo-bar-strand.mjs — a chrome bar becomes a NAVIGABLE, ROAMING κ-object. (E4)
//
// holo-bar.mjs makes a bar's IDENTITY follow its bytes (barKappa). holo-bar-store.mjs keeps the current
// ordering. This module gives the bar the two things it still lacked:
//
//   1. HISTORY + a NAVIGABLE address. Each edit is appended to a holo-strand (the operator's hash-linked,
//      append-only source chain), so the bar's head κ attests its WHOLE edit history (reorder / drop /
//      tamper any past edit → strand.verify() refuses, Law L5 over the sequence). The current bar resolves
//      from `holo://bar/<κ>` — a bar is now a thing you can OPEN, not just one you can check.
//
//   2. ROAM. Two devices each hold the strand of their chrome layout; converging is just comparing two
//      hash-linked histories (reconcileRemote): fast-forward when one strictly extends the other, keep-both
//      when they diverged (append-only — never a destructive merge). "Following, not syncing."
//
// Pure assembly over the existing substrate — NO new crypto, NO new transport:
//   • makeStrand / verify / adopt (holo-strand.mjs)         — the append-only signed history.
//   • reconcileRemote (holo-workspace-roam.mjs)             — the verify-before-trust converge decision.
//   • barKappa / verifyBar (holo-bar.mjs)                   — bar identity follows bytes (Law L1/L5).
// node-witnessable with an in-memory strand + injected digest; the browser binding wires window.HoloStrand.

import { makeStrand } from "./holo-strand.mjs";
import { reconcileRemote } from "./holo-workspace-roam.mjs";
import { barKappa, verifyBar } from "./holo-bar.mjs";

const BAR_EDIT = "bar.edit";                 // the strand entry kind for a bar mutation
const ADDR_RE = /^holo:\/\/bar\/([0-9a-f]{64})$/i;

// ── navigable address ────────────────────────────────────────────────────────────────────────────────
// barAddress(kappa) → holo://bar/<hex>. Accepts a bare hex or a did:holo:sha256:<hex> κ (both forms the
// rest of the OS uses) and normalises to the navigable URL. Returns "" for anything that isn't a κ.
export function barAddress(kappa) {
  const hex = String(kappa || "").replace(/^did:holo:sha256:/i, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? "holo://bar/" + hex : "";
}
// parseBarAddress(url) → the hex κ, or null. The inverse of barAddress; lets the resolver recognise the form.
export function parseBarAddress(url) {
  const m = ADDR_RE.exec(String(url || "").trim());
  return m ? m[1].toLowerCase() : null;
}

// ── strand-backed bar ────────────────────────────────────────────────────────────────────────────────
// makeBarStrand({ strand, digest }) → a bar history over a holo-strand.
//   strand : a makeStrand() instance (in-memory in the witness; window.HoloStrand in the browser).
//   digest : async (str) → hex (WebCrypto in the browser, node:crypto in the witness).
export function makeBarStrand({ strand = makeStrand(), digest = null } = {}) {
  if (typeof digest !== "function") throw new Error("makeBarStrand: digest required");

  // commit(kind, items) → append a bar.edit entry. The payload carries the kind, the items and the bar κ
  // re-derived from those items, so an entry is self-checking (payload.kappa MUST equal barKappa(items)).
  // Returns { kappa, address, head } — kappa identifies THIS bar state, head identifies the whole history.
  async function commit(kind, items) {
    const list = Array.isArray(items) ? items : [];
    const kappa = await barKappa(list, digest);                       // did:holo:sha256:<hex>
    await strand.append({ kind: BAR_EDIT, payload: { kind: String(kind || "bookmarks"), items: list, kappa } });
    return { kappa, address: barAddress(kappa), head: strand.head() };
  }

  // current(kind) → the latest committed state of one bar kind, RE-VERIFIED (Law L5): the payload's κ must
  // re-derive from its items, else the entry is ignored (a tampered store entry can't masquerade as current).
  async function current(kind) {
    const edits = strand.replay({ kind: BAR_EDIT });
    for (let i = edits.length - 1; i >= 0; i--) {
      const p = edits[i]["holstr:payload"];
      if (!p || p.kind !== String(kind || "bookmarks")) continue;
      if (await verifyBar(p.items, p.kappa, digest)) return { items: p.items, kappa: p.kappa, address: barAddress(p.kappa) };
      // else: this edit's payload was tampered → skip it, keep looking for an intact earlier state.
    }
    return { items: [], kappa: null, address: "" };
  }

  // resolve(addressOrKappa, kind) → the bar state whose κ matches the address, found ON the verified history.
  // Navigating to holo://bar/<κ> returns the items for that κ ONLY if (a) the whole strand verifies and (b)
  // an entry on it carries exactly that κ with items that re-derive to it. Fail-closed: no match → null.
  async function resolve(addressOrKappa, kind = null) {
    const want = parseBarAddress(addressOrKappa) || String(addressOrKappa || "").replace(/^did:holo:sha256:/i, "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(want)) return null;
    const v = await strand.verify();
    if (!v.ok) return null;                                            // broken history → trust nothing (L5)
    for (const e of strand.replay({ kind: BAR_EDIT })) {
      const p = e["holstr:payload"]; if (!p) continue;
      if (kind && p.kind !== kind) continue;
      const hex = String(p.kappa || "").replace(/^did:holo:sha256:/i, "").toLowerCase();
      if (hex === want && await verifyBar(p.items, p.kappa, digest)) return { items: p.items, kappa: p.kappa, address: barAddress(p.kappa), head: v.head };
    }
    return null;
  }

  // bundle() → the wire form to advertise to a peer device { head, entries } (the whole hash-linked history).
  function bundle() { return { head: strand.head(), entries: strand.replay({}) }; }

  // roam(remoteBundle) → compare this device's history with a peer's and decide (NEVER destructive):
  //   in-sync · fast-forward (adopt remote, the layout roamed forward) · local-ahead (keep ours) ·
  //   diverged (keep both lineages) · unrelated · rejected (remote failed verify-before-trust).
  // On fast-forward we ADOPT (strand.adopt re-verifies end-to-end before replacing) and return the new head.
  async function roam(remoteBundle, opts = {}) {
    const local = strand.replay({});
    const decision = await reconcileRemote(local, remoteBundle || {}, opts);
    if (decision.outcome === "fast-forward" && Array.isArray(decision.adopt)) {
      const a = await strand.adopt(decision.adopt);
      return { ...decision, adopted: a.ok, head: a.ok ? strand.head() : (local.length ? local[local.length - 1].id : null) };
    }
    return decision;
  }

  return { commit, current, resolve, bundle, roam, strand };
}

if (typeof window !== "undefined") {
  window.HoloBarStrand = { barAddress, parseBarAddress, makeBarStrand };
}
export default { barAddress, parseBarAddress, makeBarStrand };
