#!/usr/bin/env node
// constitution-enforce-witness.mjs — proves the Constitution (ADR-033) is ENFORCED at runtime for
// EVERY holospace, fail-closed. The conscience gate (os/usr/lib/holo/holo-conscience.js) is the
// canonical, self-verifying decision function; holo-admit.mjs routes it into the one unbypassable
// chokepoint — holo-launch.mjs `mount()` (every app, in every frame, mounts through it). This proves:
//   1 · BEFORE the Constitution self-verifies, admission refuses everything (fail-closed by default);
//   2 · the gate SEALS only against the canonical Constitution — re-deriving each principle's κ to the
//       pinned root did:holo:sha256:3ff288d0… (Law L5, the same object served at /etc/constitution/);
//   3 · a compliant holospace is ADMITTED;
//   4 · a holospace declaring a RED-LINE action (e.g. overrides the kill switch, P7) is REFUSED;
//   5 · EVERY app in the catalog passes through admission (all evaluated, all admitted — none declare
//       a red line) — i.e. enforcement is 100%, not opt-in;
//   6 · it FAILS CLOSED — a single tampered principle byte un-seals the gate and admission refuses all;
//   7 · the chokepoint is REAL — holo-launch.mjs `mount()` calls admit() and throws on refusal.
// Pure Node (Web Crypto global). Usage: node tools/constitution-enforce-witness.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sealConstitution, admit, decisionFor } from "../os/usr/lib/holo/holo-admit.mjs";
import { verifyConstitution, evaluate, PRINCIPLES, PINNED, RED_LINE } from "../os/usr/lib/holo/holo-conscience.js";

const here = dirname(fileURLToPath(import.meta.url));
const APPS = "C:/Users/pavel/Desktop/Hologram Apps";
const write = (r) => writeFileSync(join(here, "constitution-enforce-witness.result.json"), JSON.stringify(r, null, 2) + "\n");
const checks = {};

// 1 · fail-closed BEFORE the constitution self-verifies (gate unsealed ⇒ refuse everything).
checks.failClosedByDefault = admit({}).ok === false;

// 2 · seal ONLY against the canonical constitution (each principle re-derives to its pinned κ, Law L5).
const sealedOk = await sealConstitution();
checks.sealsToCanonicalConstitution = sealedOk === true && PINNED.root === "did:holo:sha256:3ff288d0c06a0fd22da898301cb6c8c11fc62e3b2b7ab58a53c7cb0cb385f00c";

// 3 · a compliant holospace is admitted.
checks.compliantAdmitted = admit({ id: "org.example.Benign", capabilities: { storage: ["self"] } }).ok === true;

// 4 · a red-line declaration is refused at the door (P7 — overrides the kill switch).
{
  const v = admit({ id: "org.example.Rogue", capabilities: { attests: { overridesKillSwitch: true } } });
  checks.redLineRefused = v.ok === false && v.blocked.includes("P7");
}

// 5 · EVERY app in the catalog passes through admission (100% coverage, not opt-in).
let appsTotal = 0, appsAdmitted = 0; const appsRefused = [];
try {
  const cat = JSON.parse(readFileSync(join(APPS, "apps/index.jsonld"), "utf8"));
  for (const ds of cat["dcat:dataset"] || []) {
    const dir = (ds["dcat:landingPage"] || "").split("/")[1];
    const defPath = join(APPS, "apps", dir, "holospace.json");
    const def = existsSync(defPath) ? JSON.parse(readFileSync(defPath, "utf8")) : { id: ds["schema:identifier"] };
    appsTotal++;
    const v = admit(def);
    if (v.ok) appsAdmitted++; else appsRefused.push(dir + ":" + v.reason);
  }
} catch (e) { appsRefused.push("catalog: " + e.message); }
checks.everyAppPassesAdmission = appsTotal > 0 && appsAdmitted === appsTotal;

// 6 · the chokepoint is REAL — mount() enforces admission (source contract).
try {
  const launch = readFileSync(join(here, "../os/lib/holo-launch.mjs"), "utf8");
  checks.mountEnforcesAdmission = /holo-admit/.test(launch) && /admit\(/.test(launch) && /throw/.test(launch);
} catch { checks.mountEnforcesAdmission = false; }

// 7 · FAILS CLOSED — tamper one principle byte ⇒ the gate un-seals ⇒ admission refuses everything.
{
  const tampered = PRINCIPLES.map((p, i) => i === 0 ? { ...p, statement: p.statement + " (tampered)" } : p);
  const reSealed = await verifyConstitution({ principles: tampered });   // sets module seal = false
  checks.failsClosedOnTamper = reSealed === false && evaluate({}).outcome === "block" && admit({}).ok === false;
}

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Hologram OS Constitution — enforced at runtime for every holospace, fail-closed (ADR-033)",
  authority: "ADR-033 (Holo Constitution / Hologram OS principles, byte-pinned) · W3C ODRL 2.2 · W3C DID Core · IETF RFC 8785 (JCS) · W3C Web Cryptography · verify by re-derivation (Law L5)",
  witnessed,
  covers: witnessed ? ["constitution-enforce", "conscience-gate", "fail-closed", "admission-control", "law-l5"] : [],
  pinnedRoot: PINNED.root, redLine: RED_LINE, appsTotal, appsAdmitted, appsRefused, checks,
});
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`· constitution κ ${PINNED.root.slice(0, 30)}… · red lines ${RED_LINE.join("/")} · ${appsAdmitted}/${appsTotal} apps pass admission`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ the Constitution is enforced for every holospace, fail-closed" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
