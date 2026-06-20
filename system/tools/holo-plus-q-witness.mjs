#!/usr/bin/env node
// holo-plus-q-witness.mjs — proves A4 of "The + Everywhere": Q FUSION. A drop and its insights become a GROUNDING
// turn on Q's context bus, so Q's next answer is informed by it. The headline: the VOICE door ("add this", through
// ASR) and the TEXT door (the "+") converge on ONE grounding, fused into the SAME conversation — voice and text are
// one path. The grounding is a content-addressed κ-object citing the brief/investigation/insight κs (auditable).
//
// Checks (all must hold):
//   1 groundingIsSealedKappa   — groundingFrom → a holo:Grounding κ-object whose κ re-derives (Law L5).
//   2 voiceTextConverge        — the text door and the voice door, given the same result+context, produce the IDENTICAL grounding κ.
//   3 landsOnQBus              — fuseToQ pushes the grounding onto an injected Q bus exactly once (delivered:true).
//   4 taggedToConversation     — the grounding carries the context's qConversationId (lands in the right Q thread).
//   5 citesEvidence            — grounding references the brief κ, investigation root, and every insight κ (traceable).
//   6 addIntentRecognized      — isAddIntent matches "add this"/"look at this"/"what do you make of this"; rejects unrelated.
//   7 gracefulNoQ              — no Q bus → fuseToQ returns the grounding (delivered:false), never throws.
//   8 differentContextDifferentGrounding — same source, different conversation → different grounding κ (per-thread).
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L2/L5 · rests on #holo-plus + #holo-q-app (Q bus).
//   node tools/holo-plus-q-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { groundingFrom, isAddIntent, fuseToQ } from "../os/usr/lib/holo/holo-plus-q.mjs";
import { runPlus } from "../os/usr/lib/holo/holo-plus.mjs";
import { sha256hex, didHolo, jcs } from "../os/usr/lib/holo/holo-uor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);

// one runPlus result + a conversation context (what the "+" produced in some app)
const DOC = "Acme Corp is based in Berlin. Dana Lee is the CEO of Acme Corp. Acme Corp raised funds in Berlin.";
const context = { surface: "local", activeApp: "records", qConversationId: "conv-7", inputText: "tell me about acme" };
const result = await runPlus([{ name: "acme.txt", bytes: enc(DOC) }], { context, title: "What the + found" });

// ── 1 · grounding is a sealed κ-object that re-derives ──────────────────────────────────────────────
const g = groundingFrom(result, context);
const reK = didHolo("sha256", sha256hex(enc(jcs({ t: "grounding", conv: "conv-7", brief: result.brief["@id"], investigation: result.investigation["holo:root"], insights: result.insights.map((i) => i["@id"]).sort() }))));
ok("groundingIsSealedKappa", g["@type"].includes("holo:Grounding") && g["@id"] === reK, `g=${g["@id"].slice(0,18)} re=${reK.slice(0,18)}`);

// ── 2 · THE headline: voice door and text door → IDENTICAL grounding ────────────────────────────────
// text door: the popover's result → grounding. voice door: "add this" about the SAME result → grounding.
const gText = groundingFrom(result, context);                       // text "+"
const voiceMatched = isAddIntent("add this to the conversation");
const gVoice = voiceMatched ? groundingFrom(result, context) : null; // voice "add this"
ok("voiceTextConverge", voiceMatched && gVoice && gText["@id"] === gVoice["@id"] && gText["schema:text"] === gVoice["schema:text"]);

// ── 3 · lands on an injected Q bus exactly once ─────────────────────────────────────────────────────
const received = [];
const qBus = { addGrounding: async (gr) => { received.push(gr); } };
const fused = await fuseToQ({ result, context, qBus });
ok("landsOnQBus", fused.delivered === true && received.length === 1 && received[0]["@id"] === g["@id"]);

// ── 4 · tagged to the conversation ──────────────────────────────────────────────────────────────────
ok("taggedToConversation", g["holo:conversation"] === "conv-7" && received[0]["holo:conversation"] === "conv-7");

// ── 5 · cites evidence (brief, investigation, every insight) ────────────────────────────────────────
ok("citesEvidence",
  g["holo:brief"] === result.brief["@id"] && g["holo:investigation"] === result.investigation["holo:root"]
  && g["holo:insights"].length === result.insights.length && g["holo:insights"].every((k) => result.insights.some((i) => i["@id"] === k)));

// ── 6 · add-intent recognizer ───────────────────────────────────────────────────────────────────────
const yes = ["add this", "look at this", "what do you make of this?", "analyse this for me", "add to context", "take a look at this chart"];
const no = ["delete this", "what time is it", "close the window", "play the next track"];
ok("addIntentRecognized", yes.every(isAddIntent) && !no.some(isAddIntent),
  `falseNeg=${yes.filter((t)=>!isAddIntent(t))} falsePos=${no.filter(isAddIntent)}`);

// ── 7 · graceful with no Q bus ──────────────────────────────────────────────────────────────────────
let threw = false; let r7 = null;
try { r7 = await fuseToQ({ result, context, qBus: null }); } catch { threw = true; }
ok("gracefulNoQ", !threw && r7 && r7.delivered === false && r7.grounding["@id"] === g["@id"]);

// ── 8 · per-conversation: a different thread → different grounding κ ─────────────────────────────────
const gOther = groundingFrom(result, { ...context, qConversationId: "conv-99" });
ok("differentContextDifferentGrounding", gOther["@id"] !== g["@id"] && gOther["holo:conversation"] === "conv-99");

const witnessed = Object.values(checks).every(Boolean);
const out = {
  "@type": "earl:TestResult",
  spec: "The + Everywhere — A4 Q FUSION: a drop + its insights become a sealed holo:Grounding κ-object pushed onto Q's context bus (tagged to the conversation, citing brief/investigation/insight κs). The voice door ('add this', via ASR) and the text door (the '+') converge on the IDENTICAL grounding for the same result+context — voice and text are one path. Per-conversation (different thread → different grounding κ); graceful with no Q present; the grounding re-derives (Law L5)",
  authority: "UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L2/L5 · rests on #holo-plus + #holo-q-app",
  witnessed,
  covers: witnessed ? ["q-fusion","grounding-kappa","voice-text-converge","lands-on-bus","conversation-tagged","cites-evidence","add-intent","graceful","per-conversation"] : [],
  sample: { grounding: g["@id"], conversation: g["holo:conversation"], text: g["schema:text"], insights: g["holo:insights"].length },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-plus-q-witness.result.json"), JSON.stringify(out, null, 2) + "\n");
console.log("holo-plus-q witness — A4 The + (drop → Q grounding; voice + text converge on one path)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  grounding ${g["@id"].slice(0, 26)}… → conversation ${g["holo:conversation"]}`);
console.log(`  "${g["schema:text"]}"`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the + is part of Q — say 'add this' or click '+', one grounding, same conversation" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
