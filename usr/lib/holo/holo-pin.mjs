// holo-pin.mjs — O3+O4 of HOLO-SOVEREIGN-OFFLINE: download ONCE, update by κ-DELTA, yours forever.
//
// The automatic pin: after first paint + releaseBoot (the ONLY head acceptor — this module never
// self-adopts a release), walk the SIGNED os-closure tier by tier (core → apps → heavy) and seal every
// κ-object the OS is made of into the device store, each byte re-derived BEFORE it is kept. Idle-
// scheduled, small concurrency — it never competes with the live surface. 100% automatic, zero UI.
//
// RESUMABLE BY CONSTRUCTION: the store keyed by hash IS the ledger — a revisit walks the closure and
// skips everything already present (khas), so an interrupted pin continues, never restarts, and no
// object is ever fetched twice. localStorage["holo.pin.v1"] records only progress metadata + the flip.
//
// THE DELTA IS THE SAME WALK (O4): on a return visit the head is re-read (one small no-store request,
// AFTER first paint); if releaseBoot advanced the pin, the new closure κ names a new enumeration and
// the walk fetches exactly the objects whose κs the device lacks — set-difference by construction.
// ATOMIC FLIP: the previous closure's objects stay untouched until the new set is COMPLETE, then the
// ledger flips {closure, prev} in one write; rollback = the strand's one-flip, still bootable locally.
// GC is RETIRED-SET ONLY: when a flip retires a closure, objects listed by IT and by NEITHER the new
// nor the kept-previous closure are evicted. The store is shared (session vault, forge) — a sweep that
// enumerates keys would eat data that is not ours; we only ever delete what a retired closure named.
//
// TRUST (fail-closed at every hop):
//   release head        must MATCH localStorage["holo.release.pin"] (seq+pub releaseBoot accepted);
//                       a lower seq than the pin → downgrade attempt → refuse + witness.
//   os-closure bytes    must re-derive to payload.closure (sha256) — page-side, always.
//   every object        re-derives on the blake3 axis (+sha256 for origin entries) before kput.
// QUOTA-AWARE: holo-persist owns persist()+estimate(); when headroom is below the floor the pin keeps
// core+apps and defers `heavy`, saying so honestly in the status (the OS guarantee never waits on
// model weights). The only voice is one quiet line through the existing notification channel.

import { makeStoreRung } from "./holo-store-rung.mjs";
import { blake3hex, createBlake3 } from "./holo-blake3.mjs";
import { persistOnce } from "./holo-persist.mjs";
import { kdel } from "./holo-forge/holo-kstore.mjs";

const LEDGER = "holo.pin.v1";
const TIERS = ["core", "apps", "heavy"];
const CONCURRENCY = 6;   // mirror-latency-bound; the WORK-based idle pacing (512KB slices) is what protects the live surface, not lane count
const HEAVY_FLOOR = 96 * 1024 * 1024;   // headroom needed before heavy joins the pin

const sha256hex = async (u8) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", u8)), (b) => b.toString(16).padStart(2, "0")).join("");
const idle = () => new Promise((r) => (typeof requestIdleCallback === "function" ? requestIdleCallback(() => r(), { timeout: 1000 }) : setTimeout(r, 40)));
const readLedger = () => { try { return JSON.parse(localStorage.getItem(LEDGER)) || null; } catch { return null; } };
const say = (detail) => { try { dispatchEvent(new CustomEvent("holo:pin", { detail })); } catch {} };

// one quiet line through the EXISTING notification surface (window.HoloNotify — the shell inbox;
// .q() is the quiet non-toast lane) — never a new UI, never a throw, console as the honest floor.
function whisper(text) {
  try {
    const n = globalThis.HoloNotify;
    if (n && typeof n.q === "function") { n.q({ title: "Hologram", body: text, sender: "Q" }); return; }
    if (n && typeof n.toast === "function") { n.toast(text); return; }
  } catch {}
  try { console.info("[holo-pin] " + text); } catch {}
}

async function fetchClosure(base, kappa, rung) {
  // content-addressed first (the SW may already serve it from the device store), path as fallback —
  // EITHER WAY the bytes must re-derive to the signed κ before they are believed.
  for (const u of [".holo/sha256/" + kappa, "os-closure.json"]) {
    try {
      const r = await fetch(new URL(u, base), { cache: "no-store" });
      if (!r.ok) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if ((await sha256hex(bytes)) !== kappa) { await rung.witness("closure-mismatch", { via: u, want: kappa }); continue; }
      return bytes;
    } catch {}
  }
  return null;
}

// stream an object, verifying blake3 incrementally (refuse-early); returns bytes or null
async function fetchVerified(url, wantB3, wantSha) {
  let r;
  try { r = await fetch(url, { cache: "no-cache" }); } catch { return null; }
  if (!r.ok || !r.body) return null;
  const h = createBlake3();
  const chunks = []; let n = 0;
  const rd = r.body.getReader();
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    h.update(value); chunks.push(value); n += value.length;
  }
  if (h.hex() !== wantB3) return null;
  const u8 = new Uint8Array(n); let o = 0;
  for (const c of chunks) { u8.set(c, o); o += c.length; }
  if (wantSha && (await sha256hex(u8)) !== wantSha) return null;
  return u8;
}

// §3.5 background integrity sweep — the HOT tier (holo-boot-*/holo-pin caches) serves with zero
// per-read hashing, so this idle pass is where "warm ≠ trusted" is honored: every cached entry that
// the closure names is re-derived; a mismatch is EVICTED + WITNESSED (the next fetch refills it from
// a verified rung). Off the request path entirely; a few dozen small files, sub-second.
async function sweepHotTier(BASE, closure, rung) {
  try {
    const names = (await caches.keys()).filter((k) => k.startsWith("holo-boot-") || k === "holo-pin");
    let checked = 0, evicted = 0;
    for (const name of names) {
      const c = await caches.open(name);
      for (const req of await c.keys()) {
        try {
          const rel = decodeURIComponent(new URL(req.url).pathname).replace(new URL(BASE).pathname, "").replace(/^\//, "").split("?")[0] || "index.html";
          const e = closure.files[rel === "" ? "index.html" : rel];
          if (!e || !e.sha256) continue;                     // not closure-named (release.json etc.) — not this sweep's law
          const hit = await c.match(req);
          if (!hit) continue;
          const u8 = new Uint8Array(await hit.arrayBuffer());
          checked++;
          if ((await sha256hex(u8)) !== e.sha256) { await c.delete(req); evicted++; await rung.witness("hot-tier-poison-evicted", { cache: name, rel, want: e.sha256 }); }
        } catch {}
        if (checked % 12 === 0) await idle();
      }
    }
    if (evicted) say({ phase: "sweep", checked, evicted });
  } catch {}
}

export async function ensurePinned({ base } = {}) {
  const BASE = base ? new URL(String(base), location.href) : new URL("../../../", import.meta.url);
  const rung = makeStoreRung();
  const status = { at: new Date().toISOString() };
  try {
    const persist = await persistOnce();

    // 1 — the head, gated by the pin releaseBoot accepted (this module never adopts heads itself).
    // releaseBoot runs off the critical path too — WAIT for it (bounded) rather than racing it: on a
    // fresh device its pin may land seconds after ours would have skipped.
    const readPin = () => { try { return JSON.parse(localStorage.getItem("holo.release.pin")); } catch { return null; } };
    let pin = readPin();
    for (let t = 0; t < 15 && !(pin && pin.seq != null); t++) { await new Promise((r) => setTimeout(r, 1000)); pin = readPin(); }
    if (!pin || pin.seq == null) {
      // releaseBoot's auto-run waits on serviceWorker.ready — if a worker install hiccuped it never
      // fires. Invoke the SAME module directly (acceptHead stays the one and only acceptor; this is
      // extending the trust gate, never forking it). Fail-soft: refused → the pin skips honestly.
      try {
        const bootUrl = new URL("apps/holo-messenger/holo-release-boot.mjs", BASE).href;
        const m = await import(/* @vite-ignore */ bootUrl);
        const r = await m.releaseBoot({ fetchFn: fetch.bind(globalThis), storage: localStorage, baseUrl: bootUrl });
        if (r && r.ok) pin = readPin();
      } catch {}
    }
    if (!pin || pin.seq == null) return { ...status, skipped: "no-release-pin (releaseBoot has not accepted a head here)" };
    let head = null, seq = null, pub = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      head = null;
      try { const r = await fetch(new URL("release.json", BASE), { cache: "no-store" }); if (r.ok) head = await r.json(); } catch {}
      if (!head) return { ...status, skipped: "release.json unreachable (offline return visit — the pin rests, L4)" };
      seq = head["holstr:seq"]; pub = head["holstr:pub"];
      pin = readPin();
      if (seq < pin.seq) { await rung.witness("release-downgrade-refused", { got: seq, pinned: pin.seq }); return { ...status, refused: "downgrade" }; }
      if (seq === pin.seq && pub === pin.pub) break;
      if (attempt === 3) return { ...status, skipped: `head seq ${seq} ≠ accepted pin ${pin.seq} — releaseBoot has not verified it (refused or still working); the pin never runs ahead` };
      await new Promise((r) => setTimeout(r, 5000));        // a fresh head: give releaseBoot time to verify+repin
    }
    const closureKappa = (head["holstr:payload"] || {}).closure;
    if (!closureKappa) return { ...status, skipped: "release carries no closure (pre-O1 head)" };

    // 2 — already pinned to this exact closure? AUDIT + HEAL instead of blind trust: the browser may
    // have quota-evicted store objects since the flip (khas is cheap), and the HOT tier (CacheStorage)
    // may hold a poisoned entry (§3.5: the boot path is pure cache.match, so verification lives HERE,
    // off the request path — the background integrity sweep). Anything missing → fall through to the
    // walk (refills exactly the holes); anything tampered → evicted + witnessed, next fetch refills.
    const ledger = readLedger();
    if (ledger && ledger.closure === closureKappa && ledger.completedAt) {
      const clB = await rung.get("sha256", closureKappa);
      if (clB) {
        const cl = JSON.parse(new TextDecoder().decode(clB));
        let missing = 0;
        for (const e of Object.values(cl.files || {})) { if (e.blake3 && !(await rung.has(e.blake3))) { missing++; if (missing > 3) break; } }
        await sweepHotTier(BASE, cl, rung);
        if (missing === 0) return { ...status, ok: true, already: true, seq };
        say({ phase: "heal", missing });                     // quota eviction detected → the walk below re-pins the holes
      }
    }

    // 3 — the signed enumeration
    const clBytes = await fetchClosure(BASE, closureKappa, rung);
    if (!clBytes) return { ...status, failed: "closure unfetchable/unverifiable" };
    const closure = JSON.parse(new TextDecoder().decode(clBytes));
    await rung.put("sha256", closureKappa, clBytes);          // the closure itself is store-resident (GC needs retired sets)
    try {                                                     // hand the SW its path→κ map (it re-verifies vs the sealed pointer)
      const c = await caches.open("holo-pin");
      await c.put(new Request(new URL("os-closure.json", BASE).href), new Response(clBytes, { headers: { "content-type": "application/json", "x-holo-kappa": "sha256:" + closureKappa } }));
    } catch {}

    // 4 — the walk (core → apps → heavy), resumable, verified, idle-paced
    const entries = Object.entries(closure.files || {});
    const byTier = Object.fromEntries(TIERS.map((t) => [t, entries.filter(([, e]) => e.tier === t)]));
    const heavyBytes = byTier.heavy.reduce((s, [, e]) => s + (e.bytes || 0), 0);
    const deferHeavy = persist.headroom < heavyBytes + HEAVY_FLOOR;
    const counts = { fetched: 0, present: 0, failed: 0, tooLarge: 0, deferredHeavy: deferHeavy ? byTier.heavy.length : 0 };
    const failedPaths = [];
    for (const tier of TIERS) {
      if (tier === "heavy" && deferHeavy) { say({ phase: "heavy-deferred", headroom: persist.headroom }); continue; }
      const work = byTier[tier];
      let i = 0;
      await Promise.all(Array.from({ length: CONCURRENCY }, async (_, lane) => {
        let sliceWork = 0;
        while (i < work.length) {
          const [path, e] = work[i++];
          try {
            if (!e.blake3) { counts.failed++; continue; }
            if (await rung.has(e.blake3)) { counts.present++; continue; }
            const url = e.source === "hf" ? closure.mirror + e.blake3 : new URL(path, BASE).href;
            // transient mirror hiccups (rate limits at pin scale) must not poison the flip: retry with
            // backoff; only bytes that STILL refuse after that are counted failed + witnessed.
            let u8 = null;
            for (let a = 0; a < 3 && !u8; a++) {
              if (a) await new Promise((r) => setTimeout(r, 2000 * 4 ** (a - 1)));
              u8 = await fetchVerified(url, e.blake3, e.source === "origin" ? e.sha256 : null);
            }
            if (!u8) { counts.failed++; failedPaths.push(path); await rung.witness("pin-object-refused", { path, want: e.blake3 }); continue; }
            if (!(await rung.put("blake3", e.blake3, u8, { otherHex: e.sha256 || null }))) { counts.tooLarge++; continue; }   // over the store cap — deferred honestly, never blocks the flip
            counts.fetched++;
            sliceWork += u8.length;
            if ((counts.fetched + counts.present) % 25 === 0) say({ phase: "pinning", tier, done: counts.fetched + counts.present, total: entries.length });
          } catch { counts.failed++; failedPaths.push(path); }
          if (sliceWork > 512 * 1024) { sliceWork = 0; await idle(); }   // idle-paced by WORK, not per object — never competes with the live surface
        }
      }));
    }

    // 4.5 — the MERCY TAIL: a mirror rate-limit window can outlast per-object backoff and poison one
    // object in thousands. One calm retry round after the burst has cooled — only what STILL refuses
    // after this is an honest failure (and the resumable walk retries it next visit anyway).
    if (counts.failed > 0 && counts.failed <= 64) {
      say({ phase: "retry-tail", count: counts.failed });
      await new Promise((r) => setTimeout(r, 25000));
      for (const path of [...failedPaths]) {
        const e = closure.files[path];
        if (!e || !e.blake3) continue;
        const url = e.source === "hf" ? closure.mirror + e.blake3 : new URL(path, BASE).href;
        const u8 = await fetchVerified(url, e.blake3, e.source === "origin" ? e.sha256 : null);
        if (u8 && (await rung.put("blake3", e.blake3, u8, { otherHex: e.sha256 || null }))) {
          counts.fetched++; counts.failed--; failedPaths.splice(failedPaths.indexOf(path), 1);
        }
        await idle();
      }
    }

    // 5 — the ATOMIC FLIP + retired-set GC (only what the retired closure named, and nothing shared)
    if (counts.failed === 0) {
      const prevLedger = ledger;
      const flip = { closure: closureKappa, seq, completedAt: new Date().toISOString(), prev: prevLedger?.closure || null, counts, deferredHeavy: deferHeavy };
      const retire = prevLedger?.prev || null;                 // the closure falling off the {current, prev} pair
      localStorage.setItem(LEDGER, JSON.stringify(flip));
      if (retire && retire !== closureKappa && retire !== flip.prev) {
        try {
          const keep = new Set();
          for (const k of [closureKappa, flip.prev]) {
            if (!k) continue;
            const b = await rung.get("sha256", k); if (!b) continue;
            for (const e of Object.values(JSON.parse(new TextDecoder().decode(b)).files || {})) { if (e.blake3) keep.add(e.blake3); if (e.sha256) keep.add(e.sha256); }
          }
          const old = await rung.get("sha256", retire);
          if (old && keep.size) {
            let gc = 0;
            for (const e of Object.values(JSON.parse(new TextDecoder().decode(old)).files || {})) {
              for (const hex of [e.blake3, e.sha256]) if (hex && !keep.has(hex)) { try { await kdel(hex); gc++; } catch {} }
              await idle();
            }
            await kdel(retire);
            say({ phase: "gc", evicted: gc });
          }
        } catch {}
      }
      say({ phase: "complete", ...counts, seq });
      whisper("Hologram is yours offline — " + (counts.fetched + counts.present) + " objects sealed on this device" + (deferHeavy ? " (heavy weights deferred: low storage headroom)" : "") + ".");
      return { ...status, ok: true, seq, ...counts };
    }
    say({ phase: "partial", ...counts, failed: failedPaths.slice(0, 5) });
    return { ...status, partial: true, ...counts, failedPaths: failedPaths.slice(0, 10) };   // resumes next visit, nothing refetched
  } catch (e) {
    return { ...status, error: String(e && e.message || e).slice(0, 120) };                  // fail-soft: the OS never notices
  }
}

export default { ensurePinned };
