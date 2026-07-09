// holo-mail-replyzero.gate.mjs - M2/2 gate.
// Real Seam A qGenerateObject (mock brain returns a status JSON) + real holo-strand → proves: schema-valid
// classification, κ-link written AND chain verifies, cache-on-unchanged, recompute-on-new-message, lane
// bucketing (TO_REPLY first), and zero network egress.
//   run:  node holo-mail-replyzero.gate.mjs
import { makeMailAI } from "./holo-mail-ai.mjs";
import { toEmailForLLM } from "./holo-mail-provider.mjs";
import { makeMailReplyZero, STATUS_SCHEMA } from "./holo-mail-replyzero.mjs";
import { validate } from "./holo-mail-ai.mjs";
import { makeStrand } from "../../tauri/dist/usr/lib/holo/holo-strand.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } };

// mock brain: returns a status keyed off whether the thread's last line is from "You".
let brainCalls = 0;
function brainFor(status) {
  return { id: "mock", async *generate(messages) { brainCalls++; const s = JSON.stringify({ status, rationale: "test" }); for (const ch of s) yield ch; } };
}

const corpus = {
  // reader received an unanswered question → TO_REPLY
  t1: [{ id: "m1", threadId: "t1", from: "ada@x.io", fromName: "Ada", to: ["me@holo.os"], subject: "Tuesday?", date: "2026-07-01T09:00:00Z", fromMe: false, text: "Can you confirm Tuesday 3pm?", attachments: [] }],
  // reader asked and is waiting → AWAITING_REPLY
  t2: [{ id: "n1", threadId: "t2", from: "me@holo.os", fromName: "Me", to: ["bob@x.io"], subject: "Invoice", date: "2026-07-01T08:00:00Z", fromMe: true, text: "Could you send the invoice?", attachments: [] }],
};
const provider = { threadMessages: (jid) => corpus[jid] || [], toEmailForLLM };

const _fetch = globalThis.fetch; let netTouched = false;
globalThis.fetch = () => { netTouched = true; throw new Error("network egress in gate"); };

try {
  // schema self-check
  ok("STATUS_SCHEMA accepts valid / rejects bad enum",
    validate({ status: "TO_REPLY", rationale: "x" }, STATUS_SCHEMA).length === 0 &&
    validate({ status: "NOPE", rationale: "x" }, STATUS_SCHEMA).length === 1);

  const strand = makeStrand({ now: () => "2026-07-01T10:00:00Z" });

  // t1 → TO_REPLY
  const rz1 = makeMailReplyZero({ ai: makeMailAI({ brain: brainFor("TO_REPLY") }), provider, strand, now: () => "2026-07-01T10:00:00Z" });
  const r1 = await rz1.classify("t1");
  ok("classifies to a valid enum status", r1.status === "TO_REPLY" && typeof r1.rationale === "string");
  ok("κ-link written + chain verifies", !!r1.kappa && strand.length() === 1 && (await strand.verify()).ok);

  const before = brainCalls;
  const r1b = await rz1.classify("t1");
  ok("unchanged thread → hot cache (no recompute)", r1b.cached === "hot" && brainCalls === before && strand.length() === 1);

  // new inbound message flips it back to TO_REPLY territory and forces recompute
  corpus.t1.push({ id: "m2", threadId: "t1", from: "ada@x.io", fromName: "Ada", to: ["me@holo.os"], subject: "Re: Tuesday?", date: "2026-07-01T09:10:00Z", fromMe: false, text: "Still need your confirmation.", attachments: [] });
  const r1c = await rz1.classify("t1");
  ok("new message → recompute + new κ", r1c.cached === false && strand.length() === 2 && r1c.lastId === "m2");

  // lanes: mix TO_REPLY (t1) with AWAITING (t2) via a separate responder
  const rz2 = makeMailReplyZero({ ai: makeMailAI({ brain: brainFor("AWAITING_REPLY") }), provider, strand, now: () => "2026-07-01T10:00:00Z" });
  await rz2.classify("t2");
  const buckets = await rz1.lanes(["t1", "t2"]);   // t1 cached TO_REPLY, t2 cached AWAITING (chain memo)
  ok("lane bucketing: TO_REPLY and AWAITING sorted", buckets.toReply.some((x) => x.jid === "t1") && buckets.awaiting.some((x) => x.jid === "t2"));

  ok("no network egress during gate", netTouched === false);
} finally {
  globalThis.fetch = _fetch;
}

console.log(`\nholo-mail-replyzero gate: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
