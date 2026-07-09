// holo-mail-categorize.gate.mjs - M2/3 gate.
import { makeMailAI } from "./holo-mail-ai.mjs";
import { makeMailCategorize, SENDERS_SCHEMA, DEFAULT_TAXONOMY } from "./holo-mail-categorize.mjs";
import { makeStrand } from "../../tauri/dist/usr/lib/holo/holo-strand.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } };

// mock brain returns categories incl. one HALLUCINATED ("Aliens") that must be coerced to "Other".
const brain = { id: "mock", async *generate() {
  const s = JSON.stringify({ senders: [
    { sender: "ada@x.io", category: "Important" },
    { sender: "promo@shop.com", category: "News" },
    { sender: "weird@z.io", category: "Aliens" },
  ] });
  for (const ch of s) yield ch;
} };
const provider = { allMessages: () => [
  { from: "ada@x.io", fromMe: false, subject: "Tuesday?", snippet: "confirm 3pm" },
  { from: "promo@shop.com", fromMe: false, subject: "SALE", snippet: "50% off" },
  { from: "weird@z.io", fromMe: false, subject: "hi", snippet: "..." },
] };

const _fetch = globalThis.fetch; let net = false; globalThis.fetch = () => { net = true; throw new Error("egress"); };
try {
  const strand = makeStrand({ now: () => "2026-07-01T10:00:00Z" });
  const cat = makeMailCategorize({ ai: makeMailAI({ brain }), provider, strand, now: () => "2026-07-01T10:00:00Z" });

  const rows = await cat.categorizeInbox();
  ok("categorizes every sender", rows.length === 3);
  ok("hallucinated category coerced to Other", rows.find((r) => r.sender === "weird@z.io").category === "Other");
  ok("valid category kept", rows.find((r) => r.sender === "ada@x.io").category === "Important");
  ok("κ-tags written + chain verifies", strand.length() === 3 && (await strand.verify()).ok);
  ok("categoryOf reads back (mem)", cat.categoryOf("promo@shop.com") === "News");

  // durable read from a fresh instance (chain memo)
  const cat2 = makeMailCategorize({ ai: makeMailAI({ brain }), provider, strand });
  ok("categoryOf reads back (chain)", cat2.categoryOf("ada@x.io") === "Important");

  ok("no network egress", net === false);
  ok("schema present", SENDERS_SCHEMA.type === "object" && DEFAULT_TAXONOMY.length >= 3);
} finally { globalThis.fetch = _fetch; }

console.log(`\nholo-mail-categorize gate: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
