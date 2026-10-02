// root-sw.js — mount-base rescue worker + VERIFIED κ-delivery + EVICTED-APP rescue (B3.1 + M3). MODULE SW.
//
// Three jobs:
//   · PATH RESCUE — map the flat URL space onto the FHS tree at a /<repo>/ mount (unchanged).
//   · κ-DELIVERY — /.holo/blake3/<hex> streamed through an incremental-BLAKE3 verifier, fail-closed on
//     mismatch (a tampered κ-object is refused, never served). blake3 imported lazily; load hiccup → passthrough.
//   · EVICTED-APP RESCUE (M3) — a file whose BYTES were moved OUT of Q (leanness) still resolves: for an app
//     listed in /evicted.json, a request under apps/<app>/ is served from the κ-MIRROR by its blake3 κ (from
//     apps/<app>/holo-evicted.json), streamed through the SAME verifier (Law L5). So the tree shrinks while
//     every evicted app opens byte-identically, each file proven on arrival. Registration falls back to
//     root-sw-classic.js where module workers are unsupported (no boot regression).
const BASE = new URL("./", self.location.href).pathname.replace(/\/$/, "");
const RESCUE = ["/apps/", "/usr/", "/_shared/", "/vendor/", "/sbin/", "/ui/"];
// boot-sequence directories served CACHE-FIRST from the versioned boot cache (see the fetch tier below)
const BOOT_DIRS = ["/usr/lib/holo/", "/usr/share/plymouth/", "/apps/holo-messenger/", "/_shared/"];
// the DOOR's own closure at the root scope — sealed by app.html into holo-boot-<stamp>; without these the
// offline root navigation paints a door that 404s its own module graph and dead-ends at the floor line.
// W1 (HOLO-INSTANT-RETURN): the seed's fast path (genesis-pack) + the portal entry boot CACHE-FIRST from
// the sealed release-stamped set — their freshness is governed by the seal exactly like the document that
// pins their hashes (a mismatched pack is refused by the seed, fail-closed). A warm boot must never wait
// on a socket for bytes it already holds; before the first seal these are cache misses → network, as today.
const BOOT_FILES = { "/root-door.mjs": 1, "/holo-root-resolver.mjs": 1, "/holo-resolve-view.mjs": 1, "/apps/index.jsonld": 1, "/apps-blake3.json": 1, "/genesis-pack.mjs": 1, "/holo-portal.mjs": 1 };
const ROOT_FILES = { "/holo-resolver.mjs": 1, "/holo-fabric.mjs": 1, "/manifest.webmanifest": 1 };
// MIME + the κ-CAS rung table live in ONE place now: holo-rungs.mjs (G0 — one ladder, rungs are data).

// I0+I1 (HOLO-ONE-KAPPA-IN): pin-at-install + boot-pack ingest — SELF_PIN is defined below (module
// eval completes before the install event fires).
// BYTE-ZERO (S0): install carries NOTHING — selfPin (closure + 2.8MB pack ingest) moved AFTER
// activate→claim, so a cold first visit is CONTROLLED in the time it takes to fetch evicted.json,
// not the pack. The ingest still runs under activate's waitUntil (the worker lives to finish it).
self.addEventListener("install", () => self.skipWaiting());
// THE rescue lives in ONE shared module (holo-evict-rescue.mjs) — root-sw and the messenger's holo-sw
// import the same code: lazy+memoized registry (restart-safe), per-closure cache, mirror fetch through
// the incremental-blake3 verifier, generalized to apps AND arbitrary evicted TREES.
import { makeEvictRescue } from "./usr/lib/holo/holo-evict-rescue.mjs";
// O2 (HOLO-SOVEREIGN-OFFLINE): the device κ-store as a VERIFIED serving rung. STATIC import — dynamic
// import() is disallowed in SWs, and static module-SW imports are cached WITH the registration, so the
// rung exists with the radio dead (the whole point). It ships in the SAME commit as this worker.
// Reads re-derive before serving (warm ≠ trusted); a tampered entry is purged + witnessed by the rung.
// Runtime rung trouble (IDB gone, private mode) → null per call → exactly the pre-O2 network path.
import { makeStoreRung } from "./usr/lib/holo/holo-store-rung.mjs";
// G0 (HOLO-GENESIS-SEED): THE rung ladder — device store → origin b/ → mirror rungs (data), every
// byte re-derived before it ships. STATIC import (SWs disallow dynamic import); ships same-commit.
import { makeLadder, MIME } from "./usr/lib/holo/holo-rungs.mjs";
// K2 (HOLO-SELF-LAWFUL): verify-at-ingest for closure-listed boot paths needs blake3 in-worker.
// STATIC import (SWs disallow dynamic import); holo-rungs itself imports this same module, so it is
// guaranteed present in the same tree — no new ship surface.
import { createBlake3 } from "./usr/lib/holo/holo-blake3.mjs";
// I0+I1 (HOLO-ONE-KAPPA-IN): ONE self-pin implementation shared with holo-sw (Law L4); ships same-commit.
import { makeSelfPin } from "./usr/lib/holo/holo-self-pin.mjs";
let _rung = null;
const rung = async () => { try { return (_rung ||= makeStoreRung()); } catch { return null; } };
const LADDER = makeLadder({ base: BASE, rung });
const RESCUER = makeEvictRescue({ base: BASE, rung });
const SELF_PIN = makeSelfPin({ base: BASE, ladder: LADDER, rung, closure: () => pinnedClosure(), onFresh: () => { _cl = null; _clP = null; } });

// ── PRISM (HOLO-PLAYGROUND-LIVE L1): the operator's personal refraction, NAME-keyed. The sealed
// base is NEVER mutated: an edit mints κ-atoms into the device store and the prism maps a PATH →
// the edited document's attribute-tree ROOT κ (holo-dag-io materializes it, every atom re-derived —
// L5 at the atom). Read from OPFS (holo-prism/prism.json, written by the page's token door);
// preloaded at activate and reloaded on the page's "holo-prism-updated" message so the fetch hot
// path is ONE sync Map lookup. Any damage folds to EMPTY → the base experience, never a broken one.
import { materialize as prismMaterialize } from "./usr/lib/holo/holo-dag-io.mjs";
let _pnames = null;   // Map (loaded) | null (loading/not yet) | false (none)
function loadPrismNames() {
  _pnames = null;
  (async () => {
    try {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("holo-prism");
      const j = JSON.parse(await (await (await dir.getFileHandle("prism.json")).getFile()).text());
      const m = new Map();
      if (j && j.v === 1 && j.names && typeof j.names === "object")
        for (const [n, r] of Object.entries(j.names))
          if (n && /^[0-9a-f]{64}$/.test(String(r))) m.set(String(n).replace(/^\/+/, "").split("?")[0], r);
      _pnames = m.size ? m : false;
    } catch { _pnames = false; }
  })();
}
self.addEventListener("message", (ev) => { if (ev.data && ev.data.type === "holo-prism-updated") { loadPrismNames(); try { caches.delete("holo-prism-derived"); } catch {} } });

self.addEventListener("activate", (e) => e.waitUntil(RESCUER.registry().then(() => { loadPrismNames(); return self.clients.claim(); }).then(() => { try { return SELF_PIN.selfPin(); } catch {} })));

// ── O3: the PINNED CLOSURE as the SW's offline path→κ map ──────────────────────────────────────────────
// holo-pin.mjs verifies os-closure.json against the SIGNED head and hands it to this worker through the
// "holo-pin" cache. Before trusting it we re-derive its sha256 against payload.closure from the sealed
// release pointer (network-first tier keeps that honest; offline, the sealed copy answers). Memoized per
// worker life; a restarted worker re-loads once. No pin yet → null → today's behavior exactly.
let _cl = null, _clP = null, _clAt = 0;
let _relSlowAt = 0;   // W1: release.json collar slow-memo (see the release tier below)
// P2 (HOLO-PAINTED-TRUTH): network-first under a COLLAR — the socket keeps priority, the pinned closure
// answers when it hangs, and no fetch event stays open unboundedly when an alternative exists (a pinned
// WAITING worker was observed live: activation waits on in-flight respondWith promises).
function collaredNet(netThunk, altThunk, ms) {
  return (async () => {
    const net = netThunk().catch(() => null);
    const fast = await Promise.race([net, new Promise((r) => setTimeout(() => r("slow"), ms || 1600))]);
    if (fast && fast !== "slow") return fast;
    try { const alt = await altThunk(); if (alt) return alt; } catch {}
    return (await net) || Response.error();
  })();
}
function pinnedClosure() {
  // K2: ABSENCE is retried (holo-pin mints the pin AFTER the first fetch events — memoizing "no pin
  // yet" for the worker's whole life would keep the first session unlawful); a verified MISMATCH or a
  // parsed closure stays memoized as before.
  if (_cl === false && _clAt && Date.now() - _clAt > 5000) { _cl = null; _clP = null; }
  if (_cl !== null) return Promise.resolve(_cl);
  return (_clP ||= (async () => {
    try {
      const c = await caches.open("holo-pin");
      const hit = await c.match(BASE + "/os-closure.json");
      if (!hit) { _clAt = Date.now(); _clP = null; return (_cl = false); }
      _clAt = 0;
      const bytes = new Uint8Array(await hit.arrayBuffer());
      let want = null;
      try { const rr = await caches.match(BASE + "/release.json", { ignoreSearch: true }); if (rr) want = (JSON.parse(await rr.clone().text())["holstr:payload"] || {}).closure; } catch {}
      if (want) {
        const d = await crypto.subtle.digest("SHA-256", bytes);
        const hex = Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
        if (hex !== want) { const R = await rung(); R && R.witness("pin-closure-mismatch", { want, got: hex }); return (_cl = false); }
      }
      return (_cl = JSON.parse(new TextDecoder().decode(bytes)));
    } catch { return (_cl = false); }
  })());
}
// serve a mount path from the pinned closure. null = not ours / not resolvable.
// K2 (HOLO-SELF-LAWFUL): resolves through THE ladder (device store → origin b/ → mirrors) instead of
// the bare store rung — offline the network rungs simply fail and the store answers exactly as before;
// online a pinned-but-unstored body heals from origin b/ (κ-addressed, verified), and the ladder's
// put-back makes the next boot local. One ladder for every resolve (Law L4).
async function pathFallback(p) {
  try {
    const cl = await pinnedClosure();
    if (!cl || !cl.files) return null;
    let rel = decodeURIComponent(p.slice(BASE.length)).replace(/^\//, "").split("?")[0];
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    let e = cl.files[rel];
    if (!e && !/\.[a-z0-9]{2,8}$/i.test(rel)) e = cl.files[rel + "/index.html"] || cl.files[rel + ".html"];
    if (!e || !e.blake3) return null;
    const r = await LADDER.resolve("blake3", e.blake3, { ext: (rel.split(".").pop() || "").toLowerCase() });
    return r && r.ok ? r : null;
  } catch { return null; }
}
// K2 hot-path helpers — SYNC and opportunistic: the closure κ of a boot path when the pin is already
// in memory (first call kicks the load and returns null — the hot path NEVER waits on lawfulness).
function closureKappaSync(p) {
  if (!_cl) { pinnedClosure(); return null; }   // null OR retriable-absent: kick the load, never wait
  if (!_cl.files) return null;
  try {
    const e = _cl.files[decodeURIComponent(p.slice(BASE.length)).replace(/^\//, "").split("?")[0]];
    return e && e.blake3 ? e.blake3 : null;
  } catch { return null; }
}
// stamp a 200 with its governing κ (x-holo-kappa) — an honesty label, not a serving mechanism: the
// boot cache's consistency is governed by the signed release pointer, the closure by the signed head.
function stamp(resp, kx, src) {
  if (!kx || !resp || resp.status !== 200 || resp.headers.get("x-holo-kappa")) return resp;
  try {
    const h = new Headers(resp.headers);
    h.set("x-holo-kappa", "blake3:" + kx);
    if (src && !h.get("x-holo-source")) h.set("x-holo-source", src);
    return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
  } catch { return resp; }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url; try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;

  // κ-route: serve an object BY ITS CONTENT ADDRESS — ONE call into the ladder (G0). Device store
  // first, then origin b/, then the mirror rungs; every rung fail-closed verified, a poisoned rung's
  // bytes refused and the next rung tried. Network throws (radio dead) must answer 504, never reject
  // the respondWith (offline honesty).
  const kap = p.match(/\/\.holo\/(sha256|blake3)\/([0-9a-f]{64})(?:\.([a-z0-9]+))?$/i);
  if (kap) {
    e.respondWith((async () => {
      try {
        const r = await LADDER.resolve(kap[1].toLowerCase(), kap[2].toLowerCase(), { ext: (kap[3] || "").toLowerCase() });
        return r || new Response("unresolvable offline — not in the device store (O2)", { status: 504 });
      } catch { return new Response("unresolvable offline — not in the device store (O2)", { status: 504 }); }
    })());
    return;
  }

  // ── HOLO-Q-LIVE-VOICE V1: serve the Q voice/CALL surface crossOriginIsolated (COOP + COEP) so Kokoro +
  // Whisper get wasm threads (SharedArrayBuffer → threaded onnxruntime). SCOPED to the q-chat page nav ONLY
  // — the desktop and its cross-origin media embeds (youtube/drive/producthunt) are untouched, nothing else
  // regresses. COEP=credentialless (NOT require-corp) keeps every cross-origin weight rung resolving.
  // MUST run BEFORE the evicted rescue below: q-chat.html is an EVICTED-PIN file, so the rescuer would
  // otherwise serve it (device-store / κ-mirror) and return before any header injection could happen — the
  // header-less response is exactly why the first cut of this shipped isolated-false. Resolve q-chat through
  // the SAME tiers the rescuer/cache/network would, then add the isolation headers to whatever comes back.
  if (req.mode === "navigate" && /\/apps\/q\/q-chat\.html$/.test(p)) {
    e.respondWith((async () => {
      let resp = null;
      try { const cand = RESCUER.matchSync(p); if (cand) resp = await RESCUER.rescue(req, cand); } catch {}
      if (!resp || !(resp.ok || resp.status === 200)) {
        try { const c = await caches.match(req, { ignoreSearch: true }); if (c) resp = c; else { const bn = (await caches.keys()).find((k) => k.indexOf("holo-boot-") === 0); if (bn) { const h2 = await (await caches.open(bn)).match(req, { ignoreSearch: true }); if (h2) resp = h2; } } } catch {}
      }
      if (!resp) { try { resp = await fetch(req); } catch { resp = (await pathFallback(p)) || Response.error(); } }
      try {
        const h = new Headers(resp.headers);
        h.set("Cross-Origin-Opener-Policy", "same-origin");
        h.set("Cross-Origin-Embedder-Policy", "credentialless");
        return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
      } catch { return resp; }
    })());
    return;
  }

  // evicted rescue (apps + trees): bytes on the kappa-mirror still resolve, verified (M3/U1).
  // O3: with the radio dead the rescue's network fallbacks reject — the pinned closure answers instead.
  {
    const cand = RESCUER.matchSync(p);
    if (cand) { e.respondWith(RESCUER.rescue(req, cand).catch(async () => (await pathFallback(p)) || Response.error())); return; }
  }

  // ── PRISM refraction (before the sealed boot cache, which would otherwise answer with the BASE
  // bytes). Names refract; κ-routes above never do. Sync Map guard — zero cost when no prism. The
  // derived doc caches under a synthetic key including the ROOT κ (a new edit = a new key; the
  // message handler also drops the whole derived cache). ANY failure → fetch(req) → base experience.
  if (_pnames && _pnames.size) {
    const relp = decodeURIComponent(p.startsWith(BASE + "/") ? p.slice(BASE.length + 1) : p.replace(/^\/+/, "")).split("?")[0];
    const prk = req.headers.get("x-holo-base") ? null : _pnames.get(relp);   // the token door's base-css fetch bypasses refraction
    if (prk) {
      e.respondWith((async () => {
        try {
          const c = await caches.open("holo-prism-derived");
          const key = BASE + "/.holo/prism/" + prk;
          const hit = await c.match(key);
          if (hit) return hit;
          const R = await rung();
          if (!R) return fetch(req);
          const text = await prismMaterialize({ getByKey: (a, h) => R.get(a, h) }, prk);   // throws on missing/tampered atom
          const ext = (relp.split(".").pop() || "").toLowerCase();
          const resp = new Response(text, { status: 200, headers: { "content-type": MIME[ext] || "text/plain", "x-holo-prism": prk, "x-holo-prism-mode": "dag" } });
          try { await c.put(key, resp.clone()); } catch {}
          return resp;
        } catch { return fetch(req); }
      })());
      return;
    }
  }

  // ── INSTANT RETURN + OFFLINE BOOT — the root-scope shell cache (M1's contract at "/") ──────────────
  // The login document at the mount root is controlled by THIS worker (holo-sw's scope cannot reach it).
  // app.html seals the whole boot sequence — the document itself, the login-chain modules, frames.pack,
  // the wallpaper — into a versioned "holo-boot-<release-stamp>" cache after first paint; here every
  // navigation and every request under the boot directories is answered CACHE-FIRST from Cache Storage.
  // A returning operator boots with ZERO network; fully offline, the same sealed bytes answer — document
  // included (ignoreSearch lets ?guest=1 land on the sealed page). A miss falls through to the network
  // untouched, so before the first seal this tier is invisible. Freshness is the PAGE's job: a new signed
  // release pointer mints a new cache name and purges the old — the worker never guesses.
  // release.json is the UPDATE FEED — network-FIRST so a new signed head is never masked by a stale
  // cache; only when the network is actually gone does the sealed copy answer (the door then still
  // resolves the messenger by its signed κ with the radio dead).
  // W1 (HOLO-INSTANT-RETURN): a 1.2s COLLAR on the network-first — a fresh signed head still wins whenever
  // the network answers promptly (GH Pages ~100-300ms), but a hung first socket (WPAD, dead keep-alive,
  // captive portal) may not hold the returning boot hostage when a sealed copy exists. Measured live: the
  // warm paint sat 10-13.7s on exactly this fetch. Slow with NO sealed copy awaits the network as before;
  // the page's own head-poll + reseal pick up a newer release on the next healthy fetch.
  if (p === BASE + "/release.json") {
    e.respondWith((async () => {
      // slow-memo: the boot reads the release 3× (seed ×2 + portal) — once the network has PROVEN hung,
      // the next reads inside the same 8s window serve the sealed copy immediately instead of re-paying
      // the collar; the background fetch clears the memo the moment the network heals.
      const net = fetch(req).catch(() => null);
      net.then((r) => { if (r) _relSlowAt = 0; });
      if (_relSlowAt && Date.now() - _relSlowAt < 8000) {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
      }
      const fast = await Promise.race([net, new Promise((r) => setTimeout(() => r("slow"), 1200))]);
      if (fast && fast !== "slow") return fast;
      _relSlowAt = Date.now();
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      return (await net) || Response.error();
    })());
    return;
  }

  if (req.mode === "navigate" || BOOT_FILES[p.slice(BASE.length)] || BOOT_DIRS.some((d) => p.startsWith(BASE + d))) {
    e.respondWith((async () => {
      // K2 (HOLO-SELF-LAWFUL): navigations are untouched; for boot MODULES the sealed path is a NAME —
      // κ known sync from the pinned closure (never awaited on the hot path).
      const kx = req.mode === "navigate" ? null : closureKappaSync(p);
      try {
        const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
        if (hit) return stamp(hit, kx, "boot-cache");
        // a module cache-buster (?v=markN) must never miss the sealed set: match SEARCH-BLIND inside the
        // release-stamped boot cache only — its consistency is governed by the release pointer, not the query.
        const bn = (await caches.keys()).find((k) => k.indexOf("holo-boot-") === 0);
        if (bn) { const h2 = await (await caches.open(bn)).match(req, { ignoreSearch: true }); if (h2) return stamp(h2, kx, "boot-cache"); }
      } catch {}
      // K2 (SL-6): on a cache miss the device store answers BEFORE the network — a warm boot needs
      // zero network even before the page reseals the boot cache.
      if (kx) {
        try {
          const R = await rung();
          if (R) {
            const u8 = await R.get("blake3", kx);
            if (u8) return new Response(u8, { status: 200, headers: { "content-type": MIME[(p.split(".").pop() || "").toLowerCase()] || "application/octet-stream", "x-holo-source": "device-store", "x-holo-kappa": "blake3:" + kx } });
          }
        } catch {}
      }
      // P2 (HOLO-PAINTED-TRUTH): the boot tier's network refill is collared too — a sealed-set miss on a
      // hung socket (measured live: 6.2s on holo-widgets after an interrupted seal) heals from the pinned
      // closure after 1.6s instead of holding the boot; no alternative → the network keeps priority.
      const netP = fetch(req);
      {
        const fast = await Promise.race([netP.catch(() => null), new Promise((r) => setTimeout(() => r("slow"), 1600))]);
        if (fast === "slow" || fast === null) {
          const healed = await pathFallback(p);
          if (healed) { netP.catch(() => {}); return healed; }
        }
      }
      try {
        const resp = await netP;
        // K2 verify-at-ingest (L5 at the trust boundary — ADR-019): a closure-listed body from the
        // network re-derives against its pinned κ; verified bytes enter the device store, so the NEXT
        // boot is lawful and local. A mismatch is witnessed and the sealed κ wins via the ladder; if
        // no rung holds it, the network bytes still serve (availability preserved — breach on record).
        if (kx && resp && resp.ok && Number(resp.headers.get("content-length") || 0) <= 8 * 1024 * 1024) {
          try {
            const u8 = new Uint8Array(await resp.clone().arrayBuffer());
            if (u8.length <= 8 * 1024 * 1024) {
              const h = createBlake3(); h.update(u8);
              if (h.hex() === kx) {
                const R = await rung(); if (R) { try { R.put("blake3", kx, u8); } catch {} }
                return stamp(resp, kx, "origin-path-verified");
              }
              const R = await rung(); R && R.witness && R.witness("lawful-ingest-mismatch", { path: p, want: kx });
              const healed = await pathFallback(p);
              if (healed) return healed;
            }
          } catch {}
        }
        return resp;
      } catch {
        // O3/O5: network gone AND not sealed → the pinned closure serves the path from the device store
        // (this is what makes a cold offline deeplink into ANY pinned app entry paint, not 404).
        return (await pathFallback(p)) || Response.error();
      }
    })());
    return;
  }

  // ── O3 OFFLINE TOTALITY — every other same-origin GET under the mount: network first (byte-identical
  // to today online; fetch(req) resolving — even a 404 — passes straight through), and ONLY a network
  // REJECTION (radio dead) falls to the pinned closure → device store, verified. Prefix check only —
  // no manifest lookup on the hot path (§3.5).
  if (p.startsWith(BASE + "/")) {
    // P2 (HOLO-PAINTED-TRUTH): byte-identical online semantics (network answers — even a 404 — pass
    // through), but a HUNG socket is answered by the pinned closure after the collar instead of holding
    // the request (and the worker's activation) hostage.
    e.respondWith(collaredNet(() => fetch(req), () => pathFallback(p)));
    return;
  }

  if (!BASE) return;   // at a root mount — untouched
  // ROOT-RESCUE: a CANONICAL absolute path ("/apps/…", "/usr/…") emitted by runtime code resolves against
  // the document — on the /Q mount it escapes the bundle, so remap it onto BASE. O5: this was network-ONLY
  // (fetch(BASE+p)); offline it rejected and the asset (a wallpaper, a login module addressed absolutely)
  // died even though the pin holds it. Now the remapped path falls back to the pinned closure → store.
  if (ROOT_FILES[p] || RESCUE.some((d) => p.startsWith(d)) || p.startsWith("/_vendor/")) {
    // /_vendor/ exists ONLY under the messenger app — a shell asset addressed relative to a root-based
    // document lands here; remap it to its real home so the ROOT base does not 404 (still one messenger).
    const rp = BASE + (p.startsWith("/_vendor/") ? "/apps/holo-messenger" : "") + p;
    // P2 (HOLO-PAINTED-TRUTH): same collar as the catch-all — remapped canonical paths served many
    // pre-paint modules at 6-7s each on a hung socket (measured live); the pin answers after 1.6s.
    // On a network MISS the evicted rescue (tree maps → κ-mirror, every byte re-derived) answers
    // before the 404 escapes — an evicted file addressed root-absolutely is still content (L1).
    const net = () => fetch(rp + url.search).then((r) => {
      if (r && (r.ok || r.status !== 404)) return r;
      try { const cand = RESCUER.matchSync(rp);
        if (cand) return RESCUER.rescue(new Request(rp + url.search), cand).then((x) => (x && x.ok ? x : r)).catch(() => r); } catch {}
      return r;
    });
    e.respondWith(collaredNet(net, () => pathFallback(rp)));
  }
});
const SW_GRAPH = "fc5601f68f461c20"; // module-graph identity — auto-stamped each seal (sw-graph-stamp.mjs) so a worker whose imports changed byte-changes too and stale/wedged registrations self-replace
