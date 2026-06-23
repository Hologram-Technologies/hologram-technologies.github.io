// holo-pull-media-witness.mjs — proves holo-pull-media.mjs (the player bridge) end-to-end in Node:
// a content-addressed media object is streamed as deadline-ordered, per-block L5-verified κ-pieces
// through the REAL holo-pull consume loop, reassembled byte-identical, and a tampered piece is withheld
// so a mismatched object can never reach the decoder. Mirrors the holo-pull/-consume/-swarm witnesses.
//
//   node system/tools/holo-pull-media-witness.mjs

import {
  DEFAULT_PIECE, chunkToDag, inMemoryMesh, streamMedia, playableFromSwarm,
} from "../os/usr/lib/holo/holo-pull-media.mjs";
import { cidOf, cidToString, sha256, toHex } from "../os/usr/lib/holo/holo-ipfs.js";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log((c ? "ok   " : "FAIL ") + n + (x ? "  — " + x : "")); };

// A media-shaped object spanning many pieces (1.6 MiB → 7 pieces at 256 KiB): deterministic so the
// witness is reproducible, varied so leaf cids differ (no accidental dedup hiding an ordering bug).
function fakeMedia(n) {
  const b = new Uint8Array(n);
  let x = 0x9e3779b1 >>> 0;                       // a full-period LCG → pieces are genuinely distinct
  for (let i = 0; i < n; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; b[i] = (x >>> 16) & 0xff; }
  return b;
}

(async () => {
  const media = fakeMedia(1_600_000);
  const want = "sha256:" + toHex(await sha256(media));

  // 1) DAG: object splits into the expected number of content-addressed pieces, all distinct.
  const { order, store } = await chunkToDag(media, DEFAULT_PIECE);
  const expectPieces = Math.ceil(media.length / DEFAULT_PIECE);
  ok("object content-addresses into pieces", order.length === expectPieces && store.size === expectPieces,
     order.length + " pieces");
  ok("pieces are distinct κ-addressed leaves", new Set(order).size === order.length && order.every((c) => c.startsWith("bafkrei")));

  // 2) stream through the real consume loop over a verify-on-receipt mesh → byte-identical reassembly.
  const r = await streamMedia(media, { want });
  ok("every piece delivered in order, verified", r.stats.frames === expectPieces && r.stats.done);
  ok("TTFF lands (first verified piece)", r.stats.ttffMs >= 0, "ttff " + r.stats.ttffMs + "ms");
  ok("streamed reassembly == source, byte-for-byte", r.verified, (r.bytes ? r.bytes.length : 0) + "B");
  ok("whole object re-derives to its declared κ (L5)", r.kappaOk === true);

  // 3) wall-clock pacing (fps) still reassembles identically — the video flow-control path.
  const paced = await streamMedia(media, { want, fps: 240, lookahead: 6 });
  ok("fps-paced stream reassembles identically", paced.verified && paced.kappaOk === true,
     paced.stats.ms + "ms @240fps");

  // 4) integrity: a tampered piece is withheld (verify-on-receipt), so reassembly fails closed — the
  //    decoder never sees a mismatched object. Inject by corrupting one leaf in a custom source.
  const tampered = await streamMedia(media, {
    want,
    maxMs: 600,
    makeSource: (s0) => {
      const s = new Map(s0);
      const victim = [...s.keys()][3];
      s.set(victim, new TextEncoder().encode("WRONG-bytes-not-matching-cid"));
      return inMemoryMesh(s, { timeoutMs: 250 });
    },
  });
  ok("tampered piece withheld → object refused, fail-closed (L5)", tampered.verified === false && tampered.bytes === null && tampered.timedOut === true);

  // 5) playableFromSwarm: a clean object yields a playable handle; a forged declared κ refuses (url:null).
  const good = await playableFromSwarm(async () => media, { type: "video/mp4", want });
  ok("clean object → playable + verified", good.verified === true && good.kappaOk === true);
  const forged = await playableFromSwarm(async () => media, { type: "video/mp4", want: "sha256:" + "0".repeat(64) });
  ok("forged declared κ → refused, no playable handle", forged.kappaOk === false && forged.url === null);

  console.log("\n" + (fail === 0 ? "PASS" : "FAIL") + "  " + pass + "/" + (pass + fail));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error("THREW", e && e.stack || e); process.exit(1); });
