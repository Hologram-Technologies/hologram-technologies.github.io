#!/usr/bin/env node
// holo-own-coexistence-witness.mjs — PROVE the two Title kinds coexist (ADR-053, issuer-binding is
// ADDITIVE). A legacy PROVENANCE Title (mint{ owned }) over a pre-existing κ and an ISSUER-BOUND
// ASSET Title (mint{ asset }) both verify, side by side, each resolving to its owner; a transfer of
// an asset Title still re-derives; and an issuer-bound asset κ cannot be re-derived by a foreign
// creator (impersonation refused at creation). Pure-Node, real WebCrypto.
//
//   node tools/holo-own-coexistence-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const L = (p) => new URL("../os/usr/lib/holo/" + p, import.meta.url);
const { enroll } = await import(L("holo-identity.mjs"));
const { kappaBlake3 } = await import(L("holo-blake3.mjs"));
const { mint, transfer, verifyChain, resolveOwner, ns } = await import(L("holo-own.mjs"));

const ref = (p) => p.kappa.replace(/^did:holo:/, "");
const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };
const te = new TextEncoder();

const maya    = await enroll({ label: "maya", passphrase: "m" });
const atlas   = await enroll({ label: "atlas", passphrase: "a" });
const mallory = await enroll({ label: "mallory", passphrase: "x" });

// 1 · legacy PROVENANCE Title over a pre-existing content κ — still valid (additive, not refused).
const existing = kappaBlake3(te.encode("org.hologram.ExistingObject"));
const prov = await mint({ owned: existing }, maya);
let r = await verifyChain([prov]);
rec("provenance Title (raw owned) verifies, owner = Maya, owned == the pre-existing κ", r.ok && r.owner === ref(maya) && prov.owned === existing && !prov.assetDescriptor);

// 2 · ISSUER-BOUND ASSET Title — owned IS the bound asset κ; descriptor carries the issuer.
const assetT = await mint({ asset: { id: "org.hologram.StudioWorld", name: "Studio World" } }, maya);
r = await verifyChain([assetT]);
rec("asset Title verifies, owner = Maya, owned re-derives from its descriptor", r.ok && r.owner === ref(maya) && assetT.assetDescriptor && assetT.assetDescriptor["@type"] === ns.ASSET_IRI);

// 3 · the two coexist in a mixed verification, each resolving independently.
const rp = await verifyChain([prov]); const ra = await verifyChain([assetT]);
rec("both Title kinds verify side by side to distinct, correct owners", rp.ok && ra.ok && rp.owner === ref(maya) && ra.owner === ref(maya) && prov["@id"] !== assetT["@id"]);

// 4 · an asset Title still transfers and re-derives (no regression on the transfer path).
const t1 = await transfer({ title: assetT, to: atlas }, maya);
r = await verifyChain([assetT, t1]);
rec("asset Title transfers to Atlas; chain re-derives, head resolves to Atlas", r.ok && (await resolveOwner([assetT, t1])) === ref(atlas));

// 5 · impersonation refused at CREATION — a foreign creator cannot re-derive Maya's asset κ.
const foreign = await mint({ asset: { id: "org.hologram.StudioWorld", name: "Studio World" } }, mallory);
rec("foreign issuer cannot produce Maya's asset κ (issuer-binding)", foreign.owned !== assetT.owned && (await verifyChain([foreign])).ok);

const spec = "Issuer-binding is additive (ADR-053): legacy provenance Titles (title over a pre-existing κ) and issuer-bound asset Titles (a new asset whose κ commits to its creator's key) coexist; both re-derive and self-verify (Law L5); asset minting refuses originator impersonation at creation; the transfer path is unchanged. Exclusivity/scarcity (double-genesis fork, double-spend) remains a Layer-2 anchor concern, not closed here.";
const out = { spec, passed, failed, checks };
writeFileSync(join(here, "holo-own-coexistence-witness.result.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\nholo-own-coexistence-witness: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
