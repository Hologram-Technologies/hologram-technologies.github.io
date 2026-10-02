// holo-q-guards.mjs - RE-EXPORT SHIM (U3a of Q-ONE: the safety spine is UN-FORKED). Exactly ONE implementation
// of the guard spine, re-exported here so every existing import (the messenger app, the witness) keeps working
// while a future edit lands EVERYWHERE.
//
// LIVE-BOOT FIX (HOLO-Q-ONE-SURFACE): this used to point at ../q/core/holo-q-guards.mjs, but the lean-Q bundle
// EVICTS apps/q/* from the messenger ship - so a later `holo ship` pruned that file, this shim's re-export 404'd,
// app.mjs's guards import failed, and the WHOLE drawer stopped booting for fresh (no-SW-cache) visitors. The ONE
// guards now lives in the OS tree at usr/lib/holo/q/ (which ALWAYS ships with the messenger, co-located with the
// reply-spine / evolve / notices), so the re-export can never be pruned out from under the app again.
export * from "../../usr/lib/holo/q/holo-q-guards.mjs";
