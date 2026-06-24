#!/usr/bin/env node
// holo-projector-witness.mjs — PROVE the PROJECTION BROWSER channel: a rendered scene is a STREAM OF
// κ-OBJECTS from an ORIGIN (scene producer) to a LENS (the projector on any device), composing the three
// proven primitives — compute-memo (O(1) region reconstruct), delta-render (emit/paint only κ-changes),
// kappa-stream (ref vs bytes, verify-before-paint L5). This is the claim no single existing witness makes:
// what crosses the wire is NOVELTY not pixels, a second device reconstructs PIXEL-IDENTICAL from cache with
// ZERO novel bytes, and a tampered region is REFUSED before it ever paints.
//
// Checks: cold frame streams novelty + paints all; a static frame emits NOTHING (pointer-compare, transform
// silent); one region changes ⇒ exactly one object on the wire; scroll-back to a held value re-paints via a
// REF (0 novel bytes, no recompute); a fresh device whose cache holds the shared base projects the whole
// scene with 0 novel bytes; a tampered region is refused before paint; the lens pixels are byte-identical to
// the origin's; deterministic across independent projectors.
//   node tools/holo-projector-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeProjector } from "../os/usr/lib/holo/holo-projector.mjs";
import { kappaOf } from "../os/usr/lib/holo/holo-kappa-stream.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const enc = (s) => new TextEncoder().encode(s);
const OP = await kappaOf(enc("paint-op"));
// a scene of regions; region i's content κ is derived from its label so we can change one slot at a time
const scene = async (labels) => Promise.all(labels.map(async (lab, i) => ({ id: "r" + i, op: OP, in: await kappaOf(enc(lab)) })));
// the PRODUCER: deterministic "painted pixels" for a region — and a call counter to prove the pointer-compare
const makeTransform = () => { const c = { calls: 0 }; const fn = async (op, inn) => { c.calls++; return enc("PIX:" + op + "|" + inn); }; fn.count = c; return fn; };

const checks = {};
let model = null;

// ── 1 · cold frame: every region is novel ⇒ streams its bytes; the lens paints all ────────────────
{
  const tf = makeTransform();
  const p = makeProjector({ transform: tf });
  const s = await scene(["a", "b", "c", "d"]);
  const { wire, emitted } = await p.render(s, { keyframe: true });
  const r = await p.receive(wire);
  checks.coldFrameStreamsNovelty = emitted === 4 && wire.every((w) => w.event.kind === "obj") && r.painted === 4 && r.novelBytes > 0;
}

// ── 2 · static frame: nothing changed ⇒ ZERO wire events, transform never re-runs (pointer-compare) ──
{
  const tf = makeTransform();
  const p = makeProjector({ transform: tf });
  const s = await scene(["a", "b", "c", "d"]);
  await p.receive((await p.render(s, { keyframe: true })).wire);     // frame 1 (cold): 4 calls
  const callsAfterCold = tf.count.calls;
  const f2 = await p.render(s);                                       // frame 2 (identical)
  const r2 = await p.receive(f2.wire);
  checks.staticFrameZeroWire = f2.emitted === 0 && r2.painted === 0 && r2.novelBytes === 0 && tf.count.calls === callsAfterCold;
}

// ── 3 · one region changes ⇒ exactly one object on the wire, exactly one repaint ──────────────────
{
  const tf = makeTransform();
  const p = makeProjector({ transform: tf });
  await p.receive((await p.render(await scene(["a", "b", "c", "d"]), { keyframe: true })).wire);
  const f = await p.render(await scene(["a", "B!", "c", "d"]));       // slot r1 changed
  const r = await p.receive(f.wire);
  checks.oneRegionDelta = f.emitted === 1 && f.wire[0].id === "r1" && f.wire[0].event.kind === "obj" && r.painted === 1 && r.novelBytes > 0;
}

// ── 4 · scroll-back: a slot returns to a HELD value ⇒ re-paints via a REF (0 novel bytes, no recompute) ──
{
  const tf = makeTransform();
  const p = makeProjector({ transform: tf });
  await p.receive((await p.render(await scene(["a", "b", "c", "d"]), { keyframe: true })).wire);
  await p.receive((await p.render(await scene(["a", "B!", "c", "d"]))).wire);   // r1 → "B!"
  const callsBefore = tf.count.calls;
  const f = await p.render(await scene(["a", "b", "c", "d"]));                   // r1 → back to "b" (held since frame 1)
  const r = await p.receive(f.wire);
  checks.scrollBackIsRef = f.emitted === 1 && f.wire[0].event.kind === "ref" && r.painted === 1 && r.novelBytes === 0 && tf.count.calls === callsBefore;
}

// ── 5 · cross-device: a fresh lens whose cache holds the shared base projects the scene with 0 novel bytes ──
{
  const s = await scene(["a", "b", "c", "d"]);
  // device A renders the scene; its cache becomes "the shared base held by everyone"
  const a = makeProjector({ transform: makeTransform() });
  await a.receive((await a.render(s, { keyframe: true })).wire);
  const sharedBase = new Map(a.cache);                                 // the deduped base every device holds
  // device B: a different device, but it already holds the base in its κ-store (persistent / gossiped)
  const b = makeProjector({ transform: makeTransform(), cache: sharedBase });
  const f = await b.render(s, { keyframe: true });                     // full keyframe to the new device…
  const r = await b.receive(f.wire);
  const pixelIdentical = ["r0", "r1", "r2", "r3"].every((id) => {
    const x = a.pixels(id), y = b.pixels(id);
    return x && y && x.length === y.length && x.every((v, i) => v === y[i]);
  });
  checks.crossDeviceFromCache = f.wire.every((w) => w.event.kind === "ref") && r.novelBytes === 0 && r.painted === 4 && pixelIdentical;
  model = { regions: 4, wireKeyframeBytes: r.novelBytes, note: "second device: full scene, zero bytes on the wire — what travels is novelty, not resolution" };
}

// ── 6 · a tampered region is REFUSED before it paints (verify-before-project, Law L5) ──────────────
{
  const p = makeProjector({ transform: makeTransform() });
  const f = await p.render(await scene(["a", "b"]), { keyframe: true });
  f.wire[0].event.payload = enc("TAMPERED — different pixels than the κ promises");   // corrupt r0's bytes
  const r = await p.receive(f.wire);
  checks.tamperRefusedBeforePaint = r.refused === 1 && p.pixels("r0") === null && r.painted === 1 && p.pixels("r1") !== null;
}

// ── 7 · the lens pixels are byte-identical to what the origin produced (content address ⇒ same bytes) ──
{
  const tf = makeTransform();
  const p = makeProjector({ transform: tf });
  const s = await scene(["alpha", "beta", "gamma"]);
  await p.receive((await p.render(s, { keyframe: true })).wire);
  let identical = true;
  for (const reg of s) { const ref = await tf(reg.op, reg.in); const got = p.pixels(reg.id); if (!got || got.length !== ref.length || !got.every((v, i) => v === ref[i])) identical = false; }
  checks.pixelIdentical = identical;
}

// ── 8 · deterministic: independent projectors over the same scene hold the same region κ set ───────
{
  const held = [];
  for (let n = 0; n < 2; n++) {
    const p = makeProjector({ transform: makeTransform() });
    await p.receive((await p.render(await scene(["x", "y", "z"]), { keyframe: true })).wire);
    held.push([...p.held()].sort().join(","));
  }
  checks.deterministic = held[0] === held[1] && held[0].length > 0;
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-projector-witness.result.json"), JSON.stringify({
  spec: "Projection browser channel: a rendered scene streams as κ-objects from an origin (scene producer) to a lens (the projector on any device). Composes compute-memo (O(1) region reconstruct) + delta-render (emit/paint only κ-changes, unchanged = pointer-compare) + kappa-stream (ref vs bytes, verify-before-paint L5). What crosses the wire is novelty, not pixels; a fresh device reconstructs pixel-identical from cache with zero novel bytes; a tampered region is refused before paint.",
  authority: "holospaces Laws L1/L2/L3/L4/L5 · damage/dirty-region rendering · content-addressed memoization · thin-client scene streaming",
  witnessed,
  covers: witnessed ? ["projection-channel", "novelty-only-wire", "static-pointer-compare", "one-region-delta", "scroll-back-ref", "cross-device-from-cache", "verify-before-project", "pixel-identical", "deterministic"] : [],
  model,
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
if (model) console.log(`· cross-device: a ${model.regions}-region scene re-projects on a second device in ${model.wireKeyframeBytes} novel bytes`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ the experience is a projection: every rendered region is a κ-object, streamed by novelty, verified before it paints, pixel-identical on any device" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
