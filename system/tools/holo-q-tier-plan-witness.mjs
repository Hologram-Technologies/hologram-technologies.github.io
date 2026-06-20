// holo-q-tier-plan-witness.mjs — re-derivable proof that the per-device tier planner makes desktop and mobile
// the SAME experience with the RIGHT bytes: it never exceeds the device budget, always yields a runnable
// target, leads with the draft where instant-first matters, prefers low-bit on constrained devices, and only
// background-upgrades on ample hardware. Pure Node, no GPU. Run: node holo-q-tier-plan-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const { planTiers } = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-tier-plan.mjs")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// realistic respond-faculty tiers: tiny draft, low-bit ternary target, the 0.5B instant, the 1.5B upgrade.
const TIERS = {
  draft:   { id: "draft-tiny",   bytesMB: 8 },
  lowbit:  { id: "ternary-1.58", bytesMB: 160 },
  instant: { id: "qwen-0.5b",    bytesMB: 469 },
  upgrade: { id: "qwen-1.5b",    bytesMB: 1117 },
};

console.log("\nholo-q tier planner — same experience, right bytes per device\n");

// ── 1) high-end desktop: full target + background upgrade + WebGPU, still draft-first (469MB is not instant) ─
console.log("high-end desktop (16GB · WebGPU · 100Mbps):");
{
  const p = planTiers({ device: { memoryGB: 16, webgpu: true, downlinkMbps: 100, mobile: false }, tiers: TIERS });
  ok(p.target.id === "qwen-0.5b", "target = the instant 0.5B (ample → full)");
  ok(p.upgrade && p.upgrade.id === "qwen-1.5b", "background upgrade to 1.5B is armed");
  ok(p.forward === "webgpu", "WebGPU forward");
  ok(p.useCascade && p.draft.id === "draft-tiny", "still draft-first — 469MB isn't instant even on wifi");
  ok(p.residentMB <= p.budgetMB, "resident ≤ budget");
}

// ── 2) mid mobile, metered, no WebGPU: low-bit target, draft-first, WASM, no eager upgrade ─────────────────
console.log("\nmid mobile (3GB · no WebGPU · 2Mbps · saveData):");
{
  const p = planTiers({ device: { memoryGB: 3, webgpu: false, downlinkMbps: 2, saveData: true, mobile: true }, tiers: TIERS });
  ok(p.target.id === "ternary-1.58", "target = the low-bit ternary tier (constrained → smallest capable)");
  ok(p.upgrade === null, "NO background upgrade on a metered/constrained device");
  ok(p.forward === "wasm", "WASM forward (no WebGPU)");
  ok(p.useCascade && p.draft, "draft-first — instant first token matters most on the slow path");
  ok(p.residentMB <= p.budgetMB, "resident ≤ budget (never OOM the phone)");
}

// ── 3) low-bit is PREFERRED over full only when constrained ────────────────────────────────────────────────
console.log("\nlow-bit preference is device-aware:");
{
  const phone = planTiers({ device: { memoryGB: 4, webgpu: false, mobile: true }, tiers: TIERS });
  const desk  = planTiers({ device: { memoryGB: 32, webgpu: true, downlinkMbps: 300 }, tiers: TIERS });
  ok(phone.target.id === "ternary-1.58", "constrained → low-bit target");
  ok(desk.target.id === "qwen-0.5b", "ample → full-precision instant target");
}

// ── 4) hard budget floor: tiny device + no low-bit → downshift, draft can become the model, never over budget ─
console.log("\nhard budget guard + always-a-target floor:");
{
  const big = { instant: { id: "qwen-0.5b", bytesMB: 469 }, draft: { id: "draft-tiny", bytesMB: 8 } };   // no low-bit
  const tiny = planTiers({ device: { memoryGB: 1, webgpu: false, mobile: true }, tiers: big });            // ~358MB budget
  ok(tiny.target && tiny.residentMB <= tiny.budgetMB, "tiny device: a runnable target chosen, still within budget");
  const microTier = { instant: { id: "big", bytesMB: 9000 }, draft: { id: "draft-tiny", bytesMB: 8 } };   // nothing fits but the draft
  const micro = planTiers({ device: { memoryGB: 1, webgpu: false, mobile: true }, tiers: microTier });
  ok(micro.target.id === "draft-tiny" && micro.residentMB <= micro.budgetMB, "when only the draft fits, the draft IS the model (graceful floor)");
}

// ── 5) determinism + always-a-target across a sweep of devices ─────────────────────────────────────────────
console.log("\ndeterminism + robustness sweep:");
{
  const dev = { memoryGB: 6, webgpu: true, downlinkMbps: 20 };
  const a = planTiers({ device: dev, tiers: TIERS }), b = planTiers({ device: dev, tiers: TIERS });
  ok(JSON.stringify(a) === JSON.stringify(b), "deterministic: same device → same plan");
  let allValid = true;
  for (const mem of [1, 2, 3, 4, 8, 16, 32]) for (const gpu of [true, false]) for (const dl of [1, 3, 10, 100]) {
    const p = planTiers({ device: { memoryGB: mem, webgpu: gpu, downlinkMbps: dl, mobile: mem <= 4 }, tiers: TIERS });
    if (!p.target || p.residentMB > p.budgetMB) { allValid = false; break; }
  }
  ok(allValid, "across 56 device profiles: always a target, never over budget");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
