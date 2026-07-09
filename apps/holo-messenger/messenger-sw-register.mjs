// messenger-sw-register.mjs — eagerly register the ONE messenger service worker (holo-sw.js: Reach push +
// M1 shell cache) on boot, so repeat opens are network-free even before push permission is granted. Additive
// + catch-guarded so it can never block boot. Escape hatch: open with ?nosw=1 to unregister it.
//
// holo-sw.js is ALSO registered by the Reach push flow (holo-push.mjs) — same script, same {type:module}, same
// dir scope, so the two calls collapse to one registration (idempotent). We register here too because caching
// must not wait on push. We also retire any stale competing worker (the old messenger-sw.js) at this scope.

(async () => {
  if (!("serviceWorker" in navigator)) return;
  try {
    const u = new URL(location.href);
    // DEV ITERATION: on the dev-serve port (8472) OR with ?nosw=1, never let a worker cache the shell — it makes
    // edits appear "still old" until a hard-refresh. Unregister any worker at this scope AND drop its caches so the
    // next plain reload is always the live build. The M1 shell-cache stays intact on every other origin/port
    // (guest :8493, host, holo://), so `holo m1-verify` and production instant-boot are unaffected.
    const devIterate = location.port === "8472" || location.port === "8474" || u.searchParams.get("nosw") === "1";
    if (devIterate) {
      for (const r of await navigator.serviceWorker.getRegistrations()) {
        if ((r.scope || "").includes("/apps/holo-messenger/")) await r.unregister();
      }
      try { if (window.caches) for (const k of await caches.keys()) if (k.startsWith("holo-msgr-")) await caches.delete(k); } catch {}
      console.log("[msgr-sw] dev/nosw — worker unregistered + shell caches cleared, serving live");
      return;
    }
    // retire the old competing cache-worker if a previous build left it controlling this scope.
    try {
      for (const r of await navigator.serviceWorker.getRegistrations()) {
        const s = (r.active && r.active.scriptURL) || (r.installing && r.installing.scriptURL) || (r.waiting && r.waiting.scriptURL) || "";
        if (s.includes("/messenger-sw.js")) { await r.unregister(); console.log("[msgr-sw] retired stale messenger-sw.js"); }
      }
    } catch {}
    // Module-relative registration: resolves to /apps/holo-messenger/ at the OS root and to <base>/apps/holo-messenger/
    // on a mounted static host (e.g. GitHub Pages /<repo>/) — one registrar, every mount point.
    await navigator.serviceWorker.register(new URL("./holo-sw.js", import.meta.url), { type: "module", scope: new URL("./", import.meta.url).pathname });
    console.log("[msgr-sw] one worker active (push + shell cache) — repeat opens serve the shell network-free");
    // S3: verify the SIGNED release pointer off the critical path — the standing trust bar for the worker
    // (what an #m1 link used to grant, now on every open). Fail-soft here; fail-closed inside the module.
    try { await import("./holo-release-boot.mjs"); } catch {}
  } catch (e) { /* never block boot */ }
})();
