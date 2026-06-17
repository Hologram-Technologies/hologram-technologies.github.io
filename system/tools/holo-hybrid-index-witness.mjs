// holo-hybrid-index-witness.mjs — proves R1: the κ-index adapter retrieves HYBRID (vector ⊕ BM25 ⊕ RRF),
// the vector leg goes live when the loaded index has an embedder, and it degrades cleanly to pure BM25 with
// embedder:null (backward-compatible). Also proves resolveEmbedder() is a NEVER-THROW, decide-once embedder
// (real model where available, deterministic floor here in Node) so doc + query vectors share one space.
//
// Note: real semantic quality (synonyms, paraphrase) needs the bge-small weights, which load only in the
// browser — that is browser-verified, not asserted here. This witness proves the WIRING + fusion + fallback.
import { buildIndex, indexAdapter } from "../os/sbin/holo-index.mjs";
import { resolveEmbedder } from "../os/usr/lib/holo/q/holo-q-embed.js";
import * as holoIpfs from "../os/usr/lib/holo/holo-ipfs.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};
let pass = 0, fail = 0, kn = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56);
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); checks[(slug(name) || "check") + "-" + (++kn)] = !!cond; console.log((cond ? "  ok  " : " FAIL ") + name + (extra ? "  — " + extra : "")); };

const DIM = 64;
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
const fakeEmbedder = { id: "fake-bow",
  async embed(text) { const v = new Array(DIM).fill(0); for (const t of String(text).toLowerCase().match(/[a-z0-9]+/g) || []) v[fnv(t) % DIM] += 1; const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1; return v.map((x) => x / n); },
  similarity(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; } };

const mkdoc = async (title, text) => ({ cid: holoIpfs.cidToString(await holoIpfs.cidOf(new TextEncoder().encode(title + "\n" + text))), title, text });

async function main() {
  // resolveEmbedder never throws (here in Node there is no transformers/WebGPU → the deterministic floor).
  const re = await resolveEmbedder();
  const v = await re.embed("history of ancient Rome");
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  ok("resolveEmbedder() returns a never-throw embedder (real or floor)", Array.isArray(v) && v.length > 0 && Math.abs(norm - 1) < 1e-6, (re.id || re.fellBackTo || "embedder"));

  const docs = await Promise.all([
    mkdoc("Ancient Rome", "Ancient Rome grew from a settlement on the Tiber into a republic and then an empire."),
    mkdoc("Roman Empire", "The Roman Empire was the post-Republican period of ancient Rome ruled by emperors."),
    mkdoc("Risotto", "A good risotto needs constant stirring and warm stock added slowly to arborio rice."),
  ]);
  const query = "ancient Rome empire";

  // WITH an embedder → the index corpus has vectors → indexAdapter is hybrid.
  const idxV = await buildIndex(docs, { embedder: fakeEmbedder });
  const hitsV = await indexAdapter(idxV).search(query, { limit: 3 });
  ok("hybrid index returns ranked results", hitsV.length > 0, hitsV.length + " hits");
  ok("the vector leg is LIVE and fused (a hit's via includes \"vector\")", hitsV.some((h) => Array.isArray(h.via) && h.via.includes("vector")), JSON.stringify(hitsV[0] && hitsV[0].via));
  ok("top hit is a Rome doc, not the unrelated one", /Rome|Empire/.test(hitsV[0].title), hitsV[0].title);

  // WITHOUT an embedder → corpus.vector returns [] → indexAdapter degrades to pure BM25 (backward-compatible).
  const idxB = await buildIndex(docs, { embedder: null });
  const hitsB = await indexAdapter(idxB).search(query, { limit: 3 });
  ok("embedder:null degrades to BM25-only (no \"vector\" in via), still ranked", hitsB.length > 0 && hitsB.every((h) => !(h.via || []).includes("vector")) && hitsB.some((h) => (h.via || []).includes("bm25")), JSON.stringify(hitsB[0] && hitsB[0].via));
  ok("BM25-only still ranks a Rome doc first", /Rome|Empire/.test(hitsB[0].title), hitsB[0].title);

  const result = { "@type": "holo:WitnessResult", witness: "holo-hybrid-index", step: "R1",
    embedder: re.id || re.fellBackTo || "embedder", topVia: hitsV[0] && hitsV[0].via, pass, fail, total: pass + fail, ok: fail === 0, checks };
  writeFileSync(join(here, "holo-hybrid-index-witness.result.json"), JSON.stringify(result, null, 2));
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass}/${pass + fail}  ·  hybrid index: via=${JSON.stringify(hitsV[0] && hitsV[0].via)} (embedder), BM25-only on null`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error("witness threw:", e); process.exit(1); });
