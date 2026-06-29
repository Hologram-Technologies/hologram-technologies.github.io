#!/usr/bin/env node
// holo-runahead-witness.mjs — PROVE negative latency as a κ-snapshot substrate primitive (the emulator's
// crown jewel, generalized so QEMU + a game core + any deterministic producer inherit it). A toy producer
// models BOTH a console and a VM: paged memory + a counter, advanced deterministically. The checks are the
// invariants that make run-ahead safe and cheap:
//   • determinism fence — the COMMITTED trajectory is bit-identical to a plain run (run-ahead never alters
//     truth); final machine state κ equal. (If this breaks, L1/rollback/netplay break.)
//   • lookahead — the PRESENTED frame is exactly L steps ahead on the current input (negative latency).
//   • incremental dedup — a checkpoint costs only its CHANGED pages, not the whole machine (the "snapshot is
//     near-free" property QEMU resume + emulator save-states rely on).
//   • idle near-free — an idle machine re-snapshots to almost the same κ (only the counter page is novel).
//   • snapshot re-derive (L5) — restore→re-snapshot yields the identical root κ.
//   node tools/holo-runahead-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeRunAhead, makeSnapshotStore } from "../os/usr/lib/holo/holo-runahead.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PAGES = 64, PSZ = 256;

// a deterministic producer: 64 memory pages + a counter. advance() optionally writes one page head, ticks
// the counter, and returns a frame that is a PURE function of state (so identical trajectories → identical
// frames). snapshot() = the pages + a counter page; restore() reinstates both.
function makeMachine() {
  let mem = Array.from({ length: PAGES }, () => new Uint8Array(PSZ));
  let counter = 0;
  const ctrPage = () => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, counter, true); return b; };
  return {
    snapshot() { const pages = mem.map((p) => p.slice()); pages.push(ctrPage()); return pages; },
    restore(list) { for (let i = 0; i < PAGES; i++) mem[i] = list[i].slice(); counter = new DataView(list[PAGES].buffer, list[PAGES].byteOffset, 4).getUint32(0, true); },
    advance(input) {
      if (input && input.touch != null) mem[input.touch % PAGES][0] = input.val & 0xff;
      counter = (counter + 1) >>> 0;
      const f = new Uint8Array(PAGES + 4);
      for (let i = 0; i < PAGES; i++) f[i] = mem[i][0];
      new DataView(f.buffer).setUint32(PAGES, counter, true);
      return f;
    },
  };
}
const eqFrame = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const rootOf = async (m) => (await makeSnapshotStore().put(m.snapshot())).root;
const inputs = Array.from({ length: 20 }, (_, t) => ({ touch: t % PAGES, val: (t * 37 + 5) & 0xff }));

const checks = {}; let model = null;

// ── plain reference run (no run-ahead) ──
const R = makeMachine(); const plain = []; for (const inp of inputs) plain.push(R.advance(inp));

// ── run-ahead run: commit one per step, present L ahead ──
const L = 3;
const A = makeMachine(); const ra = makeRunAhead(A, { frames: L });
const committed = [], presented = [];
for (let t = 0; t < inputs.length; t++) { const r = await ra.step(inputs[t]); committed.push(r.committed); presented.push(r.presented); }

// 1 · determinism fence: committed trajectory bit-identical to the plain run; final state κ equal
checks.determinismFence = committed.every((c, t) => eqFrame(c, plain[t])) && (await rootOf(A)) === (await rootOf(R));

// 2 · lookahead: each presented frame == an independent clone advanced L+1 on that step's input
{
  const A2 = makeMachine(); let ok = true;
  for (let t = 0; t < inputs.length; t++) {
    const snap = A2.snapshot();
    const clone = makeMachine(); clone.restore(snap);
    let ahead = null; for (let i = 0; i <= L; i++) ahead = clone.advance(inputs[t]);
    if (!eqFrame(ahead, presented[t])) ok = false;
    A2.advance(inputs[t]);                               // mirror the committed trajectory
  }
  checks.lookaheadIsLAhead = ok;
}

// 3 · incremental dedup: a checkpoint costs only its changed pages (touched page + counter), not all 65
{
  const M = makeMachine(); const store = makeSnapshotStore(); const r2 = makeRunAhead(M, { frames: 2, store });
  const T = 20; for (let t = 0; t < T; t++) await r2.step({ touch: t % PAGES, val: (t * 9) & 0xff });
  const st = store.stats(); const naive = (PAGES + 1) * T;
  checks.incrementalDedup = st.novelPages <= (PAGES + 1) + 2 * T && st.novelPages < naive / 4;
  model = { novelPages: st.novelPages, heldPages: st.heldPages, naiveFullSnapshots: naive, reduction: +(naive / st.novelPages).toFixed(1) };
}

// 4 · idle near-free: an idle machine's unchanged (identical) memory pages all dedup to ONE κ, so each
// checkpoint adds only the counter page — a 64-page machine costs ~1 page/step while idle.
{
  const M = makeMachine(); const store = makeSnapshotStore(); const r3 = makeRunAhead(M, { frames: 2, store });
  const T = 15; for (let t = 0; t < T; t++) await r3.step({ touch: null });
  checks.idleNearFree = store.stats().novelPages === 1 + T;   // 1 shared zero-page + one counter page per step
}

// 5 · snapshot re-derive (L5): restore→re-snapshot is the identical root κ
{
  const M = makeMachine(); for (const inp of inputs) M.advance(inp);
  const s = makeSnapshotStore();
  const m1 = await s.put(M.snapshot());
  M.restore(s.get(m1));
  const m2 = await s.put(M.snapshot());
  checks.snapshotRederive = m1.root === m2.root && s.get(m1).length === PAGES + 1;
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-runahead-witness.result.json"), JSON.stringify({
  spec: "Run-ahead as a κ-snapshot substrate primitive (generalized from holo-retro-runahead to any producer with snapshot/restore/advance — game core, QEMU, deterministic app). The committed trajectory is bit-identical to a plain run (determinism fence); the presented frame is L steps ahead (negative latency); checkpoints are content-addressed so cost is ∝ changed pages, not memory size (the snapshot-is-near-free property QEMU resume relies on).",
  authority: "RetroArch run-ahead algorithm · holospaces Laws L1/L3/L5 · content-addressed paged snapshots (QEMU live-migration dirty-page model)",
  witnessed,
  covers: witnessed ? ["runahead", "determinism-fence", "negative-latency-lookahead", "incremental-page-dedup", "idle-near-free", "snapshot-rederive-l5"] : [],
  model,
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
if (model) console.log(`· dedup: ${model.novelPages} novel pages vs ${model.naiveFullSnapshots} full-snapshot pages = ${model.reduction}× less (checkpoint cost ∝ change, not size)`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ negative latency with a bit-identical committed trajectory; checkpoints cost only changed pages — the same κ-snapshot primitive unifies the emulator and QEMU" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
