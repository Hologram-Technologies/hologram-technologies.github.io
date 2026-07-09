// holo-mail-multi.gate.mjs - M4/E gate: two accounts unified. Namespaced ids, merged lists, routed sends,
// aggregated history/voice, connect fan-out - and the real engine running over the unified provider.
//   run:  node holo-mail-multi.gate.mjs
import { makeMultiProvider } from "./holo-mail-multi.mjs";
import { toEmailForLLM } from "./holo-mail-provider.mjs";
import { makeMailAI } from "./holo-mail-ai.mjs";
import { makeMailEngine } from "./holo-mail-engine.mjs";
import { makeStrand } from "../../tauri/dist/usr/lib/holo/holo-strand.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } };

// a tiny single-account provider over a fixed corpus, tracking send routing + connect calls.
function acct(id, corpus) {
  const sent = []; let connected = 0;
  return {
    id, sent, connected: () => connected,
    provider: {
      threadMessages: (jid) => corpus[jid] || [],
      allMessages: () => Object.values(corpus).flat(),
      listThreads: async () => Object.keys(corpus).map((jid) => ({ jid, chat: (corpus[jid][0] || {}).fromName })),
      sendReply: async ({ chat, text }) => { sent.push({ chat, text }); return { ok: true }; },
      markRead: async () => ({ ok: true }),
      connect: async () => { connected++; },
      mediaUrl: (id) => "/media/" + id,
      toEmailForLLM,
    },
  };
}

const work = acct("work", { w1: [{ id: "w1m", threadId: "w1", from: "boss@corp.com", fromName: "Boss", to: ["me@corp.com"], subject: "Ping", date: "2026-07-01T09:00:00Z", fromMe: false, text: "Can you confirm?" }] });
const home = acct("home", { h1: [{ id: "h1m", threadId: "h1", from: "mom@gmail.com", fromName: "Mom", to: ["me@gmail.com"], subject: "Dinner", date: "2026-07-01T08:00:00Z", fromMe: false, text: "Free Sunday?" }],
  h2: [{ id: "h2m", threadId: "h2", from: "me@gmail.com", fromName: "Me", to: ["x@y.io"], subject: "re", date: "2026-06-30T00:00:00Z", fromMe: true, text: "Sounds good. - Ada" }] });

const multi = makeMultiProvider({ accounts: [{ id: "work", label: "Work", provider: work.provider }, { id: "home", label: "Home", provider: home.provider }] });

// list + namespacing
const list = await multi.listThreads();
ok("listThreads merges both accounts", list.length === 3 && list.every((s) => s.jid.includes("::")));
ok("threads carry account + label", list.some((s) => s.account === "work" && s.accountLabel === "Work") && list.some((s) => s.account === "home"));

// threadMessages routes by namespaced id
const wm = multi.threadMessages("work::w1");
ok("threadMessages routes to owning account", wm.length === 1 && wm[0].id === "w1m" && wm[0].account === "work");
ok("accountOf / accountLabel decode", multi.accountOf("home::h1") === "home" && multi.accountLabel("home::h1") === "Home");

// allMessages aggregates + namespaces
const all = multi.allMessages();
ok("allMessages aggregates across accounts", all.length === 3 && all.every((m) => m.threadId.includes("::")));

// send routes to the right account only
await multi.sendReply({ chat: "work::w1", text: "yes" });
ok("send routes to owning account", work.sent.length === 1 && work.sent[0].chat === "w1" && home.sent.length === 0);

// connect fans out to all
await multi.connect();
ok("connect fans out to all accounts", work.connected() === 1 && home.connected() === 1);

// the real engine runs over the unified provider (enrich a work thread)
{
  const brain = { id: "m", async *generate(messages) {
    const sys = (messages.find((m) => m.role === "system") || {}).content || "";
    if (/summarize/i.test(sys)) { for (const c of "Boss is asking for confirmation.") yield c; return; }
    if (/classify/i.test(sys)) { const s = JSON.stringify({ status: "TO_REPLY", rationale: "x" }); for (const c of s) yield c; return; }
    if (/assign each email sender/i.test(sys)) { const s = JSON.stringify({ senders: [] }); for (const c of s) yield c; return; }
    if (/cold email/i.test(sys)) { const s = JSON.stringify({ coldEmail: false, reason: "known" }); for (const c of s) yield c; return; }
  } };
  const engine = makeMailEngine({ provider: multi, strand: makeStrand({ now: () => "2026-07-01T10:00:00Z" }), brainFor: () => brain, now: () => "2026-07-01T10:00:00Z" });
  const e = await engine.enrich("work::w1");
  ok("engine.enrich works over unified id", e && e.summary && e.status === "TO_REPLY");
}

console.log(`\nholo-mail-multi gate: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
