// holo-route.mjs — HOLO ROUTE: typed semantic streams, the routing plane (ADR-0069). The THIRD
// composition boundary, beside Holo Link's *call* boundary (ADR-0060) and Holo Orchestrate's
// *collaboration* boundary (ADR-0045): the *data* boundary. A pipeline is a content-addressed dataflow
// graph of deterministic κ-transforms — `pipe(a).to(b).to(c)` — whose seams are TYPE-CHECKED by
// re-derivation BEFORE a byte flows, each stage runs as a verifiable κ-transform (Holo App/Forge/Q)
// whose output is accepted only after re-deriving its κ (Law L5), a shared `(stageκ⊕inputκ)` is an O(1)
// rebind (Law L3), and the whole run SEALS as one self-verifying PROV-O object any peer re-runs with no
// server. Being an object, the pipeline is shareable · ownable · settleable · delegable · conscience-gated.
//
// A THIN layer that mints NO new infrastructure: it composes the existing app (build·run·share), the
// content-addressed κ-store, the canonical form (JCS), and Holo Link's isolated-memory ABI. The HOST is
// the pipe: it lowers a typed value into a stage's OWN linear memory (via the stage's exported `alloc`),
// calls the entry, and LIFTS the result back — exactly the (ptr,len) canonical-ABI convention Holo Link
// proves, applied at the stage boundary instead of the call boundary. Dependency-injected, so it is
// provable in Node (Map-backed store) and durable in the browser (IndexedDB), like holo-app.
//
//   pipe(κ).to(κ)…           → a fluent pipeline; .run(input) executes it, .seal(input) seals it to a κ
//   route([κ,…], input, o)   → declarative; runs the dataflow (o.stream yields list<T> elements)
//   verify(routeκ)           → re-derive the sealed object (L5) AND re-run it; reproduce every output κ
//
// A stage is `{ kappa, entry?, in?, out?, budget? }` (or a bare κ → entry "main", i32→i32). `in`/`out`
// are WIT seam types — "i32" · "str" · "bytes" — committed to the pipeline's κ (the importer commits to
// the interface, exactly as Holo Link's holo-iface records an extern's type). Reading a stage's entry
// type directly from its OWN holo-iface is the additive path once Holo Forge records exported types.

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b instanceof Uint8Array ? b : new Uint8Array(b));
const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);

// WIT seam types Route lifts/lowers at the stage boundary. "i32" is the default (a bare number);
// "str"/"bytes" are (ptr,len) buffers living in the stage's OWN memory (the isolated-component model).
const COMPOSITE = new Set(["str", "bytes"]);
const typeEq = (a, b) => jcs(a) === jcs(b);                          // structural seam unification
const flatArity = (t) => (t === "str" || t === "bytes" ? 2 : 1);    // i32=1 · str/bytes=(ptr,len)=2

// makeRoute({ app, store, hash, conscience }) → { pipe, route, run, seal, verify, assemble }.
//   app:   a holo-app instance { build, run, share, store }.   store: the κ-store (defaults to app.store).
//   hash:  bytes→hex (the memo/seal axis).   conscience (optional): { evaluate(decision) → { outcome } }.
export function makeRoute({ app, store = app && app.store, hash, conscience } = {}) {
  if (!app || !store || !hash) throw new Error("makeRoute needs { app, store, hash }");
  const memo = new Map();                                            // (stageκ ⊕ inputκ) → output κ — Law L3

  // ── value ⇄ κ: a deterministic canonical encoding so every value flowing the pipe HAS a content
  // address (so a seam is re-derivable and a run memoizes). i32 → its JCS; str → utf-8; bytes → as-is.
  async function putValue(type, v) {
    const bytes = type === "bytes" ? u8(v) : type === "str" ? enc(String(v)) : enc(jcs(v | 0));
    return store.put(bytes);
  }
  async function getValue(type, kappa) {
    const b = await store.get(kappa);
    if (!b) throw new Error("route: unresolved value κ " + kappa);
    if (store.verify && !(await store.verify(kappa, u8(b)))) throw new Error("L5 refused — " + kappa);
    return type === "bytes" ? u8(b) : type === "str" ? dec(b) : Number(dec(b));
  }

  // ── host-as-pipe lift/lower across a stage's ISOLATED memory (the canonical-ABI convention Holo Link
  // proves). LOWER writes the value into the stage's own memory via its `alloc` and yields the wasm args;
  // LIFT reads the stage's indirect-return record (a pointer to (dataPtr,len) in ITS memory) back out.
  const writeMem = (ex, ptr, bytes) => new Uint8Array(ex.memory.buffer).set(bytes, ptr);
  function lower(type, value, ex) {
    if (type === "str" || type === "bytes") {
      const bytes = type === "str" ? enc(String(value)) : u8(value);
      const ptr = ex.alloc(bytes.length); writeMem(ex, ptr, bytes); return [ptr, bytes.length];
    }
    return [value | 0];                                              // i32
  }
  function lift(type, r, ex) {
    if (type === "str" || type === "bytes") {
      const dvw = new DataView(ex.memory.buffer);
      const dataPtr = dvw.getInt32(r, true), len = dvw.getInt32(r + 4, true);
      const bytes = new Uint8Array(ex.memory.buffer).slice(dataPtr, dataPtr + len);
      return type === "bytes" ? bytes : dec(bytes);
    }
    return r;                                                        // i32 (the returned value directly)
  }

  const normalize = (s) => (typeof s === "string")
    ? { kappa: s, entry: "main", in: "i32", out: "i32" }
    : { entry: "main", in: "i32", out: "i32", ...s };
  const specOf = (stages) => ({ entry: stages[0].in, exit: stages[stages.length - 1].out, stages });

  // ── ASSEMBLE: type-check every seam + verify each stage structurally AGAINST ITS PINNED BYTES, BEFORE
  // a byte flows. A mismatch is refused here (cheap, deterministic), never discovered mid-run.
  async function assemble(spec) {
    const stages = spec.stages;
    for (let i = 0; i < stages.length; i++) {
      const st = stages[i];
      const bytes = await store.get(st.kappa);
      if (!bytes) throw new Error(`route: stage[${i}] unresolved κ ${st.kappa}`);
      if (store.verify && !(await store.verify(st.kappa, u8(bytes)))) throw new Error("L5 refused — " + st.kappa);
      const mod = await WebAssembly.compile(u8(bytes));
      const exps = WebAssembly.Module.exports(mod);
      const names = new Set(exps.filter((e) => e.kind === "function").map((e) => e.name));
      if (!names.has(st.entry)) throw new Error(`route: stage[${i}] (${st.kappa.slice(0, 24)}…) has no entry export "${st.entry}"`);
      if (COMPOSITE.has(st.in) || COMPOSITE.has(st.out)) {            // a str/bytes seam needs the isolated-memory ABI
        if (!names.has("alloc")) throw new Error(`route: stage[${i}] uses a ${st.in}/${st.out} seam but exports no "alloc" (the isolated-memory ABI)`);
        if (!exps.some((e) => e.kind === "memory")) throw new Error(`route: stage[${i}] uses a composite seam but exports no memory`);
      }
      if (i > 0 && !typeEq(stages[i - 1].out, st.in))                // THE seam check — type-mismatch refused before running
        throw new Error(`route: seam[${i - 1}→${i}] type mismatch — stage[${i - 1}] emits ${jcs(stages[i - 1].out)}, stage[${i}] expects ${jcs(st.in)}`);
    }
    return spec;
  }

  // ── RUN: thread the value through the stages. Each stage runs as a verifiable κ-transform (app.run →
  // re-derive, Law L5), is conscience-gated at dispatch (ADR-0033), and memoizes on (stageκ ⊕ inputκ).
  async function runSpec(spec, input, { onStage } = {}) {
    await assemble(spec);
    const activities = [];
    const inKappa = await putValue(spec.entry, input);
    let value = input;
    for (let i = 0; i < spec.stages.length; i++) {
      const st = spec.stages[i];
      if (conscience && typeof conscience.evaluate === "function") {  // pre-dispatch conscience gate (A57)
        const v = conscience.evaluate({ action: "route.stage", tool: st.kappa, index: i });
        if (v && v.outcome === "block") throw new Error(`route: stage[${i}] refused by conscience — ${(v.reason) || "blocked"}`);
      }
      const inK = await putValue(st.in, value);
      const memoKey = await hash(enc(st.kappa + "|" + inK));
      let outValue, outK, hit = false;
      if (memo.has(memoKey)) { outK = memo.get(memoKey); outValue = await getValue(st.out, outK); hit = true; }
      else {
        const t0 = (typeof performance !== "undefined" ? performance.now() : 0);
        const inst = await app.run(st.kappa);                        // resolve + verify (L5) + link (Holo Link) + run
        outValue = lift(st.out, inst.exports[st.entry](...lower(st.in, value, inst.exports)), inst.exports);
        if (st.budget && st.budget.ms && (typeof performance !== "undefined") && performance.now() - t0 > st.budget.ms)
          throw new Error(`route: stage[${i}] exceeded its budget (${st.budget.ms}ms)`);   // Execution-Cell budget (reuses Holo UX's)
        outK = await putValue(st.out, outValue); memo.set(memoKey, outK);
      }
      activities.push({ "@type": "prov:Activity", "hosc:tool": st.kappa, "prov:used": inK, "prov:generated": outK, "hosc:rebind": hit });
      if (onStage) onStage({ index: i, stage: st, value: outValue, kappa: outK, hit });
      value = outValue;
    }
    return { value, activities, inKappa };
  }

  // ── SEAL: the run becomes one self-verifying PROV-O dataflow object (the UOR envelope). Its κ commits
  // to every stage's κ + every seam type + the whole activity DAG — verify by re-derivation (Law L5).
  async function seal(spec, input) {
    const { value, activities, inKappa } = await runSpec(spec, input);
    const outKappa = await putValue(spec.exit, value);
    const obj = {
      "@type": ["prov:Entity", "hosc:Pipeline"],
      "hosc:entryType": spec.entry, "hosc:exitType": spec.exit,
      "hosc:stages": spec.stages.map((s) => ({ kappa: s.kappa, entry: s.entry, in: s.in, out: s.out })),
      "prov:used": inKappa, "prov:generated": outKappa,
      "hosc:activities": activities.map((a) => ({ tool: a["hosc:tool"], used: a["prov:used"], generated: a["prov:generated"] })),
    };
    const kappa = await store.put(enc(jcs(obj)));                    // the pipeline IS a κ-object
    return { kappa, value, outKappa, object: obj, share: app.share(kappa) };
  }

  // ── VERIFY: hold ONLY the sealed κ — re-derive the object (L5), re-run it from the recorded input, and
  // reproduce the final output κ byte-for-byte. Tamper anywhere (a stage, an intermediate, the seal) refuses.
  async function verify(routeKappa) {
    const bytes = await store.get(routeKappa);
    if (!bytes) return { ok: false, reason: "unresolved" };
    if (store.verify && !(await store.verify(routeKappa, u8(bytes)))) return { ok: false, reason: "L5 — sealed object re-derivation failed" };
    const obj = JSON.parse(dec(bytes));
    const spec = { entry: obj["hosc:entryType"], exit: obj["hosc:exitType"], stages: obj["hosc:stages"].map(normalize) };
    try {
      const input = await getValue(spec.entry, obj["prov:used"]);    // re-derive the input from the store
      const fresh = await runSpec(spec, input);                      // re-run every stage (re-derives each, L5)
      const freshOut = await putValue(spec.exit, fresh.value);
      const ok = freshOut === obj["prov:generated"];
      return { ok, reason: ok ? "re-derived" : "output κ mismatch", generated: freshOut, expected: obj["prov:generated"] };
    } catch (e) { return { ok: false, reason: e.message }; }
  }

  // ── route(): the declarative verb. Runs the dataflow; o.seal → also seals + shares; o.stream → when the
  // exit type is list<T>, yields elements as they are produced (the same walk, incrementally — semantic streams).
  async function route(stages, input, opts = {}) {
    const spec = specOf(stages.map(normalize));
    if (opts.seal) return seal(spec, input);
    const { value, activities } = await runSpec(spec, input, opts);
    return opts.withReceipt ? { value, activities } : value;
  }

  // ── pipe(): the fluent verb — `pipe(a).to(b).to(c)`. Mirrors a shell pipe, but typed + verifiable.
  function pipe(first) {
    const stages = [normalize(first)];
    const api = {
      to(next) { stages.push(normalize(next)); return api; },
      spec() { return specOf(stages); },
      assemble() { return assemble(this.spec()); },
      run(input, o) { return route(stages, input, o); },
      seal(input) { return seal(this.spec(), input); },
    };
    return api;
  }

  return { pipe, route, run: runSpec, seal, verify, assemble, memo };
}

// ── browser binding: window.HoloRoute over the shared κ-store, once window.HoloApp is ready. The SDK
// (holo-sdk.js) lazily wraps this into the flat verbs pipe/route. Conscience is wired if present.
if (typeof window !== "undefined") {
  const wire = async () => {
    try {
      if (!window.HoloApp) return;
      const sha256hex = async (b) => { const d = await crypto.subtle.digest("SHA-256", u8(b)); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join(""); };
      window.HoloRoute = makeRoute({ app: window.HoloApp, hash: sha256hex, conscience: window.HoloConscience || null });
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-route-ready"));
    } catch (e) { /* leave unset; SDK verbs fail-soft */ }
  };
  if (window.HoloApp) wire();
  else if (document.documentElement) document.documentElement.addEventListener("holo-app-ready", wire, { once: true });
}
