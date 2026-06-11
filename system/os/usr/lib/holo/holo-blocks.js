// holo-blocks.js — the NATIVE block runtime for the spatial self-authoring shell (A27).
//
// A "block" is a single-file component: a root markup element + <style> + an
// `export default {…}` definition. defineBlock() turns it into a live Custom Element with
// a Shadow DOM and fine-grained reactive bindings. Authoring stays as ergonomic as
// Playground's Alpine blocks — but there is NO Alpine, NO framework, NO CDN, NO build step:
//
//   • Zero dependencies. Pure ES module over the web platform's own primitives — Custom
//     Elements + Shadow DOM (W3C row B2, required+witnessed) + a ~70-line reactive core.
//     Nothing parallel to the substrate (Law L4); nothing to fetch (Law L1/T3).
//   • UOR-native. The runtime is itself a content-addressed object the shell re-derives
//     before running (Law L5). A block's SOURCE is its κ; defineBlockFromSource() is meant
//     to be called only AFTER the caller verifies that κ (verify-before-run). A block edit
//     is a new κ (the derivation chain lives in holo-blocks-repo.mjs), so redefining a tag
//     is just "run the newer object" — live self-editing with a verifiable guardrail.
//   • Fast in any browser. Fine-grained effects (no virtual DOM, no full re-render → no lost
//     focus); CE v1 + Shadow DOM are Baseline across every modern engine.
//
// The reactive core (reactive/effect/computed) is pure and runs headless — the Node test
// exercises it directly. The DOM layer is created lazily so importing this module in Node
// (no `HTMLElement`) is safe; only the browser instantiates the Custom Element base.

// ── reactive core — minimal signals (track on read, trigger on write) ─────────────────
const ITERATE = Symbol("iterate");
const targetMap = new WeakMap();   // target → (key → Set<effect>)
const reactiveMap = new WeakMap(); // raw → proxy (stable identity, no double-wrap)
const proxySet = new WeakSet();    // every reactive proxy (so child scopes can inherit one)
const effectStack = [];
let activeEffect = null;

// observe ONLY plain data — plain objects, arrays, or objects inheriting a reactive scope.
// Host objects (DOM nodes, CSSStyleDeclaration, …) are returned RAW: proxying them would make
// native methods run with the proxy as `this` → "Illegal invocation". So $el/$host stay real.
function isObservable(v) {
  if (v === null || typeof v !== "object") return false;
  if (Array.isArray(v)) return true;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null || proxySet.has(p);
}

function track(target, key) {
  if (!activeEffect) return;
  let deps = targetMap.get(target);
  if (!deps) targetMap.set(target, (deps = new Map()));
  let dep = deps.get(key);
  if (!dep) deps.set(key, (dep = new Set()));
  if (!dep.has(activeEffect)) { dep.add(activeEffect); activeEffect.deps.push(dep); }
}
function trigger(target, key) {
  const deps = targetMap.get(target);
  if (!deps) return;
  const run = new Set();
  for (const k of [key, ITERATE]) { const d = deps.get(k); if (d) for (const e of d) if (e !== activeEffect) run.add(e); }
  for (const e of run) (e.scheduler ? e.scheduler() : e.run());
}

export function reactive(target) {
  if (!isObservable(target)) return target;
  if (reactiveMap.has(target)) return reactiveMap.get(target);
  const proxy = new Proxy(target, {
    get(t, k, r) { if (k === "__isReactive") return true; const v = Reflect.get(t, k, r); track(t, k); return isObservable(v) ? reactive(v) : v; },
    set(t, k, v, r) {
      const isArr = Array.isArray(t);
      const had = Object.prototype.hasOwnProperty.call(t, k);
      const old = t[k], oldLen = isArr ? t.length : 0;
      const res = Reflect.set(t, k, v, r);
      if (old !== v || !had) trigger(t, k);
      if (!had) trigger(t, ITERATE);
      // an index write (e.g. push) auto-grows array .length internally — the set trap
      // never fires for "length", so trigger it ourselves to wake .length readers.
      if (isArr && k !== "length" && t.length !== oldLen) trigger(t, "length");
      return res;
    },
    deleteProperty(t, k) { const had = Object.prototype.hasOwnProperty.call(t, k); const res = Reflect.deleteProperty(t, k); if (had) { trigger(t, k); trigger(t, ITERATE); } return res; },
    has(t, k) { track(t, k); return Reflect.has(t, k); },
    ownKeys(t) { track(t, ITERATE); return Reflect.ownKeys(t); },
  });
  reactiveMap.set(target, proxy); proxySet.add(proxy);
  return proxy;
}

class ReactiveEffect {
  constructor(fn, scheduler) { this.fn = fn; this.scheduler = scheduler; this.deps = []; this.active = true; }
  run() {
    if (!this.active) return this.fn();
    cleanup(this);
    try { effectStack.push(this); activeEffect = this; return this.fn(); }
    finally { effectStack.pop(); activeEffect = effectStack[effectStack.length - 1] || null; }
  }
  stop() { if (this.active) { cleanup(this); this.active = false; } }
}
function cleanup(e) { for (const dep of e.deps) dep.delete(e); e.deps.length = 0; }

export function effect(fn, opts = {}) {
  const e = new ReactiveEffect(fn, opts.scheduler);
  if (!opts.lazy) e.run();
  const runner = e.run.bind(e); runner.effect = e; runner.stop = () => e.stop();
  return runner;
}
export function computed(getter) {
  let value, dirty = true;
  const e = new ReactiveEffect(getter, () => { dirty = true; });
  return { get value() { if (dirty) { value = e.run(); dirty = false; } return value; } };
}

// ── single-file-component parsing (pure string ops — Node-safe) ───────────────────────
// A block source = markup + <style>…</style> + <script type="module">export default {…}</script>.
export function parseSFC(source) {
  const src = String(source);
  const styles = []; let m;
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleRe.exec(src))) styles.push(m[1]);
  const scriptMatch = src.match(/<script[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/i);
  const script = scriptMatch ? scriptMatch[1] : "";
  const template = src.replace(styleRe, "").replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").trim();
  return { template, style: styles.join("\n"), script };
}

// ── expression evaluation in a scope (cached; `with` keeps authoring terse) ────────────
// eval-like, by design: a block's script runs in the shell only AFTER its κ is verified
// (verify-before-run). Untrusted/user blocks belong in a sandboxed iframe (capability tier).
const exprCache = new Map();
function evalExpr(expr, scope, extra) {
  let fn = exprCache.get(expr);
  if (!fn) { fn = new Function("$s", "$e", "with($s){ return (" + expr + ") }"); exprCache.set(expr, fn); }
  return fn(scope, extra);
}
const stmtCache = new Map();
function runStmt(code, scope, extra) {
  let fn = stmtCache.get(code);
  if (!fn) { fn = new Function("$s", "$event", "with($s){ " + code + " }"); stmtCache.set(code, fn); }
  return fn(scope, extra);
}

// ── declarative bindings — native data-* attributes, each its own fine-grained effect ──
// data-text · data-html · data-show · data-if · data-class · data-style · data-model
// data-on:EVENT="stmt" · data-attr:NAME="expr" · data-for="item in list" (on <template>)
function applyBindings(root, scope, sink) {
  const walk = (el) => {
    if (el.nodeType !== 1) return;

    // data-for on a <template> — render one clone per item, re-render on list change.
    const forExpr = el.getAttribute && el.getAttribute("data-for");
    if (forExpr && el.tagName === "TEMPLATE") {
      const fm = forExpr.match(/^\s*(\w+)\s+in\s+(.+)$/);
      if (!fm) return;
      const item = fm[1], listExpr = fm[2];
      const anchor = document.createComment("for");
      el.replaceWith(anchor);
      let rendered = [], childSinks = [];
      sink.push(effect(() => {
        const list = evalExpr(listExpr, scope) || [];
        for (const n of rendered) n.remove(); rendered = [];
        for (const e of childSinks) e.stop && e.stop(); childSinks = []; // no effect leak on re-render
        list.forEach((v, i) => {
          const frag = el.content.cloneNode(true);
          const childScope = reactive(Object.assign(Object.create(scope), { [item]: v, $index: i }));
          for (const node of [...frag.children]) { applyBindings(node, childScope, childSinks); rendered.push(node); }
          anchor.parentNode.insertBefore(frag, anchor);
        });
      }));
      return; // children handled per-clone
    }

    for (const attr of [...el.attributes]) {
      const { name, value } = attr;
      if (name === "data-text") sink.push(effect(() => { el.textContent = evalExpr(value, scope); }));
      else if (name === "data-html") sink.push(effect(() => { el.innerHTML = evalExpr(value, scope); }));
      else if (name === "data-show") sink.push(effect(() => { el.style.display = evalExpr(value, scope) ? "" : "none"; }));
      else if (name === "data-if") sink.push(effect(() => { el.hidden = !evalExpr(value, scope); }));
      else if (name === "data-class") sink.push(effect(() => { const c = evalExpr(value, scope); el.className = Array.isArray(c) ? c.join(" ") : typeof c === "object" ? Object.keys(c).filter((k) => c[k]).join(" ") : String(c || ""); }));
      else if (name === "data-style") sink.push(effect(() => { const s = evalExpr(value, scope) || {}; for (const k in s) el.style[k] = s[k]; }));
      else if (name === "data-model") {
        sink.push(effect(() => { if (el.value !== scope[value]) el.value = scope[value] ?? ""; }));
        el.addEventListener("input", () => { scope[value] = el.type === "number" ? +el.value : el.value; });
      }
      else if (name.startsWith("data-on:")) { const ev = name.slice(8); el.addEventListener(ev, (e) => runStmt(value, scope, e)); }
      else if (name.startsWith("data-attr:")) { const a = name.slice(10); sink.push(effect(() => { const v = evalExpr(value, scope); v == null || v === false ? el.removeAttribute(a) : el.setAttribute(a, v === true ? "" : v); })); }
    }
    for (const child of [...el.children]) walk(child); // snapshot: data-for may insert clones live
  };
  // root may be an element (data-for clone) or a ShadowRoot/fragment (nodeType 11) — walk
  // the element itself, else each of the fragment's element children.
  if (root.nodeType === 1) walk(root); else for (const child of [...root.children]) walk(child);
}

// ── defineBlock — register a native Custom Element from a definition object ────────────
// def: { state…, mixins?, init?(), methods… }. Reactive `this.state` is the merged data;
// methods are bound; bindings + a <slot> compose like any web component.
let _baseClass = null;
function baseClass() {
  if (_baseClass) return _baseClass;
  if (typeof HTMLElement === "undefined") throw new Error("holo-blocks: no DOM (call defineBlock in a browser)");
  return (_baseClass = class HoloBlockElement extends HTMLElement {
    connectedCallback() {
      const def = this.constructor._def || {};
      const data = {}; const methods = {};
      for (const src of [...(def.mixins || []), def]) {
        for (const [k, v] of Object.entries(src)) {
          if (k === "mixins") continue;
          if (typeof v === "function") methods[k] = v; else data[k] = structuredClonish(v);
        }
      }
      // props from attributes (string-typed), available as scope.props
      const props = {}; for (const a of this.attributes) props[a.name] = a.value;
      const scope = reactive(Object.assign({}, data, { props, $el: this, $host: this }));
      for (const [k, fn] of Object.entries(methods)) scope[k] = fn.bind(scope);
      this._scope = scope; this._sink = [];

      const shadow = this.attachShadow({ mode: "open" });
      const tpl = this.constructor._template;
      if (def.style || this.constructor._style) { const st = document.createElement("style"); st.textContent = this.constructor._style || def.style || ""; shadow.appendChild(st); }
      const frag = document.createElement("div"); frag.innerHTML = tpl || "<slot></slot>"; while (frag.firstChild) shadow.appendChild(frag.firstChild);
      applyBindings(shadow, scope, this._sink);
      if (typeof scope.init === "function") scope.init();
    }
    disconnectedCallback() { for (const e of this._sink || []) e.stop && e.stop(); this._sink = []; if (this._scope && typeof this._scope.destroy === "function") this._scope.destroy(); }
  });
}
const structuredClonish = (v) => (v && typeof v === "object") ? JSON.parse(JSON.stringify(v)) : v;

export function defineBlock(tag, def, { template = "", style = "" } = {}) {
  const Base = baseClass();
  if (customElements.get(tag)) { const C = customElements.get(tag); C._def = def; C._template = template; C._style = style; return C; }
  const C = class extends Base {}; C._def = def; C._template = template; C._style = style;
  customElements.define(tag, C); return C;
}

// Define from SFC source. The script's `export default {…}` is imported via a blob module
// URL — so ONLY call this on source whose κ you have already re-derived (Law L5). For
// untrusted/user blocks, mount in a sandboxed iframe instead (capability isolation tier).
export async function defineBlockFromSource(tag, source) {
  const { template, style, script } = parseSFC(source);
  let def = {};
  if (script.trim()) {
    const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
    try { def = (await import(/* @vite-ignore */ url)).default || {}; } finally { URL.revokeObjectURL(url); }
  }
  return defineBlock(tag, def, { template, style });
}

// Verify-before-define: re-derive the source's address with the caller's substrate verifier
// (Law L5) and refuse on mismatch — UOR supply-chain safety for live self-editing.
export async function verifyAndDefine(tag, source, expectedDid, deriveDid) {
  const got = await deriveDid(source);
  if (expectedDid && got !== expectedDid) throw new Error(`holo-blocks: κ mismatch for <${tag}> — refused (expected ${expectedDid}, got ${got})`);
  return defineBlockFromSource(tag, source);
}

// ── pure reactive-core self-test (the Node test + browser witness both run this) ───────
export function reactiveSelftest() {
  const s = reactive({ a: 1, b: 2, list: [] });
  let sum = 0, runs = 0;
  effect(() => { sum = s.a + s.b; runs++; });
  const r0 = runs, sum0 = sum;          // initial run
  s.a = 10; const sum1 = sum;           // re-run on dep change
  s.b = 10; const runs2 = runs;         // re-run again
  s.c = 99; const runsAfterUnrelated = runs; // new key not tracked by this effect → no extra run

  let len = 0, listRuns = 0;
  effect(() => { len = s.list.length; listRuns++; });
  s.list.push("x"); s.list.push("y");   // array mutation triggers (ITERATE/length)
  const arrayReacts = len === 2 && listRuns >= 2;

  // conditional deps: when `on` is false, changing `b` must NOT re-run (cleanup works).
  const t = reactive({ on: true, x: 1, y: 100 }); let val = 0, tRuns = 0;
  effect(() => { val = t.on ? t.x : 0; tRuns++; });
  t.on = false; const afterOff = tRuns; t.x = 5; const noRerunOnHiddenDep = tRuns === afterOff;

  const ok = sum0 === 3 && r0 === 1 && sum1 === 12 && runs2 === r0 + 2 && runsAfterUnrelated === runs2 && arrayReacts && noRerunOnHiddenDep;
  return { initialRun: r0 === 1, reactsToChange: sum1 === 12, untrackedKeyInert: runsAfterUnrelated === runs2, arrayReacts, conditionalCleanup: noRerunOnHiddenDep, ok };
}

const HoloBlocks = { reactive, effect, computed, parseSFC, defineBlock, defineBlockFromSource, verifyAndDefine, reactiveSelftest };
if (typeof globalThis !== "undefined") globalThis.HoloBlocks = globalThis.HoloBlocks || HoloBlocks;
export default HoloBlocks;
