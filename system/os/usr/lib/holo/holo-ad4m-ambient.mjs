// holo-ad4m-ambient.mjs — THE NERVOUS SYSTEM. The AD4M web has organs (Perspectives, Neighbourhoods, live
// Languages, Synergy, WAN transport) but no heartbeat: something has to call sync, ingest, index, re-dial,
// heal. This registers every organ as a FACULTY of the ONE ambient authority that already exists
// (holo-ambient.mjs — "one heartbeat, many organs"), so the moment an operator unlocks, the whole web is
// alive and stays coherent on its own. No setup, no buttons, no "press sync" — it just works.
//
// It owns NO timer (holo-ambient owns the only loop) and adds NO capability — it DRIVES the modules that are
// already built + witnessed. Every organ is FAIL-SOFT (a missing seam → skip, never throw) and IDEMPOTENT
// (it runs every tick — it must be safe to). The ambient core already isolates a thrown organ and reports it
// in errored[]; we lean on that and add no try/catch theater. Pure + isomorphic; node-testable by driving
// tick() by hand (deterministic, no real timer).
//
// The `web` contract (all members optional — organs degrade cleanly if a seam isn't up yet):
//   web.neighbourhoods() → [{ publish() }]      — shared Spaces to converge
//   web.drainIngest(max)  → Promise<count>      — turn queued dropped/pasted/linked content into Expressions
//   web.indexNew()        → Promise<count>      — feed new Expressions to Synergy so search stays current
//   web.wan.keepAlive()   → Promise<void>       — keep WAN peers healthy; re-dial dropped channels (idempotent)
//   web.reconcileProvenance() → { unprovenanced } — surface provenance drift (fail-closed), never hide it
//   web.heal()            → Promise<{ ok }>      — verify the Perspective spine; recover from drift

// the default cadences (in heartbeats). Co-prime-ish so organs rarely bunch on the same tick. The witness
// overrides with small values for a deterministic replay; production leaves these.
const DEFAULT_CADENCE = Object.freeze({ sync: 3, ingest: 1, index: 5, peers: 8, provenance: 13, heal: 21 });

// wireAd4mFaculties(ambient, web, opts) → unwire(). Registers the six organs on the one heartbeat and returns
// a single handle that unregisters all of them (and nothing else). Registering is idempotent: the ambient
// replaces a same-named faculty rather than duplicating, so calling this twice is safe.
export function wireAd4mFaculties(ambient, web = {}, { cadence = {}, ingestBatch = 8 } = {}) {
  if (!ambient || typeof ambient.register !== "function") throw new Error("wireAd4mFaculties needs a holo-ambient instance");
  const CAD = { ...DEFAULT_CADENCE, ...cadence };
  const unregs = [];
  const add = (name, run, everyTicks) => { unregs.push(ambient.register(name, run, { everyTicks })); };

  // ad4m:sync — converge every joined Space without the user asking. publish() fans the advertisement; the
  // peer's verify-before-adopt does the trust. No-op when there are no peers (idempotent, fail-soft).
  add("ad4m:sync", async () => {
    for (const nb of (web.neighbourhoods ? web.neighbourhoods() : [])) { try { nb && nb.publish && nb.publish(); } catch (e) {} }
  }, CAD.sync);

  // ad4m:ingest — drain queued content (a dropped file, a pasted blob, a linked URL) into Expressions through
  // the live Languages. Bounded per tick (back-pressure) so a big paste never stalls the heartbeat.
  add("ad4m:ingest", async () => { if (web.drainIngest) await web.drainIngest(ingestBatch); }, CAD.ingest);

  // ad4m:index — keep Synergy's search index current as Expressions appear, so search is always fresh.
  add("ad4m:index", async () => { if (web.indexNew) await web.indexNew(); }, CAD.index);

  // ad4m:peers — keep WAN channels healthy; re-dial a dropped peer. Slow cadence: never thrash the network.
  add("ad4m:peers", async () => { if (web.wan && web.wan.keepAlive) await web.wan.keepAlive(); }, CAD.peers);

  // ad4m:provenance — reconcile provenance against the spine; if something is unprovenanced, flag it (the
  // organ surfaces drift via web.onDrift if present — it never silently hides a missing origin).
  add("ad4m:provenance", async () => {
    if (!web.reconcileProvenance) return;
    const r = web.reconcileProvenance();
    if (r && r.unprovenanced && r.unprovenanced.length && web.onDrift) { try { web.onDrift(r.unprovenanced); } catch (e) {} }
  }, CAD.provenance);

  // ad4m:heal — verify the operator's Perspective spine; on drift, recover it (reconcileResume). The slowest
  // organ: the spine is durable, so a periodic self-check is enough to keep it honest (Law L5).
  add("ad4m:heal", async () => { if (web.heal) await web.heal(); }, CAD.heal);

  return () => { for (const u of unregs) { try { u(); } catch (e) {} } unregs.length = 0; };
}

// browser binding: light the nervous system on the ONE ambient authority the OS already created. Idempotent
// and fail-soft — it waits for both window.HoloAmbient and the bound web (window.HoloFlux from boot), then
// wires the organs and arms the single loop via the OS's injected idle pump. No second timer is ever created.
if (typeof window !== "undefined") {
  window.HoloAd4mAmbient = { wireAd4mFaculties };
  const lightUp = () => {
    try {
      if (window.__holoAd4mAmbientWired) return;
      const ambient = window.HoloAmbient;          // THE single heartbeat (holo-ambient.mjs)
      const web = window.HoloFlux;                  // the bound AD4M web (holo-ad4m-boot.mjs)
      if (!ambient || !web) return;                 // not up yet — a later event will retry
      window.__holoAd4mAmbientWired = wireAd4mFaculties(ambient, web);
    } catch (e) { /* leave unwired; boot will retry */ }
  };
  if (document.documentElement) {
    document.documentElement.addEventListener("holo-ambient-ready", lightUp);
    document.documentElement.addEventListener("holo-ad4m-ready", lightUp);
  }
  lightUp();
}

export default { wireAd4mFaculties };
