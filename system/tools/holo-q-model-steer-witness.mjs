// holo-q-model-steer-witness.mjs — re-derivable proof that plain-language model steering actually moves the
// registry: "use a bigger brain for coding", "switch listening to hi-fi", "what are you using", "reset … to
// auto". Drives the REAL holo-q-mux + holo-q-faculty-models. Pure Node. Run: node holo-q-model-steer-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const mux = await imp("../os/usr/lib/holo/q/holo-q-mux.js");
const bridge = await imp("../os/usr/lib/holo/voice/holo-q-faculty-models.mjs");
const steerMod = await imp("../os/usr/lib/holo/q/holo-q-model-steer.mjs");
const deps = { mux, bridge };
const run = (text) => steerMod.steer(text, deps);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

console.log("\nholo-q model steer — intention → registry witness\n");
mux.unbindAll();

console.log("the user's own examples:");
let r = run("use a bigger brain for coding");
ok(r.handled && r.action === "bind" && r.faculty === "code" && r.model === "qwen-coder-3b", `"bigger brain for coding" → code=qwen-coder-3b  ·  "${r.say}"`);
ok(mux.resolveModel("code").source === "override" && mux.resolveModel("code").id === "qwen-coder-3b", "the registry actually changed (code override bound)");

r = run("switch listening to hi-fi");
ok(r.handled && r.faculty === "listen" && r.model === "moonshine-tiny-f16", `"listening to hi-fi" → listen=moonshine-tiny-f16  ·  "${r.say}"`);
ok(bridge.resolveFacultyModel("listen").instant.kappa === "ff7e1c8b3c9e360ab062ce96a297e6f2467608c634f2e4b171078180056a72d8", "listen override resolves to the f16 κ (real bytes)");

r = run("make answers faster");
ok(r.handled && r.faculty === "respond" && r.model === "qwen2.5-0.5b", `"answers faster" → respond=qwen2.5-0.5b (instant)  ·  "${r.say}"`);

r = run("use the bigger model for chat");
ok(r.handled && r.faculty === "respond" && r.model === "qwen2.5-1.5b", `"bigger model for chat" → respond=qwen2.5-1.5b (upgrade)  ·  "${r.say}"`);

console.log("\ndescribe + reset:");
r = run("what models are you using?");
ok(r.handled && r.action === "describe" && /code: qwen-coder-3b/.test(r.say), `"what are you using" → describes live state  ·  "${r.say}"`);

r = run("reset coding to auto");
ok(r.handled && r.action === "auto" && r.faculty === "code", `"reset coding to auto" → unbinds  ·  "${r.say}"`);
ok(mux.resolveModel("code").source === "pinned", "code is back to the pinned default (auto)");

console.log("\nhonesty + safety:");
r = run("use a bigger brain for coding");   // code has only one tier
mux.unbindAll(); r = run("make coding more powerful");
ok(r.faculty === "code" && /most capable/.test(r.say || ""), `code has one tier → honest note, not a fake upgrade  ·  "${r.say}"`);

ok(run("open the music app").handled === false, '"open the music app" → NOT a model command (passes through)');
ok(run("what is a hologram?").handled === false, '"what is a hologram?" → not a model command (no model/using word)');
ok(parseNull("listening"), "a bare faculty word alone → not a command (needs a direction)");
function parseNull(t) { return steerMod.parseModelSteer(t) === null; }

mux.unbindAll();
console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
