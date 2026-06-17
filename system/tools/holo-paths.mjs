// holo-paths.mjs — the ONE canonical, repo-relative resolver for the served app repo and the OS root.
//
// History: witnesses used to hardcode absolute paths to two standalone checkouts
// ("C:/Users/pavel/Desktop/Hologram Apps" + "Hologram OS2"). The repo was consolidated into a single
// tree (HOLOGRAM/holo-os + holo-apps + holo-ai), so those absolutes are now DEAD — a witness that
// scans a missing dir finds 0 apps and passes VACUOUSLY, which silently breaks the "can't regress"
// guarantee. This module resolves both roots from the checkout itself (import.meta.url), so the gate
// is hermetic: it runs honestly from any clone, with no machine-specific paths and no env required.
//
// Layout (this file lives in holo-os/system/tools/):
//   here = .../HOLOGRAM/holo-os/system/tools
//   OS   = ../os                       → .../HOLOGRAM/holo-os/system/os
//   APPS = ../../../holo-apps/apps     → .../HOLOGRAM/holo-apps/apps
//
// Env overrides remain honored (HOLO_APPS_DIR / HOLO_OS_DIR) for CI that lays the repos out elsewhere.

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

// served app repo root (holo-apps) and its apps/ dir
export const APPS_REPO = process.env.HOLO_APPS_REPO || resolve(here, "../../../holo-apps");
export const APPS_DIR = process.env.HOLO_APPS_DIR || join(APPS_REPO, "apps");

// canonical OS root (holo-os/system/os) and the os/etc + os/usr/lib/holo seams
export const OS_DIR = process.env.HOLO_OS_DIR || resolve(here, "../os");
export const OS_ETC = join(OS_DIR, "etc");
export const OS_LIB = join(OS_DIR, "usr/lib/holo");
export const TOOLS_DIR = here;

// honest assertion: a witness that depends on the app corpus should refuse to "pass" on a missing dir.
export function assertAppsDir() {
  if (!existsSync(APPS_DIR)) {
    throw new Error(`holo-paths: APPS_DIR does not exist (${APPS_DIR}) — set HOLO_APPS_DIR or fix the checkout. Refusing to scan a missing corpus (would pass vacuously).`);
  }
  return APPS_DIR;
}
