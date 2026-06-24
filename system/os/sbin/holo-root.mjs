// holo-root.mjs — THERE IS NO ROOT. DNS has one signed root zone and one KSK; capture either and you own
// the namespace. holo-root replaces that single point with a PLURAL, pinnable set of self-verifying anchors
// and a default of pure math. A bare human name ("ilya.deck") doesn't say which owner answers for it — DNS
// solves that with a hierarchy you must trust; we solve it by letting YOU pin an ordered list of anchors,
// resolving in pin order, first VERIFIED hit winning. No anchor is privileged by the protocol; the order is
// your choice, like a CA bundle you actually control. This is the per-anchor scarcity policy made real:
// "acme" can mean different things under different pinned anchors, and that is honest, not a bug.
//
// The unification: an ANCHOR IS A ZONE (holo-zone) — a signed, append-only directory whose targets are
// other zones' names (or content κ directly). A "zone of zones." So holo-root introduces NO new storage and
// NO new crypto: it is purely the PINNING + ordered-resolution + provenance layer over zones you already
// have. resolveName re-derives every anchor it reads (fail-closed) and follows zone-name targets to content.
//
//   math default   holo://zone/<owner>/<label>   → needs NO anchor: the name carries its own owner (L1).
//   content        did:holo:sha256:<hex>         → already an address; returned as-is.
//   bare name      ilya.deck                      → walk pinned anchors in order; first verified hit wins.
//
// holo-root also supplies the openZone(ownerHex) seam the one omni door (holo-omni-unified) needs — once you
// can resolve names to owners, opening an owner's zone is the same machinery. Pure ESM, no DOM. Law L1/L2/L3/L5.

import { parseZoneRef } from "./holo-zone-lane.mjs";
import { normTarget } from "../usr/lib/holo/holo-zone.mjs";

const isKappa = (s) => /^did:holo:sha256:[0-9a-f]{64}$/i.test(String(s)) || /^[0-9a-f]{64}$/i.test(String(s)) || /^holo:\/\/[0-9a-f]{64}$/i.test(String(s));

// makeRoot({ anchors, openZone }) — a pluralistic resolver.
//   anchors  : ordered array of OPENED zone instances (the pins). anchors[0] has priority.
//   openZone : async (ownerHex) → an opened zone instance (or null), for following zone-name targets and
//              for the one-door lane. This is where the live spine / κ-store / gossip plug in.
export function makeRoot({ anchors = [], openZone = null } = {}) {
  let pinned = anchors.slice();

  function pin(zone, { top = false } = {}) { if (zone) (top ? pinned.unshift(zone) : pinned.push(zone)); return pinned.length; }
  function unpin(ownerKappa) { pinned = pinned.filter((z) => z.ownerKappa !== ownerKappa); return pinned.length; }

  // followTarget — a target is either content (done) or a zone-name (open that zone, resolve, recurse).
  // maxHops caps a pathological anchor→zone→zone… loop (fail-closed, never hangs). Provenance accumulates.
  async function followTarget(target, hops, maxHops = 4) {
    if (isKappa(target)) return { ok: true, kappa: normTarget(target), hops };
    const zr = parseZoneRef(target);
    if (!zr) return { ok: false, why: "bad-target", hops };
    if (hops.length >= maxHops) return { ok: false, why: "too-many-hops", hops };
    if (typeof openZone !== "function") return { ok: false, why: "no-openZone", hops };
    const z = await openZone(zr.owner);
    if (!z || typeof z.resolve !== "function") return { ok: false, why: "zone-unavailable", owner: zr.owner, hops };
    const r = await z.resolve(zr.label);                                  // the zone verifies its own chain (L5)
    if (!r.ok) return { ok: false, why: r.why, owner: zr.owner, label: zr.label, hops };
    return followTarget(r.target, [...hops, { owner: zr.owner, label: zr.label }], maxHops);
  }

  // resolveName(input) — the magical one call: a fully-qualified name, a content address, or a bare name.
  async function resolveName(input) {
    const s = String(input == null ? "" : input).trim();
    if (!s) return { ok: false, why: "empty" };
    if (parseZoneRef(s)) { const f = await followTarget(s, []); return f.ok ? { ...f, via: "math" } : f; }   // default root = the math
    if (isKappa(s)) return { ok: true, kappa: normTarget(s), hops: [], via: "content-address" };
    for (const anchor of pinned) {                                        // bare name: first VERIFIED anchor hit wins
      let r;
      try { r = await anchor.resolve(s); } catch (e) { continue; }        // a broken/tampered anchor is skipped, never trusted
      if (!r || !r.ok) continue;
      const f = await followTarget(r.target, [{ anchor: anchor.ownerKappa, label: s }]);
      if (f.ok) return { ...f, via: anchor.ownerKappa };
    }
    return { ok: false, why: "unbound", name: s };
  }

  return { resolveName, pin, unpin, openZone, anchors: () => pinned.slice() };
}

export default { makeRoot };
