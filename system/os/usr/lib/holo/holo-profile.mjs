// holo-profile.mjs — the user PROFILE: a structured, versioned, re-derivable distillation of the user's
// accreted usage (the holo-memory records: intents · feedback votes · artifacts) into ONE κ-object the whole
// OS can read to personalize — interests, what to avoid, recent intentions. This is the "self-evolving"
// layer's distillation step: the more you use Hologram, the richer your profile, and every surface that reads
// it adapts to you. 100% LOCAL — a pure projection of your own on-device memory; nothing here egresses.
//
// Two tiers (the established baseline→silent-upgrade pattern, like holo-map/holo-insight):
//   • BASELINE (this file, deterministic, no model): token histogram over your intents, recency-weighted,
//     boosted by up-votes and suppressed by down-votes → top interests + an avoid-list. Node-witnessable.
//   • Q UPGRADE (makeQProfiler): the SAME shape, distilled by Q's brain (richer background/intentions),
//     falling back to the baseline. Wire later via the mux "curator" faculty.
// The profile is content-addressed (κ = didHolo over its canonical body) so it re-derives (Law L5): the SAME
// records always yield the SAME profile κ, and a tampered profile fails verifyProfile.
import { jcs, sha256hex, didHolo } from "./holo-uor.mjs";

const SHA = "sha256";
// stopwords + tokenizer aligned with holo-memory.toks ([a-z0-9]+); stopwords keep interests meaningful.
const STOP = new Set("the a an and or of to in on at for is are be it this that with my your me you q open show tell make get a3 i we us our".split(" "));
const toks = (s) => (String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 2 && !STOP.has(t));
const recOf = (r) => ({ kind: r["holmem:kind"] || r.kind || "intent", text: String(r["holmem:text"] || r.text || ""), vote: r["holmem:vote"] || r.vote || null });

// distillProfile(records) → a versioned profile κ-object. Deterministic: same records → same κ (Law L5).
// records: holo-memory shape [{holmem:kind,holmem:text,holmem:vote,...}] in append (chronological) order.
export function distillProfile(records = [], { hash = sha256hex, top = 8 } = {}) {
  const score = new Map(), liked = new Map(), disliked = new Map();
  const rs = (records || []).map(recOf);
  const n = rs.length || 1;
  rs.forEach((r, i) => {
    const recency = (i + 1) / n;                         // append-order → later = more recent = heavier
    const ts = toks(r.text);
    for (const t of ts) {
      score.set(t, (score.get(t) || 0) + recency);
      if (r.vote === "up") liked.set(t, (liked.get(t) || 0) + 1);
      if (r.vote === "down") disliked.set(t, (disliked.get(t) || 0) + 1);
    }
  });
  for (const [t, c] of liked) score.set(t, (score.get(t) || 0) + c * 2);       // up-votes boost
  for (const [t, c] of disliked) score.set(t, (score.get(t) || 0) - c * 2);    // down-votes suppress
  // deterministic ordering: weight desc, then token asc (so equal weights are stable across replicas)
  const ranked = [...score.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1));
  const interests = ranked.filter(([, w]) => w > 0).slice(0, top).map(([t]) => t);
  const avoid = [...disliked.entries()].filter(([t]) => !liked.has(t)).sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1)).slice(0, top).map(([t]) => t);
  const recentIntents = rs.filter((r) => r.kind === "intent").slice(-5).map((r) => r.text).filter(Boolean);

  const body = {
    "@context": "https://hologram.os/ns#", "@type": ["holo:UserProfile"],
    "holo:interests": interests,
    "holo:avoid": avoid,
    "holo:recentIntents": recentIntents,
    "holo:observations": rs.length,
    "holo:method": "baseline-v1",
  };
  return { ...body, kappa: didHolo(SHA, hash(jcs(body))) };
}

// verifyProfile — re-derive the κ over the canonical body (Law L5): a tampered profile fails.
export function verifyProfile(profile, { hash = sha256hex } = {}) {
  if (!profile || !profile.kappa) return false;
  const { kappa, ...body } = profile;
  return didHolo(SHA, hash(jcs(body))) === kappa;
}

// contextTerms-friendly view: the profile as a flat term list, for feeding rankByContext/surfaces as the
// user's standing interest signal (mirrors how holo-plus-context derives terms from memory).
export const profileTerms = (profile) => [...((profile && profile["holo:interests"]) || []), ...((profile && profile["holo:recentIntents"]) || []).flatMap(toks)];

// Q UPGRADE SEAM (silent): same shape, distilled by Q's brain when present; baseline otherwise. Wire to the
// mux "curator" faculty. Pure + injectable like makeQExtractor/makeQInvestigator.
export function makeQProfiler(brain, { generate = "generate" } = {}) {
  const baseline = distillProfile;
  return {
    async distill(records = [], opts = {}) {
      if (!brain || typeof brain[generate] !== "function") return baseline(records, opts);
      const rs = (records || []).map(recOf);
      const PROMPT = "From these user intents and votes, output JSON {interests:[..],background:\"..\",intentions:[..]} capturing the person's interests, background, and current intentions. Be concise.\n\n" + jcs(rs.slice(-60));
      try {
        const raw = await brain[generate](PROMPT);
        const j = JSON.parse(String(raw).match(/\{[\s\S]*\}/)[0]);
        const base = baseline(records, opts);
        const body = { ...base, "holo:interests": Array.isArray(j.interests) ? j.interests : base["holo:interests"],
          "holo:background": typeof j.background === "string" ? j.background : "", "holo:method": "q-v1" };
        const { kappa, ...rest } = body;
        return { ...rest, kappa: didHolo(SHA, (opts.hash || sha256hex)(jcs(rest))) };
      } catch (e) { return baseline(records, opts); }   // any Q failure → the deterministic baseline (honest)
    },
  };
}

export default distillProfile;
