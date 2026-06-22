// holo-q-create-fullstack-witness.mjs — proof of the shell-facing entry: a Create build (the coder's HTML) is
// wrapped into a sealed, conformant holo-app addressed by one manifest κ — beautiful (conscience-enforced),
// opens + verifies anywhere (SEC-1/L5), and is shared by its κ. Pure Node. Run: node …-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const { sealBuiltApp, openApp } = await imp("../os/usr/lib/holo/q/holo-q-create-fullstack.mjs");
const { audit } = await imp("../os/usr/lib/holo/q/holo-q-design-conscience.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// the kind of HTML the shell coder emits (with a raw color, to show the conscience fix it).
const BUILT = '<!doctype html><html><body><main><h1 style="color:#ffffff">Pricing</h1><div class="card">Pro $9</div></main></body></html>';

console.log("\nholo-q create→fullstack — every Create build becomes a sealed, shareable holo-app κ\n");

const app = sealBuiltApp(BUILT, { name: "Pricing Page" });

ok(/^[0-9a-f]{64}$/.test(app.manifestK) && app.kid.startsWith("did:holo:sha256:"), "the build is sealed to a manifest κ (the app identity)");
ok(app.share === "holo://sha256/" + app.manifestK, "it has a share link = its κ");
ok(audit(app.compiled.projectionHtml).clean && !/#ffffff/.test(app.compiled.projectionHtml), "the projection is conscience-enforced (raw #ffffff → token; on-brand)");
{
  const opened = openApp(app.manifestK, app.sealed.store);
  ok(opened.manifest.name === "Pricing Page" && opened.projectionHtml.includes("Pricing"), "opening the κ resolves the verified app (any browser, serverless)");
}
ok(Array.isArray(app.api.routes) && app.api.routes.length === 0, "a UI-only build has no data routes (capability-scoped: nothing it didn't declare)");
ok(sealBuiltApp(BUILT, { name: "Pricing Page" }).manifestK === app.manifestK, "deterministic: same build → same app κ");

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
