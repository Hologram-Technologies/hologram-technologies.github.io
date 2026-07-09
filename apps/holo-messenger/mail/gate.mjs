// gate.mjs - Holo Mail engine gate. Runs every mail module's Node gate (mock brain + real holo-strand,
// zero network). Green here = the brain is sound; the live surface is proven separately via preview_*.
//   run:  node gate.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const suites = [
  "holo-mail-ai",         // Seam A - structured output over Q
  "holo-mail-provider",   // Seam B - email-bridge adapter
  "holo-mail-summary",    // M2/1 - auto-summarize
  "holo-mail-replyzero",  // M2/2 - needs-reply lanes
  "holo-mail-categorize", // M2/3 - smart labels / split inbox
  "holo-mail-cold",       // M2/4 - cold-email blocker
  "holo-mail-draft",      // M2/5 - instant reply in the operator's voice
  "holo-mail-engine",     // composition root - binds all modules to real provider/strand/Q, graceful
  "holo-mail-onboard",    // M4 - provider detect + onboarding state machine + specific errors
  "holo-mail-health",     // M4/F - reconnect + health self-heal
  "holo-mail-multi",      // M4/E - unified multi-account inbox
];

let failed = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [join(HERE, `${s}.gate.mjs`)], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log(`\n${failed ? "✗" : "✓"} holo-mail gate: ${suites.length - failed}/${suites.length} suites passed`);
process.exit(failed ? 1 : 0);
