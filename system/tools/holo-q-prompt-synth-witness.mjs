// holo-q-prompt-synth-witness.mjs — re-derivable proof that Q writing its own prompt from intent is fail-closed
// and verify-before-use: a deterministic baseline ALWAYS yields a valid prompt; a fast-model upgrade is accepted
// ONLY when it provably preserves the user's intent + faculty; every failure mode (drift, bloat, empty, throw,
// abort) falls back to the baseline. So Q can sharpen the request but never hijack, drop, or re-route it.
// Pure Node, injected mock brain — no GPU. Run: node holo-q-prompt-synth-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const { synthesizePrompt } = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-prompt-synth.mjs")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const has = (s, sub) => String(s).toLowerCase().includes(sub.toLowerCase());

const INTENT = "summarize my quarterly sales notes";

console.log("\nholo-q prompt synthesis — Q writes its own prompt from intent, verify-before-use\n");

// ── 1) baseline: no brain → a valid deterministic prompt that contains the intent + faculty framing ───────
console.log("baseline (no model): always a valid prompt, intent preserved, deterministic:");
{
  const a = await synthesizePrompt(INTENT, { faculty: "respond" });
  const b = await synthesizePrompt(INTENT, { faculty: "respond" });
  ok(a.source === "baseline" && a.rendered.length > 0, "produces a baseline prompt with no model");
  ok(has(a.rendered, "quarterly sales notes"), "baseline preserves the user's intent verbatim");
  ok(has(a.system, "You are Q"), "baseline carries the faculty system framing");
  ok(a.rendered === b.rendered, "deterministic: same intent → same prompt");
}

// ── 2) per-faculty framing differs (respond vs code) ──────────────────────────────────────────────────────
console.log("\nframing is faculty-aware:");
{
  const r = await synthesizePrompt("reverse a linked list", { faculty: "respond" });
  const c = await synthesizePrompt("reverse a linked list", { faculty: "code" });
  ok(r.system !== c.system && has(c.system, "coding"), "respond and code get different system framing");
  ok(c.faculty === "code", "the routed faculty is carried through, never changed by synthesis");
}

// ── 3) model upgrade ACCEPTED when it preserves the intent ────────────────────────────────────────────────
console.log("\nmodel upgrade: accepted only when it preserves the intent:");
{
  const good = async () => "Summarize the user's quarterly sales notes into 3-5 bullet points, highlighting trends and outliers. Success: a faithful, concise digest.";
  const r = await synthesizePrompt(INTENT, { faculty: "respond", generate: good });
  ok(r.source === "model", "a faithful expansion is accepted (source=model)");
  ok(has(r.rendered, "bullet") && has(r.rendered, "sales"), "the richer instruction is used, intent intact");
  ok(r.expanded && r.intent === INTENT, "the user's original intent is retained alongside the expansion");
}

// ── 4) model upgrade REJECTED on drift / bloat / empty / throw → baseline (Q can't hijack the request) ────
console.log("\nverify-before-use: every bad upgrade falls back to the baseline:");
{
  const drift = async () => "Write a poem about the ocean at sunset and the cry of distant gulls.";   // unrelated → drops intent
  const r1 = await synthesizePrompt(INTENT, { faculty: "respond", generate: drift });
  ok(r1.source === "baseline" && has(r1.rendered, "quarterly sales notes"), "drift (different request) is REJECTED → baseline, intent kept");

  const bloat = async () => "x ".repeat(5000);                       // absurdly long → reject
  ok((await synthesizePrompt(INTENT, { faculty: "respond", generate: bloat })).source === "baseline", "bloated output rejected → baseline");

  const empty = async () => "  ";
  ok((await synthesizePrompt(INTENT, { faculty: "respond", generate: empty })).source === "baseline", "empty output rejected → baseline");

  const throwing = async () => { throw new Error("brain died"); };
  ok((await synthesizePrompt(INTENT, { faculty: "respond", generate: throwing })).source === "baseline", "model throw → baseline (never blocks)");
}

// ── 5) abort → baseline immediately, no model call ────────────────────────────────────────────────────────
console.log("\nabort: an aborted signal skips the model and returns the baseline at once:");
{
  let called = false;
  const gen = async () => { called = true; return "..."; };
  const r = await synthesizePrompt(INTENT, { faculty: "respond", generate: gen, signal: { aborted: true } });
  ok(r.source === "baseline" && called === false, "aborted → baseline without invoking the model");
}

// ── 6) garbled / empty intent never throws ────────────────────────────────────────────────────────────────
console.log("\nrobustness:");
{
  ok((await synthesizePrompt("", { faculty: "respond" })).rendered.length > 0, "empty intent → still a valid prompt, no throw");
  ok((await synthesizePrompt(null, {})).source === "baseline", "null intent → baseline, no throw");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
