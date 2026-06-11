// holo-qml.mjs — the hologram-native QML engine.
//
// QML (https://doc.qt.io/qt-6/qtqml-index.html · The QML Reference) is Qt's declarative UI
// language: a tree of typed objects, each with properties whose values are JavaScript
// EXPRESSIONS that re-evaluate when their dependencies change (property bindings), plus
// signal handlers (on<Signal>:). The reference engine (QtQml) is C++ compiled to a native
// runtime — which a browser cannot host without shipping an opaque foreign WASM blob (Law L4
// forbids it; ADR-0029). So, exactly the way Holo Splash projects Plymouth's scripting
// language (holo-plymouth.js: a real Lexer → Parser → Interpreter over the documented surface)
// and Holo Boot projects rEFInd, this module PROJECTS QML: it parses the real, verbatim
// upstream .qml SOURCE (e.g. SDDM's data/themes/maldives/Main.qml, installed + content-
// addressed under /usr/share/sddm/) and EXECUTES it against the documented semantics, rendering
// the live object tree to the DOM. Nothing about the theme is hand-written; the theme is the
// real source and the engine is infrastructure — witnessed against its authority (qml-engine-
// witness.mjs vs the QML Reference). Binding/handler expressions ARE JavaScript and are run as
// JavaScript by the host JS engine (the faithful "JavaScript Host Environment"), inside a QML
// scope chain (own props → ids → root props → context → Qt globals) with dependency tracking.
//
// Backends mirror Plymouth's: a DomBackend renders to real elements in the browser; a
// HeadlessBackend builds an inert object-tree model so the witness can run a theme to
// completion in Node — assert the component tree, that bindings resolve, and that the real
// SDDM API surface (sddm.login · userModel · sessionModel) is wired — with no DOM and no GPU.
//
// Exports: tokenize, Parser, parseQml, parseThemeConf, reactive primitives (track/trigger),
//          QmlItem, QmlEngine, createHeadlessBackend, createDomBackend, hostEnv.
//
// Pure at module scope (no `document`, no WebCrypto) so Node can import it; the DOM backend
// touches the document only when constructed in a browser, and the SddmComponents factories are
// INJECTED by the host page (login.html) rather than imported here — keeping the engine free of
// browser-only dependencies. Authorities: Qt 6 QML Reference (QtQml) · SDDM (github.com/sddm/sddm).

// ───────────────────────────────────────────────────────────────────────────────
// A · Source scanner.  QML is parsed structurally; binding/handler right-hand sides
//     are captured as RAW JavaScript source (then run by the host JS engine), so the
//     scanner only needs to find object/member boundaries and read balanced spans.
// ───────────────────────────────────────────────────────────────────────────────
export class Scanner {
  constructor(src) { this.s = String(src); this.i = 0; this.n = this.s.length; this.line = 1; }
  error(m) { throw new Error(`QML: ${m} (line ${this.line})`); }
  eof() { return this.i >= this.n; }
  cur() { return this.s[this.i]; }

  // skip whitespace + // line and /* */ block comments, tracking line numbers
  ws() {
    for (;;) {
      const c = this.s[this.i];
      if (c === undefined) return;
      if (c === "\n") { this.line++; this.i++; continue; }
      if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v") { this.i++; continue; }
      if (c === "/" && this.s[this.i + 1] === "/") { this.i += 2; while (this.i < this.n && this.s[this.i] !== "\n") this.i++; continue; }
      if (c === "/" && this.s[this.i + 1] === "*") {
        this.i += 2;
        while (this.i < this.n && !(this.s[this.i] === "*" && this.s[this.i + 1] === "/")) { if (this.s[this.i] === "\n") this.line++; this.i++; }
        this.i += 2; continue;
      }
      return;
    }
  }
  peek() { this.ws(); return this.s[this.i]; }
  startsWord(w) {
    this.ws();
    if (!this.s.startsWith(w, this.i)) return false;
    const after = this.s[this.i + w.length];
    return after === undefined || !/[A-Za-z0-9_]/.test(after);
  }
  eatWord(w) { if (this.startsWord(w)) { this.i += w.length; return true; } return false; }
  expect(ch) { this.ws(); if (this.s[this.i] !== ch) this.error(`expected '${ch}'`); this.i++; }

  // a (possibly dotted) identifier: Type, Namespace.Type, anchors.fill, Keys.onPressed
  qualifiedName() {
    this.ws();
    let m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i));
    if (!m) this.error("expected identifier");
    const parts = [m[0]]; this.i += m[0].length;
    for (;;) {
      const save = this.i; this.ws();
      if (this.s[this.i] === "." && /[A-Za-z_]/.test(this.s[this.i + 1] || "")) {
        this.i++; m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i)); parts.push(m[0]); this.i += m[0].length;
      } else { this.i = save; break; }
    }
    return parts;
  }

  // read a balanced JavaScript expression starting at the cursor, stopping at a top-level
  // terminator: newline (only when nothing is open), ';', '}' or ',' of the enclosing object.
  // Respects (), [], {}, '', "", `` and comments. Returns the raw trimmed source.
  readExpression() {
    this.ws();
    const start = this.i;
    let depth = 0;
    while (this.i < this.n) {
      const c = this.s[this.i];
      if (c === "/" && this.s[this.i + 1] === "/") { while (this.i < this.n && this.s[this.i] !== "\n") this.i++; continue; }
      if (c === "/" && this.s[this.i + 1] === "*") { this.i += 2; while (this.i < this.n && !(this.s[this.i] === "*" && this.s[this.i + 1] === "/")) { if (this.s[this.i] === "\n") this.line++; this.i++; } this.i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { this.i = this._skipString(this.i, c); continue; }
      if (c === "(" || c === "[" || c === "{") { depth++; this.i++; continue; }
      if (c === ")" || c === "]" || c === "}") { if (depth === 0) break; depth--; this.i++; continue; }
      if (depth === 0 && (c === ";" || c === ",")) break;
      if (c === "\n") { if (depth === 0) { this.line++; break; } this.line++; this.i++; continue; }
      this.i++;
    }
    const raw = this.s.slice(start, this.i).trim();
    if (this.s[this.i] === ";" || this.s[this.i] === ",") this.i++;          // consume optional terminator
    return raw;
  }

  // read a balanced { ... } block and return the INNER source (handler / function bodies)
  readBlock() {
    this.ws(); if (this.s[this.i] !== "{") this.error("expected '{'");
    const start = this.i; this.i++; let depth = 1;
    while (this.i < this.n && depth > 0) {
      const c = this.s[this.i];
      if (c === "/" && this.s[this.i + 1] === "/") { while (this.i < this.n && this.s[this.i] !== "\n") this.i++; continue; }
      if (c === "/" && this.s[this.i + 1] === "*") { this.i += 2; while (this.i < this.n && !(this.s[this.i] === "*" && this.s[this.i + 1] === "/")) { if (this.s[this.i] === "\n") this.line++; this.i++; } this.i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { this.i = this._skipString(this.i, c); continue; }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === "\n") this.line++;
      this.i++;
    }
    return this.s.slice(start + 1, this.i - 1);     // inner, braces stripped
  }

  _skipString(i, q) {
    i++;
    while (i < this.n) {
      const c = this.s[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "\n") this.line++;
      if (c === q) { i++; break; }
      // template-literal ${ ... } may nest — shallow-skip the braces
      if (q === "`" && c === "$" && this.s[i + 1] === "{") { let d = 1; i += 2; while (i < this.n && d > 0) { if (this.s[i] === "{") d++; else if (this.s[i] === "}") d--; i++; } continue; }
      i++;
    }
    return i;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// B · Parser → AST.  Document = import* objectDef.  An object = Type { member* }.
//     Members: id:, property decls, signal decls, function decls, child objects,
//     grouped-property objects (anchors { ... }), property bindings (x: expr,
//     anchors.fill: expr, KeyNavigation.tab: expr) and signal handlers (on<Sig>:).
// ───────────────────────────────────────────────────────────────────────────────
const PROP_TYPE = /^(int|real|double|bool|string|url|var|color|font|date|point|size|rect|alias|list|vector2d|vector3d|matrix4x4|quaternion)\b/;

export class Parser {
  constructor(src) { this.sc = new Scanner(src); }

  parse() {
    const imports = [];
    while (this.sc.startsWord("import")) imports.push(this.importStmt());
    const root = this.object();
    return { type: "Document", imports, root };
  }

  importStmt() {
    this.sc.eatWord("import");
    this.sc.ws();
    let module, version = "";
    if (this.sc.cur() === '"' || this.sc.cur() === "'") {                    // import "dir"
      const q = this.sc.cur(); const end = this.sc._skipString(this.sc.i, q); module = this.sc.s.slice(this.sc.i + 1, end - 1); this.sc.i = end;
    } else {
      module = this.sc.qualifiedName().join(".");
    }
    this.sc.ws();
    const v = /^\d+(\.\d+)?/.exec(this.sc.s.slice(this.sc.i));               // optional version
    if (v) { version = v[0]; this.sc.i += v[0].length; }
    let as = null;
    if (this.sc.eatWord("as")) as = this.sc.qualifiedName().join(".");
    return { module, version, as };
  }

  object() {
    const name = this.sc.qualifiedName();                                    // Type or Namespace.Type
    this.sc.expect("{");
    const node = { type: "Object", typeName: name.join("."), members: [] };
    while (this.sc.peek() !== "}" && !this.sc.eof()) node.members.push(this.member());
    this.sc.expect("}");
    return node;
  }

  member() {
    // id: <name>
    if (this.sc.startsWord("id")) {
      const save = this.sc.i; this.sc.eatWord("id");
      if (this.sc.peek() === ":") { this.sc.expect(":"); const idn = this.sc.qualifiedName()[0]; this.sc.eatWord(";") ; return { kind: "id", name: idn }; }
      this.sc.i = save;
    }
    // property [readonly] [default] <type> <name> [: rhs]
    if (this.sc.startsWord("property") || this.sc.startsWord("readonly") || this.sc.startsWord("default")) {
      return this.propertyDecl();
    }
    // signal foo(args)
    if (this.sc.startsWord("signal")) {
      this.sc.eatWord("signal"); const nm = this.sc.qualifiedName()[0]; let params = [];
      if (this.sc.peek() === "(") params = this.paramList();
      this.sc.eatWord(";");
      return { kind: "signal", name: nm, params };
    }
    // function foo(args) { body }   — incl. Connections' `function onX(args){}`
    if (this.sc.startsWord("function")) {
      this.sc.eatWord("function"); const nm = this.sc.qualifiedName()[0]; const params = this.paramList(); const body = this.sc.readBlock();
      if (/^on[A-Z]/.test(nm)) return { kind: "handler", signal: nm, params, body, isExpr: false };
      return { kind: "method", name: nm, params, body };
    }
    // qualifiedName then ':' (binding/handler) or '{' (child object / grouped property)
    const path = this.sc.qualifiedName();
    const p = this.sc.peek();
    if (p === ":") {
      this.sc.expect(":");
      const last = path[path.length - 1];
      if (/^on[A-Z]/.test(last)) return this.handler(path);                  // signal handler
      return this.binding(path);                                             // property binding
    }
    if (p === "{") {
      const last = path[path.length - 1];
      if (/^[A-Z]/.test(last)) return { kind: "child", object: this.objectFrom(path) };    // child object (Type {)
      return { kind: "grouped", path, members: this.groupBody() };          // grouped property (anchors {)
    }
    this.sc.error(`unexpected member near '${path.join(".")}'`);
  }

  // parse the body of an object whose type name was already consumed (child object case)
  objectFrom(name) {
    this.sc.expect("{");
    const node = { type: "Object", typeName: name.join("."), members: [] };
    while (this.sc.peek() !== "}" && !this.sc.eof()) node.members.push(this.member());
    this.sc.expect("}");
    return node;
  }
  groupBody() {
    this.sc.expect("{");
    const members = [];
    while (this.sc.peek() !== "}" && !this.sc.eof()) members.push(this.member());
    this.sc.expect("}");
    return members;
  }

  propertyDecl() {
    let readonly = false, isDefault = false;
    if (this.sc.eatWord("readonly")) readonly = true;
    if (this.sc.eatWord("default")) isDefault = true;
    this.sc.eatWord("property");
    this.sc.ws();
    const tm = PROP_TYPE.exec(this.sc.s.slice(this.sc.i)) || /^[A-Za-z_][A-Za-z0-9_.<>]*/.exec(this.sc.s.slice(this.sc.i));
    const ptype = tm[0]; this.sc.i += ptype.length;
    const name = this.sc.qualifiedName()[0];
    let rhs = null, child = null;
    if (this.sc.peek() === ":") {
      this.sc.expect(":");
      this.sc.ws();
      // `property var x: SomeType { }` (rare) vs an expression
      if (/^[A-Z]/.test(this.sc.cur() || "") && this._looksLikeObject()) child = this.object();
      else rhs = this.sc.readExpression();
    }
    return { kind: "propDecl", ptype, name, rhs, child, readonly, isDefault };
  }
  // lookahead: is this `Type { ...` (an object) rather than an expression beginning with a Cap id?
  _looksLikeObject() {
    const save = this.sc.i, sl = this.sc.line;
    try { this.sc.qualifiedName(); const ok = this.sc.peek() === "{"; this.sc.i = save; this.sc.line = sl; return ok; }
    catch { this.sc.i = save; this.sc.line = sl; return false; }
  }

  binding(path) {
    this.sc.ws();
    // `x: SomeType { }` — a property bound to an object value
    if (/^[A-Z]/.test(this.sc.cur() || "") && this._looksLikeObject()) return { kind: "binding", path, object: this.object() };
    const rhs = this.sc.readExpression();
    return { kind: "binding", path, rhs };
  }

  handler(path) {
    this.sc.ws();
    const last = path[path.length - 1];
    if (this.sc.startsWord("function")) {                                    // on X: function(a){ ... }
      this.sc.eatWord("function"); const params = this.paramList(); const body = this.sc.readBlock();
      return { kind: "handler", signal: last, attach: path.length > 1 ? path.slice(0, -1) : null, params, body, isExpr: false };
    }
    if (this.sc.peek() === "{") {                                            // on X: { statements }
      const body = this.sc.readBlock();
      return { kind: "handler", signal: last, attach: path.length > 1 ? path.slice(0, -1) : null, params: [], body, isExpr: false };
    }
    const expr = this.sc.readExpression();                                   // on X: expression
    return { kind: "handler", signal: last, attach: path.length > 1 ? path.slice(0, -1) : null, params: [], body: expr, isExpr: true };
  }

  paramList() {
    this.sc.expect("(");
    const params = [];
    this.sc.ws();
    while (this.sc.peek() !== ")" && !this.sc.eof()) {
      // params may be `type name` or just `name`; keep the LAST identifier as the name
      const ids = this.sc.qualifiedName();
      params.push(ids[ids.length - 1]);
      this.sc.ws();
      if (this.sc.peek() === ",") this.sc.expect(",");
    }
    this.sc.expect(")");
    return params;
  }
}

export function parseQml(src) { return new Parser(src).parse(); }

// theme.conf (SDDM/INI) → { General-merged key:value } (the `config` context object)
export function parseThemeConf(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/[;#].*$/, "").trim();
    if (!line || /^\[.*\]$/.test(line)) continue;
    const m = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (m) { let v = m[2].trim().replace(/^"(.*)"$/, "$1"); out[m[1].trim()] = v; }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────────
// C · Reactivity.  Property reads inside a binding are tracked; writes re-run the
//     bindings that read them — QML's property-binding graph in miniature.
// ───────────────────────────────────────────────────────────────────────────────
let ACTIVE = null;                                  // the binding currently evaluating
const SUBS = new WeakMap();                          // item → (key → Set<effect>)
function subsFor(item, key) {
  let m = SUBS.get(item); if (!m) { m = new Map(); SUBS.set(item, m); }
  let s = m.get(key); if (!s) { s = new Set(); m.set(key, s); }
  return s;
}
export function track(item, key) {
  if (ACTIVE) { const s = subsFor(item, key); s.add(ACTIVE); ACTIVE.deps.push(s); }
}
export function trigger(item, key) {
  const m = SUBS.get(item); if (!m) return;
  const s = m.get(key); if (!s) return;
  for (const eff of [...s]) if (eff !== ACTIVE) eff.run();
}

// ───────────────────────────────────────────────────────────────────────────────
// D · Scope + expression compilation.  A QML binding/handler is JavaScript evaluated
//     in the QML scope chain. We realize the chain with `with(scopeProxy){…}`: the
//     proxy's `has` claims every name so all lookups resolve through `get`, which walks
//     own props → ids → root props → context → Qt host env, TRACKING reactive reads.
// ───────────────────────────────────────────────────────────────────────────────
const EXPR_CACHE = new Map();
function compileExpr(src) {
  let fn = EXPR_CACHE.get("e:" + src);
  if (!fn) { fn = new Function("__s__", `with(__s__){ return (${src}); }`); EXPR_CACHE.set("e:" + src, fn); }
  return fn;
}
function compileBody(src, params) {
  const key = "b:" + params.join(",") + ":" + src;
  let fn = EXPR_CACHE.get(key);
  if (!fn) { fn = new Function("__s__", ...params, `with(__s__){ ${src} }`); EXPR_CACHE.set(key, fn); }
  return fn;
}

function makeScope(item, locals) {
  const host = item.engine.host;
  return new Proxy(Object.create(null), {
    has() { return true; },                                  // route every name through get()
    get(_t, key) {
      if (key === Symbol.unscopables) return undefined;
      if (typeof key === "symbol") return undefined;
      if (locals && key in locals) return locals[key];
      if (key === "parent") return item.parent ? item.parent.proxy : undefined;
      if (item.methods && key in item.methods) return item.methods[key];
      if (item.hasProp(key)) return item.get(key);                          // own property (tracked)
      const idItem = item.engine.ids[key]; if (idItem) return idItem.proxy; // id in component scope
      const root = item.engine.root;
      if (root && root !== item && root.hasProp(key)) return root.get(key); // root object property
      const ctx = item.engine.context;
      if (ctx && key in ctx) return ctx[key];                              // context property
      if (host && key in host) return host[key];                           // Qt / Math / enums
      if (key in globalThis) return globalThis[key];                       // JS globals
      return undefined;
    },
    set(_t, key, val) {
      if (item.hasProp(key)) { item.set(key, val); return true; }
      const idItem = item.engine.ids[key]; if (idItem) { return true; }     // ids are not reassignable
      const root = item.engine.root;
      if (root && root.hasProp(key)) { root.set(key, val); return true; }
      item.set(key, val); return true;
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// E · QmlItem — a live object in the tree: a reactive property store, an id, children,
//     a backend node (DOM element or headless model), and its signal handlers.
// ───────────────────────────────────────────────────────────────────────────────
export class QmlItem {
  constructor(engine, typeName, parent) {
    this.engine = engine; this.type = typeName; this.parent = parent;
    this.children = []; this.props = Object.create(null); this.bindings = Object.create(null);
    this.methods = Object.create(null); this.signals = Object.create(null); this.id = null;
    this.node = null;                                   // backend handle
    this.props.implicitWidth = 0; this.props.implicitHeight = 0;   // content sizes (filled from the DOM after mount)
    const self = this;
    this.proxy = new Proxy(Object.create(null), {
      has(_t, k) { return self.hasProp(k) || k === "parent" || (self.methods && k in self.methods); },
      get(_t, k) {
        if (typeof k === "symbol") return undefined;
        if (k === "parent") return self.parent ? self.parent.proxy : undefined;
        if (self.methods && k in self.methods) return self.methods[k];
        if (self.signals && k in self.signals) return self.signals[k];
        return self.get(k);
      },
      set(_t, k, v) { self.set(k, v); return true; },
    });
  }
  hasProp(k) { return k in this.props; }
  get(k) { track(this, k); return this.props[k]; }
  peek(k) { return this.props[k]; }                     // untracked read
  set(k, v) {
    const old = this.props[k];
    this.props[k] = v;
    if (old !== v) { this.engine.applyProp(this, k, v); trigger(this, k); }
  }
  // define a property whose value is a binding (re-evaluated on dependency change)
  bind(k, exprSrc) {
    const item = this;
    let first = true;
    const effect = {
      deps: [],
      run() {
        for (const s of effect.deps) s.delete(effect);
        effect.deps.length = 0;
        const prev = ACTIVE; ACTIVE = effect;
        let val;
        try { val = compileExpr(exprSrc)(makeScope(item)); }
        catch (e) { val = undefined; item.engine.warn(`binding '${k}' on ${item.type}: ${e.message}`); }
        finally { ACTIVE = prev; }
        // First evaluation must reach the DOM even if it equals the value the eager
        // construction pass pre-populated into props — otherwise set()'s old===v guard
        // skips applyProp and a CONSTANT binding (e.g. Image.source) never paints.
        if (first) { first = false; item.props[k] = val; item.engine.applyProp(item, k, val); trigger(item, k); }
        else item.set(k, val);
      },
    };
    this.bindings[k] = effect;
    effect.run();
  }
  setConst(k, v) { this.props[k] = v; this.engine.applyProp(this, k, v); }
  // compile a signal handler/expression into a callable bound to this item's scope
  makeHandler(h) {
    const item = this;
    if (h.isExpr) {
      const fn = compileBody("return (" + h.body + ");", h.params);
      return (...args) => { const locals = {}; h.params.forEach((p, i) => locals[p] = args[i]); try { return fn(makeScope(item, locals), ...args); } catch (e) { item.engine.warn(`handler ${h.signal}: ${e.message}`); } };
    }
    const fn = compileBody(h.body, h.params);
    return (...args) => { const locals = {}; h.params.forEach((p, i) => locals[p] = args[i]); try { return fn(makeScope(item, locals), ...args); } catch (e) { item.engine.warn(`handler ${h.signal}: ${e.message}`); } };
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// F · The Qt JavaScript host environment + type enums + key map.  These are the
//     globals the QML Reference says are available to expressions (Qt, Math, console)
//     plus the attached enum namespaces the greeter reads (Text/Image/TextEdit/Qt.Key_*).
// ───────────────────────────────────────────────────────────────────────────────
const QT_KEYS = { Enter: 0x01000005, Return: 0x01000004, Escape: 0x01000000, Tab: 0x01000001, Backtab: 0x01000002, Backspace: 0x01000003, Space: 0x20, Up: 0x01000013, Down: 0x01000014, Left: 0x01000012, Right: 0x01000011 };
// translate a DOM KeyboardEvent into a Qt-style key event so the verbatim QML handler
// (`event.key === Qt.Key_Return`) works unchanged.
export function toQtKeyEvent(e) {
  const map = { Enter: QT_KEYS.Return, NumpadEnter: QT_KEYS.Enter, Escape: QT_KEYS.Escape, Tab: e.shiftKey ? QT_KEYS.Backtab : QT_KEYS.Tab, Backspace: QT_KEYS.Backspace, " ": QT_KEYS.Space, ArrowUp: QT_KEYS.Up, ArrowDown: QT_KEYS.Down, ArrowLeft: QT_KEYS.Left, ArrowRight: QT_KEYS.Right };
  const key = map[e.key] !== undefined ? map[e.key] : (e.key && e.key.length === 1 ? e.key.toUpperCase().charCodeAt(0) : 0);
  return { key, text: e.key && e.key.length === 1 ? e.key : "", modifiers: (e.shiftKey ? 0x02000000 : 0) | (e.ctrlKey ? 0x04000000 : 0) | (e.altKey ? 0x08000000 : 0), accepted: false, _dom: e };
}

export function hostEnv(baseUrl) {
  const resolve = (u) => {
    if (u == null) return u;
    u = String(u);
    if (/^([a-z]+:)?\/\//i.test(u) || u.startsWith("/") || u.startsWith("data:")) return u;
    return (baseUrl || "") + u;
  };
  const Qt = {
    resolvedUrl: resolve, url: resolve,
    locale: () => ({ textDirection: 0, name: "en_US" }),
    RightToLeft: 1, LeftToRight: 0,
    formatTime: (d, fmt) => { try { return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } },
    formatDate: (d) => { try { return new Date(d).toLocaleDateString(); } catch { return ""; } },
    rgba: (r, g, b, a = 1) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`,
    application: { name: "Hologram OS", layoutDirection: 0 },
    platform: { os: "holo" },
    quit() {}, openUrlExternally(u) { if (typeof window !== "undefined") window.open(u, "_blank"); return true; },
  };
  for (const [k, v] of Object.entries(QT_KEYS)) Qt["Key_" + k] = v;
  const Text = { AlignLeft: 1, AlignRight: 2, AlignHCenter: 4, AlignJustify: 8, AlignTop: 32, AlignBottom: 64, AlignVCenter: 128, ElideNone: 0, ElideLeft: 1, ElideMiddle: 2, ElideRight: 3, NoWrap: 0, WordWrap: 4, WrapAnywhere: 3, Wrap: 4 };
  const TextEdit = { NoWrap: 0, WordWrap: 4, WrapAnywhere: 3, Wrap: 4, AlignLeft: 1, AlignRight: 2, AlignHCenter: 4 };
  const TextInput = { Normal: 0, NoEcho: 1, Password: 2, PasswordEchoOnEdit: 3 };
  const Image = { Stretch: 0, PreserveAspectFit: 1, PreserveAspectCrop: 2, Tile: 3, TileVertically: 4, TileHorizontally: 5, Pad: 6, Null: 0, Ready: 1, Loading: 2, Error: 3 };
  const Font = { Light: 25, Normal: 50, DemiBold: 63, Bold: 75, Black: 87 };
  return { Qt, Text, TextEdit, TextInput, Image, Font, Math, JSON, console, parseInt, parseFloat, Number, String, Boolean, Array, Object, Date, isNaN, isFinite, undefined, NaN, Infinity, true: true, false: false, null: null };
}

// Qt extends String with .arg() (placeholder %1..%9) — install it for the JS host env.
if (typeof String.prototype.arg !== "function") {
  Object.defineProperty(String.prototype, "arg", {
    value: function (a) { let used = false; const out = this.replace(/%(\d)/, () => { used = true; return String(a); }); return used ? out : this + String(a); },
    writable: true, configurable: true,
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// G · Backends.  Each maps a QML type → a node and applies property changes to it.
//     DomBackend renders to real elements; HeadlessBackend builds an inert model for
//     the Node witness.  SddmComponents factories are INJECTED (not imported) so the
//     engine stays browser-dependency-free.
// ───────────────────────────────────────────────────────────────────────────────

// shared anchors → CSS for the DOM backend (the subset the greeter uses)
function applyAnchors(el, item) {
  const a = item.props.anchors; if (!a) return;
  const px = (v) => (typeof v === "number" ? v + "px" : v);
  const m = item.props.anchors && item.props.anchors.margins;
  // Inside a Column/Row/Grid the parent manages flow; honoring centering anchors as absolute
  // would yank the child out of the flex flow. Let flex alignment do the centering instead.
  const pt = item.parent && item.parent.type;
  if (pt === "Column" || pt === "Row" || pt === "Grid") {
    if (a.fill) { el.style.width = "100%"; el.style.height = "auto"; }
    return;
  }
  el.style.position = "absolute";
  if (a.fill) { el.style.left = "0"; el.style.top = "0"; el.style.right = "0"; el.style.bottom = "0"; el.style.width = "auto"; el.style.height = "auto"; }
  if (a.centerIn) { el.style.left = "50%"; el.style.top = "50%"; el.style.transform = "translate(-50%,-50%)"; }
  if (a.horizontalCenter) { el.style.left = "50%"; el.style.transform = (el.style.transform || "").replace(/translateX\([^)]*\)/, "") + " translateX(-50%)"; }
  if (a.top !== undefined) el.style.top = px(typeof a.top === "object" ? (m || 0) : (a.topMargin || m || 0));
  if (a.right !== undefined) { el.style.right = px(a.rightMargin || m || 0); el.style.left = "auto"; }
  if (a.left !== undefined) el.style.left = px(a.leftMargin || m || 0);
  if (a.bottom !== undefined) { el.style.bottom = px(a.bottomMargin || m || 0); el.style.top = "auto"; }
  if (m !== undefined && a.fill) { el.style.left = px(m); el.style.top = px(m); el.style.right = px(m); el.style.bottom = px(m); }
}

export function createDomBackend(components = {}) {
  const C = components;     // injected SddmComponents factories: Button, TextBox, PasswordBox, ComboBox, Clock, ...
  const mk = (tag, css) => { const e = document.createElement(tag); if (css) e.style.cssText = css; return e; };

  // base visual: a <div> that is `position:relative` so anchored children resolve against it
  // (the QML "anchors are relative to parent" rule → CSS nearest-positioned-ancestor).
  function baseDiv(item) { const e = mk("div"); e.dataset.qml = item.type; e.style.position = "relative"; return e; }

  const TYPES = {
    QtObject: () => null, Timer: () => null, Connections: () => null, Component: () => null,
    TextConstants: () => null, SystemPalette: () => null,
    Item: baseDiv, FocusScope: baseDiv, Rectangle: baseDiv, MouseArea: baseDiv,
    Column(item) { const e = baseDiv(item); e.style.display = "flex"; e.style.flexDirection = "column"; e.style.alignItems = "center"; return e; },
    Row(item) { const e = baseDiv(item); e.style.display = "flex"; e.style.flexDirection = "row"; e.style.alignItems = "center"; return e; },
    Grid(item) { const e = baseDiv(item); e.style.display = "grid"; return e; },
    Text(item) { const e = mk("div"); e.dataset.qml = "Text"; e.style.whiteSpace = "pre-wrap"; e.style.color = "#000"; return e; },
    Image(item) { const e = mk("div"); e.dataset.qml = "Image"; e.style.backgroundRepeat = "no-repeat"; e.style.backgroundPosition = "center"; return e; },
    Background(item) { const e = mk("div"); e.dataset.qml = "Background"; e.style.position = "absolute"; e.style.inset = "0"; e.style.backgroundSize = "cover"; e.style.backgroundPosition = "center"; return e; },
    Clock(item) { const w = C.Clock ? C.Clock({ hourFormat: item.props.timeFont ? "HH:mm" : "HH:mm", color: item.props.color || "#fff" }) : baseDiv(item); return w; },
    Button(item) { return C.Button ? C.Button({ text: item.props.text || "Button", width: item.props.width, onClick: () => item.fire("clicked") }) : baseDiv(item); },
    TextBox(item) { return wrapField(C.TextBox ? C.TextBox({ value: item.props.text || "", height: item.props.height || 30, password: false }) : mk("input"), item); },
    PasswordBox(item) { return wrapField(C.PasswordBox ? C.PasswordBox({ height: item.props.height || 30 }) : mk("input"), item, true); },
    ComboBox(item) {
      const model = item.props.model; const items = Array.isArray(model) ? model : (model && model.sessions) || (model && model.layouts) || [];
      const w = C.ComboBox ? C.ComboBox({ items, index: item.props.index || 0, arrowIcon: item.props.arrowIcon || "", onChange: (k) => item.set("index", k) }) : baseDiv(item);
      return w;
    },
    LayoutBox(item) { const e = baseDiv(item); e.style.display = "none"; return e; },        // keyboard layouts (disabled)
  };

  // wrap an SddmComponents input so the engine sees a reactive `text` and Qt key events
  function wrapField(node, item, isPassword) {
    const input = node.input || (node.tagName === "INPUT" ? node : node.querySelector ? node.querySelector("input") : null);
    if (input) {
      Object.defineProperty(item, "_input", { value: input, configurable: true });
      input.addEventListener("input", () => { item.props.text = input.value; trigger(item, "text"); });
    }
    return node;
  }

  return {
    kind: "dom",
    create(item) {
      const f = TYPES[item.type] || TYPES[shortType(item.type)] || baseDiv;
      const el = f(item);
      item.node = el;
      return el;
    },
    appendChild(parent, child) { if (parent && parent.node && child && child.node) parent.node.appendChild(child.node); },
    applyProp(item, key, value) { applyDomProp(item, key, value); },
    completed(item) {
      // attach Keys.onPressed to the focusable input, translating DOM → Qt key events
      if (item._handlers && item._handlers.Keys && item._handlers.Keys.pressed && item._input) {
        item._input.addEventListener("keydown", (e) => { const ev = toQtKeyEvent(e); item._handlers.Keys.pressed(ev); if (ev.accepted) e.preventDefault(); });
      }
      if (item._handlers && item._handlers.self && item._handlers.self.clicked && item.node && item.type !== "Button") {
        item.node.style.cursor = item.node.style.cursor || "pointer";
        item.node.addEventListener("click", () => item.fire("clicked"));
      }
    },
    mount(rootItem, host) { if (rootItem.node) host.appendChild(rootItem.node); },
  };
}

function shortType(t) { return t.includes(".") ? t.split(".").pop() : t; }

// apply a property change to a DOM node (the generic QtQuick visual surface)
function applyDomProp(item, key, value) {
  const el = item.node; if (!el || !el.style) return;
  const px = (v) => (typeof v === "number" ? v + "px" : v);
  switch (key) {
    case "width": if (item.type !== "Background") el.style.width = (value == null || Number.isNaN(value)) ? "" : px(value); break;
    case "height": if (item.type !== "Background") el.style.height = (value == null || Number.isNaN(value)) ? "" : px(value); break;
    case "implicitWidth": case "implicitHeight": break;     // content sizes, not styled directly
    case "focus": if (value && item._input) item._input.focus(); else if (value && el.focus) el.focus(); break;
    case "x": el.style.left = px(value); el.style.position = el.style.position || "absolute"; break;
    case "y": el.style.top = px(value); el.style.position = el.style.position || "absolute"; break;
    case "visible": el.style.display = value === false ? "none" : (item.type === "Column" ? "flex" : item.type === "Row" ? "flex" : ""); break;
    case "opacity": el.style.opacity = value; break;
    case "color": if (item.type === "Text") el.style.color = value; else el.style.background = value; break;
    case "radius": el.style.borderRadius = px(value); break;
    case "spacing": el.style.gap = px(value); break;
    case "z": el.style.zIndex = value; break;
    case "clip": if (value) el.style.overflow = "hidden"; break;
    case "text":
      if (item.type === "Text") el.textContent = value == null ? "" : String(value);
      else if (item.type === "Button") el.textContent = value == null ? "" : String(value);
      else if (item._input) { if (item._input.value !== value) item._input.value = value == null ? "" : value; }
      break;
    case "source": {
      const url = value == null ? "" : String(value);
      if (item.type === "Background" || item.type === "Image") el.style.backgroundImage = url ? `url("${url}")` : "";
      break;
    }
    case "fillMode": if (item.type === "Image" || item.type === "Background") el.style.backgroundSize = (value === 2 ? "cover" : value === 1 ? "contain" : value === 0 ? "100% 100%" : "auto"); break;
    case "anchors": applyAnchors(el, item); break;
    case "font": applyFont(el, value); break;
    case "horizontalAlignment": el.style.textAlign = value === 4 ? "center" : value === 2 ? "right" : "left"; break;
    case "verticalAlignment": el.style.display = el.style.display || "flex"; if (el.style.display === "flex") { el.style.alignItems = value === 128 ? "center" : value === 64 ? "flex-end" : "flex-start"; } break;
    case "wrapMode": el.style.whiteSpace = value ? "pre-wrap" : "nowrap"; el.style.wordBreak = value ? "break-word" : "normal"; break;
    case "elide": if (value === 3) { el.style.overflow = "hidden"; el.style.textOverflow = "ellipsis"; el.style.whiteSpace = "nowrap"; } break;
    default: break;     // grouped sub-props (anchors.*, font.*) are re-applied via their group object
  }
}
function applyFont(el, f) { if (!f || typeof f !== "object") return; if (f.pixelSize) el.style.fontSize = f.pixelSize + "px"; if (f.pointSize) el.style.fontSize = f.pointSize + "pt"; if (f.bold) el.style.fontWeight = "700"; if (f.family) el.style.fontFamily = f.family; if (f.italic) el.style.fontStyle = "italic"; }

// the witness backend: no DOM — just an inert model the witness can assert against.
export function createHeadlessBackend() {
  return {
    kind: "headless",
    create(item) { item.node = { type: item.type, props: item.props, children: [] }; return item.node; },
    appendChild(parent, child) { if (parent && parent.node && child && child.node) parent.node.children.push(child.node); },
    applyProp() {},
    completed() {},
    mount() {},
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// H · Engine.  Parse → instantiate the tree (create node, register id, set props,
//     install bindings + handlers, recurse children) → fire Component.onCompleted →
//     mount.  Knows the context (sddm/userModel/sessionModel/config) and host env.
// ───────────────────────────────────────────────────────────────────────────────
export class QmlEngine {
  constructor({ backend, context = {}, baseUrl = "", onWarn } = {}) {
    this.backend = backend; this.context = context; this.baseUrl = baseUrl;
    this.host = hostEnv(baseUrl); this.ids = Object.create(null); this.root = null;
    this.connections = []; this.completedQueue = []; this._warns = []; this._onWarn = onWarn;
    this.host.qsTr = (s) => s;                                    // qsTr() passthrough
  }
  warn(m) { this._warns.push(m); if (this._onWarn) this._onWarn(m); }
  applyProp(item, key, value) { try { this.backend.applyProp(item, key, value); } catch (e) { this.warn(`applyProp ${key}: ${e.message}`); } }

  load(src) {
    const doc = typeof src === "string" ? parseQml(src) : src;
    this.document = doc;
    this.root = this.instantiate(doc.root, null);
    // resolve Connections targets now that all ids exist
    for (const c of this.connections) this.wireConnection(c);
    // Component.onCompleted, bottom-up like QML
    for (const cb of this.completedQueue) { try { cb(); } catch (e) { this.warn(`onCompleted: ${e.message}`); } }
    return this.root;
  }

  instantiate(node, parent) {
    const item = new QmlItem(this, shortType(node.typeName), parent);
    item.fire = (sig, ...a) => { const h = item._handlers && item._handlers.self && item._handlers.self[sig]; if (h) h(...a); const s = item.signals[sig]; if (s) s(...a); };
    item._handlers = { self: Object.create(null) };
    if (parent === null) this.root = item;                          // root in scope before any binding eval

    // TextConstants is SDDM's platform component that DEFINES the localized greeter strings
    // (welcomeText · userName · login · …). Upstream ships it as components/2.0; here the
    // platform provides those constants from the greeter context, so `textConstants.welcomeText`
    // (the theme's `TextConstants { id: textConstants }`) resolves exactly as in real SDDM.
    if (item.type === "TextConstants") Object.assign(item.props, this.context.textConstants || {});

    // Connections is non-visual: collect target + handlers, wire after the whole tree exists
    if (item.type === "Connections") { this.backend.create(item); this.collectConnections(node, item); return item; }

    // classify members, preserving child document order
    const simple = [], paths = [], groups = [], handlers = [], children = [], objProps = [];
    for (const m of node.members) {
      if (m.kind === "id") { item.id = m.name; this.ids[m.name] = item; }
      else if (m.kind === "propDecl") {
        if (m.child) objProps.push({ name: m.name, object: m.child });
        else { if (m.rhs == null) item.props[m.name] = defaultFor(m.ptype); else simple.push({ key: m.name, rhs: m.rhs }); }
      }
      else if (m.kind === "method") item.methods[m.name] = item.makeHandler({ signal: m.name, params: m.params, body: m.body, isExpr: false });
      else if (m.kind === "signal") item.signals[m.name] = (...a) => item.fire(m.name, ...a);
      else if (m.kind === "grouped") groups.push(m);
      else if (m.kind === "binding") {
        if (m.object) objProps.push({ name: m.path.join("."), object: m.object });
        else if (m.path.length === 1) simple.push({ key: m.path[0], rhs: m.rhs });
        else paths.push(m);
      }
      else if (m.kind === "handler") handlers.push(m);
      else if (m.kind === "child") children.push(m.object);
    }

    // EAGER pass (best-effort, non-reactive): populate props so factory-backed components
    // (TextBox/ComboBox/Button/Clock) see their construction values, which are context/host
    // (sessionModel · textConstants · Qt.resolvedUrl) and so resolve before any id/child exists.
    for (const b of simple) { try { item.props[b.key] = this.evalEager(item, b.rhs); } catch {} }
    for (const g of groups) this.eagerGroup(item, g.path, g.members);
    for (const p of paths) { try { this.eagerPathBinding(item, p.path, p.rhs); } catch {} }

    this.backend.create(item);                                      // node now has its construction props

    for (const op of objProps) { const child = this.instantiate(op.object, item); item.setConst(op.name, child.proxy); }
    for (const cn of children) { const child = this.instantiate(cn, item); item.children.push(child); this.backend.appendChild(item, child); }

    // REACTIVE pass: ids + children now exist, so bindings can see siblings and track deps
    for (const b of simple) item.bind(b.key, b.rhs);
    for (const g of groups) this.applyGroup(item, g.path, g.members);
    for (const p of paths) this.applyPathBinding(item, p.path, p.rhs);
    for (const gName of (item._groups || [])) this.applyProp(item, gName, item.props[gName]);
    for (const h of handlers) this.installHandler(item, h);
    this.backend.completed(item);
    return item;
  }

  // non-reactive single evaluation (used for the eager construction pass)
  evalEager(item, rhs) { const prev = ACTIVE; ACTIVE = null; try { return compileExpr(rhs)(makeScope(item)); } finally { ACTIVE = prev; } }
  eagerGroup(item, path, members) {
    const obj = this.ensureGroup(item, path);
    for (const m of members) {
      if (m.kind === "binding" && !m.object) { try { setDeep(obj, m.path.join("."), this.evalEager(item, m.rhs)); } catch {} }
    }
  }
  eagerPathBinding(item, path, rhs) { const obj = this.ensureGroup(item, path); setDeep(obj, path.slice(1).join("."), this.evalEager(item, rhs)); }

  // grouped property:  anchors { fill: parent; margins: 5 }   font { pixelSize: 24; bold: true }
  applyGroup(item, path, members, deferred) {
    const obj = this.ensureGroup(item, path);
    for (const m of members) {
      if (m.kind === "binding" && m.path.length === 1) {
        const key = m.path[0];
        if (m.object) { const child = this.instantiate(m.object, item); obj[key] = child.proxy; }
        else this.bindInto(item, obj, key, m.rhs, path[0]);
      } else if (m.kind === "binding") { this.bindInto(item, obj, m.path.join("."), m.rhs, path[0]); }
    }
  }
  ensureGroup(item, path) {
    const g = path[0];
    if (!item.props[g] || typeof item.props[g] !== "object") item.props[g] = {};
    (item._groups || (item._groups = [])).includes(g) || item._groups.push(g);
    return item.props[g];
  }
  // anchors.fill: parent   (a dotted binding, not a group block)
  applyPathBinding(item, path, rhs, deferred) {
    const obj = this.ensureGroup(item, path);
    this.bindInto(item, obj, path.slice(1).join("."), rhs, path[0]);
  }
  bindInto(item, obj, key, rhs, groupName) {
    const eff = { deps: [], run() {
      for (const s of eff.deps) s.delete(eff); eff.deps.length = 0;
      const prev = ACTIVE; ACTIVE = eff;
      let v; try { v = compileExpr(rhs)(makeScope(item)); } catch (e) { v = undefined; item.engine.warn(`binding ${groupName}.${key}: ${e.message}`); } finally { ACTIVE = prev; }
      setDeep(obj, key, v); item.engine.applyProp(item, groupName, item.props[groupName]); trigger(item, groupName);
    } };
    eff.run();
  }

  installHandler(item, m) {
    const fn = item.makeHandler(m);
    const sigName = m.signal.replace(/^on/, ""); const sig = sigName.charAt(0).toLowerCase() + sigName.slice(1);
    if (m.attach) {
      const ns = m.attach[m.attach.length - 1];           // Keys, Component, ...
      item._handlers[ns] = item._handlers[ns] || Object.create(null);
      item._handlers[ns][sig] = fn;
      if (ns === "Component" && sig === "completed") this.completedQueue.push(fn);
    } else {
      item._handlers.self[sig] = fn;
      if (sig === "completed") this.completedQueue.push(fn);    // Component.onCompleted shorthand
    }
  }

  collectConnections(node, item) {
    let targetExpr = null; const handlers = [];
    for (const m of node.members) {
      if (m.kind === "binding" && m.path.join(".") === "target") targetExpr = m.rhs;
      else if (m.kind === "handler") handlers.push(m);
    }
    this.connections.push({ item, targetExpr, handlers });
  }
  wireConnection(c) {
    let target = null;
    try { target = c.targetExpr ? compileExpr(c.targetExpr)(makeScope(c.item.parent || c.item)) : null; } catch (e) { this.warn(`Connections target: ${e.message}`); }
    if (!target) return;
    for (const h of c.handlers) {
      const fn = c.item.makeHandler(h);
      const sigName = h.signal.replace(/^on/, ""); const sig = sigName.charAt(0).toLowerCase() + sigName.slice(1);
      if (typeof target.connect === "function") target.connect(sig, fn);     // holo-sddm style emitter
      else if (target[sig + "Connect"]) target[sig + "Connect"](fn);
      else if (target.__qml && target.signals[sig]) { /* QmlItem signal */ }
    }
  }

  mount(hostEl) { this.backend.mount(this.root, hostEl); return this.root; }

  // after the DOM lays out, feed real content sizes back into implicitWidth/Height so
  // bindings such as `Math.max(320, mainColumn.implicitWidth + 50)` settle to true sizes.
  measureImplicit() {
    const walk = (it) => {
      const n = it.node;
      if (n && typeof n.getBoundingClientRect === "function") {
        const r = n.getBoundingClientRect();
        if (r.width && Math.abs(r.width - it.peek("implicitWidth")) > 0.5) it.set("implicitWidth", r.width);
        if (r.height && Math.abs(r.height - it.peek("implicitHeight")) > 0.5) it.set("implicitHeight", r.height);
      }
      it.children.forEach(walk);
    };
    if (this.root) walk(this.root);
  }

  // a JSON-LD-friendly snapshot of the live tree — used by the agent MCP tool and the witness
  // to make the greeter's structure + wiring legible (component tree, ids, resolved bindings).
  describeTree(item = this.root) {
    if (!item) return null;
    const props = {};
    for (const k of Object.keys(item.props)) { const v = item.props[k]; if (v == null || typeof v === "function" || (v && v.__qmlProxy)) continue; if (typeof v === "object") continue; props[k] = v; }
    const wiring = item._handlers ? Object.keys(item._handlers.self || {}).concat(Object.keys(item._handlers).filter((n) => n !== "self").map((ns) => ns + ".*")) : [];
    return { type: item.type, id: item.id || undefined, props, wiring: wiring.length ? wiring : undefined, children: item.children.map((c) => this.describeTree(c)) };
  }
}

function setDeep(obj, dotted, v) { const parts = dotted.split("."); let o = obj; for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; } o[parts[parts.length - 1]] = v; }
function defaultFor(t) { return t === "int" || t === "real" || t === "double" ? 0 : t === "bool" ? false : t === "string" || t === "url" ? "" : t === "var" ? undefined : null; }
