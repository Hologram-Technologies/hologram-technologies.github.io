// holo-mail-provider.gate.mjs - S1 gate for SEAM B.
// Spins a REAL in-process mock bridge (localhost HTTP + SSE) and drives the provider through it end to end:
// status, /summary, live /events → corpus grouping + normalization (fromEmail, listUnsubscribe surfaced),
// EmailForLLM shaping, /send + /read POST bodies, media URL, loopback guard.
//   run:  node holo-mail-provider.gate.mjs
import http from "node:http";
import { makeMailProvider, normalizeMessage, toEmailForLLM } from "./holo-mail-provider.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Scripted mail events, in the exact shape the enriched email-bridge emits.
const EVENTS = [
  { platform: "gmail", jid: "t1", chat: "Ada", sender: "Ada Lovelace", text: "Are we still on for Tuesday? Please confirm.", fromMe: false, sentAt: "2026-07-01T09:00:00.000Z", extId: "email:msg:a1", subject: "Tuesday?", fromEmail: "ada@analytical.io", toEmails: ["me@holo.os"] },
  { platform: "gmail", jid: "t1", chat: "Ada", sender: "Me", text: "Yes - 3pm works.", fromMe: true, sentAt: "2026-07-01T09:05:00.000Z", extId: "email:msg:a2", subject: "Re: Tuesday?", fromEmail: "me@holo.os", toEmails: ["ada@analytical.io"] },
  { platform: "gmail", jid: "t2", chat: "BigDeals", sender: "BigDeals", text: "50% off everything!", fromMe: false, sentAt: "2026-07-01T10:00:00.000Z", extId: "email:msg:b1", subject: "SALE", fromEmail: "promo@bigdeals.com", toEmails: ["me@holo.os"], listUnsubscribe: "<https://bigdeals.com/u/abc>, <mailto:unsub@bigdeals.com>" },
];
let lastSend = null, lastRead = null;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  const body = async () => { let b = ""; for await (const c of req) b += c; return JSON.parse(b || "{}"); };
  if (url.pathname === "/status") return json({ linked: true, accounts: [{ email: "me@holo.os", provider: "Gmail", health: "ok" }] });
  if (url.pathname === "/summary") return json([{ jid: "t1", chat: "Ada", preview: "Yes - 3pm works.", ts: 1, unread: 0, group: false, pinned: false }, { jid: "t2", chat: "BigDeals", preview: "50% off", ts: 2, unread: 1, group: false, pinned: false }]);
  if (url.pathname === "/send") { lastSend = await body(); return json({ ok: true }); }
  if (url.pathname === "/read") { lastRead = await body(); return json({ ok: true }); }
  if (url.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    for (const ev of EVENTS) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "summary-delta", jid: "t1" })}\n\n`);   // control frame - must be ignored
    return; // hold open
  }
  res.writeHead(404); res.end();
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  // pure functions first
  {
    const m = normalizeMessage(EVENTS[2]);
    ok("normalize surfaces fromEmail + listUnsubscribe", m.from === "promo@bigdeals.com" && m.listUnsubscribe.includes("bigdeals.com/u/abc"));
    const llm = toEmailForLLM(m);
    ok("EmailForLLM shapes from/to/content", llm.from.includes("promo@bigdeals.com") && llm.to === "me@holo.os" && llm.content.includes("50%"));
  }

  const p = makeMailProvider({ base });

  const st = await p.status();
  ok("status() reads bridge", st.linked === true && st.accounts[0].email === "me@holo.os");

  const threads = await p.listThreads();
  ok("listThreads() returns summary", threads.length === 2 && threads[0].jid === "t1");

  const stop = await p.connect();
  await sleep(120);   // let the SSE frames drain into the corpus

  const t1 = p.threadMessages("t1");
  ok("live events grouped by thread, chronological", t1.length === 2 && t1[0].id === "email:msg:a1" && t1[1].fromMe === true);
  ok("control frame (summary-delta) ignored", p.threadMessages("t1").length === 2);

  const t2 = p.threadMessages("t2");
  ok("second thread captured with unsub metadata", t2.length === 1 && t2[0].listUnsubscribe.includes("mailto:unsub@bigdeals.com"));

  // de-dup: replaying an event doesn't double-count
  p._record(EVENTS[0]);
  ok("de-dup by message id", p.threadMessages("t1").length === 2);

  await p.sendReply({ chat: "t1", text: "See you at 3." });
  ok("sendReply posts {chat,text}", lastSend && lastSend.chat === "t1" && lastSend.text === "See you at 3.");

  await p.markRead("t2");
  ok("markRead posts {chat}", lastRead && lastRead.chat === "t2");

  ok("mediaUrl builds loopback path", p.mediaUrl("email:attach:x:0").startsWith(base + "/media/"));

  // loopback guard
  let threw = false;
  try { makeMailProvider({ base: "http://evil.example.com" }); } catch { threw = true; }
  ok("rejects non-loopback base", threw);

  stop();
} finally {
  server.close();
}

console.log(`\nholo-mail-provider gate: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
