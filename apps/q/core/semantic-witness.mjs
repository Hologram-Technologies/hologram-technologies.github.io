// core/semantic-witness.mjs — the W3C SEMANTIC-TYPING gate (C2, extended to all κ-objects).
// Proves EVERY substrate object kind yields a node that is simultaneously: content-addressed (Law L1,
// @id = did:holo), schema.org-typed (WHAT it is), and PROV-O-bearing (HOW it came to be) — i.e. legible
// to any W3C JSON-LD/RDF tool. Pure + node-runnable: `node core/semantic-witness.mjs`. Exit 1 on any fail.

import { linkedDataFor, skillAsHowTo, fileAsDocument, appAsSoftware, modelAsSource, asLinkedData, verifySemantic, HOLO_CONTEXT } from "./semantic.js";

const K = (h) => "did:holo:sha256:" + h.padEnd(64, "0").slice(0, 64);
const cases = [
  { kind: "skill", node: skillAsHowTo({ name: "Format JSON", description: "When asked to pretty-print JSON", instructions: "1. Parse the text\n2. Re-serialize with 2-space indent", kappa: K("a1"), prov: [{ v: 1, kappa: K("a0") }, { v: 2, kappa: K("a1") }] }), want: "schema:HowTo" },
  { kind: "file", node: fileAsDocument({ path: "/src/main.py", kappa: K("b1"), bytes: 412 }), want: "schema:DigitalDocument" },
  { kind: "app", node: appAsSoftware({ name: "counter.html", kappa: K("c1"), bytes: 980 }), want: "schema:SoftwareApplication" },
  { kind: "model", node: modelAsSource({ name: "BitNet-2B-4T", family: "BitNet", params: "0.69 GB", format: "t2 1.58-bit κ", kappa: K("19e16e6d") }), want: "schema:SoftwareSourceCode" },
  { kind: "conversation", node: linkedDataFor("conversation", { kappa: K("d1"), props: { "schema:name": "chat #1" } }), want: "schema:Conversation" },
  { kind: "receipt", node: asLinkedData({ kind: "receipt", kappa: K("e1"), props: { "schema:name": "tool-call receipt" } }), want: "schema:CreativeWork" },
];

let pass = 0;
console.log("W3C semantic-typing gate — every κ-object is schema.org-typed + PROV-O + content-addressed\n");
for (const c of cases) {
  const v = verifySemantic(c.node);
  const types = [].concat(c.node["@type"]);
  const hasWant = types.includes(c.want);
  const ctxOk = c.node["@context"] === HOLO_CONTEXT || !!c.node["@context"];
  // JSON round-trip must be lossless (it's just data)
  let rt = false; try { rt = JSON.stringify(JSON.parse(JSON.stringify(c.node))) === JSON.stringify(c.node); } catch {}
  const ok = v.ok && hasWant && ctxOk && rt;
  if (ok) pass++;
  console.log(`${ok ? "✓" : "✗"} ${c.kind.padEnd(13)} @id=${String(c.node["@id"]).slice(0, 24)}… @type=[${types.join(", ")}]  schema:${v.hasSchema?"y":"n"} prov:${v.hasProv?"y":"n"} id:${v.hasId?"y":"n"} ctx:${ctxOk?"y":"n"} rt:${rt?"y":"n"}`);
}
const all = pass === cases.length;
console.log(`\n${all ? "PASS" : "FAIL"} — ${pass}/${cases.length} κ-object kinds carry a valid W3C @type`);
process.exit(all ? 0 : 1);
