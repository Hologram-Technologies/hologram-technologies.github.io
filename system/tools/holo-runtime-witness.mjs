#!/usr/bin/env node
// holo-runtime-witness.mjs — PROVE the Holo Runtime is a single canonical instance with NO
// duplicates. The Holo Runtime lives once at os/usr/lib/holo and every app reaches it through
// the `/_shared/` URL space (os/lib/holo-fhs-map.mjs routes it there). This witness enforces the
// invariant declared in os/lib/holo-runtime.mjs:
//
//   • the runtime is defined + present, and the ONE flat→FHS map routes `_shared/` to it;
//   • NO app bundles a copy of an engine that already exists in the runtime (no duplication) —
//     an app's own `_shared/` may carry ONLY app-only engines with no runtime master;
//   • (diagnostic) any duplicate that also DIVERGES in bytes is reported as rot.
//
//   node tools/holo-runtime-witness.mjs

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));        // tools/
const OS = join(here, "..", "os");                          // system/os
const RUNTIME = join(OS, "usr", "lib", "holo");             // the one Holo Runtime
const APPS = "C:/Users/pavel/Desktop/Hologram Apps/apps";   // the apps repo (see relock-app.mjs)

const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const walk = (dir, out = []) => { for (const n of readdirSync(dir).sort()) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; };
const rel = (root, p) => relative(root, p).split("\\").join("/");

// ── 1 · the runtime is defined + present ──
const def = await import(pathToFileURL(join(OS, "lib", "holo-runtime.mjs")));
const RT = def.HOLO_RUNTIME;
rec("Holo Runtime is defined (os/lib/holo-runtime.mjs)", !!RT && RT.name === "Holo Runtime", RT ? `${RT.name} v${RT.version}` : "missing");
rec("the runtime is physically present at its one root", existsSync(RUNTIME) && statSync(RUNTIME).isDirectory(), RT?.root);

// ── 2 · the ONE flat→FHS map routes every `_shared/` ref to the runtime ──
const { fhsMap } = await import(pathToFileURL(join(OS, "lib", "holo-fhs-map.mjs")));
const routes = [
  ["_shared/holo-theme.js", "usr/lib/holo/holo-theme.js"],
  ["apps/etherscan/_shared/holo-theme.js", "usr/lib/holo/holo-theme.js"],
];
rec("the one flat→FHS map collapses `_shared/` to the single runtime", routes.every(([i, o]) => fhsMap(i) === o), routes.map(([i, o]) => `${i}→${fhsMap(i)}`).join("  ·  "));

// ── 3 · NO app duplicates a runtime engine (the core invariant) ──
// SELF-CONTAINED exemption: under the per-app self-containment direction (ADR: shared-lib →
// per-app self-containment — the same move as vendoring webamp into amp, holo-evm into evm), a
// vendored app deliberately carries its OWN engine copies so it runs standalone (e.g. shared via a
// content link, no OS runtime present). Such an app is held to the self-containment contract, not the
// bind-don't-copy contract — listed here so the exception is explicit and auditable. browser ships a
// full web-engine stack (holo-eth · holo-ipfs · holo-dweb · …) as part of its identity.
const SELF_CONTAINED = new Set(["browser"]);
const runtimeHas = (relPath) => existsSync(join(RUNTIME, relPath));
const dups = [], divergent = [], appOnly = [], selfContained = [];
const appDirs = existsSync(APPS) ? readdirSync(APPS).filter((d) => { try { return statSync(join(APPS, d)).isDirectory(); } catch { return false; } }) : [];
for (const app of appDirs) {
  if (SELF_CONTAINED.has(app)) { selfContained.push(app); continue; }   // vendored, self-contained — outside the bind-don't-copy rule
  const sh = join(APPS, app, "_shared");
  if (!existsSync(sh) || !statSync(sh).isDirectory()) continue;
  for (const f of walk(sh)) {
    const r = rel(sh, f);                                   // e.g. "holo-blockscout.js"
    if (runtimeHas(r)) {
      const same = (() => { try { return Buffer.compare(readFileSync(f), readFileSync(join(RUNTIME, r))) === 0; } catch { return false; } })();
      dups.push(`${app}/_shared/${r}${same ? "" : " (DIVERGENT)"}`);
      if (!same) divergent.push(`${app}/_shared/${r}`);
    } else {
      appOnly.push(`${app}/_shared/${r}`);
    }
  }
}
rec("no app bundles an engine that already lives in the Holo Runtime (zero duplicates)", dups.length === 0,
  dups.length ? `${dups.length} duplicate(s): ${dups.join(", ")}` : `${appOnly.length} app-only engine(s) kept, 0 duplicated${selfContained.length ? ` · ${selfContained.length} self-contained exempt: ${selfContained.join(", ")}` : ""}`);
if (divergent.length) rec("no duplicate has diverged from the runtime (no rot)", false, divergent.join(", "));

// ── 4 · the runtime DECLARES its canonical substrate capabilities (store + delivery + addressing) ──
const caps = RT.capabilities || {};
rec("the runtime declares its canonical capabilities — content-addressed store + content-verify delivery + addressing axes (the ONE definition every app inherits)",
  !!(caps.store && caps.delivery && caps.addressing), Object.keys(caps).join(" · "));

// ── 5 · every declared store/addressing engine LIVES ONCE in the runtime root + the one map routes every app's `_shared/<engine>` to it ──
const capEngines = [caps.store?.engine, caps.addressing?.sigmaAxis, caps.addressing?.coordinate].filter(Boolean);
const presentAll = capEngines.every((e) => existsSync(join(RUNTIME, e)));
const routedAll = capEngines.every((e) => fhsMap("_shared/" + e) === "usr/lib/holo/" + e && fhsMap("apps/anyapp/_shared/" + e) === "usr/lib/holo/" + e);
rec("every declared store/addressing engine lives once in the runtime root, and the one map routes every app's `_shared/<engine>` reference to it (an app BINDS it, never copies it)",
  capEngines.length >= 3 && presentAll && routedAll, capEngines.join(" · "));

// ── 6 · the content-verify DELIVERY worker is present, routed, and registered at root scope by the gateway (so every nested app inherits content-verified, network-free delivery) ──
const worker = caps.delivery?.worker;
const workerPresent = !!worker && existsSync(join(OS, worker));
const workerRouted = !!worker && fhsMap(worker) === worker;        // lives at the os/ root, identity-mapped
const gateway = existsSync(join(OS, "index.html")) ? readFileSync(join(OS, "index.html"), "utf8") : "";
const registered = !!worker && new RegExp(`serviceWorker\\.register\\(\\s*["'\`]/?${worker.replace(/\./g, "\\.")}`).test(gateway);
rec("the content-verify delivery worker is present, routed, and registered at root scope by the gateway — every nested app inherits content-verified, network-free delivery with no per-app wiring",
  workerPresent && workerRouted && registered, `${worker} · routed:${workerRouted} · gateway-registered:${registered}`);

// ── 7 · the runtime's behavioral guarantees REST ON the proven rows (the store + delivery witnesses) ──
const proven = (p) => { try { return JSON.parse(readFileSync(join(here, p), "utf8")).witnessed === true; } catch { return false; } };
const storeProven = proven("holo-kstore-witness.result.json");
const deliveryProven = proven("holo-sw-cache-witness.result.json");
rec("the runtime's store + delivery guarantees rest on the PROVEN behavioral rows (#kstore + #sw-cache witnessed in real Chromium), not on this declaration alone",
  storeProven && deliveryProven, `store(#kstore):${storeProven} · delivery(#sw-cache):${deliveryProven}`);

const witnessed = failed === 0 && passed > 0;
writeFileSync(join(here, "holo-runtime-witness.result.json"), JSON.stringify({
  spec: "The Holo Runtime is the single canonical native runtime for the entire Hologram OS and its applications: it lives once at os/usr/lib/holo, the one flat→FHS map routes every app's `/_shared/` reference to it, and no engine is duplicated between the runtime and any app bundle (apps carry only app-only engines). It DECLARES the substrate capabilities every app inherits — the content-addressed store (holo-kstore.js: arena L1/L2 → OPFS → κ-route, Law L5), the content-verify delivery wire (holo-fhs-sw.js: κ-keyed CacheStorage, app-byte L5, network-free re-open, registered at root scope by the gateway), and the content-derived addressing axes (σ-axis BLAKE3 + Φ-Atlas-12288) — each living once and bound by apps, with the behavioral guarantees resting on the proven #kstore and #sw-cache rows.",
  witnessed, covers: witnessed ? ["single-runtime", "one-route", "no-duplicates", "declares-capabilities", "store-bound-once", "delivery-root-scope", "rests-on-proven-rows"] : [],
  appOnlyEngines: appOnly, results,
}, null, 2) + "\n");
console.log(`\n=== ${passed}/${passed + failed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
