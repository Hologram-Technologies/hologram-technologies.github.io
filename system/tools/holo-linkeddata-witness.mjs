#!/usr/bin/env node
// holo-linkeddata-witness.mjs — PROVE S3: the κ-object graph is a NAVIGABLE, VERIFIABLE web of data.
//   · URI⇄κ binding is a clean bijection across every form (did · ipfs · /ipfs · /.holo route).
//   · A URI dereferences to a concrete κ-object, re-derived (Law L5).
//   · traverse() walks the graph ACROSS ≥3 distinct sources; EVERY hop re-derives.
//   · a tampered link target is REFUSED mid-traversal (the lie cannot propagate).
//   · S2 latency fold-in: a warm re-traversal is network-free (zero source fetches) — the cached-resolve
//     low-latency property — and the per-hop timings are recorded.
// This witness IS the behavioral definition of the holospaces target rows CC-linkeddata (+ perf-deref).
//   node tools/holo-linkeddata-witness.mjs
import { makeObject, linkTo } from "../os/usr/lib/holo/holo-object.mjs";
import { kappaToUri, uriToKappa, kappaForms, URI_FORMS, isKappaUri, hexOf } from "../os/sbin/holo-uri.mjs";
import { deref, traverse, verifyHop } from "../os/sbin/holo-graph.mjs";

const r = [];
const ok = (label, pass, d = "") => { r.push({ label, pass: !!pass }); console.log(`${pass ? "PASS" : "FAIL"} — ${label}${d ? "  (" + d + ")" : ""}`); return !!pass; };

// ── build a small graph: A → {B, C}, B → D. Four UOR objects, then DISTRIBUTE their bytes across three
//    separate "sources" so a traversal must cross source boundaries to complete.
const build = new Map();
const D = makeObject(build, { type: ["schema:Dataset"], name: "D" });
const C = makeObject(build, { type: ["schema:Dataset"], name: "C" });
const B = makeObject(build, { type: ["schema:Dataset"], name: "B", links: [linkTo(build, "rel:next", D)] });
const A = makeObject(build, { type: ["schema:Collection"], name: "A", links: [linkTo(build, "rel:b", B), linkTo(build, "rel:c", C)] });
const bytesOf = (o) => build.get(hexOf(o.id));
const srcA = new Map([[hexOf(A.id), bytesOf(A)], [hexOf(D.id), bytesOf(D)]]);
const srcB = new Map([[hexOf(B.id), bytesOf(B)]]);
const srcC = new Map([[hexOf(C.id), bytesOf(C)]]);

// an injected resolver over the three sources; it COUNTS fetches and records which sources it touched.
function makeResolve(sources) {
  const stat = { fetches: 0, sourcesUsed: new Set() };
  const resolve = async (kappa) => {
    stat.fetches++;
    const h = hexOf(kappa);
    for (const [name, src] of sources) if (src.has(h)) { stat.sourcesUsed.add(name); return src.get(h); }
    return null;
  };
  return { resolve, stat };
}
const SOURCES = [["srcA", srcA], ["srcB", srcB], ["srcC", srcC]];

// A · URI⇄κ binding — a κ is expressible as a URI in every form, and each round-trips back to the κ.
for (const form of URI_FORMS) {
  const uri = kappaToUri(A.id, form);
  ok(`κ → "${form}" URI round-trips back to the κ`, uriToKappa(uri) === A.id, uri.length > 48 ? uri.slice(0, 46) + "…" : uri);
}
ok("a bare sha2-256 CIDv1 string binds to its κ", uriToKappa(kappaForms(A.id).ipfs.replace("ipfs://", "")) === A.id);
ok("a non-κ URI does not bind (isKappaUri=false)", !isKappaUri("https://example.org/thing"));
ok("kappaForms exposes all four equivalent URIs", Object.keys(kappaForms(A.id)).join(",") === "did,ipfs,path,route");

// B · dereference — a URI (any form) resolves to its concrete κ-object, re-derived (Law L5).
{
  const { resolve } = makeResolve(SOURCES);
  for (const form of URI_FORMS) {
    const out = await deref(kappaToUri(A.id, form), { resolve });
    ok(`deref a "${form}" URI → the verified object A`, out.ok && out.kind === "object" && out.obj.id === A.id);
  }
  const leafless = await deref("did:holo:sha256:" + "00".repeat(32), { resolve });
  ok("deref an unresolvable κ fails cleanly", !leafless.ok && /unresolved/.test(leafless.why));
}

// C · multi-source traversal — walk A's whole graph; every hop re-derives, ACROSS ≥3 sources.
{
  const { resolve, stat } = makeResolve(SOURCES);
  const t0 = Date.now();
  const out = await traverse(kappaToUri(A.id, "path"), { resolve });
  const coldMs = Date.now() - t0;
  ok("traverse completes over the whole graph", out.ok, `${out.visited.size} nodes, ${out.hops} hops`);
  ok("every object is visited exactly once (A,B,C,D)", out.visited.size === 4);
  ok("hops followed = edges in the graph (A:2 + B:1)", out.hops === 3);
  ok("traversal crossed ≥3 distinct sources", stat.sourcesUsed.size >= 3, [...stat.sourcesUsed].join("+"));

  // S2 latency fold-in — re-traverse with a κ-store cache seeded from the verified bytes: a warm walk is
  // network-free (zero source fetches), the low-latency guarantee of content addressing.
  const cache = new Map(); for (const n of out.nodes) if (n.kind === "object") cache.set(hexOf(n.obj.id), build.get(hexOf(n.obj.id)));
  const warm = { fetches: 0 };
  const warmResolve = async (kappa) => { const h = hexOf(kappa); if (cache.has(h)) return cache.get(h); warm.fetches++; return null; };
  const t1 = Date.now();
  const out2 = await traverse(kappaToUri(A.id, "did"), { resolve: warmResolve });
  const warmMs = Date.now() - t1;
  ok("warm re-traversal succeeds identically", out2.ok && out2.visited.size === 4 && out2.hops === 3);
  ok("warm re-traversal is NETWORK-FREE (zero source fetches)", warm.fetches === 0);
  console.log(`    latency — cold: ${coldMs}ms (${stat.fetches} source fetches) · warm: ${warmMs}ms (0 source fetches) · 4 nodes / 3 hops`);
}

// D · tamper REFUSED mid-traversal — corrupt B's bytes in its source; the lie is caught at the A→B edge and
//    cannot propagate to D.
{
  const corrupt = new Uint8Array(bytesOf(B)); corrupt[corrupt.length - 2] ^= 0x20;   // flip a byte in B's stored JSON
  const tsrcB = new Map([[hexOf(B.id), corrupt]]);
  const { resolve } = makeResolve([["srcA", srcA], ["srcB-tampered", tsrcB], ["srcC", srcC]]);
  const out = await traverse(A.id, { resolve });
  ok("a tampered link target is REFUSED mid-traversal", !out.ok);
  ok("the refusal names the offending κ (B) and an L5/integrity reason", out.at === B.id && /(re-derive|digest|Law L5)/i.test(out.why), out.why);
  ok("D is NOT admitted (the lie did not propagate)", !out.visited.has(hexOf(D.id)));
}

// E · verifyHop unit — a leaf hash mismatch and an object/κ mismatch are both refused.
{
  const okHop = verifyHop(A.id, bytesOf(A), null);
  ok("verifyHop admits a genuine object", okHop.ok && okHop.kind === "object");
  const wrong = verifyHop(C.id, bytesOf(B), null);   // B's bytes presented as C's κ
  ok("verifyHop refuses bytes presented under the wrong κ", !wrong.ok);
}

const passed = r.filter((x) => x.pass).length;
console.log(`\n${passed}/${r.length} checks`);
if (passed !== r.length) process.exit(1);
console.log("WITNESSED ✓ — S3: URI⇄κ binding + L5 link-dereference traversal across sources (navigable verifiable graph)");
