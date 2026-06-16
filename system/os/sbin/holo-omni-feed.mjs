// holo-omni-feed.mjs — the omnibar becomes the CONDUCTOR of the live homepage feed. composePersonalScene
// fuses YOUR private context (the omni-index history + Q.recall hits) into a SCENE the homepage already knows
// how to stream + self-verify (skeleton → bytes → L5 κ) + play in place. Ordered by holo-rank authority,
// blended with recency × frequency × intent-match. Private-context-FIRST; honest fallback to the demo scene
// when your history is thin (never invents). Pure ESM, sources injected → Node-witnessable. Reuses, does not
// fork: holo-omni-index (history) + holo-omni-q.askPrivate (recall) + holo-rank.json (.ranks) feed it from the
// shell/homepage; the render + verify + viewer pipeline downstream is the homepage's own, untouched.

const KIND_ORIGIN = { web: "web", cid: "ipfs", web3: "web3", app: "holo", file: "holo", kappa: "holo", video: "video", audio: "audio" };
const KIND_TAB = { web: "Web", web3: "Web3", cid: "IPFS", video: "Media", audio: "Media", file: "Spaces", app: "Spaces", kappa: "Spaces" };
const MEDIA = { video: "video", audio: "audio" };
const hexOf = (k) => String(k || "").split(":").pop();

// the leaf the homepage renders. media kinds → a {media:{kind,src}} the viewer plays by range; everything else
// → a {query} the omnibar pipeline (resolveUnified) resolves into a sealed, verified card on click.
function common(item) {
  const origin = KIND_ORIGIN[item.kind] || "web";
  const playable = MEDIA[item.kind];
  const ref = item.input || item.addr;
  return { origin, poster: String(item.kappa || item.addr || item.title || "scene"), ...(playable ? { media: { kind: playable, src: ref } } : { query: ref }) };
}
function whyText(item, viaRecall, auth, intent) {
  if (viaRecall) return `recalled from your context${intent ? ` · matches “${String(intent).slice(0, 40)}”` : ""}`;
  const n = item.n || 1;
  return `from your history${n > 1 ? ` · opened ${n}×` : ""}${auth > 1.001 ? ` · rank ${(auth - 1).toFixed(2)}` : ""}`;
}
const heroLeaf  = (it, why) => ({ ...common(it), eyebrow: "for you", title: it.title || it.addr, dek: why, why });
const thumbLeaf = (it, why) => ({ ...common(it), t: it.title || it.addr, why });
const storyLeaf = (it, why) => ({ ...common(it), tab: KIND_TAB[it.kind] || "Web", title: it.title || it.addr, dek: why, src: why, why });

function scoreItem(item, rank, now, intent) {
  const ageH = Math.max(0, (now - (item.t || 0)) / 3.6e6);
  const recency = 1 / (1 + ageH / 24);                    // ~halves per day
  const freq = Math.log2(1 + (item.n || 1));
  const auth = 1 + (rank[hexOf(item.kappa)] || 0) * 1.5;   // holo-rank personal authority, when the κ is ranked
  let match = 1;
  if (intent) {
    const hay = ((item.title || "") + " " + (item.addr || "")).toLowerCase(), q = String(intent).toLowerCase();
    match = hay.indexOf(q) >= 0 ? 1.8 : (q.split(/\s+/).filter(Boolean).some((t) => hay.indexOf(t) >= 0) ? 1.3 : 0.85);
  }
  return { score: (0.6 + recency) * (1 + 0.4 * freq) * auth * match, auth };
}

// diversify(ranked) — a deterministic spread: greedily take the highest score, but DEMOTE an origin each time
// it's already been shown, so the feed spans video/web/web3/audio/ipfs instead of clustering one source. No
// randomness (testable + resume-safe); authority still dominates, it just doesn't monopolize.
function diversify(ranked, penalty = 0.6) {
  const pool = ranked.slice(), out = [], seen = {};
  while (pool.length) {
    let bi = 0, bv = -Infinity;
    for (let i = 0; i < pool.length; i++) { const o = KIND_ORIGIN[pool[i].it.kind] || "web"; const adj = pool[i].score / (1 + penalty * (seen[o] || 0)); if (adj > bv) { bv = adj; bi = i; } }
    const p = pool.splice(bi, 1)[0], o = KIND_ORIGIN[p.it.kind] || "web"; seen[o] = (seen[o] || 0) + 1; out.push(p);
  }
  return out;
}

// composePersonalScene({ entries, recallHits, rank, intent, now, fallback, min, diversity, rotate, anchor }) →
//   { hero, thumbs, stories, _personal, _count } — private-first, holo-rank-ordered, origin-DIVERSIFIED. Fewer
//   than `min` candidates → the fallback scene, _personal:false (honest; no invented content). `rotate` (an
//   integer that the idle refresh advances) deterministically cycles the mid-tier beyond the top `anchor` items,
//   so the feed never goes stale while its strongest anchors stay put — exploration without randomness.
export function composePersonalScene({ entries = [], recallHits = [], rank = {}, intent = "", now = Date.now(), fallback = null, min = 3, diversity = true, rotate = 0, anchor = 2 } = {}) {
  const cand = new Map();
  for (const e of entries) if (e && e.addr) cand.set(e.addr, { ...e, viaRecall: false });
  for (const h of recallHits) {
    if (!h || !h.addr) continue;
    const ex = cand.get(h.addr);
    if (ex) ex.viaRecall = true;
    else cand.set(h.addr, { addr: h.addr, input: h.addr, title: h.title || h.addr, kind: h.kind || "web", n: 1, t: now - 36e5, viaRecall: true });
  }
  const ranked = [...cand.values()]
    .map((it) => { const s = scoreItem(it, rank, now, intent); return { it, score: s.score, auth: s.auth }; })
    .sort((a, b) => b.score - a.score);

  if (ranked.length < min) return fallback ? { ...fallback, _personal: false, _count: ranked.length } : { hero: [], thumbs: [], stories: [], _personal: false, _count: ranked.length };

  let ordered = diversity ? diversify(ranked) : ranked;
  if (rotate) {   // keep the strongest `anchor` items put; cycle the rest so an idle refresh surfaces fresh ones
    const keep = ordered.slice(0, anchor), rest = ordered.slice(anchor);
    if (rest.length) { const off = ((rotate % rest.length) + rest.length) % rest.length; ordered = keep.concat(rest.slice(off), rest.slice(0, off)); }
  }
  const leaf = (r, make) => make(r.it, whyText(r.it, r.it.viaRecall, r.auth, intent));
  const hero    = ordered.slice(0, 3).map((r) => leaf(r, heroLeaf));
  const thumbs  = ordered.slice(0, 8).map((r) => leaf(r, thumbLeaf));   // the strip can repeat the strongest, like the demo
  const stories = ordered.slice(3, 9).map((r) => leaf(r, storyLeaf));
  return { hero, thumbs, stories, _personal: true, _count: ranked.length };
}

export default { composePersonalScene };
