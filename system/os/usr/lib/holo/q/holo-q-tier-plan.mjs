// holo-q-tier-plan.mjs — PER-DEVICE TIER PLANNER. The same Q experience on a phone and a workstation comes
// from loading the RIGHT bytes per device, never the same bytes everywhere. Given the device's signals and the
// tiers a faculty has (draft · low-bit · instant · upgrade), it returns ONE plan: which target to load now,
// whether to lead with the tiny draft (cascade → instant first token), whether to background-upgrade, the
// forward path (WebGPU vs WASM), and a hard resident-byte budget so we never OOM a phone. Pure + deterministic
// → Node-witnessed. The browser passes navigator.deviceMemory / navigator.gpu / navigator.connection.
//
//   planTiers({ device, tiers }) → { target, draft, upgrade, useCascade, forward, budgetMB, residentMB, reason }
//   device : { memoryGB, webgpu:bool, downlinkMbps?, saveData?:bool, mobile?:bool }
//   tiers  : { draft?, lowbit?, instant, upgrade? } each { id, kappa?, bytesMB }
//
// Invariants the witness enforces:
//   1. residentMB (draft + target) ≤ budgetMB — ALWAYS (never OOM the device).
//   2. there is ALWAYS a runnable target (floor = the draft if nothing else fits).
//   3. cascade leads whenever the cold load isn't trivially fast (instant first token where it matters most).
//   4. background upgrade ONLY on an ample, unmetered, WebGPU device.
//   5. a low-bit target is preferred over full-precision on a constrained device.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const bytes = (t) => (t && typeof t.bytesMB === "number") ? t.bytesMB : Infinity;

export function planTiers({ device = {}, tiers = {} } = {}) {
  const memoryGB = typeof device.memoryGB === "number" ? device.memoryGB : 4;   // navigator.deviceMemory is coarse; 4 is a safe unknown
  const webgpu = !!device.webgpu;
  const saveData = !!device.saveData;
  const downlink = typeof device.downlinkMbps === "number" ? device.downlinkMbps : null;
  const mobile = !!device.mobile;

  if (!tiers.instant && !tiers.draft && !tiers.lowbit) throw new Error("planTiers needs at least one tier (instant/lowbit/draft)");

  const slow = saveData || (downlink != null && downlink < 5) || mobile;        // a link/where instant-first matters most
  const constrained = slow || memoryGB <= 4 || !webgpu;                          // prefer small + WASM-friendly

  // never let resident model bytes exceed ~35% of device RAM (leaves room for activations/KV/the OS).
  const budgetMB = Math.round(clamp(memoryGB * 1024 * 0.35, 200, 6144));

  const all = [tiers.draft, tiers.lowbit, tiers.instant, tiers.upgrade].filter(Boolean);
  const smallestFirst = all.slice().sort((a, b) => bytes(a) - bytes(b));

  // will we lead with the draft? whenever a draft exists and the cold load isn't trivially small.
  const targetIsBig = bytes(tiers.lowbit || tiers.instant || tiers.draft) > 30;
  let useCascade = !!tiers.draft && (slow || constrained || targetIsBig);
  let draftMB = useCascade ? bytes(tiers.draft) : 0;
  let cap = budgetMB - draftMB;

  // choose the TARGET. constrained → the smallest capable tier (low-bit preferred); ample → the instant tier,
  // with the heavier 'upgrade' reserved for a background swap (not the first load).
  const targets = [tiers.lowbit, tiers.instant, tiers.upgrade].filter(Boolean);
  let target;
  if (constrained) {
    target = targets.find((t) => bytes(t) <= cap) || targets.slice().sort((a, b) => bytes(a) - bytes(b))[0];
  } else {
    target = (tiers.instant && bytes(tiers.instant) <= cap) ? tiers.instant
      : (targets.filter((t) => bytes(t) <= cap).sort((a, b) => bytes(b) - bytes(a))[0] || targets.sort((a, b) => bytes(a) - bytes(b))[0]);
  }

  // hard budget guard (invariant 1 + 2): drop the draft to fit, then fall to draft-as-target as the last resort.
  let residentMB = draftMB + bytes(target);
  if (residentMB > budgetMB && useCascade) { useCascade = false; draftMB = 0; residentMB = bytes(target); }
  if (residentMB > budgetMB) {                                                   // even the bare target overflows → smallest tier wins
    target = smallestFirst[0]; useCascade = false; draftMB = 0; residentMB = bytes(target);
    if (residentMB > budgetMB && tiers.draft) { target = tiers.draft; residentMB = bytes(tiers.draft); }   // the tiny draft IS the model
  }
  const draft = useCascade ? tiers.draft : null;

  // background upgrade: ample + WebGPU + unmetered, a real heavier tier that isn't already the target.
  const upgrade = (!constrained && webgpu && !saveData && tiers.upgrade && tiers.upgrade !== target) ? tiers.upgrade : null;
  const forward = webgpu ? "webgpu" : "wasm";

  const reason = [
    constrained ? "constrained device → smallest capable target" : "ample device → full target",
    useCascade ? "draft-first (instant token)" : "no draft lead",
    upgrade ? "background upgrade armed" : "no background upgrade",
    forward,
    `budget ${budgetMB}MB · resident ${residentMB}MB`,
  ].join(" · ");

  return { target, draft, upgrade, useCascade, forward, budgetMB, residentMB, reason };
}

export default { planTiers };
