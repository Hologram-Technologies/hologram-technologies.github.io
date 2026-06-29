// holo-foresight-feed.mjs — the READ-ONLY crowd feed. Maps Polymarket's public market data into the one
// shape holo-foresight reads: { id, question, yes, entities, kappa }. It holds NO keys, signs NOTHING, and
// places NO orders — it is a pure observation surface. This is the honest boundary (Law L5): acting on an
// edge is a SEPARATE, human-gated step through the wallet's single approval door, never something the feed
// can reach. Settlement still lands on Polygon; this layer is an overlay that costs the operator nothing
// and needs nothing from the venue.
//
// Each market snapshot is content-addressed (`kappa`) so the crowd price MY belief was formed against is
// itself a verifiable evidence anchor on the source chain — the dispute "what was the price at time T?"
// becomes re-derivable instead of trusted.
//
// Isomorphic + dependency-injected: pass your own `fetchJson` (and `now`) for hermetic tests; in the
// browser it defaults to the public Gamma read API over the platform fetch. The κ hash is injectable and
// defaults to the canonical sha256hex (holo-uor) so a snapshot's identity is the ONE canonical form (L2).

import { sha256hex } from "./holo-uor.mjs";

const GAMMA = "https://gamma-api.polymarket.com";

// naive entity lift from a question (baseline): capitalized multi-word spans + quoted spans. Upgradable by
// Q's extractor later — the feed never pretends a model ran (honest surface). Lowercased downstream anyway.
function liftEntities(question = "") {
  const q = String(question);
  const caps = q.match(/\b([A-Z][\w.&'-]+(?:\s+[A-Z][\w.&'-]+)*)\b/g) || [];
  const quoted = (q.match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, ""));
  return Array.from(new Set([...caps, ...quoted].map((s) => s.trim()).filter((s) => s.length > 2)));
}

// parse one Gamma market object → our shape. `outcomePrices` is a JSON string array aligned to `outcomes`;
// the YES leg is the crowd's implied probability. Defensive: malformed rows yield yes=null and are skipped.
export function toMarket(raw, { hash = sha256hex } = {}) {
  let prices = raw.outcomePrices, outcomes = raw.outcomes;
  try { if (typeof prices === "string") prices = JSON.parse(prices); } catch { prices = null; }
  try { if (typeof outcomes === "string") outcomes = JSON.parse(outcomes); } catch { outcomes = null; }
  let yes = null;
  if (Array.isArray(prices) && prices.length) {
    const yi = Array.isArray(outcomes) ? outcomes.findIndex((o) => String(o).toLowerCase() === "yes") : 0;
    yes = Number(prices[yi >= 0 ? yi : 0]);
  }
  const id = String(raw.conditionId || raw.id || raw.slug || "");
  const question = String(raw.question || raw.title || "");
  const snapshot = { src: "polymarket", id, question, yes, closed: !!raw.closed };
  return {
    id, question, yes,
    entities: liftEntities(question),
    closed: !!raw.closed,
    kappa: "did:holo:sha256:" + hash(JSON.stringify(snapshot)),   // the price-at-time-T evidence anchor
  };
}

// fetchMarkets({ fetchJson, limit, active, hash }) → [market]. Read-only. `fetchJson` defaults to the
// platform fetch over Gamma; inject it (and skip the network entirely) in witnesses/tests.
export async function fetchMarkets({
  fetchJson = async (url) => (await fetch(url)).json(),
  limit = 50, active = true, closed = false, hash = sha256hex,
} = {}) {
  const url = `${GAMMA}/markets?limit=${limit}&active=${active}&closed=${closed}&order=volume&ascending=false`;
  const rows = await fetchJson(url);
  const list = Array.isArray(rows) ? rows : (rows && rows.data) || [];
  return list.map((r) => toMarket(r, { hash })).filter((m) => m.yes !== null && Number.isFinite(m.yes) && !m.closed);
}

export default { fetchMarkets, toMarket, liftEntities };
