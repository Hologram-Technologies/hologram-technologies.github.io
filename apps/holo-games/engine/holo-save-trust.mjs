// holo-save-trust.mjs — verify-before-trust for game saves. A save's bytes must re-hash to their
// stamped κ before they are ever unserialized into a core. This is the single predicate behind every
// hand-off (resume, load-slot, roam, share/import): the live front door must refuse a save whose
// κ-claim fails, so a poisoned roam peer or share link cannot inject arbitrary emulator state.
//
// `hash` is injected (async (Uint8Array) -> hex): crypto.subtle in the app, node:crypto in the test.

// True if the record is safe to trust: either it carries NO κ-claim (legacy/pre-κ save → unverified,
// allowed so old data still loads) OR its bytes re-hash to the claimed κ. False ONLY when there is no
// state to load, or a κ-claim is present and FAILS (tampered → refuse).
export async function saveVerifies(rec, hash) {
  if (!rec || !rec.state) return false;          // nothing to load
  if (!rec.saveKappa) return true;               // legacy save → unverified, allowed
  return (await hash(rec.state)) === rec.saveKappa;
}

// Convenience for the load sites: returns the state to unserialize, `false` if a κ-claim FAILS
// (tampered → caller shows "refused"), or null if there is no save.
export async function trustedStateOf(sv, hash) {
  if (!sv || !sv.state) return null;
  return (await saveVerifies(sv, hash)) ? sv.state : false;
}
