#!/usr/bin/env node
// holo-ceremony-witness.mjs — PROVE the invisible first-run ceremony: the operator's sovereign
// knowledge is self-issued as salted-digest claims (selective disclosure works; forgery refused), an
// empty social graph is opened, bilateral edges are co-signed + verifiable, and enrolling runs it all
// silently. Composes the existing Holo ZK — no new crypto.
//
//   node tools/holo-ceremony-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { principalFromSeed, enroll, ceremonyOf, forget } from "../os/usr/lib/holo/holo-login.mjs";
import { seedFromMnemonic, generateMnemonic } from "../os/usr/lib/holo/holo-wdk.js";
import { firstRun, disclose, verifyDisclosure, verifyObject, bilateralEdge, verifyEdge } from "../os/usr/lib/holo/holo-ceremony.mjs";
import "../os/usr/lib/holo/holo-zk.js";

const here = dirname(fileURLToPath(import.meta.url));
const results = []; let pass = 0, fail = 0;
const rec = (n, ok, d = "") => { results.push({ n, ok, d }); ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const jcs = globalThis.HoloZK.jcs;

const ilya = await principalFromSeed(seedFromMnemonic("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"), "Ilya");

// 1 · the ceremony issues a signed, content-addressed knowledge credential + an empty social graph
const { credential, disclosures, graph } = await firstRun(ilya, { claims: { country: "—", over18: true } });
rec("knowledge credential is signed + content-addressed (re-derives, Law L5)", await verifyObject(credential) && /^did:holo:sha256:/.test(credential.id || "did:holo:sha256:"), credential.id.slice(0, 22) + "…");
rec("only DIGESTS are published (raw claims never on the credential)", Array.isArray(credential.digests) && credential.digests.length >= 5 && !JSON.stringify(credential).includes("Ilya"));
rec("social graph opened: signed, content-addressed, EMPTY", await verifyObject(graph) && Array.isArray(graph.edges) && graph.edges.length === 0);

// 2 · SELECTIVE DISCLOSURE — reveal exactly one claim; everything else stays hidden
const pres = await disclose({ digests: credential.digests, disclosures }, ["name"]);
const seen = await verifyDisclosure(pres);
rec("discloses ONLY the chosen claim (name); the rest leak nothing", seen && seen.name === "Ilya" && !("identity" in seen) && !("country" in seen) && !("over18" in seen), JSON.stringify(seen));
const pres2 = await disclose({ digests: credential.digests, disclosures }, ["over18", "did"]);
rec("multi-claim disclosure reveals exactly the chosen set", JSON.stringify(Object.keys((await verifyDisclosure(pres2)) || {}).sort()) === JSON.stringify(["did", "over18"]));

// 3 · FORGERY — a fabricated claim (not in the signed digest set) is REFUSED
rec("fabricated claim refused (digest not in the signed set)", (await verifyDisclosure({ digests: credential.digests, revealed: [jcs(["forgedsalt", "over18", false])] })) === null);
rec("tampered credential refused (a flipped digest breaks κ)", !(await verifyObject({ ...credential, digests: [...credential.digests.slice(1), "00".repeat(32)] })));

// 4 · BILATERAL social edge — two operators co-sign one relationship; one-sided ⇒ not an edge
const bob = await principalFromSeed(seedFromMnemonic(generateMnemonic(12)), "Bob");
const edge = await bilateralEdge(ilya, bob, { kind: "knows" });
rec("bilateral edge requires BOTH signatures + re-derives (Law L5)", await verifyEdge(edge) && edge.a === ilya.kappa && edge.b === bob.kappa);
rec("a one-sided edge is NOT a real edge", !(await verifyEdge({ ...edge, sigB: undefined })));
rec("a tampered edge (changed kind) is refused", !(await verifyEdge({ ...edge, kind: "owes" })));

// 5 · INVISIBLE wiring — enrolling silently runs the ceremony; the artefacts are attached
const r = await enroll({ label: "Ada", secret: "biometric-prf-secret-abc12" });
const cer = await ceremonyOf(r.principal.kappa);
rec("enrol runs the ceremony silently (knowledge + graph attached)", !!cer && await verifyObject(cer.knowledge) && await verifyObject(cer.graph) && !!cer.disclosures);
await forget(r.principal.kappa);

const ok = fail === 0;
writeFileSync(join(here, "holo-ceremony-witness.result.json"), JSON.stringify({ ok, pass, fail, results }, null, 2) + "\n");
console.log(`\n${ok ? "PASS" : "FAIL"} — Holo Login invisible ZK/privacy ceremony ${pass}/${pass + fail}`);
process.exit(ok ? 0 : 1);
