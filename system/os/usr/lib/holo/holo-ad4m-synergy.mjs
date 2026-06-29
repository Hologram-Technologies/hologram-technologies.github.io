// holo-ad4m-synergy.mjs — COASYS SYNERGY on κ: privacy-preserving distributed search where data with
// provenance becomes an asset, and contribution earns mutual credit (Synergy Fuel / $SYNG) — all serverless.
// Three capabilities, each composed from a module that already exists, nothing new invented:
//
//   1. PRIVATE SEARCH — the query runs over a SEALED corpus (holo-swarm: the worker's host sees only
//      ciphertext) and the requester accepts the ranking only after verifying the worker ran the agreed
//      work (verify-before-accept, Law L5). Ranking is holo-rank's personalized PageRank — deterministic,
//      re-derivable by anyone (the result κ Google's secret rank cannot offer).
//   2. PROVENANCE-AS-ASSET — every indexed Expression's origin is a signed ingest entry on the operator's
//      strand (holo-strand-provenance), so each result cites an origin κ you can prove.
//   3. MUTUAL CREDIT — on use, a signed `synergy.credit` entry is appended to a credit strand: a κ-native,
//      append-only mutual-credit ledger ($SYNG analog) with NO token deploy and NO chain. (An optional
//      web3 settlement to a CAIP-10 via holo-chain.payTo is the bridge, never the ledger.)
//
// Pure assembly over holo-swarm + holo-rank + holo-strand-provenance + holo-strand. Node-witnessable (the
// requester plays the worker in-process, exactly like holo-swarm's selftest); fail-closed throughout.

import { workOrder, sealInput, openInput, attestResult, acceptResult } from "./holo-swarm.mjs";
import { makeEdge, personalRank } from "./holo-rank.mjs";
import { address, seal, verify as verifyObj } from "./holo-object.mjs";
import { provenanceOf } from "./holo-strand-provenance.mjs";

const te = new TextEncoder();
const newKey = () => globalThis.crypto.getRandomValues(new Uint8Array(32));

// makeSynergy({ store, creditStrand, provStrand, sessionKey }) → the Synergy engine.
//   store        : a content-addressed store for reference edges (holo-rank). Absent ⇒ in-memory.
//   creditStrand : a holo-strand for the mutual-credit ledger (signed credit entries). Optional.
//   provStrand   : a holo-strand whose ingest entries prove each Expression's origin. Optional.
//   sessionKey   : the AES-GCM key the corpus is sealed under (the worker decrypts in-TEE). Default random.
export function makeSynergy({ store = new Map(), creditStrand = null, provStrand = null, sessionKey = null } = {}) {
  const corpus = [];                                    // { url, text, owner }
  const edges = [];                                     // reference edges (holo-rank votes)
  const key = sessionKey || newKey();

  // index(expr) — add an Expression to the searchable corpus. `text` is the indexable surface; `owner` is
  // the provenance principal who earns credit when this result is used.
  function index({ url, text, owner }) { corpus.push({ url, text: String(text || ""), owner: owner || null }); return url; }
  // cite(from, to, by) — a reference edge (a vote) that personalized PageRank flows along (trust/relevance).
  function cite(from, to, by) { edges.push(makeEdge(store, { rel: "cites", from, to, by })); return edges.length; }

  // privateSearch(terms, { worker, session }) — the confidential, verify-before-accept query.
  //   worker  : an attesting principal { kappa, alg, pub, sign } (the recruited compute peer).
  //   session : the session κ scoping the work + attestation.
  async function privateSearch(terms, { worker, session } = {}) {
    if (!worker || !session) throw new Error("privateSearch needs { worker, session }");
    const ql = terms.map((t) => String(t).toLowerCase());

    // 1 · match terms → the SEED node set (the "query" for personalized PageRank)
    const seed = corpus.filter((c) => ql.some((t) => c.text.toLowerCase().includes(t))).map((c) => c.url);
    if (!seed.length) return { ok: true, results: [], reason: "no match" };

    // 2 · SEAL the corpus+edges so the worker's HOST sees only ciphertext (confidential dispatch)
    const sealed = await sealInput(JSON.stringify({ edges, seed }), key);

    // 3 · the agreed unit of work (its κ is the agreement both peers attest)
    const work = (await workOrder({ op: "synergy.rank", inputs: seed, params: { terms: ql } })).kappa;

    // 4 · WORKER (in-TEE): decrypt, run holo-rank's personalized PageRank, produce the output κ + a receipt
    const opened = JSON.parse(new TextDecoder().decode(await openInput(sealed, key)));
    const rank = personalRank(opened.edges, opened.seed, {});
    const ranking = rank.ranking;                                  // [{ node: κ, score }], deterministic
    const output = address({ "@type": "SynergyRanking", ranking });
    const receipt = await attestResult({ work, output, session }, worker);

    // 5 · REQUESTER (verify-before-accept, fail-closed): re-derive (work→output), verify the worker's receipt
    const accepted = await acceptResult({ work, output, attestation: receipt, session, expectWorker: worker.kappa });
    if (!accepted) return { ok: false, reason: "result-refused" };

    // 6 · attach PROVABLE provenance + mint MUTUAL CREDIT per corpus result (never leak the raw corpus)
    const results = [];
    for (const r of ranking) {
      const c = corpus.find((x) => x.url === r.node);
      if (!c) continue;                                            // skip non-corpus nodes reached by the walk
      const prov = provStrand ? provenanceOf(provStrand, c.url) : null;
      let credit = null;
      if (creditStrand && c.owner) credit = await mintCredit(c.owner, c.url);
      results.push({ url: c.url, score: r.score, owner: c.owner, provenance: prov ? prov.id : null, credit: credit ? credit.id : null });
    }
    return { ok: true, results, output, worker: accepted.worker, sealed };  // sealed returned for the confidentiality witness only
  }

  // mintCredit(to, forResult, amount) — a signed κ-native mutual-credit entry on the ledger strand.
  async function mintCredit(to, forResult, amount = 1) {
    if (!creditStrand) return null;
    return creditStrand.append({ kind: "synergy.credit", payload: { to, amount, for: forResult } });
  }
  // balanceOf(owner) — sum of credits to a principal, read straight off the verifiable ledger.
  function balanceOf(owner) {
    if (!creditStrand) return 0;
    return creditStrand.replay({ kind: "synergy.credit" }).filter((e) => e["holstr:payload"].to === owner).reduce((s, e) => s + (e["holstr:payload"].amount || 0), 0);
  }

  return { index, cite, privateSearch, mintCredit, balanceOf, corpusSize: () => corpus.length, sessionKey: key };
}

if (typeof window !== "undefined") {
  window.HoloSynergy = { makeSynergy };
}

export default { makeSynergy };
