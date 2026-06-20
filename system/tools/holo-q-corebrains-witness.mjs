// holo-q-corebrains-witness.mjs — re-derivable proof that the core-brain BINDER (holo-q-corebrains.mjs)
// binds the OS's own brains to the canonical faculties as lazy, readiness-gated providers, so Create mode
// resolves to the coder once loaded and the text model until then — kicking background loads, never
// blocking, never throwing on a broken brain, and leaving `code` on the text-only path when no coder is
// offered. Pure Node — injected fake brains, no network/GPU/browser. Exit 0 = green; 1 = a divergence.
//   Run: node holo-q-corebrains-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const muxMod = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-mux.js")).href);
const A = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-active.mjs")).href);
const CB = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-corebrains.mjs")).href);
const mux = muxMod.default || muxMod;
const { resolveActive } = A;
const { mountCoreBrains } = CB;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const tick = () => new Promise((r) => setTimeout(r, 0));

// a GATED fake brain: make() blocks until `gate` resolves, then returns a sampler yielding `chunks`. This
// lets the witness control EXACTLY when each background load finishes (deterministic, no tick-counting).
// `fail:true` makes the load throw (a broken brain). Models the holo-voice-llm / GPU-brain load shape.
function gatedBrain(chunks, gate, { fail = false } = {}) {
  return async () => { await gate; if (fail) throw new Error("load failed"); return (m, o) => (async function* () { for (const c of chunks) yield c; })(); };
}
function makeFakeBrain(chunks, { fail = false } = {}) { return gatedBrain(chunks, Promise.resolve(), { fail }); }
const settle = async () => { await tick(); await tick(); };       // drain microtasks after releasing a gate
const drainGen = async (p, msgs) => { let s = ""; for await (const d of p.generate(msgs, {})) s += d; return s; };

console.log("\nholo-q-corebrains — core-brain binder witness\n");

// ── 1) before loads resolve: code falls to the text path; once ready, both upgrade ─────────────────────
console.log("background load → silent upgrade (deterministic gates):");
mux.unbindAll();
let releaseText, releaseCode;
const textGate = new Promise((r) => { releaseText = r; });
const codeGate = new Promise((r) => { releaseCode = r; });
let m = mountCoreBrains(mux, { makeText: gatedBrain(["text"], textGate), makeCode: gatedBrain(["coder"], codeGate), hasGPU: true });
ok(resolveActive(mux, "code").runnable === false, "right after mount (both gated) → code not runnable yet (template floor stands)");
releaseText(); await settle();                          // the text brain finishes loading; the coder is still gated
ok(m.text.isReady() === true, "the text brain finishes its background load → ready");
ok(resolveActive(mux, "code").active === "respond", "code now resolves to the TEXT brain (coder still loading)");
releaseCode(); await settle();                          // now the coder finishes
ok(m.code.isReady() === true && resolveActive(mux, "code").active === "code", "coder finishes loading → code silently upgrades to it");

// ── 2) 'text model only' when no coder is offered (no GPU) ─────────────────────────────────────────────
console.log("\nno coder offered (no GPU) → text model only:");
mux.unbindAll();
m = mountCoreBrains(mux, { makeText: makeFakeBrain(["text"]), makeCode: makeFakeBrain(["coder"]), hasGPU: false });
ok(m.code === null, "hasGPU:false → no code brain is built");
await tick(); await tick();
ok(resolveActive(mux, "code").active === "respond", "code resolves to the TEXT model only (and stays there)");

// ── 3) a broken coder degrades to text, never throws ───────────────────────────────────────────────────
console.log("\nbroken coder → degrade to text, never throw:");
mux.unbindAll();
m = mountCoreBrains(mux, { makeText: makeFakeBrain(["text"]), makeCode: makeFakeBrain(["coder"], { fail: true }), hasGPU: true });
await tick(); await tick();
ok(m.code.isDead() === true, "the coder's load threw → marked dead");
ok(resolveActive(mux, "code").active === "respond", "a dead coder degrades to the text brain (honest fallback)");
ok((await drainGen(m.code, [])) === "", "the dead coder's generate yields an empty stream (never throws)");

// ── 4) the bound providers actually stream their brain ─────────────────────────────────────────────────
console.log("\nbound providers stream:");
mux.unbindAll();
m = mountCoreBrains(mux, { makeText: makeFakeBrain(["he", "llo"]), makeCode: makeFakeBrain(["bui", "ld"]), hasGPU: true });
ok((await drainGen(m.text, [])) === "hello", "the text provider streams its brain end-to-end");
ok((await drainGen(m.code, [])) === "build", "the code provider streams its brain end-to-end");

mux.unbindAll();
console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
