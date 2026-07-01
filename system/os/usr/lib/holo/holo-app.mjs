// holo-app.mjs — BUILD · RUN · SHARE: the three native verbs every holospace fulfils (ADR-0051). A
// THIN façade over what already exists — the compiler (holo-forge), the durable content-addressed
// κ-store (holo-store, shared with the read/write layer), and the resolver/Service Worker (serving) —
// adding no new infrastructure. Every app is a single κ derived from its attributes; build, run and
// share all key off that κ:
//
//   build(source) → { kappa, sourceKappa, receipt, exports }   compile → wasm; persist BOTH the source
//                   and the artifact by their κ. O(1) on repeat: identical source ⊕ compiler rebinds
//                   to the cached build (hologram dispatch — "rebind, not recompute"), never recompiles.
//   run(κ)       → { exports }   resolve the κ from the store (re-derive, Law L5) and execute. A SOURCE
//                   κ SELF-COMPILES then runs; an ARTIFACT κ runs directly — one κ, self-compiling.
//   share(κ)     → holo://κ   the κ IS the share: location-independent, self-verifying, self-compiling;
//                   the resolver/SW serves it from cache → peers → IPFS → origin, re-derived everywhere.
//
// Mirrors holo-sdk.js: this sets the window.HoloApp / window.HoloForge global; the SDK lazily wraps it
// into the flat verbs build/run/share. Dependency-injected, so it is provable in Node (Map-backed) and
// durable in the browser (IndexedDB), exactly like holo-store. Content objects live in the κ-store; the
// build-memo (an arbitrary key→meta cache, not a content object) lives in a small side index.

import { compile, forgeReceipt, jcs, VERSION, LANG } from "./holo-forge/holo-forge.mjs";
import { blake3hex } from "./holo-blake3.mjs";   // §1.2: BLAKE3 is the ONE canonical κ axis

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b instanceof Uint8Array ? b : new Uint8Array(b));
const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
const isWasm = (b) => { try { return WebAssembly.validate(u8(b)); } catch { return false; } };
const memIndex = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } }; };

// makeApp({ store, hash, index }) → { build, run, share }.  store: the holo-store contract
// { put(bytes)→κ, get(κ)→bytes|null, verify(κ,bytes)→bool }.  hash: bytes→hex (same axis as the store,
// for the receipt/build-key κ).  index: an arbitrary key→value cache for the O(1) build-memo.
export function makeApp({ store, hash, index = memIndex(), axis = "did:holo:blake3", legacyHash = null }) {
  const didOf = async (bytes) => axis + ":" + await hash(bytes);   // §1.2: label carries the store's κ axis (BLAKE3)
  // §1.2 dual-read: content is now BLAKE3-addressed, but EXISTING store objects may still be sha256-keyed.
  // Accept a κ if the store's (BLAKE3) verify passes OR the bytes re-derive to the κ under legacy sha256, so
  // apps sealed before the axis flip still open. Tamper still fails BOTH → fail-closed. legacyHash is injected.
  const verifyOK = async (kappa, bytes) => {              // legacy dual-read
    if (store.verify && (await store.verify(kappa, bytes))) return true;   // canonical BLAKE3 axis
    if (legacyHash) { const suf = String(kappa).split(":").pop(); return (await legacyHash(bytes)) === suf; }   // legacy dual-read (sha256)
    return !store.verify;                                 // no verifier → trust (Map-backed tests)
  };

  async function build(source, { lang = LANG } = {}) {
    if (typeof source !== "string") throw new Error("build(source): source must be a string");
    const sourceKappa = await store.put(enc(source));                  // the source is itself a κ-object
    const compilerKappa = build.compilerKappa || await didOf(enc("holo-forge"));
    const key = "build:" + await hash(enc(sourceKappa + "|" + compilerKappa));
    const memo = await index.get(key);
    if (memo) return { ...memo, sourceKappa, hit: true };              // O(1) rebind — no recompile
    const out = compile(source);                                       // the deterministic transform
    const artifactKappa = await store.put(out.wasm);                   // the artifact is a κ-object
    const exports = out.exports.map((e) => e.name);
    const flagsKappa = await didOf(enc(jcs({ lang, target: "wasm-core-2.0" })));
    const receiptObj = forgeReceipt({ sourceKappa, compilerKappa, flagsKappa, artifactKappa, lang, exports: out.exports });
    const receipt = await store.put(enc(jcs(receiptObj)));             // the build receipt is a κ-object
    const meta = { kappa: artifactKappa, receipt, exports, imports: out.imports || [], lang, tool: VERSION };
    await index.set(key, meta);
    return { ...meta, sourceKappa, hit: false };
  }

  const isKappa = (s) => typeof s === "string" && s.startsWith("did:holo:");
  async function fetchVerified(kappa) {
    const b = await store.get(kappa);
    if (!b) throw new Error("link: unresolved κ " + kappa);
    const bytes = u8(b);
    if (!(await verifyOK(kappa, bytes))) throw new Error("L5 refused — " + kappa);   // legacy dual-read
    return bytes;
  }
  // CONTENT-ADDRESSED LINKING (Holo Link): instantiate a module graph where every WASM import whose
  // module-name is a κ is resolved from the store, VERIFIED by re-derivation (Law L5), and instantiated
  // ONCE per graph (memoized → a shared dependency links exactly once, Law L3). The whole composition is
  // reached from one κ; combine = a module that imports another by κ, split = each κ still stands alone.
  const readIface = (module) => { try { const s = WebAssembly.Module.customSections(module, "holo-iface"); return s.length ? JSON.parse(new TextDecoder().decode(new Uint8Array(s[0]))) : {}; } catch { return {}; } };
  // WIT lift/lower (the canonical-ABI core), isolated. Each `str` ARG is (ptr,len) in the CALLER's own memory:
  // copy the bytes into the CALLEE's memory (via its exported `alloc`) and rewrite the pointer. A `str` RESULT
  // is an indirect return — the callee returns a pointer to (dataPtr,len) in ITS memory; we copy that string
  // BACK into the caller's memory and hand back a (dataPtr,len) record in the caller's memory. (A struct is a
  // typed buffer, so the same path returns a string OR a struct.)
  const u8 = (mem) => new Uint8Array(mem.buffer), dv = (mem) => new DataView(mem.buffer), W = 4;
  // sizeof a WIT type's flat layout — i32=4 · str=(ptr,len)=8 · rec=Σfields · list=(ptr,count)=8 · variant=tag+max(case).
  function sizeOf(t) {
    if (t === "str") return 2 * W;
    if (t && t.rec) return t.rec.reduce((s, f) => s + sizeOf(f), 0);
    if (t && t.list) return 2 * W;
    if (t && t.variant) return W + Math.max(0, ...t.variant.map(sizeOf));
    return W;
  }
  // COPY a value of type `t` at `srcAddr` in `src` memory into `dst` ({mem, alloc}), recursively lifting EVERY
  // string (inside records / lists / variants) into dst's OWN memory. Returns the value's address in dst.
  function copyComposite(t, src, srcAddr, dst) {
    const size = sizeOf(t), dstAddr = dst.alloc(size);
    u8(dst.mem).set(u8(src).slice(srcAddr, srcAddr + size), dstAddr);   // raw-copy the flat layout, then fix up pointers
    fixup(t, src, srcAddr, dst, dstAddr);
    return dstAddr;
  }
  function fixup(t, src, srcAddr, dst, dstAddr) {
    if (t === "str") {                                                 // [ptr,len] → lift bytes, lower, rewrite the ptr
      const sptr = dv(src).getInt32(srcAddr, true), len = dv(src).getInt32(srcAddr + W, true);
      const dptr = dst.alloc(len); u8(dst.mem).set(u8(src).slice(sptr, sptr + len), dptr);
      dv(dst.mem).setInt32(dstAddr, dptr, true);
    } else if (t && t.rec) { let off = 0; for (const f of t.rec) { fixup(f, src, srcAddr + off, dst, dstAddr + off); off += sizeOf(f); } }
    else if (t && t.list) {
      const sptr = dv(src).getInt32(srcAddr, true), count = dv(src).getInt32(srcAddr + W, true), es = sizeOf(t.list);
      const buf = dst.alloc(count * es); u8(dst.mem).set(u8(src).slice(sptr, sptr + count * es), buf);
      for (let i = 0; i < count; i++) fixup(t.list, src, sptr + i * es, dst, buf + i * es);
      dv(dst.mem).setInt32(dstAddr, buf, true);
    } else if (t && t.variant) { const tag = dv(src).getInt32(srcAddr, true); if (t.variant[tag]) fixup(t.variant[tag], src, srcAddr + W, dst, dstAddr + W); }
    // i32 / scalars: the raw copy is already correct
  }
  // satisfy a TYPED κ-import: lift/lower params + result across the two ISOLATED memories (the canonical ABI).
  function typedTrampoline(dep, name, params, ret, caller) {
    return (...args) => {
      const depO = { mem: dep.exports.memory, alloc: dep.exports.alloc };
      const callerO = { mem: caller.m, alloc: caller.alloc };
      const out = []; let ai = 0;
      for (const pt of params) {
        if (pt === "str") { const len = args[ai + 1], dptr = depO.alloc(len); u8(depO.mem).set(u8(callerO.mem).slice(args[ai], args[ai] + len), dptr); out.push(dptr, len); ai += 2; }
        else if (pt === "i32") { out.push(args[ai]); ai += 1; }
        else { out.push(copyComposite(pt, callerO.mem, args[ai], depO)); ai += 1; }   // composite param → copy into the callee
      }
      const r = dep.exports[name](...out);
      if (ret === "i32" || ret === "void") return r;
      return copyComposite(ret === "str" ? { rec: ["str"] } : ret, depO.mem, r, callerO);   // lower the result BACK into the caller
    };
  }
  async function linkGraph(kappa, rootImports = {}, cache = new Map()) {
    if (cache.has(kappa)) return cache.get(kappa);
    const module = await WebAssembly.compile(await fetchVerified(kappa));
    const iface = readIface(module);                                    // content-addressed interface types (params + result)
    const caller = { m: null, alloc: null };                           // bound to this module's own memory + allocator
    const importObj = {};
    for (const imp of WebAssembly.Module.imports(module)) {
      if (imp.kind !== "function") continue;                           // memory is DEFINED per-component, not imported
      let fn;
      if (isKappa(imp.module)) {
        const dep = await linkGraph(imp.module, {}, cache);
        const t = iface[imp.name];                                     // present iff the import has a non-trivial WIT type
        fn = t ? typedTrampoline(dep, imp.name, t.params || [], t.ret || "i32", caller) : dep.exports[imp.name];
      } else if (rootImports[imp.module]) fn = rootImports[imp.module][imp.name];
      if (fn === undefined) throw new Error(`link: ${kappa} imports "${imp.module}"."${imp.name}" — unresolved`);
      (importObj[imp.module] ||= {})[imp.name] = fn;
    }
    const instance = await WebAssembly.instantiate(module, importObj);   // (Module, imports) → Instance
    caller.m = instance.exports.memory || null;                          // trampolines lift from / lower into THIS module
    caller.alloc = instance.exports.alloc || null;
    cache.set(kappa, instance);
    return instance;
  }

  // run(ref) → { exports, kappa, selfCompiled }. ref is a κ (artifact OR source) or raw source. A module
  // that imports others by κ is LINKED across the substrate (Holo Link) before it runs.
  async function run(ref, { imports = {} } = {}) {
    let bytes = null, kappa = null, selfCompiled = false;
    if (typeof ref === "string" && ref.includes(":")) {                // a κ → resolve + verify (Law L5)
      kappa = ref; bytes = await store.get(ref);
      if (bytes && !(await verifyOK(ref, u8(bytes)))) throw new Error("L5 refused — " + ref);   // legacy dual-read
    }
    if (!bytes && typeof ref === "string") { const b = await build(ref); kappa = b.kappa; bytes = await store.get(b.kappa); }
    if (!bytes) throw new Error("run: nothing resolves at " + ref);
    bytes = u8(bytes);
    if (!isWasm(bytes)) { const b = await build(dec(bytes)); kappa = b.kappa; selfCompiled = true; }   // a source κ self-compiles
    const instance = await linkGraph(kappa, imports);                   // content-addressed linking + run
    return { exports: instance.exports, kappa, selfCompiled };
  }

  // share(κ) → the κ IS the share. holo://κ resolves anywhere (cache · peers · IPFS · origin), re-derived.
  function share(kappa, { base = "" } = {}) {
    const hex = String(kappa).split(":").pop();
    return { kappa, holo: "holo://" + hex, url: (base || "") + "#k=" + encodeURIComponent(kappa) };
  }

  return { build, run, share, store, index };
}

// ── <holo-app> — the drop-in affordance: a build · run · share panel for any holospace, themed via
// the OS variables (--holo-*). Drop <holo-app></holo-app> anywhere and a holospace can compile, run
// and share by content address. Reads window.HoloApp (set below); zero configuration.
function defineHoloAppElement() {
  if (typeof customElements === "undefined" || customElements.get("holo-app")) return;
  class HoloAppElement extends HTMLElement {
  connectedCallback() {
    if (this._wired) return; this._wired = true;
    const sh = this.attachShadow({ mode: "open" });
    const sample = this.getAttribute("source") || "int sq(int x) { return x * x; }\nint main() { return sq(7); }\n";
    sh.innerHTML = `<style>
      :host{display:block;font:13px/1.5 var(--holo-font-sans,system-ui,sans-serif);color:var(--holo-ink,#e8eaf0)}
      .w{background:var(--holo-surface,#15171c);border:1px solid var(--holo-border,#262a33);border-radius:var(--holo-radius,14px);padding:14px}
      .h{display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--holo-ink-dim,#9aa3b2);margin-bottom:10px}
      textarea{width:100%;height:120px;background:var(--holo-bg,#0c0e12);color:var(--holo-ink,#e9edf6);border:1px solid var(--holo-border,#262a33);border-radius:10px;padding:10px;font:12px/1.6 ui-monospace,monospace;resize:vertical}
      .b{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
      button{font:inherit;font-weight:600;min-height:40px;padding:0 14px;border-radius:10px;cursor:pointer;color:var(--holo-ink,#e8eaf0);background:var(--holo-surface-2,#1b1e25);border:1px solid var(--holo-border,#262a33)}
      button.p{background:color-mix(in srgb,var(--holo-accent,#ff6b3d) 18%,var(--holo-surface-2,#1b1e25));border-color:color-mix(in srgb,var(--holo-accent,#ff6b3d) 45%,var(--holo-border,#262a33))}
      .o{margin-top:10px;font:11.5px/1.6 ui-monospace,monospace;color:var(--holo-ink-dim,#9aa3b2);word-break:break-all;white-space:pre-wrap;min-height:1.4em}
      .k{color:var(--holo-accent,#ff6b3d)}
    </style>
    <div class="w"><div class="h">create · play · share<span class="k">— one κ, serverless, self-verifying</span></div>
      <textarea spellcheck="false">${sample.replace(/</g, "&lt;")}</textarea>
      <div class="b"><button class="p" id="b">Create</button><button id="r">Play</button><button id="s">Share</button></div>
      <div class="o" id="o">edit, then Create → a content address (κ)</div></div>`;
    const $ = (s) => sh.getElementById(s);
    const ta = sh.querySelector("textarea");
    const out = (m, cls = "") => { $("o").innerHTML = cls ? `<span class="${cls}">${m}</span>` : m; };
    let last = null;
    const app = () => window.HoloApp;
    $("b").onclick = async () => { try { last = await app().build(ta.value); out(`κ = <span class="k">${last.kappa}</span>${last.hit ? "  · O(1) rebind" : ""}\nexports: ${last.exports.join(", ")}`); } catch (e) { out("build error: " + e.message, ""); } };
    $("r").onclick = async () => { try { const ref = (last && last.kappa) || ta.value; const r = await app().run(ref); const x = r.exports; const main = x.main || x.demo || x[Object.keys(x)[0]]; out(`ran ${r.selfCompiled ? "(self-compiled) " : ""}→ ${typeof main === "function" ? main() : "[" + Object.keys(x).join(", ") + "]"}`); } catch (e) { out("run error: " + e.message); } };
    $("s").onclick = async () => { try { if (!last) last = await app().build(ta.value); const sh2 = app().share(last.kappa); try { await navigator.clipboard.writeText(sh2.holo); } catch {} out(`shared — <span class="k">${sh2.holo}</span>  (copied; resolves anywhere, re-derived)`); } catch (e) { out("share error: " + e.message); } };
  }
  }
  customElements.define("holo-app", HoloAppElement);
}

// ── browser binding: window.HoloApp over the durable κ-store (shared db "holo") + BLAKE3 (§1.2) ──
if (typeof window !== "undefined") {
  (async () => {
    try {
      const b3hex = (b) => blake3hex(u8(b));                          // §1.2: the ONE canonical κ axis (sync)
      const sha256hex = async (b) => { const d = await crypto.subtle.digest("SHA-256", u8(b)); return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join(""); };   // legacy dual-read
      const { makeStore, idbBackend } = await import("./holo-store.js");
      const store = makeStore({ hash: b3hex, axis: "did:holo:blake3", backend: idbBackend({ db: "holo", store: "kappa" }) });
      const be = idbBackend({ db: "holo-app-index", store: "memo" });   // own db → no version collision with "holo"
      const index = { get: async (k) => { const b = await be.get(k); return b ? JSON.parse(dec(b)) : undefined; }, set: async (k, v) => be.set(k, enc(JSON.stringify(v))) };
      const app = makeApp({ store, hash: b3hex, index, axis: "did:holo:blake3", legacyHash: sha256hex });   // legacy dual-read
      try { const src = await (await fetch(new URL("./holo-forge/holo-forge.mjs", import.meta.url))).arrayBuffer(); app.build.compilerKappa = "did:holo:blake3:" + b3hex(new Uint8Array(src)); } catch {}
      window.HoloApp = window.HoloForge = app;                          // the wired global; holo-sdk wraps it
      defineHoloAppElement();                                           // register <holo-app> (the drop-in affordance)
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-app-ready"));
    } catch (e) { /* leave unset; SDK verbs fail-soft */ }
  })();
}
