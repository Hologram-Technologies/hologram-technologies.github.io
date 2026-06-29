// holo-foresight.mjs — PROOF OF FORESIGHT. The private-edge forecaster: it reads what the OPERATOR
// privately knows (the + κ-hypergraph: everything ingested, mapped, mine and mine alone) and the crowd's
// public price (a read-only market feed), and surfaces ONLY the delta — the handful of markets where my
// own information disagrees with what the crowd has priced. The reasoning never leaves the device, so the
// edge is never sold to a server or to the house. Every belief is then committed to the operator's source
// chain (holo-strand) the MOMENT it forms — a hash-linked, signed, timestamped κ. So I can later PROVE
// "I priced this correctly at time T" without revealing the position until I choose. A sovereign,
// portable, tamper-evident forecasting reputation no platform can fake, move, or revoke.
//
// This is what is impossible without the κ substrate: a cloud copilot mining your private graph for
// trading signal leaks the edge by construction; and you cannot prove a track record without exposing
// your bets. Here the private graph stays private (Law L1), the belief is content-addressed (Law L2), and
// the chain of beliefs is tamper-evident over the SEQUENCE (Law L5, via holo-strand).
//
// First principles + the house pattern (cf. holo-plus.mjs): a PURE, isomorphic, deterministic core, with
// every intelligence exposed as a SWAPPABLE SEAM. The belief reader has a deterministic baseline (no GPU,
// Node-witnessable) and upgrades silently to Q's zero-shot brain when present — graceful, never a hard
// dependency. The feed is read-only by construction (holo-foresight-feed.mjs holds no keys, places no
// orders); acting on an edge is a SEPARATE, human-gated step through the wallet's one approval door.

const norm = (s) => String(s || "").trim().toLowerCase();
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round = (x, n = 4) => Math.round(x * 10 ** n) / 10 ** n;
const uniq = (xs) => Array.from(new Set(xs));

// ── the BELIEF READER (the swappable intelligence) ──────────────────────────────────────────────────
// read(market, graph) → { p, evidence:[κ], rationale, informed }. `p` is MY private-implied probability
// that the market resolves YES; `evidence` are the content-addressed source anchors that back it.
//
// Baseline (deterministic, no model): aggregate the STANCE of every private-graph node whose label matches
// one of the market's entities, weighted by confidence, and squash to (0,1). Node shape (the contract a
// graph mapper or Q must produce): { label, stance:-1..+1, weight:>=0, sourceKappa }. No matching node ⇒
// no private signal ⇒ defer to the crowd (informed:false). Pure: same inputs → same belief, forever.
export function defaultRead(market, graph) {
  const nodes = Array.isArray(graph) ? graph : (graph && graph.nodes) || [];
  const ents = uniq((market.entities || []).map(norm)).filter(Boolean);
  const hits = nodes.filter((n) => ents.includes(norm(n.label)));
  if (!hits.length) return { p: clamp(Number(market.yes) || 0, 0, 1), evidence: [], rationale: "no private signal — deferring to the crowd", informed: false };
  const s = hits.reduce((a, n) => a + clamp(Number(n.stance) || 0, -1, 1) * Math.max(0, Number(n.weight) || 0), 0);
  const p = round(0.5 + 0.5 * Math.tanh(s));     // tanh squashes any net stance into a calibrated (0,1)
  return {
    p,
    evidence: uniq(hits.map((n) => n.sourceKappa).filter(Boolean)),
    rationale: `${hits.length} private node(s) on [${uniq(hits.map((n) => n.label)).join(", ")}] net stance ${round(s, 3)}`,
    informed: true,
  };
}

// makeForesight({ read, strand, threshold, now }) — the watcher.
//   read      : belief reader seam (default deterministic baseline; pass bindQ()-derived reader for Q).
//   strand    : an unlocked holo-strand (makeStrand) — where beliefs are committed. Optional for scan().
//   threshold : minimum |edge| to count as a signal (default 0.10 — a 10-point disagreement with the crowd).
//   now       : () → ISO string stamped INTO each belief at scan time (injectable determinism).
export function makeForesight({ read = defaultRead, strand = null, threshold = 0.1, now = () => "1970-01-01T00:00:00Z" } = {}) {

  // scan — for every market, form a private belief and keep only the ones that DISAGREE with the crowd by
  // at least `threshold`. This is the whole magic surface: the crowd measures itself, this measures ME, and
  // returns the difference. NON-mutating, zero side effects (it never touches the strand or the wallet).
  // Async: the production reader (Q) reasons on-device and is async; `await` on a sync baseline is a no-op.
  async function scan(markets = [], graph = [], opt = {}) {
    const th = opt.threshold ?? threshold;
    const out = [];
    for (const m of markets) {
      const yes = clamp(Number(m.yes) || 0, 0, 1);
      const b = await read(m, graph);
      if (!b.informed) continue;                       // no private edge → silent (don't bet on the crowd)
      const edge = round(b.p - yes);
      if (Math.abs(edge) < th) continue;               // I agree with the crowd → no signal
      out.push({
        market: m.kappa || m.id, id: m.id, question: m.question,
        marketYes: round(yes), impliedP: b.p, edge, side: edge > 0 ? "yes" : "no",
        evidence: b.evidence, rationale: b.rationale, at: now(),
      });
    }
    return out.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));   // sharpest disagreement first
  }

  // commit — seal ONE belief onto the source chain: a hash-linked, (optionally) operator-signed, timestamped
  // κ. THIS is the proof of foresight — its `at`/`seq`/`prev` cannot be silently moved (holo-strand Law L5).
  async function commit(delta) {
    if (!strand) throw new Error("foresight.commit: no strand attached");
    return strand.append({ kind: "foresight.belief", payload: delta });
  }

  // scanAndCommit — the live loop: scan, then commit every signal so the record exists BEFORE the market
  // moves. Returns { signals, entries }. Acting on a signal is a deliberate, human-gated step elsewhere.
  async function scanAndCommit(markets, graph, opt) {
    const signals = await scan(markets, graph, opt);
    const entries = [];
    if (strand) for (const s of signals) entries.push(await commit(s));   // no strand ⇒ scan only (no side effects)
    return { signals, entries };
  }

  // proofs — the operator's committed track record: every foresight.belief on the chain, in order. Because
  // it rides the strand, the head κ attests the WHOLE sequence; selective disclosure of individual beliefs
  // (reveal one, prove its place, keep the rest sealed) is a later cut on top of this.
  function proofs({ since = 0 } = {}) {
    if (!strand) return [];
    return strand.replay({ kind: "foresight.belief", since }).map((r) => ({ ...r["holstr:payload"], seq: r["holstr:seq"], kappa: r.id }));
  }

  return { scan, commit, scanAndCommit, proofs, read };
}

// ── proof-of-foresight, settled (pure) ──────────────────────────────────────────────────────────────
// score(beliefs, resolutions) — once markets resolve, grade the committed beliefs into a VERIFIABLE
// forecasting reputation. `resolutions`: { [marketIdOrκ]: 0|1 } (the YES outcome). For each belief we
// score MY implied probability against the truth (Brier, lower is better) and whether I beat the crowd
// (|myP - truth| < |crowdYes - truth|). Pure + deterministic → re-derivable by anyone holding the (later
// disclosed) beliefs + the public resolutions. No claim survives that the chain + the outcomes don't.
export function score(beliefs = [], resolutions = {}) {
  let n = 0, brierMe = 0, brierCrowd = 0, beat = 0;
  const rows = [];
  for (const b of beliefs) {
    const key = b.market ?? b.id;
    const truth = resolutions[key] ?? resolutions[b.id];
    if (truth !== 0 && truth !== 1) continue;
    n++;
    const me = (b.impliedP - truth) ** 2, crowd = (b.marketYes - truth) ** 2;
    brierMe += me; brierCrowd += crowd;
    const won = me < crowd; if (won) beat++;
    rows.push({ id: b.id, truth, impliedP: b.impliedP, marketYes: b.marketYes, beatCrowd: won });
  }
  return {
    n,
    brier: n ? round(brierMe / n) : null,            // my mean Brier score (0 = perfect, 0.25 = a coin flip)
    crowdBrier: n ? round(brierCrowd / n) : null,    // the crowd's, over the SAME markets
    edgeOverCrowd: n ? round((brierCrowd - brierMe) / n) : null,  // >0 ⇒ I was sharper than the crowd
    beatRate: n ? round(beat / n, 3) : null,
    rows,
  };
}

export default { makeForesight, defaultRead, score };
