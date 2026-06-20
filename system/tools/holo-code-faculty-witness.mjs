// holo-code-faculty-witness.mjs — proof that Holo Code's holoQProvider speaks the canonical `code` faculty
// contract (isReady / delta-shaped generate / bindToMux), so the app's loaded coder can be shared as the
// OS's `code` brain through holo-q-mux instead of being a private bypass. Pure Node — the heavy GPU/engine
// imports are lazy (inside connect/_core), so importing the module top-level is safe with no browser/GPU.
//   Run: node holo-code-faculty-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const P = await import(pathToFileURL(resolve(HERE, "../../../holo-apps/apps/code/holo-code-providers.mjs")).href);
const { holoQProvider, localProvider, getProvider } = P;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const drain = async (gen) => { let s = ""; for await (const d of gen) s += d; return s; };

console.log("\nholo-code — canonical `code` faculty contract witness\n");

// ── 1) the contract members exist and are the right shape ─────────────────────────────────────────────
console.log("contract surface:");
ok(typeof holoQProvider.isReady === "function", "holoQProvider.isReady() exists (readiness gate)");
ok(typeof holoQProvider.generate === "function", "holoQProvider.generate() exists (delta-shaped completion)");
ok(typeof holoQProvider.bindToMux === "function", "holoQProvider.bindToMux() exists (publish as the `code` faculty)");

// ── 2) disconnected (no engine) → not ready, empty stream, never throws ───────────────────────────────
console.log("\ndisconnected → text-fallback safe (not ready, empty stream):");
ok(holoQProvider.isReady() === false, "no engine connected → isReady() is false (resolver uses the text model)");
ok((await drain(holoQProvider.generate([{ role: "user", content: "hi" }]))) === "", "generate() yields an EMPTY stream when not connected (never throws, no fake)");

// ── 3) bindToMux binds the `code` faculty onto an injected mux, carrying a live readiness gate ─────────
console.log("\nbindToMux publishes the `code` faculty:");
const bound = {};
const fakeMux = { bindSpecialist: (task, prov) => { bound[task] = prov; } };
ok(holoQProvider.bindToMux(fakeMux) === true, "bindToMux(mux) returns true and binds");
ok(bound.code && typeof bound.code.generate === "function" && bound.code.faculty === "code", "→ a `code` provider with a generate() is registered");
ok(typeof bound.code.isReady === "function" && bound.code.isReady() === false, "→ the bound provider's isReady() reflects the engine (false while disconnected)");
ok(holoQProvider.bindToMux({}) === false, "a mux without bindSpecialist → returns false (no throw)");

// ── 4) the local agent stays an honest, labeled floor (not a silent model) ────────────────────────────
console.log("\nlocal agent = honest floor:");
ok(localProvider.id === "local" && localProvider.kind === "deterministic", "localProvider is the deterministic local agent (kind=deterministic, no model)");
ok(localProvider.available() === true && getProvider("local") === localProvider, "local is always available and resolvable by id");

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
