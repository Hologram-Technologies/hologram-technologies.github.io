// holo-lock-witness.mjs — pure policy witness for Warm Lock (no DOM). Run: node tools/holo-lock-witness.mjs
import { shouldLock, makeLock, LOCK_REASONS } from "../os/usr/lib/holo/holo-lock.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } };

// — shouldLock eligibility —
ok("operator+biometric on hide → lock", shouldLock({ operator: "did:holo:sha256:abc", hasBiometric: true, reason: "hidden" }) === true);
ok("operator+biometric idle → lock", shouldLock({ operator: "did:holo:sha256:abc", hasBiometric: true, reason: "idle" }) === true);
ok("guest is NEVER locked", shouldLock({ operator: "did:holo:sha256:abc", guest: true, hasBiometric: true, reason: "hidden" }) === false);
ok("no operator → not locked", shouldLock({ hasBiometric: true, reason: "hidden" }) === false);
ok("no biometric → never strand (not locked)", shouldLock({ operator: "did:holo:sha256:abc", hasBiometric: false, reason: "hidden" }) === false);
ok("unknown reason → not locked", shouldLock({ operator: "did:holo:sha256:abc", hasBiometric: true, reason: "boot" }) === false);
ok("default reason is hidden", shouldLock({ operator: "did:holo:sha256:abc", hasBiometric: true }) === true);

// — makeLock state machine —
let locks = 0, unlocks = 0;
const L = makeLock({ onLock: () => locks++, onUnlock: () => unlocks++ });
ok("starts open", L.state() === "open" && !L.isLocked());
ok("lock(eligible) → locked + onLock once", L.lock({ operator: "x", hasBiometric: true, reason: "hidden" }) === true && L.isLocked() && locks === 1);
ok("double lock is a no-op", L.lock({ operator: "x", hasBiometric: true, reason: "hidden" }) === false && locks === 1);
ok("unlock → open + onUnlock once", L.unlock() === true && !L.isLocked() && unlocks === 1);
ok("unlock when open is a no-op", L.unlock() === false && unlocks === 1);
const G = makeLock({});
ok("lock(guest) refused → stays open", G.lock({ operator: "x", guest: true, hasBiometric: true, reason: "hidden" }) === false && G.state() === "open");
ok("LOCK_REASONS = hidden,idle", LOCK_REASONS.join(",") === "hidden,idle");

console.log(`holo-lock-witness: ${pass}/${pass + fail} green`);
process.exit(fail ? 1 : 0);
