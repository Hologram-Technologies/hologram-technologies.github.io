// holo-mail-cold.gate.mjs - M2/4 gate: staged decision (tag → history → AI), exclusion, zero egress.
import { makeMailAI } from "./holo-mail-ai.mjs";
import { makeMailCold, COLD_SCHEMA } from "./holo-mail-cold.mjs";
import { validate } from "./holo-mail-ai.mjs";
import { makeStrand } from "../../tauri/dist/usr/lib/holo/holo-strand.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } };

let aiCalls = 0;
const brain = { id: "mock", async *generate() { aiCalls++; const s = JSON.stringify({ coldEmail: true, reason: "unsolicited sales pitch" }); for (const ch of s) yield ch; } };
const provider = { allMessages: () => [
  { from: "me@holo.os", fromMe: true, to: ["ada@x.io"], subject: "hi", text: "hey" },   // reader wrote to Ada → history
] };

const _fetch = globalThis.fetch; let net = false; globalThis.fetch = () => { net = true; throw new Error("egress"); };
try {
  ok("COLD_SCHEMA validates", validate({ coldEmail: true, reason: "x" }, COLD_SCHEMA).length === 0);

  const strand = makeStrand({ now: () => "2026-07-01T10:00:00Z" });
  const cold = makeMailCold({ ai: makeMailAI({ brain }), provider, strand, now: () => "2026-07-01T10:00:00Z" });

  // stage: history - Ada is known (reader emailed her) → not cold, AI NOT consulted
  const r1 = await cold.isCold({ from: "ada@x.io", fromMe: false, subject: "re", text: "thanks" });
  ok("prior correspondence → not cold (history stage, no AI)", r1.cold === false && r1.stage === "history" && aiCalls === 0);

  // stage: ai - unknown sender, no history → AI says cold
  const r2 = await cold.isCold({ from: "sales@vendor.io", fromMe: false, subject: "Boost your revenue", text: "Book a demo!" });
  ok("unknown sender → AI stage, cold", r2.cold === true && r2.stage === "ai" && aiCalls === 1);

  // learned tag: mark not-cold → next time skip AI (exclusion)
  await cold.markNotCold("sales@vendor.io");
  const r3 = await cold.isCold({ from: "sales@vendor.io", fromMe: false, subject: "again", text: "hi" });
  ok("exclusion tag rescues sender (tag stage, no new AI)", r3.cold === false && r3.stage === "tag" && aiCalls === 1);
  ok("chain verifies", (await strand.verify()).ok);

  ok("own message → not cold", (await cold.isCold({ from: "me@holo.os", fromMe: true, subject: "x", text: "y" })).cold === false);
  ok("no network egress", net === false);
} finally { globalThis.fetch = _fetch; }

console.log(`\nholo-mail-cold gate: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
