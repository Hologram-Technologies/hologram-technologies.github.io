// holo-index.mjs — the SELF-VERIFYING SEMANTIC INDEX (Stage 4 of IPFS-native semantic rendering). The
// Stage-2/3 discovery index was an external, untrusted service. This makes our OWN index a first-class
// κ-object: crawl content → build the retrieval corpus → seal the index into a real IPFS object whose CID
// IS its identity. The index is then SHAREABLE (a CAR file, a pin, a P2P share) and SELF-VERIFYING — anyone
// resolves it through the gateway, re-derives every block (Law L5), and re-hydrates a working corpus from
// it WITHOUT trusting whoever served it. This is the only path to trustworthy BREADTH: an index nobody has
// to trust because it re-derives. It does not invent storage or retrieval — it composes holo-q-corpus (the
// retriever), holo-web-snapshot (the seal + CAR), and the gateway (resolve), exactly as the prior stages.
//
// The index manifest is the canonical, content-addressed list of indexed docs (each carrying its source
// CID + the indexable text). Re-hydration replays the DETERMINISTIC corpus build (chunk κs, BM25 postings,
// the zero-LLM auto-link graph are all pure functions of the doc bytes — ADR-0099), so a re-loaded index's
// corpus.stateKappa() equals the original's byte-for-byte. Pure ESM, no DOM; the embedder is injected.

import { createCorpus } from "../usr/lib/holo/q/holo-q-corpus.js";
import { rrf } from "../usr/lib/holo/q/holo-q-recall.js";          // the SAME RRF the recall read-path uses
import { sealSnapshot, blockSource, toCar, fromCar } from "./holo-web-snapshot.mjs";
import { resolveIpfsPath } from "./holo-ipfs-gateway.mjs";
import * as holoIpfs from "../usr/lib/holo/holo-ipfs.js";

// buildIndex(docs, { embedder }) → { indexCid, manifest, blocks, corpus, stateKappa, docs }.
//   docs: [{ cid, title, text, blocks?, meta? }] — each an already content-addressed source object (its
//   blocks travel in the bundle so the sealed index resolves the sources too). Docs are sorted by CID so
//   the manifest bytes — and thus the index CID — are deterministic.
export async function buildIndex(docs = [], { embedder = null } = {}) {
  const corpus = createCorpus({ embedder });
  const blocks = new Map();
  const sorted = docs.slice().sort((a, b) => (a.cid < b.cid ? -1 : a.cid > b.cid ? 1 : 0));
  const entries = [];
  for (const d of sorted) {
    await corpus.index({ id: d.cid, text: d.text, meta: { ...(d.meta || {}), cid: d.cid, title: d.title || "" } });
    if (d.blocks) for (const [c, b] of d.blocks) blocks.set(c, b);          // carry the source objects in the bundle
    entries.push({ cid: d.cid, title: d.title || "", text: d.text, meta: d.meta || {} });
  }
  // canonical manifest (fixed key order → stable bytes → stable index CID).
  const manifest = { "@type": "holo:SemanticIndex", version: 1, docs: entries };
  const snap = await sealSnapshot({ resources: [{ name: "index.json", bytes: JSON.stringify(manifest) }] });
  for (const [c, b] of snap.blocks) blocks.set(c, b);
  return { indexCid: snap.rootCid, did: snap.did, manifest, blocks, corpus, stateKappa: await corpus.stateKappa(), docs: new Map(entries.map((e) => [e.cid, e])) };
}

// loadIndex(indexCid, blocks, { embedder }) → { corpus, manifest, docs, blocks, getBlock, stateKappa }.
//   `blocks` is the index bundle (e.g. fromCar(car).blocks). The manifest is resolved through the gateway
//   and RE-DERIVED (Law L5); the corpus is rebuilt deterministically → stateKappa matches the original.
export async function loadIndex(indexCid, blocks, { embedder = null } = {}) {
  const getBlock = blockSource(blocks);
  const out = await resolveIpfsPath(indexCid, "index.json", getBlock);
  if (out.kind !== "file") throw new Error("holo-index: manifest (index.json) not found in " + indexCid);
  const bytes = await holoIpfs.reassembleFile(out.cidStr, getBlock);        // re-derives every block to its CID
  const manifest = JSON.parse(new TextDecoder().decode(bytes));
  const corpus = createCorpus({ embedder });
  const docs = new Map();
  for (const e of (manifest.docs || [])) { await corpus.index({ id: e.cid, text: e.text, meta: { ...(e.meta || {}), cid: e.cid, title: e.title } }); docs.set(e.cid, e); }
  return { indexCid: holoIpfs.cidToString(holoIpfs.parseCID(indexCid)), corpus, manifest, docs, blocks, getBlock, stateKappa: await corpus.stateKappa() };
}

// toIndexCar / fromIndexCar — the index as a single shareable file (the universal transport). Re-exported
// from holo-web-snapshot so a caller has one import for the whole index lifecycle.
export const toIndexCar = (indexCid, blocks) => toCar(indexCid, blocks);
export const fromIndexCar = (car) => fromCar(car).blocks;

// loadIndexFromCar(car, { embedder }) — the browser path: one call from a fetched CAR (the index's root CID
// is the CAR root, so the caller needs neither the CID nor a separate bundle). Re-derives on load (Law L5).
export async function loadIndexFromCar(car, opts = {}) {
  const dec = holoIpfs.decodeCar(car instanceof Uint8Array ? car : new Uint8Array(car));
  if (!dec.roots || !dec.roots.length) throw new Error("holo-index: CAR has no root (not a sealed index)");
  const blocks = new Map(); for (const b of dec.blocks) blocks.set(b.cid, b.bytes);
  return loadIndex(dec.roots[0], blocks, opts);
}

// indexAdapter(loaded) — expose a loaded κ-index as a holo-discover ADAPTER, so the orchestrator discovers
// against OUR sealed index (network-free) the same way it discovers against linked-data. search() ranks by
// BM25 over the index corpus; seal() returns the ALREADY-sealed source object (its CID + the bundle blocks),
// so the composed page cites the real indexed CID — which re-derives at resolve.
export function indexAdapter(loaded) {
  const { corpus, docs, blocks } = loaded;
  const bundle = blocks || new Map();
  return {
    id: "kappa-index",
    // HYBRID retrieval: vector(query) ⊕ BM25(query) fused by RRF — the same shape as Q.recall. The vector
    // leg is live only when the loaded corpus has an embedder (semantic ranking); with embedder:null,
    // corpus.vector returns [] and this degrades to pure BM25 — backward-compatible, no behavior change.
    async search(query, { limit = 5 } = {}) {
      const depth = Math.max(limit * 4, 20);
      const [vec, kw] = await Promise.all([corpus.vector(query, depth), Promise.resolve(corpus.bm25(query, depth))]);
      const fused = rrf([{ via: "vector", items: vec }, { via: "bm25", items: kw }]);
      const seen = new Set(), out = [];
      for (const f of fused) {
        const ch = corpus.chunk(f.kappa); if (!ch) continue;
        const cid = ch.pageId; if (seen.has(cid)) continue; seen.add(cid);
        const d = docs.get(cid) || {};
        out.push({ source: "kappa-index", entityId: cid, title: d.title || cid, summary: "", ref: "ipfs://" + cid, cid, via: f.via });
        if (out.length >= limit) break;
      }
      return out;
    },
    async seal(c) {
      const d = docs.get(c.cid) || {};
      return { ok: true, source: "kappa-index", entityId: c.cid, title: d.title || c.cid, ref: c.ref || ("ipfs://" + c.cid),
        cid: c.cid, blocks: bundle, extract: String(d.text || "").split(/\n{2,}/)[0] || "", text: d.text || "" };
    },
  };
}

// crawl(seeds, { discovery, limit }) — fetch + seal the top candidate per seed via a discovery instance,
// yielding docs ready for buildIndex. "crawl + embed → a shareable κ-index." Best-effort: a seed that
// yields nothing is skipped.
export async function crawl(seeds = [], { discovery, limit = 5 } = {}) {
  if (!discovery) throw new Error("holo-index.crawl: a discovery instance is required");
  const docs = [], seen = new Set();
  for (const s of seeds) {
    let cands; try { cands = await discovery.discover(s, { limit }); } catch { cands = []; }
    for (const c of cands) {
      const sealed = await discovery.sealCandidate(c, s);
      if (!sealed || seen.has(sealed.cid)) continue;
      seen.add(sealed.cid);
      docs.push({ cid: sealed.cid, title: sealed.title, text: sealed.text, blocks: sealed.blocks, meta: { source: sealed.source, entityId: sealed.entityId, query: s } });
      break;                                                                  // one doc per seed
    }
  }
  return docs;
}

export default { buildIndex, loadIndex, toIndexCar, fromIndexCar, indexAdapter, crawl };
