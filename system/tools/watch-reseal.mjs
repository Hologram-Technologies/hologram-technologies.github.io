#!/usr/bin/env node
// watch-reseal.mjs — keep the WHOLE OS image sealed while you edit it. The content-verify Service Worker
// (holo-fhs-sw.js) re-derives every served byte to its κ and REFUSES a mismatch (409, Law L5). So the
// instant a sealed file (shell.html, login.html, _shared/*, lib/*, …) is saved without resealing, the
// next boot 409s. This watches the OS tree and, when you PAUSE, runs the FULL canonical reseal —
//   reseal-drift (boot closure) → holo-anchor-sw (SW anchor) → seal-served (whole-tree os-served) —
// so all THREE seals stay in step, not just the boot closure. (The old watcher ran only reseal-drift,
// leaving the SW anchor and os-served.json silently stale — the exact drift that can ship a Safety-Stop.)
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
const SYSTEM = join(here, "..");
const RESEAL = join(here, "reseal.mjs");          // FULL reseal: boot closure → SW anchor → served tree

// Ignore the reseal's OWN outputs so the watcher can't loop on its writes, plus VCS noise and non-served
// types. The full reseal writes os-closure.json + boot-manifest.json (drift), holo-fhs-sw.js (the anchor)
// and os-served.json (served tree) — all ignored here. Trade-off: a DIRECT edit to the SW source won't
// auto-trigger; run `npm run reseal` once (the pre-push hook also catches it before main).
const IGNORE = /(?:^|[\\/])(?:\.git|node_modules)[\\/]|(?:os-closure|boot-manifest|os-served)\.json$|holo-fhs-sw\.js$/i;
const SERVED = /\.(?:html|js|mjs|css|json|jsonld|svg|png|webp|woff2?)$/i;
const DEBOUNCE = 800;   // full reseal ≈ 2 s; only run when you pause, so rapid saves coalesce into one

let timer = null, running = false, pending = false;

function reseal() {
  if (running) { pending = true; return; }          // a save landed mid-reseal → run once more after
  running = true;
  const t = new Date().toLocaleTimeString();
  const p = spawn(process.execPath, [RESEAL], { cwd: SYSTEM, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  p.on("close", () => {
    running = false;
    const sealed = /SEALED ✓/.test(out);
    process.stdout.write(sealed
      ? `[${t}] resealed — whole tree in step (boot closure + SW anchor + os-served) ✓\n`
      : `[${t}] reseal ran but tree is STILL OUT OF STEP ✗ — run \`npm run reseal\` and read the output\n`);
    if (pending) { pending = false; schedule(); }   // coalesce the saves that arrived during the run
  });
}
function schedule() { clearTimeout(timer); timer = setTimeout(reseal, DEBOUNCE); }

try {
  watch(OS, { recursive: true }, (_evt, file) => {
    if (!file || IGNORE.test(file) || !SERVED.test(file)) return;
    schedule();
  });
} catch (e) {
  console.error("watch-reseal: could not watch the OS tree —", e && e.message || e);
  process.exit(1);
}

console.log("watch-reseal: watching the OS image — the WHOLE tree (boot closure + SW anchor + os-served) reseals when you pause. Ctrl-C to stop.");
reseal();   // reconcile fully once at startup, so the very first boot is already completely sealed
