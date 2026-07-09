// holo-mail-engine.gate.mjs - production composition-root gate.
// Real holo-strand + per-label mock brains → proves enrich (summary+status+lane), draftFor, lanes
// bucketing, and the load-bearing GRACEFUL DEGRADATION: no Q brain → nulls, never a throw, never a fake.
//   run:  node holo-mail-engine.gate.mjs
import { makeMailEngine } from "./holo-mail-engine.mjs";
import { toEmailForLLM } from "./holo-mail-provider.mjs";
import { makeStrand } from "../../tauri/dist/usr/lib/holo/holo-strand.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } };
const stream = async function* (s) { for (let i = 0; i < s.length; i += 4) yield s.slice(i, i + 4); };

// a per-label brain bank: the engine's brainFor(label) picks the right one.
const brains = {
  "summarize":   { id: "s", generate: () => stream("Maya is asking to confirm Thursday's design review.") },
  "thread-status": { id: "t", generate: (messages) => { const txt = messages.map((m) => m.content).join(" "); const st = /50%|sale|off!/i.test(txt) ? "FYI" : "TO_REPLY"; return stream(JSON.stringify({ status: st, rationale: "x" })); } },
  "categorize":  { id: "c", generate: () => stream(JSON.stringify({ senders: [{ sender: "maya@northwind.co", category: "Important" }, { sender: "promo@shop.com", category: "News" }] })) },
  "cold-email":  { id: "x", generate: () => stream(JSON.stringify({ coldEmail: false, reason: "known" })) },
  "draft-reply": { id: "d", generate: () => stream("Thanks, Maya - Thursday at 3pm works. - Ada") },
};
const brainFor = (label) => brains[label] || null;

const corpus = {
  t1: [{ id: "m1", threadId: "t1", from: "maya@northwind.co", fromName: "Maya", to: ["me@holo.os"], subject: "Design review?", date: "2026-07-01T09:00:00Z", fromMe: false, text: "Can you confirm Thursday 3pm?", snippet: "confirm", attachments: [] }],
  t2: [{ id: "n1", threadId: "t2", from: "promo@shop.com", fromName: "Shop", to: ["me@holo.os"], subject: "SALE", date: "2026-07-01T08:00:00Z", fromMe: false, text: "50% off!", snippet: "50", attachments: [] }],
};
const provider = { threadMessages: (jid) => corpus[jid] || [], allMessages: () => Object.values(corpus).flat(), toEmailForLLM };

const _fetch = globalThis.fetch; let net = false; globalThis.fetch = () => { net = true; throw new Error("egress"); };
try {
  const strand = makeStrand({ now: () => "2026-07-01T10:00:00Z" });
  const engine = makeMailEngine({ provider, strand, brainFor, now: () => "2026-07-01T10:00:00Z" });

  await engine.prime();
  const e1 = await engine.enrich("t1");
  ok("enrich returns summary", e1 && /Maya/.test(e1.summary));
  ok("enrich returns status", e1.status === "TO_REPLY");
  ok("enrich routes to Reply lane", e1.lane === "reply");
  ok("κ-links written + chain verifies", strand.length() > 0 && (await strand.verify()).ok);

  const d1 = await engine.draftFor("t1");
  ok("draftFor returns a ready reply", d1 && /Maya/.test(d1.text));

  const buckets = await engine.lanes(["t1", "t2"]);
  ok("lanes: Reply has t1, News has t2", buckets.reply.some((x) => x.jid === "t1") && buckets.news.some((x) => x.jid === "t2"));

  // ── graceful degradation: NO Q brain → nulls, no throw, no fabrication ──
  const dark = makeMailEngine({ provider, strand: makeStrand({ now: () => "2026-07-01T10:00:00Z" }), brainFor: () => null });
  const eDark = await dark.enrich("t1");
  ok("no brain → enrich yields nulls (no throw)", eDark && eDark.summary === null && eDark.status === null);
  ok("no brain → draft is null (no fabrication)", (await dark.draftFor("t1")) === null);
  ok("no brain → still lanes without crashing", !!(await dark.lanes(["t1", "t2"])));

  // ── empty-stream brain (Q loaded but yields nothing) → same graceful nulls ──
  const emptyBrain = { id: "e", generate: async function* () {} };
  const quiet = makeMailEngine({ provider, strand: makeStrand({ now: () => "2026-07-01T10:00:00Z" }), brainFor: () => emptyBrain });
  const eQuiet = await quiet.enrich("t1");
  ok("empty-stream brain → nulls (Law L5)", eQuiet.summary === null && eQuiet.status === null);

  ok("no network egress", net === false);
} finally { globalThis.fetch = _fetch; }

console.log(`\nholo-mail-engine gate: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
