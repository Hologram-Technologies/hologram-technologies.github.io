// holo-q-active-witness.mjs — re-derivable proof that the ACTIVE-BRAIN resolver (holo-q-active.mjs) makes
// Create mode (and every generative surface) obey ONE rule: use the coding brain when it is loaded, the
// TEXT brain (`respond`) while it is not, a deterministic floor if even that is missing — never blocking,
// never faking, always knowing which model is talking, and silently upgrading the moment a better brain
// binds. Pure Node — no network, no GPU, no browser. Exit 0 = green; exit 1 = a real divergence.
//   Run: node holo-q-active-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const muxMod = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-mux.js")).href);
const A = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-active.mjs")).href);
const mux = muxMod.default || muxMod;
const { resolveActive, facultySampler, describeActive, wireCoreBrains } = A;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// a fake string-delta brain (the voice LLM / GPU brain shape): generate(messages) yields text deltas.
const fakeBrain = (id, chunks) => ({ id, generate: async function* () { for (const c of chunks) yield c; } });
const drain = async (sampler, msgs) => { let s = ""; for await (const d of sampler(msgs, {})) s += d; return s; };

console.log("\nholo-q-active — active-brain resolver witness\n");

// ── 1) the core question: Create mode resolves to the CODING brain only when it is loaded ──────────────
console.log("Task 1 — code resolves to the coding brain, text-fallback otherwise:");
mux.unbindAll();
let r = resolveActive(mux, "code");
ok(!r.runnable, "code with NOTHING bound → not runnable (caller's template floor stands, no block)");
ok(r.requested.id === "qwen-coder-3b" && r.requested.source === "pinned", "badge still names the INTENDED coder (qwen-coder-3b · pinned) while it loads");

// bind only the TEXT brain (`respond`) — the coder hasn't loaded yet → code must fall back to text
wireCoreBrains(mux, { textBrain: fakeBrain("respond-brain", ["hi"]) });
r = resolveActive(mux, "code");
ok(r.runnable && r.active === "respond" && r.isFallback, "code with only `respond` bound → falls back to the TEXT brain (active=respond, isFallback)");

// now the coder binds (mid-session) → code must silently upgrade to it on the NEXT resolve
wireCoreBrains(mux, { codeBrain: fakeBrain("code-brain", ["x"]) });
r = resolveActive(mux, "code");
ok(r.runnable && r.active === "code" && !r.isFallback, "after the coder binds → code upgrades to it (active=code, not a fallback)");

// ── 1b) the readiness gate: a coder still STREAMING its weights = text model only, until it's ready ────
console.log("\nreadiness gate — 'text model only' until the coder finishes loading:");
mux.unbindAll();
let coderReady = false;
const lazyCoder = { id: "qwen-coder-3b", isReady: () => coderReady, generate: async function* () { yield "coder"; } };
wireCoreBrains(mux, { textBrain: fakeBrain("respond-brain", ["text"]), codeBrain: lazyCoder });
r = resolveActive(mux, "code");
ok(r.active === "respond" && r.isFallback, "coder bound but NOT ready (weights streaming) → code runs the TEXT model");
coderReady = true;                                                    // the κ-disk finished loading
r = resolveActive(mux, "code");
ok(r.active === "code" && !r.isFallback, "coder flips ready → code upgrades to it on the very next resolve (no re-wire)");

// ── 2) the sampler re-resolves PER CALL → silent mid-session upgrade with no surface change ────────────
console.log("\nfacultySampler re-resolves per call (silent upgrade):");
mux.unbindAll();
const sampler = facultySampler(mux, "code", { chain: ["code", "respond"] });
ok((await drain(sampler, [])) === "", "no brain bound → sampler yields an EMPTY stream (template floor stands, never throws)");
wireCoreBrains(mux, { textBrain: fakeBrain("respond-brain", ["text", "-build"]) });
ok((await drain(sampler, [])) === "text-build", "text brain bound → same sampler now streams the TEXT brain");
wireCoreBrains(mux, { codeBrain: fakeBrain("code-brain", ["coder", "-build"]) });
ok((await drain(sampler, [])) === "coder-build", "coder bound → the SAME sampler streams the CODER next call (silent upgrade, no re-wire)");

// ── 3) delta normalization: the one sampler rides every brain output convention ────────────────────────
console.log("\nsampler normalizes every generate() convention:");
mux.unbindAll();
mux.bindSpecialist("respond", { id: "evt", generate: async function* () { yield { delta: "a" }; yield { text: "b" }; yield "c"; yield { value: "d" }; yield { phase: "noise" }; } });
ok((await drain(facultySampler(mux, "respond"), [])) === "abcd", "string / {delta} / {text} / {value} all normalize; unknown shapes drop");

// ── 4) the badge text — the user ALWAYS knows which model is talking ──────────────────────────────────
console.log("\ndescribeActive — honest model identity for the user:");
mux.unbindAll();
let d = describeActive(mux, "code");
ok(d.loading === true && /qwen-coder-3b/.test(d.note), "nothing loaded → badge: loading qwen-coder-3b… (names the target)");
wireCoreBrains(mux, { textBrain: fakeBrain("respond-brain", ["x"]) });
d = describeActive(mux, "code");
ok(d.isFallback === true && d.loading === true && /text fallback/.test(d.note), "on text fallback → badge says 'text fallback — loading qwen-coder-3b…'");
wireCoreBrains(mux, { codeBrain: fakeBrain("qwen-coder-3b", ["x"]) });   // the real coder provider carries its model id
d = describeActive(mux, "code");
ok(d.isFallback === false && d.loading === false && d.label === "qwen-coder-3b", "coder loaded → badge shows the running model id (qwen-coder-3b · no fallback, not loading)");

// ── 5) a deterministic FLOOR is usable but never preferred over a real brain ──────────────────────────
console.log("\nfloor is the last resort, never the ceiling:");
mux.unbindAll();
mux.bindSpecialist("respond", { id: "floor:respond", floor: true, generate: async function* () { yield { value: "floored" }; } });
r = resolveActive(mux, "code");
ok(r.runnable && r.onFloor === true, "only a floor bound → resolves to it (usable), flagged onFloor");
mux.bindSpecialist("code", fakeBrain("code-brain", ["real"]));
r = resolveActive(mux, "code");
ok(r.active === "code" && r.onFloor === false, "a real coder outranks the floor (floor is the net, not the ceiling)");

// ── 6) never throws on a malformed mux / unknown task; honest identity fallback ────────────────────────
console.log("\nrobustness (never throws, honest):");
let threw = false;
try { resolveActive({}, "code"); } catch (e) { threw = true; }
ok(threw, "a mux missing routeTask/resolveModel → throws a CLEAR setup error (not a silent wrong answer)");
mux.unbindAll();
ok(describeActive(mux, "respond").loading === true && describeActive(mux, "respond").label === "qwen2.5-0.5b", "respond (text) unbound → badge names its pinned id qwen2.5-0.5b");

// ── 7) wireCoreBrains honors 'text model only' when no code brain is offered ──────────────────────────
console.log("\nwireCoreBrains — 'text model only' when no coder is offered:");
mux.unbindAll();
const w = wireCoreBrains(mux, { textBrain: fakeBrain("respond-brain", ["t"]) });   // NO codeBrain (e.g. no WebGPU)
ok(w.bound.length === 1 && w.bound[0] === "respond", "no code brain supplied → only `respond` binds (code stays on the text-fallback path)");
ok(resolveActive(mux, "code").active === "respond", "→ Create mode runs the TEXT model only, exactly as intended on a device that can't load the coder");

mux.unbindAll();
console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
