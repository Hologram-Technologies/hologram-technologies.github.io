#!/usr/bin/env node
// holo-own-surface-witness.mjs — PROVE the opt-in asset surface (ADR-053, issuer-binding additive).
// The Own UI controller (claimAsset) and the SDK (mintTitle{asset}) both ORIGINATE issuer-bound
// asset Titles that own_verify accepts; the legacy provenance paths (claim / mintTitle{owned}) are
// unchanged. Pure-Node (no DOM, no IndexedDB → in-memory registry).
//
//   node tools/holo-own-surface-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const L = (p) => new URL("../os/usr/lib/holo/" + p, import.meta.url);
const { enroll } = await import(L("holo-identity.mjs"));
const ui = await import(L("holo-own-ui.js"));
const sdk = await import(L("holo-sdk.js"));
const { verifyChain } = await import(L("holo-own.mjs"));

const ref = (p) => p.kappa.replace(/^did:holo:/, "");
const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };

const maya = await enroll({ label: "maya", passphrase: "m" });

// 1 · Own UI: legacy claim (provenance) still works.
ui.setOperator(maya);
const provK = ui.ownedKappaOf("org.hologram.SomeObject");
const prov = await ui.claim(provK);
rec("Own UI claim(): legacy provenance Title verifies", (await verifyChain([prov])).ok && !prov.assetDescriptor && prov.owned === provK);

// 2 · Own UI: claimAsset originates an issuer-bound asset Title.
const a = await ui.claimAsset({ id: "org.hologram.StudioWorld", name: "Studio World" });
rec("Own UI claimAsset(): asset Title verifies, descriptor present", (await verifyChain([a])).ok && !!a.assetDescriptor && a.assetDescriptor["@type"].endsWith("#Asset"));
rec("Own UI claimAsset(): registered chain is retrievable by its owned κ", (await ui.loadChain(a.owned)).length === 1);

// 3 · SDK: mintTitle{owned} legacy unchanged; mintTitle{asset} originates an asset Title.
sdk.setOperator(maya);
const sProv = await sdk.mintTitle({ owned: provK });
rec("SDK mintTitle{owned}: legacy provenance Title verifies", (await verifyChain([sProv])).ok && !sProv.assetDescriptor);
const sAsset = await sdk.mintTitle({ asset: { id: "org.hologram.OtherWorld", name: "Other World" } });
rec("SDK mintTitle{asset}: asset Title verifies, owner = Maya", (await verifyChain([sAsset])).ok && sAsset.owner === ref(maya) && !!sAsset.assetDescriptor);

// 4 · the SDK asset and UI asset are DISTINCT κ (different assets), both issued by Maya.
rec("two distinct assets ⇒ distinct κ, both issued by Maya", sAsset.owned !== a.owned && sAsset.owner === ref(maya) && a.owner === ref(maya));

const spec = "The opt-in asset surface (ADR-053): HoloOwnUI.claimAsset and HoloSDK.mintTitle{asset} originate issuer-bound asset Titles (κ commits to the creator's key); the legacy provenance paths (claim / mintTitle{owned}) are unchanged. Both kinds re-derive and self-verify (Law L5).";
const out = { spec, passed, failed, checks };
writeFileSync(join(here, "holo-own-surface-witness.result.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\nholo-own-surface-witness: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
