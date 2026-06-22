// holo-stepup-gate-witness.mjs — the SINGLE step-up enforcement seam (os/usr/lib/holo/holo-stepup-gate.mjs).
// Proves the orchestration every sensitive surface routes through: classify (needsStepUp) → require a
// payload-bound biometric → VERIFY the returned consent artifact host-side → open the trust window →
// FAIL-CLOSED on any throw → REJECT a tampered token → REJECT an app-forged request whose operator is not
// the host operator (the bridge is unforgeable from a frame). Deps are injected (a mock `require` mints a
// real, verifiable token via the witnessed holo-stepup primitive), so the seam logic is proven under Node
// without a TEE; the physical biometric ceremony is device-proven (hologram-auth-vault-rewrap-plan.md tier).
// Fail-closed: nonzero exit on any miss (gate.mjs LIVE_EXIT).

import { selftest } from "../os/usr/lib/holo/holo-stepup-gate.mjs";

const r = await selftest();
const rows = Object.entries(r).filter(([k]) => k !== "ok");
console.log("\nholo-stepup-gate (enforcement seam):");
for (const [k, v] of rows) console.log(`  [${v ? "✓" : "✗"}] ${k}`);
console.log(`\n${rows.filter(([, v]) => v).length}/${rows.length} green${r.ok ? " — WITNESSED" : " — FAIL"}`);
process.exit(r.ok ? 0 : 1);
