// holo-mail-ai.gate.mjs - S1 spike gate for SEAM A.
// Proves the structured-output layer works against Q's real brain contract (async *generate token stream)
// using a deterministic MOCK brain - no model, no network. Runtime binds the real Q brain identically.
//   run:  node holo-mail-ai.gate.mjs
import { makeMailAI, validate, extractJson } from "./holo-mail-ai.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } };

// A mock brain: yields a scripted string as a token stream (2-char chunks), like a real decoder would.
function scriptedBrain(script) {
  return {
    id: "mock",
    async *generate(_messages, _opts) {
      const s = typeof script === "function" ? script(_messages) : script;
      for (let i = 0; i < s.length; i += 2) yield s.slice(i, i + 2);
    },
  };
}

// Trip-wire: fail loudly if any code path touches the network during a gate run.
const _fetch = globalThis.fetch;
let netTouched = false;
globalThis.fetch = () => { netTouched = true; throw new Error("network egress in gate"); };

const STATUS = { type: "object", required: ["status", "rationale"], fields: {
  status: { type: "enum", values: ["TO_REPLY", "AWAITING_REPLY", "FYI", "ACTIONED"] },
  rationale: { type: "string" },
} };

try {
  // 1. clean JSON parses + validates
  {
    const ai = makeMailAI({ brain: scriptedBrain(`{"status":"TO_REPLY","rationale":"asks a question"}`) });
    const out = await ai.qGenerateObject({ prompt: "x", schema: STATUS, label: "thread-status" });
    ok("clean JSON → object", out.status === "TO_REPLY" && out.rationale.length > 0);
  }

  // 2. JSON wrapped in prose + ```fences``` is extracted
  {
    const wrapped = "Sure! Here you go:\n```json\n{\"status\":\"FYI\",\"rationale\":\"cc only\"}\n```\nHope that helps.";
    const ai = makeMailAI({ brain: scriptedBrain(wrapped) });
    const out = await ai.qGenerateObject({ prompt: "x", schema: STATUS });
    ok("fenced/prose-wrapped JSON extracted", out.status === "FYI");
  }

  // 3. trailing-comma + smart-quote repair
  {
    const dirty = `{ “status”: “ACTIONED”, “rationale”: “done”, }`;
    const r = extractJson(dirty);
    ok("repairs smart-quotes + trailing comma", r.ok && r.value.status === "ACTIONED");
  }

  // 4. schema mismatch on attempt 1, corrected on retry
  {
    let n = 0;
    const brain = { id: "mock", async *generate() {
      n++;
      const s = n === 1 ? `{"status":"MAYBE","rationale":"bad enum"}` : `{"status":"AWAITING_REPLY","rationale":"waiting"}`;
      for (const ch of s) yield ch;
    } };
    const ai = makeMailAI({ brain });
    const out = await ai.qGenerateObject({ prompt: "x", schema: STATUS, retries: 1 });
    ok("bad enum → retry → valid", out.status === "AWAITING_REPLY" && n === 2);
  }

  // 5. never fakes: unrecoverable output throws (Law L5), does not return junk
  {
    const ai = makeMailAI({ brain: scriptedBrain("totally not json at all") });
    let threw = false;
    try { await ai.qGenerateObject({ prompt: "x", schema: STATUS, retries: 1 }); } catch { threw = true; }
    ok("unrecoverable → throws (no fabrication)", threw);
  }

  // 6. empty generation throws for text too
  {
    const ai = makeMailAI({ brain: scriptedBrain("") });
    let threw = false;
    try { await ai.qGenerateText({ prompt: "x" }); } catch { threw = true; }
    ok("empty text → throws", threw);
  }

  // 7. route() tiering picks a different brain per label
  {
    const seen = [];
    const route = async (label) => { seen.push(label); return scriptedBrain(`{"status":"FYI","rationale":"r"}`); };
    const ai = makeMailAI({ route });
    await ai.qGenerateObject({ prompt: "x", schema: STATUS, label: "cold-email" });
    ok("route(label) consulted for tiering", seen[0] === "cold-email");
  }

  // 8. validator direct: nested array-of-objects contract (rules engine shape)
  {
    const RULES = { type: "object", required: ["matchedRules", "noMatchFound"], fields: {
      matchedRules: { type: "array", items: { type: "object", required: ["ruleName", "isPrimary"], fields: {
        ruleName: { type: "string" }, isPrimary: { type: "boolean" } } } },
      reasoning: { type: "string" },
      noMatchFound: { type: "boolean" },
    } };
    const good = validate({ matchedRules: [{ ruleName: "Newsletter", isPrimary: true }], noMatchFound: false }, RULES);
    const bad = validate({ matchedRules: [{ ruleName: "X" }], noMatchFound: false }, RULES);
    ok("nested array-of-objects validates", good.length === 0 && bad.length === 1);
  }

  ok("no network egress during gate", netTouched === false);
} finally {
  globalThis.fetch = _fetch;
}

console.log(`\nholo-mail-ai gate: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
