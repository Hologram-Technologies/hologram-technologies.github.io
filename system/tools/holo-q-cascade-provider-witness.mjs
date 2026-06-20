// holo-q-cascade-provider-witness.mjs — re-derivable proof that the cascade plugs into Q's ACTIVE PLANE with
// no surface change: the cascade provider (a) streams detokenized text deltas, (b) reconstructs the full
// model's own greedy decode token-for-token (fidelity survives the provider+streaming layer), (c) flows through
// the REAL facultySampler (holo-q-active.mjs) bound on a mux exactly like any brain, (d) is runnable the instant
// the DRAFT is up (talk in ~1s), and (e) honors abort. Pure Node, mock token-brains + tokenizer — no GPU.
// Run: node holo-q-cascade-provider-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const { createCascadeProvider } = await imp("../os/usr/lib/holo/q/holo-q-cascade-provider.mjs");
const { referenceGreedy } = await imp("../os/usr/lib/holo/q/holo-q-cascade.mjs");
const { facultySampler } = await imp("../os/usr/lib/holo/q/holo-q-active.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// ── mock token-level brains (async greedy — like a real GPU forward) + a prefix-stable tokenizer ───────────
const V = 100;
const mkTarget = (readyFn) => ({ id: "target-1.5b", ready: readyFn, greedy: async (s) => { const n = s.length, a = s[n - 1] || 0, b = s[n - 2] || 0; return (a * 31 + b * 7 + n * 13 + 5) % V; } });
const mkDraft = (target, readyFn = () => true) => ({ id: "draft-tiny", ready: readyFn, greedy: async (s) => { const t = await target.greedy(s); return (s.reduce((x, y) => x + y, 0) % 4 === 0) ? (t + 1) % V : t; } });
const tokenizer = { encode: (txt) => Array.from(String(txt)).slice(0, 3).map((c) => c.charCodeAt(0) % 50), decode: (ids) => ids.join(",") };   // join → prefix-stable
const MESSAGES = [{ role: "user", content: "hi" }];
const N = 40;

const collect = async (it) => { let s = ""; for await (const d of it) s += d; return s; };

console.log("\nholo-q cascade provider — active-plane integration + fidelity witness\n");

// ── 1) streams text + reconstructs the full model's greedy decode (fidelity through provider+streaming) ───
console.log("fidelity through the provider: streamed text == the full model's own decode:");
{
  const target = mkTarget(() => true), draft = mkDraft(target);
  const prov = createCascadeProvider({ draft, target, tokenizer, faculty: "respond", k: 4, maxNew: N });
  const prompt = tokenizer.encode("user: hi\nassistant:");
  const refText = tokenizer.decode(await referenceGreedy(target, prompt, N));
  const got = await collect(prov.generate(MESSAGES, { maxTokens: N }));
  ok(got.length > 0, "provider.generate yields a non-empty text stream");
  ok(got === refText, "streamed text === detokenized full-model greedy decode (fidelity survives streaming)");
}

// ── 2) flows through the REAL facultySampler bound on a mux — no surface change ───────────────────────────
console.log("\nactive-plane integration: bound on the mux, streamed via the real facultySampler:");
{
  const target = mkTarget(() => true), draft = mkDraft(target);
  const prov = createCascadeProvider({ draft, target, tokenizer, faculty: "respond", k: 4, maxNew: N });
  const mux = {
    b: {}, bindSpecialist(f, p) { this.b[f] = p; },
    routeTask(f) { return this.b[f] || { id: "main", fallback: true }; },
    resolveModel(f) { return this.b[f] ? { source: "override", id: this.b[f].id } : { source: "main", id: "main" }; },
  };
  mux.bindSpecialist("respond", prov);                        // the cascade IS the respond brain now
  const sampler = facultySampler(mux, "respond");
  ok(sampler.available(), "facultySampler sees the cascade provider as runnable");
  const prompt = tokenizer.encode("user: hi\nassistant:");
  const refText = tokenizer.decode(await referenceGreedy(target, prompt, N));
  const got = await collect(sampler(MESSAGES, { maxTokens: N }));
  ok(got === refText, "facultySampler streams the cascade → full-model-fidelity text (orchestration unchanged)");
  ok(sampler.active().providerId === "cascade-respond", "the active plane reports the cascade as the bound provider");
}

// ── 3) earliness: runnable the instant the DRAFT is up, before the target lands ───────────────────────────
console.log("\nearliness: the draft makes Q runnable in ~1s, before the target is resident:");
{
  let targetUp = false;
  const target = mkTarget(() => targetUp), draft = mkDraft(target, () => true);
  const prov = createCascadeProvider({ draft, target, tokenizer, faculty: "respond", k: 4, maxNew: 12 });
  ok(prov.isReady() === true, "isReady() true with only the draft resident (talk now)");
  let first = null; for await (const d of prov.generate(MESSAGES, { maxTokens: 12 })) { if (first == null) first = d; if (prov) break; }
  ok(typeof first === "string" && first.length > 0, "a first delta is emitted from the draft immediately");
}

// ── 4) not ready when neither brain is up; abort stops the stream ─────────────────────────────────────────
console.log("\nreadiness + abort:");
{
  const target = mkTarget(() => false), draft = mkDraft(target, () => false);
  const prov = createCascadeProvider({ draft, target, tokenizer, faculty: "respond" });
  ok(prov.isReady() === false, "isReady() false when neither draft nor target is resident");

  const t2 = mkTarget(() => true), d2 = mkDraft(t2);
  const prov2 = createCascadeProvider({ draft: d2, target: t2, tokenizer, faculty: "respond", maxNew: N });
  const ac = { aborted: true };                              // already-aborted signal
  const got = await collect(prov2.generate(MESSAGES, { maxTokens: N, signal: ac }));
  ok(got === "", "an aborted signal yields no tokens (clean barge-in / new-turn cancel)");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
