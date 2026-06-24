// holo-self-app-witness.mjs — conformance witness for the SELF·Hologram demo app
// (holo-apps/apps/self). Proves it is a SELF-contained, SERVERLESS Holo app:
//   • zero network egress in the app source (offline-first, Law L3)
//   • it ships and imports the REAL primitives (Law L2 — no forked crypto)
//   • the vendored modules are BYTE-IDENTICAL to the canonical ones (Law L5 — re-derivation)
//   • those vendored primitives still pass their own selftests
// Fail-closed (exit nonzero on any miss). Hermetic Node + WebCrypto.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const APP = join(here, "../../../holo-apps/apps/self");
const CANON = join(here, "../os/usr/lib/holo");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

let pass = 0, fail = 0; const rows = [];
const W = (req, claim, ok) => { rows.push({ req, claim, ok: !!ok }); ok ? pass++ : fail++; };

const html = readFileSync(join(APP, "index.html"), "utf8");

// SELF-1 — zero network egress anywhere in the app (the airplane-mode promise is structural, not cosmetic)
W("SELF-1", "no fetch/XHR/WebSocket/beacon/EventSource in the app",
  !/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/.test(html.replace(/window\.fetch\s*=\s*function/g, "")));
W("SELF-1b", "no remote script/style/img src (no CDN, Law L4)",
  !/(src|href)\s*=\s*["']https?:\/\//i.test(html) && !/@import\s+url\(\s*["']?https?:/i.test(html));

// SELF-2 — it imports the REAL primitives (view-only app; no inline crypto module)
for (const m of ["holo-identity.mjs", "holo-credential.mjs", "holo-present.mjs"])
  W("SELF-2", `imports ./${m}`, new RegExp(`from\\s+["']\\./${m.replace(".", "\\.")}["']`).test(html));

// SELF-3 — the vendored modules are byte-identical to the canonical substrate primitives (Law L5/L2)
for (const m of ["holo-identity.mjs", "holo-credential.mjs", "holo-present.mjs"])
  W("SELF-3", `vendored ${m} == canonical (sha256)`, sha(join(APP, m)) === sha(join(CANON, m)));

// SELF-4 — the vendored primitives still verify end-to-end (issue→present→verify, all refusals)
const cred = await import(pathToFileURL(join(APP, "holo-credential.mjs")).href);
const pres = await import(pathToFileURL(join(APP, "holo-present.mjs")).href);
const cs = await cred.selftest(); W("SELF-4", "vendored holo-credential selftest GREEN", cs.ok);
const ps = await pres.selftest(); W("SELF-4b", "vendored holo-present selftest GREEN (human≡agent, refusals)", ps.ok);

// SELF-5 — the app actually wires the verify path (not a mock): references the shipped verify functions
W("SELF-5", "calls verifyCredential + verifyPresentation", /verifyCredential\s*\(/.test(html) && /verifyPresentation\s*\(/.test(html));

for (const r of rows) console.log(`${r.ok ? "✓" : "✗"} ${r.req}  ${r.claim}`);
console.log(`\nholo-self-app witness: ${pass}/${pass + fail} GREEN`);
process.exit(fail ? 1 : 0);
