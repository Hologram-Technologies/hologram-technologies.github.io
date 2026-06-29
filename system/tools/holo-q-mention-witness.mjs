// holo-q-mention-witness.mjs — proves Q-in-groups (M7): mention-gated, publishes over the peer transport,
// authored as Q, idempotent, and loop-safe (never answers itself). Node, fake brain + fake thread + a fake
// publish (captures the object AND appends it, so the self-loop guard is exercised) + real seal/verify mint.
//
// Proves: (1) mentionsQ token rules; (2) an @Q message → ONE published Q reply (verifiable κ, authored Q);
// (3) no @Q → nothing published (Q stays silent in groups); (4) Q's own last message → no reply (no loop);
// (5) idempotent — a second pass on the same mention publishes nothing; (6) group history is sender-prefixed;
// (7) abort publishes nothing.

import { makeQGroupResponder, mentionsQ, Q_IDENTITY } from "../os/usr/lib/holo/q/holo-q-contact.mjs";
import { seal, verify } from "../os/usr/lib/holo/holo-object.mjs";
import { messageObject } from "../os/usr/lib/holo/holo-pluck.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };

const mintFn = (input) => ({ object: seal(messageObject(input)) });
function makeGroup(seed = []) {
  const events = seed.slice(), published = [];
  return {
    thread: { view: () => events.map((e, i) => ({ text: e.text, sender: e.sender, seq: i, kappa: e.kappa })) },
    publish: async (obj) => { ok(verify(obj), "published object re-derives to its κ (verifiable, Law L5)"); published.push(obj); events.push({ text: obj["schema:text"], sender: "Q", kappa: obj.id }); },
    say: (sender, text) => { const o = seal(messageObject({ text, sender, chat: "Hologram Devs", source: "holo" })); events.push({ text, sender, kappa: o.id }); },
    _events: events, _published: published,
  };
}
function makeFakeBrain(reply = "On it — eta is tomorrow.") {
  let lastHistory = null;
  return { lastHistory: () => lastHistory, setSkill: async () => {}, generate: async function* (h, { signal } = {}) { lastHistory = h; for (const w of String(reply).split(" ")) { if (signal && signal.aborted) return; yield " " + w; } } };
}

// (1) mentionsQ token rules
ok(mentionsQ("@Q what's the eta?") && mentionsQ("hey @q can you help") && mentionsQ("@Q"), "mentionsQ true for an @Q token");
ok(!mentionsQ("ask q about it") && !mentionsQ("email q@example.com") && !mentionsQ("@Quentin says hi"), "mentionsQ false for non-mentions (bare q, email, @Quentin)");

// (2)(6) a mention → one published, verifiable, Q-authored reply; group history is sender-prefixed
{
  const g = makeGroup(); const brain = makeFakeBrain("Alice — eta is tomorrow.");
  const qg = makeQGroupResponder({ brain, now: () => "2026-06-29T00:00:00Z" });
  g.say("Bob", "morning all"); g.say("Alice", "@Q what's the eta?");
  const r = await qg.respondInGroup(g.thread, { publish: g.publish, mintFn, group: "Hologram Devs" });
  ok(r.published === true && /sha256/.test(String(r.kappa)), "an @Q message triggers ONE published Q reply");
  const last = g._events[g._events.length - 1];
  ok(last.sender === "Q" && last.text === "Alice — eta is tomorrow.", "the reply lands in the group authored as Q");
  const h = brain.lastHistory();
  ok(h[0].role === "system" && /GROUP/.test(h[0].content), "group system prompt set");
  ok(h.some((m) => m.role === "user" && m.content === "Alice: @Q what's the eta?"), "group history is SENDER-PREFIXED (Q knows who asked)");
}

// (3) no mention → silent
{
  const g = makeGroup(); const brain = makeFakeBrain();
  const qg = makeQGroupResponder({ brain, now: () => "t" });
  g.say("Bob", "deploy is green");
  const r = await qg.respondInGroup(g.thread, { publish: g.publish, mintFn, group: "Hologram Devs" });
  ok(r.skipped === "no-mention" && g._published.length === 0, "no @Q → Q stays silent (nothing published)");
}

// (4) Q's own last message → no reply (loop-safe)
{
  const g = makeGroup(); const brain = makeFakeBrain();
  const qg = makeQGroupResponder({ brain, now: () => "t" });
  g.say("Q", "earlier Q reply");
  const r = await qg.respondInGroup(g.thread, { publish: g.publish, mintFn, group: "Hologram Devs" });
  ok(r.skipped === "own" && g._published.length === 0, "Q never answers its own message (no loop)");
}

// (5) idempotent — same mention, second pass publishes nothing
{
  const g = makeGroup(); const brain = makeFakeBrain("once");
  const qg = makeQGroupResponder({ brain, now: () => "t" });
  g.say("Carol", "@Q ping");
  await qg.respondInGroup(g.thread, { publish: g.publish, mintFn, group: "g" });
  const before = g._published.length;
  // simulate a re-render firing the check again, but the LAST message is now Q's reply → skip "own";
  // to test idempotency directly, drop Q's reply and re-run on the SAME mention:
  g._events.pop();
  const r2 = await qg.respondInGroup(g.thread, { publish: g.publish, mintFn, group: "g" });
  ok(before === 1 && r2.skipped === "already", "idempotent: the same mention is answered exactly once");
}

// (7) abort → nothing published
{
  const g = makeGroup(); const brain = makeFakeBrain("one two three four");
  const qg = makeQGroupResponder({ brain, now: () => "t" });
  g.say("Dave", "@Q long answer please");
  const ctrl = new AbortController(); let n = 0;
  const origPublish = g.publish; let published = 0; const publish = async (o) => { published++; return origPublish(o); };
  const r = await qg.respondInGroup(g.thread, { publish, mintFn, group: "g", signal: ctrl.signal, onDelta: () => { if (++n === 1) ctrl.abort(); } });
  ok(r.aborted === true && published === 0, "aborted mid-reply → nothing published");
}

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED: @Q makes Q a real group participant — it replies once, only when mentioned, publishes a verifiable Q-authored κ to every peer, knows who asked, and never answers itself."}`);
process.exit(fail ? 1 : 0);
