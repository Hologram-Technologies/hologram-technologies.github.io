// holo-zone-lane.mjs — the ZONE leg of the one omni door (holo-omni-unified). A Holo name —
// holo://zone/<owner>/<label> — classifies and resolves through the SAME envelope as every other lane
// (onion · web3 · κ · ipfs · web · nl), so the magical bar treats an owned, mutable name exactly like a
// content address: paste it → one verified κ-object → render → Q-act. The resolver is verify-before-trust
// (the zone re-derives its whole chain before answering); this seam owns no model and holds no authority —
// it just routes the string to the owner's zone and returns what re-derives.
//
// Pure ESM, no DOM, no network of its own. The caller injects how to OPEN a zone for a given owner
// (cfg.openZone(ownerHex) or a cfg.zones map) — that is where the spine / gossip / κ-store live.

// parseZoneRef(s) → { owner, label } | null. Accepts the canonical holo://zone/<64hex>/<label> form and a
// compact zone:<64hex>/<label> alias. The owner is the sha256 hex of the owner's public key (its κ).
export function parseZoneRef(s) {
  const v = String(s == null ? "" : s).trim();
  const m = /^holo:\/\/zone\/([0-9a-f]{64})\/([a-z0-9][a-z0-9.-]{0,62})$/i.exec(v)
        || /^zone:([0-9a-f]{64})\/([a-z0-9][a-z0-9.-]{0,62})$/i.exec(v);
  return m ? { owner: m[1].toLowerCase(), label: m[2].toLowerCase() } : null;
}

// classifyZone(s) → { lane:"zone", kind:"zone", label } | null — instant, no network (the "what is this?" chip).
export function classifyZone(s) {
  return parseZoneRef(s) ? { lane: "zone", kind: "zone", label: "Holo name" } : null;
}

// resolveZone(input, cfg) → the uniform envelope. cfg.openZone(ownerHex) returns a makeZone() instance for
// that owner (or cfg.zones.get(ownerHex)). The zone itself verifies before it answers (Law L5); a missing
// owner, an unverifiable chain, or an unbound label all fail closed with a reason.
export async function resolveZone(input, cfg = {}) {
  const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
  const ms = () => (t0 ? Math.round((performance.now ? performance.now() : 0) - t0) : 0);
  const ref = parseZoneRef(input);
  if (!ref) return { ok: false, lane: "zone", kind: "zone", reason: "not-a-zone-name", ms: ms() };

  let zone = null;
  try {
    if (typeof cfg.openZone === "function") zone = await cfg.openZone(ref.owner);
    else if (cfg.zones && typeof cfg.zones.get === "function") zone = cfg.zones.get(ref.owner);
  } catch (e) { return { ok: false, lane: "zone", kind: "zone", owner: ref.owner, label: ref.label, reason: "open-threw:" + (e && e.message), ms: ms() }; }
  if (!zone || typeof zone.resolve !== "function") return { ok: false, lane: "zone", kind: "zone", owner: ref.owner, label: ref.label, reason: "zone-unavailable", ms: ms() };

  const r = await zone.resolve(ref.label);
  if (!r.ok) return { ok: false, lane: "zone", kind: "zone", owner: ref.owner, label: ref.label, head: r.head, reason: r.why, ms: ms() };
  return { ok: true, lane: "zone", kind: "zone", owner: ref.owner, label: ref.label,
    kappa: r.target, target: r.target, name: r.name, head: r.head, seq: r.seq, ms: ms() };
}

export default { parseZoneRef, classifyZone, resolveZone };
