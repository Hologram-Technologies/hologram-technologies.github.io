// holo-fhs-loader.mjs — a Node ESM resolve hook that applies the OS's ONE flat→FHS mapping
// (holo-fhs-map.mjs) to module specifiers, so production modules which speak the flat URL space
// (e.g. holo-launch.mjs's `import "./_shared/holo-admit.mjs"`) resolve in Node exactly as they do
// under the in-browser Service Worker. This is the SAME fhsMap the SW and dev server use (Law L2) —
// no reimplementation, no stub: it lets a witness exercise the real module under its real mapping.
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fhsMap } from "./../os/lib/holo-fhs-map.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");

export async function resolve(specifier, context, next) {
  // Only relative flat-space specifiers that name the shared runtime (or another FHS area) need it.
  const m = String(specifier).match(/(?:^|\/)(_shared\/.+|pkg\/.+)$/);
  if (m) {
    const phys = fhsMap(m[1]);
    if (phys) return next(pathToFileURL(join(OS, phys)).href, context);
  }
  return next(specifier, context);
}
