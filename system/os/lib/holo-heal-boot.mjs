// holo-heal-boot.mjs — START THE AUTONOMOUS HEAL LOOP at OS boot, no user action (ADR-0076). Loads the
// OS-wide closure, builds the heal supervisor over the κ-substrate recovery chain, and keeps the whole
// OS healthy on idle: re-verify every κ-object against its content (Law L5), recover any that drifted /
// went missing from a NON-origin source (IPFS · mesh), and surface a health summary the OS can show.
// The SEALED ANCHOR (the constitution, the conscience-gate source, the closure root) is EXCLUDED — a
// broken anchor stays fail-closed and is surfaced, never auto-rewritten.
//
// GUARDED END-TO-END: every step is best-effort and wrapped — this module can NEVER break boot. The
// first scrub is DEFERRED to idle (it never blocks the critical path); thereafter it re-arms on idle.
// It composes the already-witnessed spine (holo-heal · holo-resolver · holo-peers) — no new trust.

import { makeHealer, anchorSet } from "/sbin/holo-heal.mjs";
import { makeSupervisor } from "/sbin/holo-heal-supervisor.mjs";
import { cacheSource, originSource } from "/sbin/holo-sources.mjs";
import { ipfsPeer, bridgePeer } from "/sbin/holo-peers.mjs";
import { webSource, importObject } from "/sbin/holo-web.mjs";                      // the OPEN-WEB κ transport: follow any HTTPS edge in the internet hypergraph, re-derived (Law L5)
import * as ipfs from "/usr/lib/holo/holo-ipfs.js";
import { kget, kput, kverify } from "/usr/lib/holo/holo-forge/holo-kstore.mjs";   // the durable, persistent on-device κ-store (IndexedDB) — the device's own copy
import { rootKappaFromHash, coldBootRoot } from "/lib/holo-cid-boot.mjs";          // SINGLE-LINK: the share link is https://<host>/#<root-CID>

const hexOf = (k) => String(k && (k.kappa || k.did || k["@id"] || k)).split(":").pop().toLowerCase();
const sha256hex = async (b) => [...new Uint8Array(await self.crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("");

(async () => {
  try {
    if (!self.crypto || !self.crypto.subtle) return;                          // no Web Crypto → cannot re-derive; stay out of the way

    // SINGLE-LINK ACTIVATION (decentralized-boot delta A). The shareable link …/#<root-CID> carries the
    // boot-root content address in the fragment (the SW can't read it — its self.location is the worker
    // URL; this page module can). Fetch the boot root as RAW bytes (so we can re-derive it), and if the
    // origin can't serve it, recover it BY κ from the NON-ORIGIN chain (device store · IPFS Trustless
    // Gateways). Then self-verify: does the booted root match the link's content-address? Surfaced on
    // self.__holoRoot for the "verified ✓" badge. All guarded — never breaks boot (falls back to the
    // origin path exactly as before).
    const rootK = (() => { try { return rootKappaFromHash(globalThis.location && globalThis.location.hash); } catch { return null; } })();
    let raw = null;
    try { const r = await fetch("/etc/os-closure.json", { cache: "no-store" }); if (r.ok) raw = new Uint8Array(await r.arrayBuffer()); } catch {}
    if (!raw && rootK) {                                                        // origin couldn't serve the root → the cold-device, dead-origin path
      try {
        const sources = [{ name: "store", get: async (h) => { try { return await kget("sha256:" + h); } catch { return null; } } }, { name: "ipfs", get: ipfsPeer({ ipfs }) }];
        const got = await coldBootRoot({ hash: globalThis.location.hash, sources });
        if (got) raw = got.bytes;
      } catch {}
    }
    let lock = null; try { lock = raw ? JSON.parse(new TextDecoder().decode(raw)) : null; } catch {}
    try { const verified = (rootK && raw) ? ((await sha256hex(raw)) === rootK) : null; self.__holoRoot = { cid: rootK, verified, at: Date.now() }; } catch {}
    if (!lock || !lock.closure) return;

    // path → κ — the whole OS, as content addresses (what we keep whole). Also collect each object's
    // W3C DID Core `alsoKnownAs` HTTPS IRIs — the open-web EDGES that point to this κ-node, so recovery
    // can follow them to ANY internet location (not just the origin). Most carry only the blake3 σ-axis
    // alias today; the HTTPS-edge path is ready for when objects advertise their mirrors.
    const closure = {}, irisByHex = {};
    for (const [p, e] of Object.entries(lock.closure)) {
      const k = (e && (e.kappa || e.did || e["@id"])) || e;
      closure[p] = k;
      const https = ((e && e.alsoKnownAs) || []).map(String).filter((u) => /^https?:\/\//.test(u));
      if (https.length) irisByHex[hexOf(k)] = https;
    }
    const iris = async (kappa) => irisByHex[hexOf(kappa)] || [];               // an object's advertised HTTPS edges
    const gateways = Array.isArray(lock.gateways) ? lock.gateways : [];         // configurable content-address gateways (did:holo's IPFS-gateway analogue)

    // the sealed ANCHOR set — NEVER auto-healed: the constitution, the conscience-gate source, the closure root.
    const anchorHexes = [hexOf(lock.root)];
    for (const [p, e] of Object.entries(lock.closure)) if (/(^|\/)etc\/constitution\//.test(p) || /holo-conscience\.js$/.test(p)) anchorHexes.push(hexOf((e && (e.kappa || e.did || e["@id"])) || e));
    const isAnchor = anchorSet(anchorHexes);

    // The recovery chain, in preference order — every byte re-derived by the resolver (Law L5), so the
    // source is a latency choice, never a trust one:
    //   1 · the device's OWN durable κ-store (instant, offline) — once seeded, the origin is optional.
    //   2 · the origin it booted from (by name) — the natural SEED; a corrupt origin is refused, not served.
    //   3 · the OPEN WEB — the object's own HTTPS IRIs + any content-address gateway, anywhere on the net.
    //   4 · IPFS Trustless Gateways (a sha-256 κ IS a CIDv1 sha2-256) — the global content-addressed swarm.
    //   5 · WebRTC-mesh peers — other devices that already healed this κ (a sync only exists in a room).
    const askMesh = async () => null;
    const sources = [
      cacheSource(async (hex) => { try { return await kget("sha256:" + hex); } catch { return null; } }),
      originSource(closure, (u, o) => fetch(u, o)),
      webSource({ iris, gateways, fetchImpl: (u, o) => fetch(u, o) }),
      ipfsPeer({ ipfs }),
      bridgePeer("mesh", askMesh),
    ];
    // persist EVERY healed byte to the durable store → the device becomes a SEED: it survives a corrupt
    // origin, cache eviction, or going fully offline, and can serve the κ to peers. "Can recover" → "will".
    const healer = makeHealer({ sources, store: new Map(), isAnchor, persist: async (hex, b) => { try { await kput("sha256:" + hex, b); } catch {} } });

    // intact(hex) — is there a VERIFIED durable copy on this device? (kverify re-derives it, Law L5.) No
    // origin fetch, no network, no console noise: a healthy object that is already seeded is an instant hit.
    const intact = async (hex) => { try { return (await kverify("sha256:" + hex)) != null; } catch { return false; } };

    const sup = makeSupervisor({
      loadClosure: async () => closure, healer, intact,
      now: () => new Date().toISOString(),
      log: (m, s) => { try { self.__holoHeal = { ...s, at: Date.now() }; } catch {} },
    });
    // a debug/observe affordance: drive one pass on demand — also drives the autonomy spine (page context only).
    self.__holoHealTick = () => sup.tick("manual").then((r) => { try { (typeof window !== "undefined" && window.HoloSpine)?.runOnce(r); } catch (e) {} return r; });
    // ACCESS + IMPORT ANY OBJECT on the open-internet hypergraph, self-verifying. Agents and humans call
    // __holoImport(κ | https-URL) → { kappa, bytes }: resolve a κ from any edge (web · IPFS · gateways) and
    // re-derive it, OR fetch an arbitrary URL and content-address it so it can join the substrate. Either
    // way the result is self-verifying (kappa === did:holo:sha256:H(bytes)) — the open web as one address space.
    self.__holoImport = (ref) => importObject(ref, { gateways, iris, fetchImpl: (u, o) => fetch(u, o) });

    // FULLY AUTONOMOUS — no user action, no worker dependency, no gate. The first pass and every later
    // pass run on IDLE (requestIdleCallback), so the critical boot path is never blocked, and the loop
    // re-arms itself forever: the OS keeps itself whole on its own.
    //
    // The ONE thing that can pause it is the CONSTITUTION. Healing can never break the law — the sealed
    // anchor (constitution · conscience-gate source · closure root) is excluded, so the loop only ever
    // RESTORES correct content, never alters the law. And it acts only UNDER a verified law: if the
    // conscience gate reports the constitution is broken (sealed() === false), the whole OS is already
    // fail-closed, so the loop holds too and surfaces it — it resumes the moment the law re-verifies.
    const lawOk = () => { try { const c = self.HoloConscience; return !c || typeof c.sealed !== "function" || c.sealed() !== false; } catch { return true; } };
    // Pace the sweep: a background janitor, NOT a hot loop. Re-arm with a MIN gap (then wait for idle), so it
    // never ticks back-to-back on every idle callback. The supervisor's per-κ backoff stops it retrying
    // unreachable objects; this stops it re-sweeping the whole closure constantly.
    const MIN_GAP_MS = 15000;
    const schedule = (fn) => setTimeout(() => (self.requestIdleCallback ? self.requestIdleCallback(fn, { timeout: 60000 }) : fn()), MIN_GAP_MS);
    let _prev = -1;   // last logged open count (unresolved + cooling) — log only when actionable or CHANGED
    const loop = () => (lawOk() ? sup.tick("auto").then((r) => {
        const s = r && r.summary;
        // AUTONOMY SPINE (page only; SW no-ops): publish the fresh heal state, then drive the ONE ambient loop
        // (reflect + drift-heal). Falls back to a direct spine tick if the ambient layer isn't present.
        try { if (typeof window !== "undefined" && s) window.__holoHeal = { ...s, flaky: r.flaky, at: Date.now() }; } catch (e) {}
        try { if (typeof window !== "undefined") { if (window.HoloAmbient) window.HoloAmbient.tick(); else window.HoloSpine?.runOnce(r); } } catch (e) {}
        if (!s) return;
        const open = (s.unresolved || 0) + (s.cooling || 0);
        if (s.healed > 0 || open !== _prev) { try { console.log("[holo-heal]", s); } catch {} _prev = open; }   // quiet in steady state
      }) : Promise.resolve())
      .catch(() => {}).finally(() => schedule(loop));        // re-arm forever, idle-paced — fully autonomous
    schedule(loop);
  } catch (e) { try { console.warn("[holo-heal] boot skipped:", (e && e.message) || e); } catch {} }
})();
