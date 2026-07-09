// holo-projector.mjs — THE PROJECTION BROWSER seam. It unifies the three proven-but-separate render
// primitives into one origin↔lens channel so a rendered experience becomes a STREAM OF κ-OBJECTS that
// project onto any device:
//
//   • holo-compute-memo  — the ORIGIN reconstructs an already-seen region in O(1) (no recompute/dispatch).
//   • holo-delta-render  — the ORIGIN emits ONLY κ-changed regions; an unchanged region is a pointer-compare.
//   • holo-kappa-stream  — the WIRE: a region the lens holds ⇒ a REF (≈0 bytes), a novel one ⇒ its BYTES,
//                          re-derived before it paints (Law L5). What travels is NOVELTY, NOT RESOLUTION.
//
// First principles. A browser is fetch → parse/layout → paint → composite → pixels. κ already owns FETCH
// (holo://, L5). This seam moves the boundary to the SCENE: the producer (an engine, local or edge) hands
// the projector a scene — an ordered list of REGIONS, each addressed by (op κ, in κ) — and the projector is
// the LENS: it verifies and composites, nothing more. So the engine stays a swappable scene producer behind
// the seam, and the lens is tiny, portable, and the only thing on screen (total rebrand, any device/OS).
//
// A SCENE is [{ id, op, in }] — id is the stable on-screen slot, op κ the paint op, in κ the region content.
// `transform(opκ,inκ) → bytes` is the producer (a real WebGPU/raster driver in-browser; a pure fn in Node),
// so the channel accounting is witnessed in Node and the SAME channel drives a real surface in the browser.
//
//   makeProjector({ transform, cache?, l2?, cap?, paint? })
//     .render(regions, { keyframe?, budget? }) → { wire, emitted, stats }   // ORIGIN: minimal events for the delta
//     .receive(wire)                            → { painted, refused, novelBytes, stats }  // LENS: admit (L5) + paint-on-κ
//     .pixels(id) → bytes | null   · .held() → Set<hex>   · .wireBytes() → total novel bytes admitted
//
// node-, Service-Worker- and DOM-safe. Imports only its sibling primitives (it is their composer, Law L4).
import { makeKappaStream } from "./holo-kappa-stream.mjs";
import { makeDeltaLoop } from "./holo-delta-render.mjs";
import { makeComputeMemo } from "./holo-compute-memo.mjs";

export function makeProjector({ transform, cache = new Map(), l2 = null, cap = 4096, paint = null } = {}) {
  if (!transform) throw new Error("holo-projector: needs a { transform } scene producer (opκ,inκ)→bytes");

  // ONE channel = one address space (Law L3). The origin produces onto it; the lens admits from it. For a
  // connection the origin's view of "what the lens holds" IS the lens's cache — they converge on this Map.
  const stream = makeKappaStream(cache);
  const memo = makeComputeMemo({ l2, cap });                 // origin-side O(1) region reconstruct

  // ORIGIN delta loop: paint(id,bytes) does not draw — it COLLECTS the changed region so we can stream it.
  // Only κ-changed regions reach here (the loop's job); unchanged regions are a pointer-compare and emit
  // nothing at all (the leanest delta: unchanged regions are implicitly retained by the lens).
  let collected = [];
  const originLoop = makeDeltaLoop({ memo, transform, paint: (id, bytes) => collected.push({ id, bytes }) });

  const lensLastK = new Map();                                // id → κ currently on screen (the lens's delta state)
  const lensPixels = new Map();                               // id → bytes currently on screen (for verification)
  const sent = new Set();                                     // hexes the origin has put on THIS wire (its mirror of held)

  // ORIGIN — produce the minimal wire for this frame. keyframe=true re-emits every region (a fresh lens
  // that holds nothing of this scene yet — but a warm cache still turns each into a ref, so a keyframe to a
  // device that already holds the base costs ZERO novel bytes: cross-device dedup falls out for free).
  async function render(regions, { keyframe = false, budget = Infinity } = {}) {
    if (keyframe) originLoop.clear();
    collected = [];
    const stats = await originLoop.frame(regions, { budget });
    const wire = [];
    for (const c of collected) {
      let event = await stream.frame(c.bytes);                // ref iff the lens already holds it; else its bytes
      const hex = String(event.kappa).split(":").pop();
      // SPATIAL dedup within one frame: identical regions (a flat background, a repeated glyph) share a κ. The
      // first carries the bytes; the rest are refs — the producer mirrors what it has already put on the wire,
      // so a κ sent once this session is never sent again (the lens admits the obj first, refs resolve after it).
      if (event.kind === "obj" && sent.has(hex)) event = { kind: "ref", kappa: event.kappa };
      else if (event.kind === "obj") sent.add(hex);
      wire.push({ id: c.id, event });
    }
    return { wire, emitted: wire.length, stats };
  }

  // LENS — admit each changed region and paint it. admit() is verify-before-paint: a novel object must
  // re-derive to its κ (Law L5) or it is REFUSED and never reaches the surface; a ref reconstructs O(1)
  // from the address space. Then the lens applies the delta rule itself: repaint a slot only on κ-change.
  async function receive(wire) {
    let painted = 0, refused = 0;
    const before = stream.wireBytes();
    for (const w of wire) {
      let bytes;
      try { bytes = await stream.admit(w.event); }           // L5 here — a tampered region throws, never paints
      catch (e) { refused++; continue; }
      if (lensLastK.get(w.id) !== w.event.kappa) {            // paint-on-κ-change (the delta rule, lens-side)
        if (paint) paint(w.id, bytes);
        lensLastK.set(w.id, w.event.kappa); lensPixels.set(w.id, bytes); painted++;
      }
    }
    return { painted, refused, novelBytes: stream.wireBytes() - before, stats: stream.stats() };
  }

  return {
    render, receive,
    pixels: (id) => lensPixels.get(id) || null,
    held: () => new Set(cache.keys()),
    wireBytes: () => stream.wireBytes(),
    originStats: () => memo.stats(),
    lensStats: () => stream.stats(),
    cache,
  };
}

export default { makeProjector };
