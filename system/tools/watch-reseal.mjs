#!/usr/bin/env node
// watch-reseal.mjs — keep os/etc/os-closure.json in step with the OS image WHILE you edit it. The
// content-verify Service Worker (holo-fhs-sw.js) re-derives every served byte to its κ and REFUSES a
// mismatch (409, Law L5). So the instant a sealed file (shell.html, login.html, _shared/*, lib/*, …)
// is saved without resealing, the next boot 409s. This watches the OS tree and, on any change, re-runs
// reseal-drift.mjs (debounced) — so seals stay current on every save and you never see a κ mismatch
// during development. It reseals ONLY what actually drifted (reseal-drift's job); a no-op save is free.
//
//   node tools/watch-reseal.mjs        # or: npm run watch-reseal
//
// Leave it running in a terminal alongside the dev server. Ctrl-C to stop.

import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const RESEAL = join(here, "reseal-drift.mjs");

// The reseal WRITES os-closure.json (and seal tools touch boot-manifest.json); ignore those so the
// watcher can't loop on its own output. Also ignore VCS noise and non-served file types.
const IGNORE = /(?:^|[\\/])(?:\.git|node_modules)[\\/]|os-closure\.json$|boot-manifest\.json$/i;
const SERVED = /\.(?:html|js|mjs|css|json|jsonld|svg|png|webp|woff2?)$/i;

let timer = null, running = false, pending = false;

function reseal() {
  if (running) { pending = true; return; }          // a save landed mid-reseal → run once more after
  running = true;
  const t = new Date().toLocaleTimeString();
  const p = spawn(process.execPath, [RESEAL], { cwd: join(here, ".."), stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  p.on("close", () => {
    running = false;
    const names = [...out.matchAll(/↻\s+(\S+)/g)].map((m) => m[1]);
    if (names.length) process.stdout.write(`[${t}] resealed ${names.length}: ${names.join(", ")} ✓\n`);
    if (pending) { pending = false; schedule(); }   // coalesce the saves that arrived during the run
  });
}
function schedule() { clearTimeout(timer); timer = setTimeout(reseal, 250); }   // debounce rapid/atomic saves

try {
  watch(OS, { recursive: true }, (_evt, file) => {
    if (!file || IGNORE.test(file) || !SERVED.test(file)) return;
    schedule();
  });
} catch (e) {
  console.error("watch-reseal: could not watch the OS tree —", e && e.message || e);
  process.exit(1);
}

console.log("watch-reseal: watching the OS image — Law-L5 seals stay in step on every save. Ctrl-C to stop.");
reseal();   // reconcile once at startup, so the very first boot is already sealed
