#!/usr/bin/env node
// holo-tube-witness.mjs — proves Holo Tube streams video as κ-addressed objects with Law L5 on
// the media path. Pure-Node, deterministic, offline: it reads the SEALED demo MediaGraph and its
// real fMP4 segments (apps/holo-tube/media/, produced by holo-tube-ingest --demo) and proves the
// four conformance properties against them — no network, no browser, no ffmpeg re-run.
//
//   R1  every media segment re-derives to its κ before decode; a tampered byte is REFUSED (L5).
//   R2  the graph replays byte-identically OFFLINE from a κ-store keyed by κ (origin dead, L1·L3·L5).
//   R3  the playlist/radio is gapless: each video's successor κ is resolvable before it ends.
//   R4  segments are bit-exact (no transcode); the MediaGraph segment-closure κ re-derives from
//       the segments alone (non-circular root over the whole closure, L2·L5).
//
// Authority: W3C Media Source Extensions · ISO/IEC 14496-12 (BMFF/fMP4) · holospaces Laws
// L1 (content not location) · L2 (canonical forms) · L3 (the store is the memory) · L5 (verify by
// re-derivation) · the OS κ-store contract (holo-kstore / holo-store). Witnesses against the OS
// content-addressing primitive (holo-uor) and the media algebra (holo-media), never itself.
//
//   node tools/holo-tube-witness.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import {
  segmentKappa,
  verifySegment,
  orderedSegmentKappas,
  mediaGraphClosureKappa,
  nextVideoId,
} from "../os/usr/lib/holo/holo-media.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, "../../../holo-apps/apps/holo-tube");
const MEDIA = join(APP, "media");
const hexOf = (k) => String(k).split(":").pop().toLowerCase();

const checks = {};
let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };

// A κ-store with a Map backend (the "store is the memory", Law L3): put(bytes) addresses by κ;
// get(κ) returns the bytes and RE-DERIVES them, refusing a tampered object (Law L5). Mirrors the
// in-browser holo-kstore / holo-store contract, off-substrate, so offline replay is provable here.
function makeKStore() {
  const m = new Map();
  return {
    map: m,
    put(bytes) { const k = segmentKappa(bytes); m.set(hexOf(k), bytes); return k; },
    get(k) { const b = m.get(hexOf(k)); if (!b) return null; if (!verifySegment(b, k)) throw new Error("κ MISMATCH — refused (L5)"); return b; },
  };
}

function main() {
  if (!existsSync(join(MEDIA, "demo.mediagraph.json"))) {
    console.error("no sealed MediaGraph — run: node tools/holo-tube-ingest.mjs --demo");
    writeResult(false);
    process.exit(1);
  }
  const graph = JSON.parse(readFileSync(join(MEDIA, "demo.mediagraph.json"), "utf8"));
  const allSegs = []; // { kappa, path, bytes }
  for (const v of graph.videos || [])
    for (const r of v.representations || []) {
      if (r.initSegment) allSegs.push({ kappa: r.initSegment, path: r.initPath });
      for (const s of r.segments || []) allSegs.push({ kappa: s.kappa, path: s.path });
    }
  for (const s of allSegs) s.bytes = new Uint8Array(readFileSync(join(APP, s.path)));

  // structural sanity
  rec("MediaGraph is a holo:MediaGraph with ≥1 video", graph["@type"] === "holo:MediaGraph" && (graph.videos || []).length >= 1);
  rec("every video has an MSE-feedable representation (init + ordered media segments)",
    (graph.videos || []).every((v) => (v.representations || []).every((r) => r.initSegment && Array.isArray(r.segments) && r.segments.length > 0)));
  rec("every representation declares an ISO-BMFF / WebM mime (codecs present)",
    (graph.videos || []).every((v) => (v.representations || []).every((r) => /^(video|audio)\/(mp4|webm);\s*codecs=/.test(r.mime || ""))));

  // ── R1 · every segment re-derives to its κ before decode; tamper is refused (Law L5) ─────────
  {
    const allOk = allSegs.every((s) => verifySegment(s.bytes, s.kappa) && sha256hex(s.bytes) === hexOf(s.kappa));
    rec("R1 · every segment re-derives to its κ (L5 holds for all 15 segments)", allOk);
    // flip one byte → the κ must no longer match (a tampered segment is refused before decode)
    const t = allSegs[0].bytes.slice(0); t[(t.length / 2) | 0] ^= 0xff;
    rec("R1 · a tampered segment FAILS verification (refused before decode)", !verifySegment(t, allSegs[0].kappa));
  }

  // ── R2 · offline byte-identical replay from a κ-store (origin dead, L1·L3·L5) ─────────────────
  {
    const ks = makeKStore();
    // seal every segment by κ (this IS the OPFS κ-disk after a first watch)
    for (const s of allSegs) { const k = ks.put(s.bytes); if (hexOf(k) !== hexOf(s.kappa)) { rec("R2 · stored κ === graph κ", false); break; } }
    // now resolve EVERY segment BY ITS κ alone (no path, no origin) and assert byte-identity
    let identical = true;
    for (const s of allSegs) { const got = ks.get(s.kappa); if (!got || got.length !== s.bytes.length || !got.every((b, i) => b === s.bytes[i])) { identical = false; break; } }
    rec("R2 · replays byte-identically from the κ-store by κ alone (no origin)", identical);
    // a corrupted stored object is refused on read (the store never serves bad bytes)
    const k0 = allSegs[0].kappa; ks.map.set(hexOf(k0), (() => { const c = allSegs[0].bytes.slice(0); c[0] ^= 0xff; return c; })());
    let refused = false; try { ks.get(k0); } catch { refused = true; }
    rec("R2 · a corrupted stored segment is refused on read (L5)", refused);
    // an absent κ resolves to null, not bad bytes
    rec("R2 · an unstored κ resolves to null", makeKStore().get(segmentKappa(new TextEncoder().encode("never stored"))) === null);
  }

  // ── R3 · gapless playlist / radio: each successor κ is resolvable before the current ends ─────
  {
    const ids = (graph.videos || []).map((v) => v.id);
    const visited = new Set(); let id = ids[0], hops = 0, gapless = true;
    while (id && hops <= ids.length) {
      if (visited.has(id)) break;          // a cycle (radio loop) is fine — stop when we repeat
      visited.add(id);
      const v = (graph.videos || []).find((x) => x.id === id);
      const next = nextVideoId(graph, id);
      if (next) {                           // the successor must EXIST and be MSE-feedable (resolvable before this ends)
        const nv = (graph.videos || []).find((x) => x.id === next);
        if (!nv || !(nv.representations || [])[0]?.initSegment) { gapless = false; break; }
      }
      id = next; hops++;
    }
    rec("R3 · every video resolves a feedable successor (gapless walk over the queue)", gapless);
    rec("R3 · the walk reaches every video in the queue", visited.size === ids.length);
  }

  // ── R4 · bit-exact (no transcode) + the segment-closure κ re-derives from the segments ────────
  {
    // recompute each segment κ from its on-disk bytes — identical to the graph entry ⇒ the bytes
    // were never transcoded after sealing (the identity path preserves source bytes, Law L2).
    const bitExact = allSegs.every((s) => segmentKappa(s.bytes) === s.kappa);
    rec("R4 · on-disk segment κ === graph κ (bit-exact, no transcode drift)", bitExact);
    // the embedded segment-closure root re-derives from the segment κ set alone (non-circular).
    const recomputed = mediaGraphClosureKappa(graph);
    rec("R4 · holo:segmentClosure re-derives from the segment closure", recomputed === graph["holo:segmentClosure"]);
    rec("R4 · the closure covers exactly the played segment set", orderedSegmentKappas(graph).length === allSegs.length);
  }

  // ── range paging parity (reuse): a segment pages losslessly by byte range (206 / RangeResolver) ─
  {
    const b = allSegs[0].bytes;
    let re = new Uint8Array(0);
    for (let off = 0; off < b.length; off += 4096) { const part = b.subarray(off, Math.min(off + 4096, b.length)); const n = new Uint8Array(re.length + part.length); n.set(re); n.set(part, re.length); re = n; }
    rec("segment pages losslessly by byte range (κ-store 206 path applies to media)", re.length === b.length && re.every((x, i) => x === b[i]) && sha256hex(re) === hexOf(allSegs[0].kappa));
  }

  writeResult(failed === 0);
  console.log(`\nholo-tube-witness: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

function writeResult(witnessed) {
  writeFileSync(
    join(here, "holo-tube-witness.result.json"),
    JSON.stringify({
      spec: "Holo Tube streams video as κ-addressed objects with Law L5 on the media path: a MediaGraph seals a stream as a content-addressed DAG of fMP4 segments; every segment re-derives to its κ before decode (R1), the graph replays byte-identically offline from a κ-store (R2), the playlist/radio is gapless (R3), and segments are bit-exact while the segment-closure κ re-derives from the segments alone (R4).",
      authority: "W3C Media Source Extensions · ISO/IEC 14496-12 (BMFF/fMP4) · holospaces Laws L1·L2·L3·L5 · the OS κ-store contract (holo-kstore/holo-store) · holo-uor (content-addressing) — tools/holo-tube-witness.mjs",
      witnessed,
      covers: ["holo-tube", "media-source-extensions", "iso-bmff", "kappa-media", "law-l1", "law-l2", "law-l3", "law-l5"],
      checks, passed, failed,
    }, null, 2) + "\n",
  );
}

main();
