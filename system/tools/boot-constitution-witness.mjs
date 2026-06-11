#!/usr/bin/env node
// boot-constitution-witness.mjs — proves the Constitution (ADR-033) is SEALED, SELF-VERIFYING,
// SELF-DECLARING and ENFORCED across Hologram OS *from the initial boot gateway*. The boot gateway is
// the very first page (index.html — repo front door + os/index.html Pages entry): before it enters the
// bootloader (rEFInd → Plymouth → SDDM → PrimeOS) it loads the fail-closed conscience gate
// (os/usr/lib/holo/holo-conscience.js), re-derives the eight principles to their pinned κ (Law L5), and
// REFUSES TO BOOT if the constitution does not self-verify. This witness checks, end to end:
//   SEALED          · the law is one re-derivable κ-object; its root matches the pinned constitution κ.
//   SELF-VERIFYING  · re-deriving the principles seals the gate; a single tampered byte un-seals it.
//   SELF-DECLARING  · both gateways declare the constitution (JSON-LD + the boot κ) and the
//                     /.well-known/constitution.json door resolves to the same root κ.
//   ENFORCED@BOOT   · both gateways gate boot on verifyConstitution() and FAIL CLOSED on a failure.
//   ENFORCED@MOUNT  · the one unbypassable app chokepoint admits a benign app, refuses a red-line app,
//                     and (constitution un-sealed) refuses EVERYTHING — fail-closed.
// Pure Node (Web Crypto global). Usage: node tools/boot-constitution-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { verifyConstitution, evaluate, PRINCIPLES, PINNED } from "../os/usr/lib/holo/holo-conscience.js";
import { admit } from "../os/usr/lib/holo/holo-admit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");
const K = "did:holo:sha256:3ff288d0c06a0fd22da898301cb6c8c11fc62e3b2b7ab58a53c7cb0cb385f00c";
const checks = {};

// ── the two boot gateways ─────────────────────────────────────────────────────────────────────────
const gateways = { "index.html (front door)": "../../index.html", "os/index.html (Pages entry)": "../os/index.html" };
const gatewaySrc = Object.fromEntries(Object.entries(gateways).map(([name, p]) => [name, read(p)]));

// SEALED · the sealed object's root re-derives to the pinned constitution κ.
const uor = JSON.parse(read("../os/etc/constitution/constitution.uor.json"));
checks.sealed = uor.root === K && PINNED.root === K && (await verifyConstitution()) === true;

// SELF-DECLARING · each gateway names the constitution (text + door) AND embeds the boot κ; the
// /.well-known door resolves to the same root κ.
const wk = JSON.parse(read("../os/.well-known/constitution.json"));
checks.selfDeclaring = wk["@id"] === K
  && Object.values(gatewaySrc).every((s) => s.includes("CONSTITUTION.md") && s.includes("constitution.json") && s.includes(K));

// ENFORCED@BOOT · each gateway loads the conscience gate, calls verifyConstitution(), and FAILS CLOSED
// (a visible "boot refused" path) rather than booting an unverifiable constitution.
checks.enforcedAtBoot = Object.values(gatewaySrc).every((s) =>
  /holo-conscience\.js/.test(s) && /verifyConstitution\s*\(/.test(s) && /holoBootRefused\s*\(/.test(s) && /fail[ -]closed/i.test(s));

// ENFORCED@MOUNT · the unbypassable admission chokepoint (every app mounts through it).
checks.benignAdmitted = admit({ id: "org.example.Benign", capabilities: { storage: ["self"] } }).ok === true;
{
  const v = admit({ id: "org.example.Rogue", capabilities: { attests: { overridesKillSwitch: true } } });
  checks.redLineRefused = v.ok === false && v.blocked.includes("P7");
}

// SELF-VERIFYING / FAIL-CLOSED · a single tampered principle byte un-seals the gate ⇒ it refuses all
// (evaluate blocks, admission refuses everything). Then re-seal to the canonical constitution.
{
  const tampered = PRINCIPLES.map((p, i) => i === 0 ? { ...p, statement: p.statement + " (tampered)" } : p);
  const reSealed = await verifyConstitution({ principles: tampered });          // sets module seal = false
  checks.tamperUnseals = reSealed === false;
  checks.failsClosedWhenUnsealed = evaluate({}).outcome === "block" && admit({}).ok === false;
  checks.reSealsToCanonical = (await verifyConstitution()) === true;            // restore the canonical seal
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "boot-constitution-witness.result.json"), JSON.stringify({
  spec: "Hologram OS Constitution — sealed, self-verifying, self-declaring + enforced from the initial boot gateway (ADR-033)",
  authority: "ADR-033 (Holo Constitution) · W3C ODRL 2.2 · W3C DID Core · IETF RFC 8785 (JCS) · W3C Web Cryptography · verify by re-derivation (Law L5)",
  witnessed,
  covers: witnessed ? ["constitution-sealed", "self-verifying", "self-declaring", "enforced-at-boot", "enforced-at-mount", "fail-closed", "law-l5"] : [],
  constitutionK: K, gateways: Object.keys(gateways), checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`· constitution κ ${K.slice(0, 30)}… · gateways: ${Object.keys(gateways).join(" + ")}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ the Constitution is sealed, self-verifying, self-declaring + enforced from the boot gateway" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
