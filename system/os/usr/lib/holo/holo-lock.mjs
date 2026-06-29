// holo-lock.mjs — Warm Lock policy (pure, no DOM/timers). "Lock, don't log out": the warm-resident shell
// stays alive + restored across a hide (see holo-boot-warm-resident); this decides WHEN to gate it behind a
// biometric so a revealed warm window isn't an open door. The session key (holo-session _opKey) stays in
// memory across a lock, so unlock is one tap with NO navigation and NO re-restore — locking gates the SCREEN,
// it does not tear down the session.
//
// Eligibility is fail-OPEN by omission: we lock ONLY a real operator that CAN unlock here. A guest
// (ephemeral, no biometric) or a session with no device biometric enrolled is NEVER locked — locking it
// would strand the person with no way back in. The browser binding (holo-lock-ui.mjs) supplies the live
// context; this module is the testable decision + a tiny state machine.

export const LOCK_REASONS = Object.freeze(["hidden", "idle"]);

// shouldLock(ctx) → boolean. ctx = { operator, guest, hasBiometric, reason }.
export function shouldLock({ operator, guest, hasBiometric, reason } = {}) {
  if (guest) return false;                       // ephemeral session — nothing to unlock with
  if (!operator) return false;                   // no signed-in operator (e.g. pre-login / display-split)
  if (!hasBiometric) return false;               // no device biometric → never strand the person
  return LOCK_REASONS.includes(reason || "hidden");
}

// makeLock({ onLock, onUnlock }) — a minimal, injectable state machine (no DOM, no timers) so the policy +
// transitions are node-witnessable. lock(ctx) is idempotent and gated by shouldLock; unlock() clears it.
export function makeLock({ onLock, onUnlock } = {}) {
  let locked = false;
  return {
    state() { return locked ? "locked" : "open"; },
    isLocked() { return locked; },
    lock(ctx = {}) {
      if (locked) return false;                  // already locked → no-op (no double-mount)
      if (!shouldLock(ctx)) return false;        // not eligible → stays open (fail-open)
      locked = true;
      try { onLock && onLock(ctx); } catch (e) {}
      return true;
    },
    unlock() {
      if (!locked) return false;
      locked = false;
      try { onUnlock && onUnlock(); } catch (e) {}
      return true;
    },
  };
}

export default { LOCK_REASONS, shouldLock, makeLock };
