// holo-mail-draft.gate.mjs - M2/5 gate: voice from Sent κ-history, draft only when a reply is owed,
// κ-link written, Law-L5 no-fabricate on empty brain, zero egress.
import { makeMailAI } from "./holo-mail-ai.mjs";
import { makeMailDraft } from "./holo-mail-draft.mjs";
import { makeStrand } from "../../tauri/dist/usr/lib/holo/holo-strand.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } };

// brain echoes the reader's characteristic sign-off so we can prove voice context reached it.
let sawVoice = false;
const brain = { id: "mock", async *generate(messages) {
  const joined = messages.map((m) => m.content).join(" ");
  sawVoice = /Cheers, Ada/.test(joined);              // voice example must be in the prompt
  const s = "Sounds good - 3pm works. Cheers, Ada";
  for (let i = 0; i < s.length; i += 4) yield s.slice(i, i + 4);
} };
const emptyBrain = { id: "empty", async *generate() { /* yields nothing */ } };

const corpus = { t1: [
  { id: "m1", threadId: "t1", from: "bob@x.io", fromName: "Bob", to: ["ada@holo.os"], subject: "Tuesday?", date: "2026-07-01T09:00:00Z", fromMe: false, text: "Can we meet Tuesday?" },
] };
// operator's sent history (voice)
const sent = [{ id: "s1", from: "ada@holo.os", fromMe: true, to: ["x@y.io"], subject: "re", date: "2026-06-30T00:00:00Z", text: "Works for me. Cheers, Ada" }];
const provider = { threadMessages: (jid) => corpus[jid] || [], allMessages: () => [...Object.values(corpus).flat(), ...sent] };

const _fetch = globalThis.fetch; let net = false; globalThis.fetch = () => { net = true; throw new Error("egress"); };
try {
  const strand = makeStrand({ now: () => "2026-07-01T10:00:00Z" });
  const d = makeMailDraft({ ai: makeMailAI({ brain }), provider, strand, now: () => "2026-07-01T10:00:00Z" });

  const r1 = await d.draft("t1");
  ok("drafts a reply body", r1 && r1.text.length > 0);
  ok("voice profile reached the prompt", sawVoice === true);
  ok("draft written as κ-link + chain verifies", !!r1.kappa && strand.length() === 1 && (await strand.verify()).ok);

  // ball not in reader's court: latest message is fromMe → no draft
  corpus.t1.push({ id: "m2", threadId: "t1", from: "ada@holo.os", fromName: "Me", to: ["bob@x.io"], subject: "Re", date: "2026-07-01T09:05:00Z", fromMe: true, text: "Yes." });
  ok("nothing owed (last is fromMe) → no draft", (await d.draft("t1")) === null);

  // empty thread → null
  ok("empty thread → null", (await d.draft("t404")) === null);

  // Law L5: empty brain → NO draft (never fabricated)
  const dEmpty = makeMailDraft({ ai: makeMailAI({ brain: emptyBrain }), provider, strand });
  corpus.t2 = [{ id: "z1", threadId: "t2", from: "c@x.io", fromName: "C", to: ["ada@holo.os"], subject: "hi", date: "2026-07-01T09:00:00Z", fromMe: false, text: "ping" }];
  ok("empty brain → no fabricated draft (null)", (await dEmpty.draft("t2")) === null);

  ok("no network egress", net === false);
} finally { globalThis.fetch = _fetch; }

console.log(`\nholo-mail-draft gate: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
