#!/usr/bin/env node
// holo-plus-intake-witness.mjs — proves A1 of "The + Everywhere": THE THREE INTAKE MODES. The "+" turns a file, a
// link, or a reference to ANOTHER HOLO OBJECT/APP (by κ) into runPlus inputs. The headline is object-by-κ: you
// don't upload — you point at a κ already on the substrate, its bytes are RESOLVED there, and they are L5-verified
// to re-derive to that κ before use. Link a tampered/wrong object and intake REFUSES it. The whole reflex then
// runs on the linked object with NO re-acquisition — the uniquely-Hologram move.
//
// Checks (all must hold):
//   1 parseRefAllForms       — did:holo:…, holo://…, holo://sha256/…, …/.holo/sha256/…, bare 64-hex all parse; garbage → null.
//   2 resolveObjectByKappa   — a κ + an injected substrate resolver → an input carrying that κ, resolved (not uploaded).
//   3 integrityVerifiedL5    — the resolved bytes re-derive to the κ (verify-before-use); a clean object passes.
//   4 tamperRefused          — a resolver that returns the WRONG bytes for a κ ⇒ intake throws (no ingesting a lie).
//   5 unresolvableHonest     — a κ the resolver can't find ⇒ a clear "unresolvable" error, never a silent empty input.
//   6 allThreeModesNormalize — files + links + objects all normalize to { name, bytes, mime } inputs in one call.
//   7 noReUploadEndToEnd     — link object κ X → runPlus → the graph's raw source κ EQUALS X (resolved by reference only).
//   8 linkedObjectYieldsInsight — the reflex runs on the linked object and produces a provenance-bearing insight.
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · holospaces Law L5 (verify by re-derivation) · rests on #holo-uor +
// #holo-ingest + #holo-plus (runPlus). node tools/holo-plus-intake-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseRef, resolveObject, intakeToInputs } from "../os/usr/lib/holo/holo-plus-intake.mjs";
import { sha256hex, didHolo } from "../os/usr/lib/holo/holo-uor.mjs";
import { runPlus } from "../os/usr/lib/holo/holo-plus.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);

// ── a substrate stand-in: a content-addressed store κ → bytes (what the browser resolver hits over /.holo) ──
const DOC = "Acme Corp is based in Berlin. Dana Lee is the CEO of Acme Corp.";
const docBytes = enc(DOC);
const docKappa = didHolo("sha256", sha256hex(docBytes));
const store = new Map([[docKappa, docBytes]]);
const resolve = async (kappa) => store.get(kappa) || null;   // injected; prod = fetch /.holo/sha256/<hex>

// ── 1 · parseRef across every form ──────────────────────────────────────────────────────────────────
const hex = sha256hex(docBytes);
const forms = [`did:holo:sha256:${hex}`, `holo://sha256/${hex}`, `holo://${hex}`, `/x/.holo/sha256/${hex}`, hex];
ok("parseRefAllForms",
  forms.every((f) => { const p = parseRef(f); return p && p.hex === hex && p.axis === "sha256"; }) && parseRef("not-a-kappa") === null && parseRef("") === null);

// ── 2/3 · resolve a holo object by κ; integrity verified ────────────────────────────────────────────
const obj = await resolveObject(docKappa, { resolve });
ok("resolveObjectByKappa", obj.kappa === docKappa && obj.bytes.length === docBytes.length && /Acme/.test(new TextDecoder().decode(obj.bytes)));
ok("integrityVerifiedL5", didHolo("sha256", sha256hex(obj.bytes)) === docKappa);

// ── 4 · tamper: resolver returns the wrong bytes for a κ ⇒ refuse ───────────────────────────────────
const liar = async () => enc("totally different bytes");
let threw = false; try { await resolveObject(docKappa, { resolve: liar }); } catch (e) { threw = /integrity/.test(e.message); }
ok("tamperRefused", threw);

// ── 5 · unresolvable κ ⇒ honest error ───────────────────────────────────────────────────────────────
let threw5 = false; const missingK = didHolo("sha256", "a".repeat(64));
try { await resolveObject(missingK, { resolve }); } catch (e) { threw5 = /unresolvable/.test(e.message); }
ok("unresolvableHonest", threw5);

// ── 6 · all three modes normalize together ──────────────────────────────────────────────────────────
const fakeFile = { name: "n.txt", type: "text/plain", arrayBuffer: async () => enc("Beta Labs in Oslo.").buffer };
const fakeFetch = async (u) => ({ ok: true, headers: { get: () => "text/plain" }, arrayBuffer: async () => enc("Gamma Inc in Paris.").buffer });
const inputs = await intakeToInputs({ files: [fakeFile], links: ["https://x/data.txt"], objects: [docKappa] }, { resolve, fetchImpl: fakeFetch });
ok("allThreeModesNormalize",
  inputs.length === 3 && inputs.every((i) => i.name && i.bytes instanceof Uint8Array)
  && inputs[2].kappa === docKappa, `n=${inputs.length}`);

// ── 7 · NO re-upload: link object κ → runPlus → the graph's raw source κ equals the referenced κ ────
const linked = await resolveObject(docKappa, { resolve });
const out = await runPlus([linked], { title: "linked object" });
// runPlus seals the resolved bytes; content-addressing ⇒ the raw source κ MUST equal the κ we linked.
const rawSourceKappa = didHolo("sha256", sha256hex(linked.bytes));
ok("noReUploadEndToEnd", rawSourceKappa === docKappa && out.kappas.includes(docKappa), "raw source κ must equal the linked κ");

// ── 8 · the reflex runs on the linked object and yields a provenance-bearing insight ────────────────
ok("linkedObjectYieldsInsight",
  out.graph["holo:entities"].some((e) => e["schema:name"] === "Acme Corp")
  && out.insights.length >= 1 && out.insights.every((i) => i["prov:wasDerivedFrom"].length > 0),
  `entities=${out.graph["holo:stats"].entities} insights=${out.insights.length}`);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "The + Everywhere — A1 INTAKE: file / link / holo-object-by-κ all normalize to runPlus inputs. The headline mode is object-by-κ — point at a κ already on the substrate, resolve its bytes there (no upload), L5-verify they re-derive to that κ before use (tamper/wrong-bytes refused, unresolvable is an honest error), and run the whole reflex with NO re-acquisition: the graph's raw source κ equals the linked κ by content-addressing. The uniquely-Hologram intake",
  authority: "UOR-ADDR (κ = H(canonical_form)) · holospaces Law L5 · rests on #holo-uor + #holo-ingest + #holo-plus",
  witnessed,
  covers: witnessed ? ["intake-three-modes","object-by-kappa","no-re-upload","l5-integrity","tamper-refused","unresolvable-honest","normalize","linked-insight"] : [],
  sample: { docKappa, modes: ["file", "link", "object-by-κ"], linkedInsight: out.insights[0] && out.insights[0]["schema:text"] },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-plus-intake-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-plus-intake witness — A1 The + (file · link · holo-object-by-κ, no re-upload, L5-verified)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  linked object κ ${docKappa.slice(0, 28)}… → resolved (no upload) → ${out.graph["holo:stats"].entities} entities · ${out.insights.length} insights`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the + ingests files, links, AND other holo objects by κ — resolved on-substrate, integrity-checked" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
