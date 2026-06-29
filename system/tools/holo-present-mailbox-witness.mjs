#!/usr/bin/env node
// holo-present-mailbox-witness.mjs — PROVE the lock-free PRODUCE→PRESENT handoff (the emulator's high-FPS
// structure, lifted to the substrate so the browser + QEMU inherit it). The invariants that make present
// out-pace produce without tearing or blocking:
//   • latest-wins — the consumer always gets the NEWEST complete frame; intermediate frames are dropped.
//   • no-tear — the producer's write slot and the consumer's read slot are ALWAYS distinct (triple buffer).
//   • present out-paces produce — a present loop ticking faster than produce gets the fresh frame once, then
//     null (re-present the held front) — the mechanism behind 240–500 Hz present over a 60 Hz producer.
//   • produce out-paces present — a slow consumer sees only the latest at each acquire; the rest drop; never
//     a stale or torn frame.
//   • never-blocks — a long produce burst with no consumer never stalls.
//   • integrity — the acquired bytes equal the published bytes (no corruption / no mid-write read).
//   node tools/holo-present-mailbox-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFrameMailbox } from "../os/usr/lib/holo/holo-present-mailbox.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FB = 8;
const frame = (i) => { const u = new Uint8Array(FB); new DataView(u.buffer).setUint32(0, i, true); u[4] = 0xab; u[5] = 0xcd; return u; };
const idxOf = (u) => new DataView(u.buffer, u.byteOffset, FB).getUint32(0, true);
const eqBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const checks = {}; let model = null;

// 1 · latest-wins: publish 1,2,3 with no acquire between ⇒ the consumer gets 3, drops 1,2
{
  const { producer: P, consumer: C } = makeFrameMailbox(FB);
  for (let i = 1; i <= 3; i++) P.publish(frame(i));
  const got = C.acquire();
  checks.latestWins = got !== null && idxOf(got) === 3 && C.stats.acquired === 1;
  checks.integrity = eqBytes(got, frame(3));                 // exact bytes, no corruption
}

// 2 · no-tear: across an interleaved run the producer's back slot and the consumer's front slot never alias
{
  const { producer: P, consumer: C } = makeFrameMailbox(FB);
  let ok = P.backSlot() !== C.frontSlot();
  for (let i = 1; i <= 200; i++) {
    P.publish(frame(i)); if (P.backSlot() === C.frontSlot()) ok = false;
    if (i % 3 === 0) { C.acquire(); if (P.backSlot() === C.frontSlot()) ok = false; }
  }
  checks.noTear = ok;
}

// 3 · present out-paces produce: 1 publish then 8 present ticks per cycle ⇒ 1 fresh + 7 null (held front
//     stays stable) — the 8× (e.g. 480 Hz over 60 Hz) case
{
  const { producer: P, consumer: C } = makeFrameMailbox(FB);
  let acq = 0, rep = 0, frontStable = true, last = null, pi = 0;
  for (let prod = 0; prod < 10; prod++) {
    P.publish(frame(++pi));
    for (let pres = 0; pres < 8; pres++) {
      const f = C.acquire();
      if (f) { acq++; last = idxOf(f); }
      else { rep++; if (last !== null && idxOf(C.front()) !== last) frontStable = false; }   // re-present held front
    }
  }
  checks.presentOutpacesProduce = acq === 10 && rep === 70 && frontStable;
  model = { presentHz: 480, produceHz: 60, ratio: 8, freshAcquires: acq, reprojectSlots: rep };
}

// 4 · produce out-paces present: publish 100, acquire every 4th ⇒ the consumer sees only the latest (4,8,…)
{
  const { producer: P, consumer: C } = makeFrameMailbox(FB);
  const seen = [];
  for (let i = 1; i <= 100; i++) { P.publish(frame(i)); if (i % 4 === 0) { const f = C.acquire(); if (f) seen.push(idxOf(f)); } }
  const expected = []; for (let i = 4; i <= 100; i += 4) expected.push(i);
  checks.produceOutpacesPresent = JSON.stringify(seen) === JSON.stringify(expected);
}

// 5 · never-blocks: a large produce burst with no consumer completes (publish never stalls)
{
  const { producer: P } = makeFrameMailbox(FB);
  for (let i = 0; i < 100000; i++) P.publish(frame(i & 0xffff));
  checks.neverBlocks = P.stats.published === 100000;
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-present-mailbox-witness.result.json"), JSON.stringify({
  spec: "Lock-free triple-buffer PRODUCE→PRESENT handoff (lifted from the game emulator to the projection substrate). Latest-wins, no-tear (producer write slot and consumer read slot always distinct), present can out-pace produce (fresh-once-then-null → re-present held front), produce can out-pace present (drops, never stale/torn), never-blocks. The structural reason present runs at the panel refresh (240–500 Hz) over a slower deterministic producer.",
  authority: "lock-free triple buffer / swap chain · SPSC mailbox (latest-wins, not FIFO) · holo-retro-engine/holo-present-mailbox.js",
  witnessed,
  covers: witnessed ? ["present-mailbox", "latest-wins", "no-tear", "present-outpaces-produce", "produce-outpaces-present", "never-blocks", "integrity"] : [],
  model,
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
if (model) console.log(`· decouple: ${model.freshAcquires} fresh + ${model.reprojectSlots} re-present slots = present at ${model.presentHz}Hz over produce at ${model.produceHz}Hz (${model.ratio}×)`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ present decouples from produce — latest-wins, no tear, no block; the path to 500 FPS over a 60 Hz producer" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
