#!/usr/bin/env node
// holo-kappa-stream-witness.mjs — PROVE the ONE κ-STREAM primitive (the spine of "stream the whole
// experience as κ-objects"). The whole Hologram experience — a frame, a token, a UI subtree, a model
// layer — is a stream of κ-OBJECTS against a local κ-cache (Law L3: the store IS the memory). The
// producer emits a κ-REF when the consumer already holds the object (≈0 bytes — reconstruct O(1)) and the
// κ's BYTES only when it is NOVEL (the delta), each re-derived on arrival (Law L5). Thesis under test:
// WHAT TRAVELS IS NOVELTY, NOT RESOLUTION — the reason the experience streams at high FPS on any device
// and any network — and render and LLM ride the SAME transport (Law L4). Personalization is a κ-delta:
// the shared base is refs (held), only "you" travels.
//
// Checks (all must hold):
//   1 spineReconstructs        — a novel object travels + re-derives to its κ; the second identical frame
//                                is all refs and reconstructs byte-identical with ZERO extra wire (L3/L5).
//   2 bandwidthIsNovelty       — frame N+1 identical ⇒ 0 wire bytes; change ONE region ⇒ only that region's
//                                bytes travel (the high-FPS mechanism, measured).
//   3 tamperRefused            — an object whose bytes do not re-derive to its κ is refused (L5, fail-closed).
//   4 refToUnheldRefused       — a ref to a κ the consumer does not hold is refused (protocol safety).
//   5 personalizationDelta     — shared base regions + one personal region: across two users the shared
//                                base is refs (cache hits), only the personal region's bytes travel per user.
//   6 unifiesRenderAndLLM      — a UI-subtree object and an LLM-token object ride the SAME primitive; both
//                                dedupe to refs on repeat (apps and LLMs are one transport).
//   7 deterministic            — identical regions ⇒ identical κ sequence (Law L2, one canonical form).
//   8 highFpsModel             — 120 frames of M regions where ONE region changes per frame cost ≈ (M + 120)
//                                region-payloads, not 120·M — an order-of-magnitude wire reduction, quantified.
//
// Authority (external): holospaces Laws L1/L2/L3/L4/L5 · W3C Subresource Integrity (verify-by-digest) ·
// IPFS Trustless Gateways (κ = CIDv1 sha2-256) · HTTP delta/conditional-request precedent (ETag/304).
// Usage: node tools/holo-kappa-stream-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeKappaStream, kappaOf } from "../os/usr/lib/holo/holo-kappa-stream.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const enc = (s) => new TextEncoder().encode(s);
const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);
// a frame is an ordered list of region byte-objects; emit each through the stream, return the events
const emitFrame = async (s, regions) => { const evs = []; for (const r of regions) evs.push(await s.frame(r)); return evs; };
const admitAll = async (s, evs) => { const out = []; for (const e of evs) out.push(await s.admit(e)); return out; };

const checks = {};

// ── 1 · a novel object travels + re-derives; the identical second frame is all refs, zero extra wire ──
{
  const s = makeKappaStream();
  const R = [enc("region-A"), enc("region-B"), enc("region-C")];
  const f1 = await emitFrame(s, R); await admitAll(s, f1);
  const wireAfter1 = s.wireBytes();
  const f2 = await emitFrame(s, R); const back = await admitAll(s, f2);
  const allRefs = f2.every((e) => e.kind === "ref");
  const reconstructed = back.every((b, i) => same(b, R[i]));
  checks.spineReconstructs = f1.every((e) => e.kind === "obj") && allRefs && reconstructed && s.wireBytes() === wireAfter1;
}

// ── 2 · bandwidth ∝ novelty: identical ⇒ 0 wire; one region changed ⇒ only its bytes ─────────────
{
  const s = makeKappaStream();
  const base = [enc("x".repeat(100)), enc("y".repeat(100)), enc("z".repeat(100))];
  await admitAll(s, await emitFrame(s, base));
  const w0 = s.wireBytes();
  await admitAll(s, await emitFrame(s, base));                     // identical frame
  const w1 = s.wireBytes();
  const changed = [base[0], enc("Y".repeat(100)), base[2]];        // one region differs
  await admitAll(s, await emitFrame(s, changed));
  const w2 = s.wireBytes();
  checks.bandwidthIsNovelty = (w1 - w0) === 0 && (w2 - w1) === 100;
}

// ── 3 · an object whose bytes do not re-derive to its κ is refused (L5) ───────────────────────────
{
  const s = makeKappaStream();
  const ev = await s.frame(enc("honest"));                          // kind:"obj", payload:honest
  const forged = { kind: "obj", kappa: ev.kappa, payload: enc("TAMPERED — different bytes") };
  let refused = false; try { await s.admit(forged); } catch { refused = true; }
  checks.tamperRefused = refused;
}

// ── 4 · a ref to a κ the consumer does not hold is refused (protocol safety) ──────────────────────
{
  const s = makeKappaStream();
  const k = await kappaOf(enc("never sent as bytes"));
  let refused = false; try { await s.admit({ kind: "ref", kappa: k }); } catch { refused = true; }
  checks.refToUnheldRefused = refused;
}

// ── 5 · personalization is a κ-delta: shared base = refs, only the personal region travels per user ──
{
  const base = [enc("nav-bar"), enc("feed-shell"), enc("footer")];
  const alice = makeKappaStream(); const bob = makeKappaStream();
  await admitAll(alice, await emitFrame(alice, base));
  await admitAll(bob, await emitFrame(bob, base));
  const aBase = alice.wireBytes(), bBase = bob.wireBytes();
  const aPanel = enc("alice's personalized panel");
  const bPanel = enc("bob's personalized panel — longer text here");
  const aFrame = await emitFrame(alice, [...base, aPanel]);
  const bFrame = await emitFrame(bob, [...base, bPanel]);
  await admitAll(alice, aFrame); await admitAll(bob, bFrame);
  const baseAreRefs = aFrame.slice(0, 3).every((e) => e.kind === "ref") && bFrame.slice(0, 3).every((e) => e.kind === "ref");
  const onlyPersonalTravels = (alice.wireBytes() - aBase) === aPanel.length && (bob.wireBytes() - bBase) === bPanel.length;
  checks.personalizationDelta = baseAreRefs && onlyPersonalTravels;
}

// ── 6 · render and LLM ride the SAME primitive (a UI subtree and a token both dedupe) ─────────────
{
  const s = makeKappaStream();
  const uiSubtree = enc(JSON.stringify({ tag: "div", text: "a rendered region" }));   // render object
  const token = enc("Paris");                                                          // LLM token object
  const a = await emitFrame(s, [uiSubtree, token]); await admitAll(s, a);
  const b = await emitFrame(s, [uiSubtree, token]);                                    // repeat — both ref now
  checks.unifiesRenderAndLLM = a.every((e) => e.kind === "obj") && b.every((e) => e.kind === "ref");
}

// ── 7 · identical regions ⇒ identical κ sequence (Law L2) ─────────────────────────────────────────
{
  const R = [enc("alpha"), enc("beta")];
  const s1 = makeKappaStream(), s2 = makeKappaStream();
  const k1 = (await emitFrame(s1, R)).map((e) => e.kappa);
  const k2 = (await emitFrame(s2, R)).map((e) => e.kappa);
  checks.deterministic = k1.length === 2 && k1.every((k, i) => k === k2[i]) && k1[0].startsWith("did:holo:sha256:");
}

// ── 8 · the high-FPS model: 120 frames, M regions, ONE changes per frame — wire ≈ (M + 120), not 120·M ──
let fps = null;
{
  const M = 20, FRAMES = 120, SZ = 64;
  const s = makeKappaStream();
  const regions = Array.from({ length: M }, (_, i) => enc(("r" + i + ":").padEnd(SZ, "0")));
  let naivePayloads = 0;
  for (let f = 0; f < FRAMES; f++) {
    regions[0] = enc(("frame" + f + ":").padEnd(SZ, "0"));         // exactly one region is novel each frame
    await admitAll(s, await emitFrame(s, regions));
    naivePayloads += M;                                            // what a resolution-proportional stream would send
  }
  const st = s.stats();
  const objsExpected = M + (FRAMES - 1);                           // first frame: M novel; then 1 novel/frame
  const wireBytes = s.wireBytes(), naiveBytes = naivePayloads * SZ;
  fps = { objs: st.objs, refs: st.refs, objsExpected, wireBytes, naiveBytes, reduction: +(naiveBytes / wireBytes).toFixed(1) };
  checks.highFpsModel = st.objs === objsExpected && st.refs === (FRAMES * M - objsExpected) && fps.reduction > 8;
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-kappa-stream-witness.result.json"), JSON.stringify({
  spec: "The κ-stream spine: the whole experience (frame · token · UI subtree · model layer) is a stream of κ-objects against a local κ-cache; held κ ⇒ ref (≈0 bytes, O(1) reconstruct), novel κ ⇒ bytes (re-derived, Law L5). What travels is novelty not resolution (high FPS on any device); render and LLM share one transport (Law L4); personalization is a κ-delta over shared κ-objects.",
  authority: "holospaces Laws L1/L2/L3/L4/L5 · W3C Subresource Integrity · IPFS Trustless Gateways (κ = CIDv1 sha2-256) · HTTP ETag/304 delta precedent",
  witnessed,
  covers: witnessed ? ["kappa-stream", "bandwidth-is-novelty", "tamper-refused", "personalization-delta", "render-llm-unified", "deterministic", "high-fps-model", "law-l3", "law-l5"] : [],
  fps,
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
if (fps) console.log(`· high-FPS model: ${fps.objs} novel objs + ${fps.refs} refs · wire ${fps.wireBytes}B vs naive ${fps.naiveBytes}B = ${fps.reduction}× less`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ one κ-stream — novelty travels, the rest reconstructs from cache; render + LLM, any device" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
