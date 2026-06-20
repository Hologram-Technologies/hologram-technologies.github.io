#!/usr/bin/env node
// holo-investigation-witness.mjs — proves S8 of "the +": THE WHOLE INVESTIGATION IS ONE PINNABLE κ-DAG. The full
// reflex (ingest → map → insight → brief) composes into a SINGLE root κ that re-derives from its members — so the
// entire chain is portable, serverless, and verifiable from anywhere. Tamper any member and the root breaks. This
// is the ADR done-check: "the whole thing is one pinnable κ-DAG", and the pinSet names exactly the bytes a pin must
// carry to replay it on a cold device. The live IPFS pin + relock reseal is the OUT-OF-BAND deploy step (declared,
// not faked: holo:pinned stays null until a real receipt).
//
// Checks (all must hold):
//   1 composesOneRoot            — the full pipeline → one holo:Investigation with a single root κ.
//   2 rootCoversAllMembers       — the root = H(sorted members: sources + graph closure + insights + brief).
//   3 rootReDerives              — independent re-derivation of jcs(members) equals the root (Law L5).
//   4 tamperAnyMemberBreaksRoot  — perturbing any member κ changes the root (the DAG is content-addressed).
//   5 portableReDeriveFromMembers — given ONLY the member κs (no other context), the root re-derives (location-agnostic).
//   6 fullChainVerifies          — verifyInvestigation passes: root intact AND every insight's provenance verifies (S5).
//   7 pinSetIsByteClosure        — pinSet names every κ needed to replay offline: all sources + all graph nodes + insights + brief.
//   8 honestPinIsOutOfBand       — holo:pinned is null (no fabricated "pinned:true"); the deploy step is declared, not faked.
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · W3C PROV-O (prov:Bundle) · IETF RFC 8785 (JCS) · holospaces L2/L5.
// rests on #holo-ingest + #holo-map + #holo-insight + #holo-brief. node tools/holo-investigation-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sealIngest } from "../os/usr/lib/holo/holo-ingest.mjs";
import { extractGraph, mergeGraphs } from "../os/usr/lib/holo/holo-map.mjs";
import { investigate } from "../os/usr/lib/holo/holo-insight.mjs";
import { composeBrief } from "../os/usr/lib/holo/holo-brief.mjs";
import { composeInvestigation, pinSet, verifyInvestigation } from "../os/usr/lib/holo/holo-investigation.mjs";
import { jcs } from "../os/usr/lib/holo/holo-uor.mjs";
import { reDerive } from "../os/sbin/holo-resolver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const reKappa = async (bytes) => "did:holo:sha256:" + (await reDerive(bytes));

// ── run the whole reflex, then compose the investigation κ-DAG ──────────────────────────────────────
const DOC_A = "Acme Corp operates in Berlin. Acme Corp shipped 12 products in 2023.";
const DOC_B = "Acme Corp is based in Berlin. CEO: Dana Lee leads the company.";
const bytesA = enc(DOC_A), bytesB = enc(DOC_B);
const srcA = sealIngest({ name: "a.txt", bytes: bytesA });
const srcB = sealIngest({ name: "b.txt", bytes: bytesB });
const graph = mergeGraphs([extractGraph({ text: DOC_A, sourceKappa: srcA.source }), extractGraph({ text: DOC_B, sourceKappa: srcB.source })]);
const insights = await investigate(graph);
const brief = composeBrief({ graph, insights, title: "What the + found", now: () => "2026-06-19T00:00:00Z" });
const sourceBytes = new Map([[srcA.source, bytesA], [srcB.source, bytesB]]);
const inv = composeInvestigation({ title: "Acme investigation", sources: [srcA.source, srcB.source], graph, insights, brief, now: () => "2026-06-19T00:00:00Z" });

// ── 1 · one root ────────────────────────────────────────────────────────────────────────────────────
ok("composesOneRoot", inv["@type"].includes("holo:Investigation") && /^did:holo:sha256:[0-9a-f]{64}$/.test(inv["holo:root"]) && inv["@id"] === inv["holo:root"]);

// ── 2 · the root covers exactly the members (sources + graph closure + insights + brief) ────────────
const members = [...[srcA.source, srcB.source], graph["holo:graphClosure"], ...insights.map((i) => i["@id"]), brief["@id"]].sort();
ok("rootCoversAllMembers", inv["holo:memberCount"] === members.length
  && inv["holo:sources"].length === 2 && inv["holo:insights"].length === insights.length && inv["holo:brief"] === brief["@id"]);

// ── 3 · the root re-derives from the canonical member list (independent hash) ───────────────────────
ok("rootReDerives", (await reKappa(enc(jcs(members)))) === inv["holo:root"]);

// ── 4 · tamper ANY member ⇒ the root changes ────────────────────────────────────────────────────────
const perturbed = [...members]; perturbed[0] = "did:holo:sha256:" + "a".repeat(64);
ok("tamperAnyMemberBreaksRoot", (await reKappa(enc(jcs(perturbed.sort())))) !== inv["holo:root"]);

// ── 5 · portable: given ONLY the member κs, the root re-derives (no other context needed) ───────────
const portableRoot = await reKappa(enc(jcs([...inv["holo:sources"], inv["holo:graph"], ...inv["holo:insights"], inv["holo:brief"]].sort())));
ok("portableReDeriveFromMembers", portableRoot === inv["holo:root"]);

// ── 6 · the full chain verifies (root intact + every insight's provenance holds), and breaks on tamper ─
const clean = verifyInvestigation(inv, { graph, insights, sourceBytes });
const tampered = new Map(sourceBytes); tampered.set(srcA.source, enc(DOC_A + " (forged)"));
const broken = verifyInvestigation(inv, { graph, insights, sourceBytes: tampered });
ok("fullChainVerifies", clean.ok === true && clean.rootOk === true && broken.ok === false && broken.brokenInsights.length > 0);

// ── 7 · the pin set is the byte-closure needed to replay offline ────────────────────────────────────
const pins = pinSet(inv, graph);
const graphNodes = [...graph["holo:entities"], ...graph["holo:claims"], ...graph["holo:provenance"]].map((n) => n["@id"]);
ok("pinSetIsByteClosure",
  [srcA.source, srcB.source, brief["@id"], ...insights.map((i) => i["@id"]), ...graphNodes].every((k) => pins.includes(k))
  && pins.length >= graphNodes.length + 2);

// ── 8 · honest: no fabricated pin; the deploy step is declared, not faked ───────────────────────────
ok("honestPinIsOutOfBand", inv["holo:pinned"] === null);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "the + — S8 INVESTIGATION κ-DAG: the whole reflex (ingest → map → insight → brief) composes into one content-addressed root that re-derives from its members (sources + graph closure + insights + brief). Tamper any member and the root breaks; given only the member κs the root re-derives (location-agnostic, pinnable); verifyInvestigation gates root integrity AND every insight's provenance (S5); pinSet names the full byte-closure to replay offline. holo:pinned stays null — the live IPFS pin + relock reseal is the declared out-of-band deploy step, not faked",
  authority: "UOR-ADDR (κ = H(canonical_form)) · W3C PROV-O (prov:Bundle) · IETF RFC 8785 (JCS) · holospaces L2/L5 · rests on #holo-ingest + #holo-map + #holo-insight + #holo-brief",
  witnessed,
  covers: witnessed ? ["investigation-dag","one-root","root-re-derives","tamper-breaks-root","portable","full-chain-verify","pin-set-closure","honest-pin"] : [],
  sample: { root: inv["holo:root"], members: inv["holo:memberCount"], pins: pins.length, sources: inv["holo:sources"].length, insights: inv["holo:insights"].length },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-investigation-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-investigation witness — S8 the + (whole reflex → one pinnable, re-derivable κ-DAG)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  investigation root ${inv["holo:root"].slice(0, 32)}…  ·  ${inv["holo:memberCount"]} members  ·  pin set ${pins.length} κs`);
console.log(`  out-of-band deploy: pin the ${pins.length}-κ set to IPFS + relock the touched substrate files (holo-telemetry-tap.mjs)`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the whole investigation is one content-addressed, portable, re-derivable κ-DAG" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
