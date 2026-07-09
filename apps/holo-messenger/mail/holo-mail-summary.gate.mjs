// holo-mail-summary.gate.mjs - M2/1 gate.
// Real Seam A (makeMailAI over a mock brain) + real holo-strand (in-memory) → proves: summary produced,
// κ-link written AND the chain verifies, cache-on-unchanged (no recompute, no extra κ), recompute-on-new-
// message, durable memo across a fresh instance, empty-thread → null, and zero network egress.
//   run:  node holo-mail-summary.gate.mjs
import { makeMailAI } from "./holo-mail-ai.mjs";
import { toEmailForLLM } from "./holo-mail-provider.mjs";
import { makeMailSummary } from "./holo-mail-summary.mjs";
import { makeStrand } from "../../tauri/dist/usr/lib/holo/holo-strand.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } };

// mock brain: counts calls, streams back a canned one-liner as tokens.
let brainCalls = 0;
const brain = { id: "mock", async *generate() { brainCalls++; const s = "Ada is confirming the Tuesday 3pm meeting."; for (let i = 0; i < s.length; i += 3) yield s.slice(i, i + 3); } };

// stub provider: real toEmailForLLM, a mutable thread corpus.
const corpus = { t1: [
  { id: "m1", threadId: "t1", from: "ada@x.io", fromName: "Ada", to: ["me@holo.os"], subject: "Tuesday?", date: "2026-07-01T09:00:00Z", fromMe: false, text: "Are we on for Tuesday 3pm?", attachments: [] },
] };
const provider = { threadMessages: (jid) => corpus[jid] || [], toEmailForLLM };

// network trip-wire
const _fetch = globalThis.fetch; let netTouched = false;
globalThis.fetch = () => { netTouched = true; throw new Error("network egress in gate"); };

try {
  const ai = makeMailAI({ brain });
  const strand = makeStrand({ now: () => "2026-07-01T10:00:00Z" });   // in-memory, unsigned (still hash-links)
  const sum = makeMailSummary({ ai, provider, strand, now: () => "2026-07-01T10:00:00Z" });

  // 1. produces a one-line summary + writes a κ-link
  const r1 = await sum.summarize("t1");
  ok("summary produced", r1 && /Tuesday/.test(r1.summary) && !/\n/.test(r1.summary));
  ok("κ-link written (has kappa id)", !!r1.kappa && strand.length() === 1);
  ok("chain verifies (Law L5)", (await strand.verify()).ok === true);
  ok("first call hit the brain once", brainCalls === 1);

  // 2. cache-on-unchanged: same last message → no recompute, no new κ
  const r2 = await sum.summarize("t1");
  ok("unchanged thread → hot cache", r2.cached === "hot" && brainCalls === 1 && strand.length() === 1);

  // 3. new message arrives → recompute + new κ-link
  corpus.t1.push({ id: "m2", threadId: "t1", from: "me@holo.os", fromName: "Me", to: ["ada@x.io"], subject: "Re: Tuesday?", date: "2026-07-01T09:05:00Z", fromMe: true, text: "Yes, see you at 3.", attachments: [] });
  const r3 = await sum.summarize("t1");
  ok("new message → recompute", r3.cached === false && brainCalls === 2 && r3.lastId === "m2" && strand.length() === 2);
  ok("chain still verifies after 2nd append", (await strand.verify()).ok === true);

  // 4. durable memo: a FRESH summary instance over the same strand reuses the recorded κ (no brain call)
  const sum2 = makeMailSummary({ ai, provider, strand, now: () => "2026-07-01T10:00:00Z" });
  const r4 = await sum2.summarize("t1");
  ok("durable memo across instances (chain cache)", r4.cached === "chain" && brainCalls === 2);

  // 5. empty thread → null (never fabricates)
  const rEmpty = await sum.summarize("t404");
  ok("empty thread → null", rEmpty === null);

  ok("no network egress during gate", netTouched === false);
} finally {
  globalThis.fetch = _fetch;
}

console.log(`\nholo-mail-summary gate: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
