// holo-plymouth.js — the hologram-native Plymouth engine.
//
// Plymouth (https://wiki.ubuntu.com/Plymouth) is the boot-splash system: a daemon
// (plymouthd) renders a themed splash — logo, throbber, boot progress, password
// prompts, messages — while a client (plymouth) drives it (show-splash, update
// --status, message, ask-for-password, change-mode, quit). Themes are `.plymouth`
// config files naming a *splash plugin* (module): `script` (a tiny scripting
// language that draws sprites), `two-step` (background + watermark + throbber +
// progress + password dialog), `text`, and `details`.
//
// This module is a STRICT, from-spec reimplementation of that surface, with no
// server and no native code — the "platform" is a <canvas> and this interpreter.
// It is isomorphic: a CanvasBackend draws in the browser; a HeadlessBackend models
// sprites/images (real PNG dimensions read from the IHDR) so the witness can run a
// theme to completion in Node without a GPU. Every callback name, every config key,
// and the script language match Plymouth's documented behaviour.
//
// Exports: parsePlymouth, Lexer, Parser, Interpreter, pngSize, ScriptPlugin,
//          TwoStepPlugin, TextPlugin, DetailsPlugin, HeadlessBackend, CanvasBackend,
//          Engine, MODES.

// ───────────────────────────────────────────────────────────────────────────────
// A · `.plymouth` theme config parser  (INI: [Section] then key=value)
// ───────────────────────────────────────────────────────────────────────────────
export function parsePlymouth(text) {
  const sections = {};
  let cur = null;
  for (let raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/[;#].*$/, "").trim();   // ; and # are comments
    if (!line) continue;
    const sec = line.match(/^\[(.+?)\]\s*$/);
    if (sec) { cur = sec[1]; sections[cur] = sections[cur] || {}; continue; }
    const kv = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (kv && cur) sections[cur][kv[1].trim()] = kv[2].trim();
  }
  const theme = sections["Plymouth Theme"] || {};
  const moduleName = theme.ModuleName || "";
  return {
    sections,
    name: theme.Name || "",
    description: theme.Description || "",
    moduleName,
    module: sections[moduleName] || {},          // the [<module>] section
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// B · PNG IHDR reader — true width/height without decoding pixels (headless).
// ───────────────────────────────────────────────────────────────────────────────
export function pngSize(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // signature + IHDR: width @16, height @20 (big-endian uint32)
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
  const u32 = (o) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
  return { width: u32(16), height: u32(20) };
}

// ───────────────────────────────────────────────────────────────────────────────
// C · Lexer for the Plymouth script language.
// ───────────────────────────────────────────────────────────────────────────────
const KEYWORDS = new Set(["fun", "if", "else", "while", "for", "return", "global", "local"]);
const PUNCT = [
  "&&", "||", "==", "!=", "<=", ">=", "++", "--", "+=", "-=", "*=", "/=",
  "+", "-", "*", "/", "%", "=", "<", ">", "!", "(", ")", "{", "}", "[", "]", ".", ",", ";",
];

export class Lexer {
  constructor(src) { this.s = String(src); this.i = 0; this.line = 1; this.toks = []; }
  error(m) { throw new Error(`Plymouth script: ${m} (line ${this.line})`); }
  tokenize() {
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === "\n") { this.line++; this.i++; continue; }
      if (c === " " || c === "\t" || c === "\r") { this.i++; continue; }
      // comments: Plymouth's script language accepts shell-style `#`, C++ `//`, and C `/* */`.
      if (c === "#") { while (this.i < s.length && s[this.i] !== "\n") this.i++; continue; }
      if (c === "/" && s[this.i + 1] === "/") { while (this.i < s.length && s[this.i] !== "\n") this.i++; continue; }
      if (c === "/" && s[this.i + 1] === "*") { this.i += 2; while (this.i < s.length && !(s[this.i] === "*" && s[this.i + 1] === "/")) { if (s[this.i] === "\n") this.line++; this.i++; } this.i += 2; continue; }
      if (c === '"' || c === "'") { this.string(c); continue; }
      if (c >= "0" && c <= "9" || (c === "." && s[this.i + 1] >= "0" && s[this.i + 1] <= "9")) { this.number(); continue; }
      if (/[A-Za-z_]/.test(c)) { this.ident(); continue; }
      this.punct();
    }
    this.toks.push({ t: "eof", line: this.line });
    return this.toks;
  }
  push(t, v) { this.toks.push({ t, v, line: this.line }); }
  string(q) {
    this.i++; let out = "";
    while (this.i < this.s.length && this.s[this.i] !== q) {
      let ch = this.s[this.i++];
      if (ch === "\\") {
        const n = this.s[this.i++];
        ch = n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n;
      }
      out += ch;
    }
    if (this.s[this.i] !== q) this.error("unterminated string");
    this.i++; this.push("string", out);
  }
  number() {
    let j = this.i;
    while (j < this.s.length && /[0-9.]/.test(this.s[j])) j++;
    // hex (0x..) for completeness
    if (this.s[this.i] === "0" && (this.s[this.i + 1] === "x" || this.s[this.i + 1] === "X")) {
      j = this.i + 2; while (j < this.s.length && /[0-9a-fA-F]/.test(this.s[j])) j++;
      this.push("number", parseInt(this.s.slice(this.i, j), 16)); this.i = j; return;
    }
    this.push("number", parseFloat(this.s.slice(this.i, j))); this.i = j;
  }
  ident() {
    let j = this.i; while (j < this.s.length && /[A-Za-z0-9_]/.test(this.s[j])) j++;
    const w = this.s.slice(this.i, j); this.i = j;
    this.push(KEYWORDS.has(w) ? w : "id", w);
  }
  punct() {
    for (const p of PUNCT) {
      if (this.s.startsWith(p, this.i)) { this.push("op", p); this.i += p.length; return; }
    }
    this.error(`unexpected character '${this.s[this.i]}'`);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// D · Parser → AST.
// ───────────────────────────────────────────────────────────────────────────────
export class Parser {
  constructor(toks) { this.toks = toks; this.p = 0; }
  peek(o = 0) { return this.toks[this.p + o]; }
  next() { return this.toks[this.p++]; }
  is(t, v) { const k = this.peek(); return k.t === t && (v === undefined || k.v === v); }
  eat(t, v) { if (!this.is(t, v)) this.err(`expected ${v || t}`); return this.next(); }
  err(m) { const k = this.peek(); throw new Error(`Plymouth script: ${m}, got ${k.t}${k.v != null ? " '" + k.v + "'" : ""} (line ${k.line})`); }

  parse() { const body = []; while (!this.is("eof")) body.push(this.statement()); return { type: "Program", body }; }

  block() { this.eat("op", "{"); const body = []; while (!this.is("op", "}") && !this.is("eof")) body.push(this.statement()); this.eat("op", "}"); return { type: "Block", body }; }

  statement() {
    if (this.is("op", "{")) return this.block();
    if (this.is("fun")) return this.funDecl();
    if (this.is("if")) return this.ifStmt();
    if (this.is("while")) return this.whileStmt();
    if (this.is("for")) return this.forStmt();
    if (this.is("return")) { this.next(); let arg = null; if (!this.is("op", ";")) arg = this.expr(); this.semi(); return { type: "Return", arg }; }
    if (this.is("global") || this.is("local")) { const kind = this.next().t; const names = []; do { names.push(this.eat("id").v); } while (this.accept("op", ",")); this.semi(); return { type: "Decl", kind, names }; }
    if (this.is("op", ";")) { this.next(); return { type: "Empty" }; }
    const e = this.expr(); this.semi(); return { type: "ExprStmt", expr: e };
  }
  semi() { this.accept("op", ";"); }
  accept(t, v) { if (this.is(t, v)) { this.next(); return true; } return false; }

  funDecl() {
    this.eat("fun");
    // named: `fun name (..) {..}`  |  anonymous expression handled in primary()
    if (this.is("id")) {
      const name = this.next().v; const params = this.params(); const body = this.block();
      return { type: "FunDecl", name, params, body };
    }
    const params = this.params(); const body = this.block();
    return { type: "ExprStmt", expr: { type: "FunExpr", params, body } };
  }
  params() { this.eat("op", "("); const ps = []; if (!this.is("op", ")")) { do { ps.push(this.eat("id").v); } while (this.accept("op", ",")); } this.eat("op", ")"); return ps; }
  ifStmt() { this.eat("if"); this.eat("op", "("); const test = this.expr(); this.eat("op", ")"); const cons = this.statement(); let alt = null; if (this.is("else")) { this.next(); alt = this.statement(); } return { type: "If", test, cons, alt }; }
  whileStmt() { this.eat("while"); this.eat("op", "("); const test = this.expr(); this.eat("op", ")"); const body = this.statement(); return { type: "While", test, body }; }
  forStmt() {
    this.eat("for"); this.eat("op", "(");
    const init = this.is("op", ";") ? null : this.expr(); this.eat("op", ";");
    const test = this.is("op", ";") ? null : this.expr(); this.eat("op", ";");
    const post = this.is("op", ")") ? null : this.expr(); this.eat("op", ")");
    const body = this.statement();
    return { type: "For", init, test, post, body };
  }

  // expression precedence climbing
  expr() { return this.assign(); }
  assign() {
    const left = this.or();
    if (this.is("op", "=") || this.is("op", "+=") || this.is("op", "-=") || this.is("op", "*=") || this.is("op", "/=")) {
      const op = this.next().v; const right = this.assign();
      return { type: "Assign", op, target: left, value: right };
    }
    return left;
  }
  binL(sub, ops) { let l = sub.call(this); while (this.is("op") && ops.includes(this.peek().v)) { const op = this.next().v; const r = sub.call(this); l = { type: "Bin", op, left: l, right: r }; } return l; }
  or() { return this.binL(this.and, ["||"]); }
  and() { return this.binL(this.equality, ["&&"]); }
  equality() { return this.binL(this.rel, ["==", "!="]); }
  rel() { return this.binL(this.add, ["<", ">", "<=", ">="]); }
  add() { return this.binL(this.mul, ["+", "-"]); }
  mul() { return this.binL(this.unary, ["*", "/", "%"]); }
  unary() {
    if (this.is("op", "!") || this.is("op", "-")) { const op = this.next().v; return { type: "Unary", op, arg: this.unary() }; }
    if (this.is("op", "++") || this.is("op", "--")) { const op = this.next().v; return { type: "Update", op, prefix: true, arg: this.unary() }; }
    return this.postfix();
  }
  postfix() {
    let e = this.primary();
    for (;;) {
      if (this.is("op", ".")) { this.next(); const name = this.eat("id").v; e = { type: "Member", obj: e, name }; }
      else if (this.is("op", "[")) { this.next(); const idx = this.expr(); this.eat("op", "]"); e = { type: "Index", obj: e, index: idx }; }
      else if (this.is("op", "(")) { e = { type: "Call", callee: e, args: this.args() }; }
      else if (this.is("op", "++") || this.is("op", "--")) { const op = this.next().v; e = { type: "Update", op, prefix: false, arg: e }; }
      else break;
    }
    return e;
  }
  args() { this.eat("op", "("); const a = []; if (!this.is("op", ")")) { do { a.push(this.expr()); } while (this.accept("op", ",")); } this.eat("op", ")"); return a; }
  primary() {
    if (this.is("number")) return { type: "Num", value: this.next().v };
    if (this.is("string")) return { type: "Str", value: this.next().v };
    if (this.is("id")) return { type: "Id", name: this.next().v };
    if (this.is("fun")) { this.next(); const params = this.params(); const body = this.block(); return { type: "FunExpr", params, body }; }
    if (this.is("op", "(")) { this.next(); const e = this.expr(); this.eat("op", ")"); return e; }
    this.err("unexpected token");
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// E · Runtime values.
// ───────────────────────────────────────────────────────────────────────────────
export const NULL = Symbol("NULL");
class Hash { constructor() { this.map = new Map(); } }
const isHash = (v) => v instanceof Hash;
const isFun = (v) => v && v.__fun === true;
const isNS = (v) => v && v.__ns === true;
const isImage = (v) => v && v.__image === true;
const isSprite = (v) => v && v.__sprite === true;
const isBound = (v) => v && v.__bound === true;

function truthy(v) { return !(v === NULL || v === 0 || v === "" || v === false || v == null); }
function toNum(v) { if (typeof v === "number") return v; if (typeof v === "string") { const n = parseFloat(v); return isNaN(n) ? 0 : n; } return 0; }
function toStr(v) {
  if (v === NULL || v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (isImage(v)) return "[image]"; if (isSprite(v)) return "[sprite]";
  return String(v);
}

class Return { constructor(v) { this.value = v; } }

// ───────────────────────────────────────────────────────────────────────────────
// F · Interpreter.
// ───────────────────────────────────────────────────────────────────────────────
export class Interpreter {
  constructor(backend) {
    this.backend = backend;
    this.globals = new Map();
    this.callbacks = {};            // name → fun value (Plymouth.Set*Function targets)
    this.opcount = 0; this.opbudget = 5_000_000;   // runaway guard
    this.installNatives();
  }
  setGlobal(name, v) { this.globals.set(name, v); }

  run(ast) {
    // hoist top-level function declarations so registration can precede definition
    for (const st of ast.body) if (st.type === "FunDecl") this.globals.set(st.name, { __fun: true, params: st.params, body: st.body, name: st.name });
    for (const st of ast.body) this.exec(st, null);
  }

  exec(node, scope) {
    switch (node.type) {
      case "Empty": return;
      case "Block": { for (const s of node.body) this.exec(s, scope); return; }
      case "ExprStmt": this.eval(node.expr, scope); return;
      case "FunDecl": this.globals.set(node.name, { __fun: true, params: node.params, body: node.body, name: node.name }); return;
      case "Decl": { for (const n of node.names) { if (node.kind === "local" && scope) { if (!scope.has(n)) scope.set(n, NULL); } else if (!this.globals.has(n)) this.globals.set(n, NULL); } return; }
      case "If": if (truthy(this.eval(node.test, scope))) this.exec(node.cons, scope); else if (node.alt) this.exec(node.alt, scope); return;
      case "While": { let g = 0; while (truthy(this.eval(node.test, scope))) { this.exec(node.body, scope); if (++g > 10_000_000) throw new Error("Plymouth script: while-loop budget exceeded"); } return; }
      case "For": { if (node.init) this.eval(node.init, scope); let g = 0; while (node.test ? truthy(this.eval(node.test, scope)) : true) { this.exec(node.body, scope); if (node.post) this.eval(node.post, scope); if (++g > 10_000_000) throw new Error("Plymouth script: for-loop budget exceeded"); } return; }
      case "Return": throw new Return(node.arg ? this.eval(node.arg, scope) : NULL);
      default: this.eval(node, scope); return;
    }
  }

  eval(node, scope) {
    if (++this.opcount > this.opbudget) throw new Error("Plymouth script: op budget exceeded");
    switch (node.type) {
      case "Num": return node.value;
      case "Str": return node.value;
      case "Id": return this.lookup(node.name, scope);
      case "FunExpr": return { __fun: true, params: node.params, body: node.body, name: "(anon)" };
      case "Unary": { const v = this.eval(node.arg, scope); return node.op === "!" ? (truthy(v) ? 0 : 1) : -toNum(v); }
      case "Update": return this.update(node, scope);
      case "Bin": return this.binop(node, scope);
      case "Assign": return this.assign(node, scope);
      case "Member": return this.member(this.eval(node.obj, scope), node.name);
      case "Index": return this.index(this.eval(node.obj, scope), this.eval(node.index, scope));
      case "Call": return this.call(node, scope);
      default: throw new Error("Plymouth script: cannot evaluate " + node.type);
    }
  }

  lookup(name, scope) {
    if (scope && scope.has(name)) return scope.get(name);
    if (this.globals.has(name)) return this.globals.get(name);
    return NULL;
  }

  binop(node, scope) {
    if (node.op === "&&") return truthy(this.eval(node.left, scope)) ? (truthy(this.eval(node.right, scope)) ? 1 : 0) : 0;
    if (node.op === "||") { const l = this.eval(node.left, scope); if (truthy(l)) return l; const r = this.eval(node.right, scope); return truthy(r) ? r : 0; }
    const a = this.eval(node.left, scope), b = this.eval(node.right, scope);
    switch (node.op) {
      case "+": return (typeof a === "string" || typeof b === "string") ? toStr(a) + toStr(b) : toNum(a) + toNum(b);
      case "-": return toNum(a) - toNum(b);
      case "*": return toNum(a) * toNum(b);
      case "/": { const d = toNum(b); return d === 0 ? 0 : toNum(a) / d; }
      case "%": { const d = toNum(b); return d === 0 ? 0 : toNum(a) % d; }
      case "==": return this.equals(a, b) ? 1 : 0;
      case "!=": return this.equals(a, b) ? 0 : 1;
      case "<": return toNum(a) < toNum(b) ? 1 : 0;
      case ">": return toNum(a) > toNum(b) ? 1 : 0;
      case "<=": return toNum(a) <= toNum(b) ? 1 : 0;
      case ">=": return toNum(a) >= toNum(b) ? 1 : 0;
    }
  }
  equals(a, b) { if (typeof a === "string" || typeof b === "string") return toStr(a) === toStr(b); if (a === NULL || b === NULL) return a === b; return toNum(a) === toNum(b); }

  // l-value reference: returns {get(), set(v)}
  ref(node, scope) {
    if (node.type === "Id") {
      const name = node.name;
      return {
        get: () => this.lookup(name, scope),
        set: (v) => { if (scope && scope.has(name)) scope.set(name, v); else this.globals.set(name, v); },
      };
    }
    if (node.type === "Member") {
      const objRef = this.ref(node.obj, scope);
      let obj = objRef.get();
      if (!isHash(obj)) { obj = new Hash(); objRef.set(obj); }   // auto-vivify
      const key = node.name;
      return { get: () => (obj.map.has(key) ? obj.map.get(key) : NULL), set: (v) => obj.map.set(key, v) };
    }
    if (node.type === "Index") {
      const objRef = this.ref(node.obj, scope);
      let obj = objRef.get();
      if (!isHash(obj)) { obj = new Hash(); objRef.set(obj); }
      const key = this.hkey(this.eval(node.index, scope));
      return { get: () => (obj.map.has(key) ? obj.map.get(key) : NULL), set: (v) => obj.map.set(key, v) };
    }
    throw new Error("Plymouth script: invalid assignment target");
  }
  hkey(v) { return typeof v === "number" ? v : toStr(v); }

  assign(node, scope) {
    const r = this.ref(node.target, scope);
    let v;
    if (node.op === "=") v = this.eval(node.value, scope);
    else { const cur = toNum(r.get()); const rhs = toNum(this.eval(node.value, scope)); v = node.op === "+=" ? cur + rhs : node.op === "-=" ? cur - rhs : node.op === "*=" ? cur * rhs : cur / (rhs || 1); }
    r.set(v); return v;
  }
  update(node, scope) {
    const r = this.ref(node.arg, scope); const old = toNum(r.get());
    const nv = node.op === "++" ? old + 1 : old - 1; r.set(nv);
    return node.prefix ? nv : old;
  }

  member(obj, name) {
    if (isHash(obj)) return obj.map.has(name) ? obj.map.get(name) : NULL;
    if (isNS(obj)) { const m = obj.members[name]; if (m === undefined) return NULL; return typeof m === "function" ? { __bound: true, self: obj, fn: m } : m; }
    if (isImage(obj)) { const m = IMAGE_METHODS[name]; return m ? { __bound: true, self: obj, fn: m } : NULL; }
    if (isSprite(obj)) { const m = SPRITE_METHODS[name]; return m ? { __bound: true, self: obj, fn: m } : NULL; }
    return NULL;
  }
  index(obj, idx) { if (isHash(obj)) { const k = this.hkey(idx); return obj.map.has(k) ? obj.map.get(k) : NULL; } return NULL; }

  call(node, scope) {
    // namespace-as-constructor: Image(...), Sprite(...)
    const callee = this.eval(node.callee, scope);
    const args = node.args.map((a) => this.eval(a, scope));
    if (isFun(callee)) return this.invoke(callee, args);
    if (isBound(callee)) return callee.fn.call(this, callee.self, args);
    if (isNS(callee) && callee.call) return callee.call.call(this, args);
    if (callee === NULL) throw new Error("Plymouth script: call of undefined function");
    throw new Error("Plymouth script: value is not callable");
  }
  invoke(fn, args) {
    const scope = new Map();
    fn.params.forEach((p, i) => scope.set(p, i < args.length ? args[i] : NULL));
    try { this.exec(fn.body, scope); } catch (e) { if (e instanceof Return) return e.value; throw e; }
    return NULL;
  }

  // ── native namespaces: Window, Image, Sprite, Plymouth, Math ──────────────────
  installNatives() {
    const be = this.backend;
    const num = (v, d = 0) => (v === undefined || v === NULL ? d : toNum(v));

    const Window = { __ns: true, name: "Window", members: {
      GetWidth: (_s, a) => be.width(num(a[0])),
      GetHeight: (_s, a) => be.height(num(a[0])),
      GetX: (_s, a) => be.x(num(a[0])),
      GetY: (_s, a) => be.y(num(a[0])),
      GetMaxWidth: (_s, a) => be.width(num(a[0])),
      GetMaxHeight: (_s, a) => be.height(num(a[0])),
      GetBitsPerPixel: () => 32,
      SetBackgroundTopColor: (_s, a) => { be.setBgTop(num(a[0]), num(a[1]), num(a[2])); return NULL; },
      SetBackgroundBottomColor: (_s, a) => { be.setBgBottom(num(a[0]), num(a[1]), num(a[2])); return NULL; },
    } };

    const ImageNS = {
      __ns: true, name: "Image",
      call: (a) => be.loadImage(toStr(a[0])),
      members: {
        Text: (_s, a) => be.textImage(toStr(a[0]), { r: num(a[1], 1), g: num(a[2], 1), b: num(a[3], 1), a: num(a[4], 1) }, a[5] === undefined || a[5] === NULL ? null : toStr(a[5]), a[6] === undefined || a[6] === NULL ? null : toStr(a[6])),
      },
    };
    const SpriteNS = { __ns: true, name: "Sprite", call: (a) => be.makeSprite(a[0] && a[0] !== NULL ? a[0] : null) };

    const reg = (k) => (_s, a) => { if (isFun(a[0]) || isBound(a[0])) this.callbacks[k] = a[0]; return NULL; };
    const Plymouth = { __ns: true, name: "Plymouth", members: {
      SetRefreshFunction: reg("refresh"),
      SetBootProgressFunction: reg("bootProgress"),
      SetUpdateStatusFunction: reg("updateStatus"),
      SetDisplayPasswordFunction: reg("displayPassword"),
      SetDisplayQuestionFunction: reg("displayQuestion"),
      SetDisplayMessageFunction: reg("displayMessage"),
      SetMessageFunction: reg("message"),
      SetHideMessageFunction: reg("hideMessage"),
      SetDisplayNormalFunction: reg("displayNormal"),
      SetRootMountedFunction: reg("rootMounted"),
      SetKeyboardInputFunction: reg("keyboardInput"),
      SetQuitFunction: reg("quit"),
      GetMode: () => be.mode(),
    } };

    const Math_ = { __ns: true, name: "Math", members: {
      Pi: Math.PI,
      Sin: (_s, a) => Math.sin(num(a[0])), Cos: (_s, a) => Math.cos(num(a[0])), Tan: (_s, a) => Math.tan(num(a[0])),
      ASin: (_s, a) => Math.asin(num(a[0])), ACos: (_s, a) => Math.acos(num(a[0])), ATan: (_s, a) => Math.atan(num(a[0])),
      ATan2: (_s, a) => Math.atan2(num(a[0]), num(a[1])),
      Sqrt: (_s, a) => Math.sqrt(num(a[0])), Pow: (_s, a) => Math.pow(num(a[0]), num(a[1])),
      Abs: (_s, a) => Math.abs(num(a[0])), Int: (_s, a) => Math.trunc(num(a[0])),
      Floor: (_s, a) => Math.floor(num(a[0])), Ceil: (_s, a) => Math.ceil(num(a[0])),
      Min: (_s, a) => Math.min(num(a[0]), num(a[1])), Max: (_s, a) => Math.max(num(a[0]), num(a[1])),
      Random: () => Math.random(), Log: (_s, a) => Math.log(num(a[0])),
    } };

    this.globals.set("Window", Window);
    this.globals.set("Image", ImageNS);
    this.globals.set("Sprite", SpriteNS);
    this.globals.set("Plymouth", Plymouth);
    this.globals.set("Math", Math_);
    this.globals.set("RefreshRate", 50);
  }

  // dispatch a registered callback (used by the Engine/protocol)
  fire(name, args = []) {
    const cb = this.callbacks[name];
    if (!cb) return NULL;
    try { return isBound(cb) ? cb.fn.call(this, cb.self, args) : this.invoke(cb, args); }
    catch (e) { if (e instanceof Return) return e.value; throw e; }
  }
  has(name) { return !!this.callbacks[name]; }
}

// image/sprite methods (this === Interpreter, self === instance) ─────────────────
const IMAGE_METHODS = {
  GetWidth: (self) => self.width,
  GetHeight: (self) => self.height,
  Scale: function (self, a) { return self.backend.scaleImage(self, toNum(a[0]), toNum(a[1])); },
  Rotate: function (self, a) { return self.backend.rotateImage(self, toNum(a[0])); },
  Crop: function (self, a) { return self.backend.cropImage(self, toNum(a[0]), toNum(a[1]), toNum(a[2]), toNum(a[3])); },
  Recolor: function (self, a) { return self.backend.recolorImage(self, toNum(a[0]), toNum(a[1]), toNum(a[2]), a[3] === undefined ? 1 : toNum(a[3])); },
};
const SPRITE_METHODS = {
  SetImage: (self, a) => { self.image = (a[0] && a[0] !== NULL) ? a[0] : null; self.backend.dirty(); return NULL; },
  SetX: (self, a) => { self.x = toNum(a[0]); self.backend.dirty(); return NULL; },
  SetY: (self, a) => { self.y = toNum(a[0]); self.backend.dirty(); return NULL; },
  SetZ: (self, a) => { self.z = toNum(a[0]); self.backend.dirty(); return NULL; },
  SetOpacity: (self, a) => { self.opacity = toNum(a[0]); self.backend.dirty(); return NULL; },
  SetPosition: (self, a) => { self.x = toNum(a[0]); self.y = toNum(a[1]); if (a[2] !== undefined) self.z = toNum(a[2]); self.backend.dirty(); return NULL; },
  GetImage: (self) => self.image || NULL,
  GetX: (self) => self.x, GetY: (self) => self.y, GetZ: (self) => self.z, GetOpacity: (self) => self.opacity,
};

// ───────────────────────────────────────────────────────────────────────────────
// G · Backends.  Shared sprite model; Canvas paints, Headless just records.
// ───────────────────────────────────────────────────────────────────────────────
class BaseBackend {
  constructor(w, h) { this.w = w; this.h = h; this.sprites = []; this.bg = { top: [0, 0, 0], bottom: [0, 0, 0] }; this._mode = "boot"; this._dirty = true; this.images = new Map(); }
  width() { return this.w; } height() { return this.h; } x() { return 0; } y() { return 0; }
  setBgTop(r, g, b) { this.bg.top = [r, g, b]; this._dirty = true; }
  setBgBottom(r, g, b) { this.bg.bottom = [r, g, b]; this._dirty = true; }
  mode() { return this._mode; } setMode(m) { this._mode = m; }
  dirty() { this._dirty = true; }
  makeSprite(image) { const s = { __sprite: true, backend: this, image: image || null, x: 0, y: 0, z: 0, opacity: 1 }; this.sprites.push(s); this._dirty = true; return s; }
  // image transforms (dimension-correct; pixels handled by subclass)
  scaleImage(img, w, h) { return this.deriveImage(img, { width: Math.max(0, Math.round(w)), height: Math.max(0, Math.round(h)), op: "scale" }); }
  rotateImage(img, ang) { const c = Math.abs(Math.cos(ang)), s = Math.abs(Math.sin(ang)); return this.deriveImage(img, { width: Math.round(img.width * c + img.height * s), height: Math.round(img.width * s + img.height * c), op: "rotate", angle: ang }); }
  cropImage(img, x, y, w, h) { return this.deriveImage(img, { width: Math.max(0, Math.round(w)), height: Math.max(0, Math.round(h)), op: "crop", cx: x, cy: y }); }
  recolorImage(img, r, g, b, a) { return this.deriveImage(img, { width: img.width, height: img.height, op: "recolor", color: [r, g, b, a] }); }
}

export class HeadlessBackend extends BaseBackend {
  // sizes: filename → {width,height}; injected by the loader (read from PNG IHDR).
  constructor(w, h, sizes = {}) { super(w, h); this.sizes = sizes; this.fontH = 16; }
  loadImage(name) { const s = this.sizes[name] || this.sizes[name.split("/").pop()] || { width: 0, height: 0 }; const img = { __image: true, backend: this, name, width: s.width, height: s.height, kind: "file" }; return img; }
  textImage(text, color, font, align) { const h = this.fontH; const w = Math.max(1, Math.round([...String(text)].length * h * 0.55)); return { __image: true, backend: this, text, color, width: w, height: h, kind: "text" }; }
  deriveImage(img, spec) { return { __image: true, backend: this, width: spec.width, height: spec.height, kind: "derived", from: img, op: spec.op }; }
  // headless render = no-op; the witness inspects this.sprites
  paint() { this._dirty = false; }
}

export class CanvasBackend extends BaseBackend {
  constructor(canvas, assets) {
    super(canvas.width, canvas.height);
    this.canvas = canvas; this.ctx = canvas.getContext("2d");
    this.assets = assets || {};       // filename → {bitmap,width,height}
    this.fontH = 16; this.fontFamily = 'ui-monospace, "Cascadia Code", Menlo, Consolas, monospace'; this.dpr = 1;
  }
  resize(w, h, dpr = 1) { this.w = w; this.h = h; this.dpr = dpr; this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); this._dirty = true; }
  loadImage(name) {
    const a = this.assets[name] || this.assets[name.split("/").pop()];
    if (a) return { __image: true, backend: this, name, width: a.width, height: a.height, bitmap: a.bitmap, kind: "file" };
    return { __image: true, backend: this, name, width: 0, height: 0, bitmap: null, kind: "file" };
  }
  textImage(text, color, font, align) {
    const ctx = this.ctx; const px = (font && /(\d+)/.test(font)) ? parseInt(font.match(/(\d+)/)[1], 10) : this.fontH;
    ctx.save(); ctx.font = `${px}px ${this.fontFamily}`;
    const lines = String(text).split("\n");
    const w = Math.max(1, ...lines.map((l) => Math.ceil(ctx.measureText(l).width)));
    const h = px * 1.35 * lines.length;
    const off = (typeof OffscreenCanvas !== "undefined") ? new OffscreenCanvas(Math.max(1, w), Math.max(1, Math.ceil(h))) : Object.assign(document.createElement("canvas"), { width: Math.max(1, w), height: Math.max(1, Math.ceil(h)) });
    const o = off.getContext("2d"); o.font = `${px}px ${this.fontFamily}`; o.textBaseline = "top";
    o.fillStyle = `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${color.a})`;
    lines.forEach((l, i) => o.fillText(l, 0, i * px * 1.35));
    ctx.restore();
    return { __image: true, backend: this, text, color, width: w, height: Math.ceil(h), bitmap: off, kind: "text" };
  }
  deriveImage(img, spec) {
    const W = Math.max(1, spec.width), H = Math.max(1, spec.height);
    const off = (typeof OffscreenCanvas !== "undefined") ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
    const o = off.getContext("2d");
    if (img.bitmap) {
      if (spec.op === "rotate") { o.translate(W / 2, H / 2); o.rotate(spec.angle); o.drawImage(img.bitmap, -img.width / 2, -img.height / 2); }
      else if (spec.op === "crop") { o.drawImage(img.bitmap, spec.cx, spec.cy, W, H, 0, 0, W, H); }
      else o.drawImage(img.bitmap, 0, 0, W, H);
      if (spec.op === "recolor") { o.globalCompositeOperation = "source-in"; const c = spec.color; o.fillStyle = `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${c[3]})`; o.fillRect(0, 0, W, H); }
    }
    return { __image: true, backend: this, width: W, height: H, bitmap: off, kind: "derived" };
  }
  paint() {
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    const css = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
    g.addColorStop(0, css(this.bg.top)); g.addColorStop(1, css(this.bg.bottom));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (const s of [...this.sprites].sort((a, b) => a.z - b.z)) {
      if (!s.image || !s.image.bitmap || s.opacity <= 0 || s.__hidden) continue;   // __hidden: a render-time hide (e.g. the splash hiding a theme's full-bleed backdrop in Dark/Light)
      ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity));
      try { ctx.drawImage(s.image.bitmap, Math.round(s.x), Math.round(s.y)); } catch {}
    }
    ctx.globalAlpha = 1; this._dirty = false;
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// H · Splash plugins.  Each implements the documented Plymouth module behaviour.
// ───────────────────────────────────────────────────────────────────────────────
export const MODES = ["boot", "shutdown", "suspend", "resume", "updates", "system-upgrade", "firmware-upgrade"];

// `script` — runs a .script theme through the interpreter and drives its callbacks.
export class ScriptPlugin {
  constructor(backend, source) { this.backend = backend; this.source = source; this.interp = new Interpreter(backend); }
  static configKeys() { return ["ImageDir", "ScriptFile"]; }
  start() {
    const toks = new Lexer(this.source).tokenize();
    const ast = new Parser(toks).parse();
    this.interp.run(ast);                  // top-level: build sprites + register callbacks
    return this;
  }
  refresh() { this.interp.fire("refresh"); }
  bootProgress(t, p) { this.interp.fire("bootProgress", [t, p]); }
  updateStatus(s) { this.interp.fire("updateStatus", [s]); }
  displayPassword(prompt, bullets) { this.interp.fire("displayPassword", [prompt, bullets]); }
  displayQuestion(prompt, entry) { this.interp.fire("displayQuestion", [prompt, entry]); }
  displayMessage(text) { if (this.interp.has("displayMessage")) this.interp.fire("displayMessage", [text]); else this.interp.fire("message", [text]); }
  hideMessage(text) { this.interp.fire("hideMessage", [text]); }
  displayNormal() { this.interp.fire("displayNormal"); }
  keyboardInput(k) { this.interp.fire("keyboardInput", [k]); }
  quit() { this.interp.fire("quit"); }
  callbackNames() { return Object.keys(this.interp.callbacks); }
}

// `two-step` — background gradient + watermark + throbber animation + boot progress
// + password dialog (box/lock/entry/bullets) + message. All documented config keys.
const hexColor = (s, d = [0, 0, 0]) => {
  if (!s) return d; const m = String(s).match(/0x([0-9a-fA-F]{6})/) || String(s).match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return d; const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};
const frac = (s, d) => { const v = parseFloat(s); return isNaN(v) ? d : v; };

export class TwoStepPlugin {
  constructor(backend, cfg, assets) {
    this.be = backend; this.cfg = cfg || {}; this.assets = assets || {};   // name→image (already loaded)
    this.t = 0; this.progress = 0; this.status = ""; this.message = ""; this.password = null;
    this.halign = frac(cfg.HorizontalAlignment, 0.5); this.valign = frac(cfg.VerticalAlignment, 0.5);
    this.whalign = frac(cfg.WatermarkHorizontalAlignment, 0.5); this.wvalign = frac(cfg.WatermarkVerticalAlignment, 0.5);
    this.dhalign = frac(cfg.DialogHorizontalAlignment, 0.5); this.dvalign = frac(cfg.DialogVerticalAlignment, 0.5);
    this.bgTop = hexColor(cfg.BackgroundStartColor, [0, 0, 0]); this.bgBottom = hexColor(cfg.BackgroundEndColor, this.bgTop);
    // animation frames (the "two steps": a one-shot progress run + a looping throbber)
    this.throbber = this._frames("throbber-"); this.anim = this._frames("animation-").concat(this._frames("progress-"));
    this.watermark = assets["watermark.png"] || assets["watermark"] || null;
    this.spr = {};
  }
  static configKeys() { return ["ImageDir", "Font", "TitleFont", "HorizontalAlignment", "VerticalAlignment", "WatermarkImage", "WatermarkHorizontalAlignment", "WatermarkVerticalAlignment", "DialogHorizontalAlignment", "DialogVerticalAlignment", "Transition", "TransitionDuration", "BackgroundStartColor", "BackgroundEndColor", "ProgressBarBackgroundColor", "ProgressBarForegroundColor"]; }
  _frames(prefix) {
    const names = Object.keys(this.assets).filter((n) => n.startsWith(prefix) && /\.png$/.test(n)).sort();
    return names.map((n) => this.assets[n]);
  }
  start() {
    this.be.setBgTop(...this.bgTop); this.be.setBgBottom(...this.bgBottom);
    if (this.watermark) { this.spr.watermark = this.be.makeSprite(this.watermark); this._place(this.spr.watermark, this.watermark, this.whalign, this.wvalign); }
    this.spr.throb = this.be.makeSprite(this.throbber[0] || this.anim[0] || null);
    this.spr.msg = this.be.makeSprite(null);
    this.spr.dialog = this.be.makeSprite(null);
    return this;
  }
  _place(spr, img, ha, va) { if (!spr || !img) return; spr.x = Math.round((this.be.width() - img.width) * ha); spr.y = Math.round((this.be.height() - img.height) * va); this.be.dirty(); }
  refresh() {
    const frames = this.throbber.length ? this.throbber : this.anim;
    if (frames.length) {
      let idx;
      if (this.throbber.length) idx = Math.floor(this.t * 25) % this.throbber.length;          // looping spinner
      else idx = Math.min(frames.length - 1, Math.floor(this.progress * (frames.length - 1)));  // progress run
      const img = frames[idx]; this.spr.throb.image = img; this._place(this.spr.throb, img, this.halign, this.valign);
    }
    this.t += 1 / 50;
  }
  bootProgress(t, p) { this.progress = p; }
  updateStatus(s) { this.status = s; }
  displayMessage(text) { this.message = text; this._renderMessage(); }
  hideMessage() { this.message = ""; this._renderMessage(); }
  _renderMessage() {
    if (!this.message) { this.spr.msg.image = null; this.be.dirty(); return; }
    const img = this.be.textImage(this.message, { r: 1, g: 1, b: 1, a: 1 }, this.cfg.Font || null, null);
    this.spr.msg.image = img; this.spr.msg.x = Math.round((this.be.width() - img.width) / 2); this.spr.msg.y = Math.round(this.be.height() * 0.86); this.be.dirty();
  }
  displayPassword(prompt, bullets) {
    // dialog: optional box.png/lock.png/entry.png background + N bullets (or vector text)
    const bulletStr = "•".repeat(Math.max(0, bullets));
    const text = (prompt || "Password") + "\n" + (bulletStr || "");
    const img = this.be.textImage(text, { r: 1, g: 1, b: 1, a: 1 }, this.cfg.Font || null, null);
    this.spr.dialog.image = img;
    this._place(this.spr.dialog, img, this.dhalign, this.dvalign);
    this.password = { prompt, bullets };
  }
  displayNormal() { this.spr.dialog.image = null; this.password = null; this.be.dirty(); }
  displayQuestion(prompt, entry) { const img = this.be.textImage((prompt || "") + " " + (entry || ""), { r: 1, g: 1, b: 1, a: 1 }, this.cfg.Font || null, null); this.spr.dialog.image = img; this._place(this.spr.dialog, img, this.dhalign, this.dvalign); }
  quit() {}
  callbackNames() { return ["refresh", "bootProgress", "updateStatus", "displayMessage", "displayPassword", "displayNormal"]; }
}

// `text` — a minimal text-mode splash: title + ASCII progress bar + status + bullets.
export class TextPlugin {
  constructor(backend, cfg) { this.be = backend; this.cfg = cfg || {}; this.title = cfg.Title || ""; this.progress = 0; this.status = ""; this.message = ""; this.password = null; this.spr = null; }
  static configKeys() { return ["Title", "BackgroundColor"]; }
  start() { this.be.setBgTop(...hexColor(this.cfg.BackgroundColor, [0, 0, 0])); this.be.setBgBottom(...hexColor(this.cfg.BackgroundColor, [0, 0, 0])); this.spr = this.be.makeSprite(null); this._render(); return this; }
  _bar() { const W = 32, f = Math.round(this.progress * W); return "[" + "=".repeat(f) + " ".repeat(W - f) + "]"; }
  _render() {
    const lines = [];
    if (this.title) lines.push(this.title);
    lines.push(this._bar() + "  " + Math.round(this.progress * 100) + "%");
    if (this.status) lines.push(this.status);
    if (this.password) lines.push((this.password.prompt || "Password") + ": " + "*".repeat(this.password.bullets));
    if (this.message) lines.push(this.message);
    const img = this.be.textImage(lines.join("\n"), { r: 0.9, g: 0.9, b: 0.9, a: 1 }, this.cfg.Font || null, null);
    this.spr.image = img; this.spr.x = Math.round((this.be.width() - img.width) / 2); this.spr.y = Math.round((this.be.height() - img.height) / 2); this.be.dirty();
  }
  refresh() {}
  bootProgress(t, p) { this.progress = p; this._render(); }
  updateStatus(s) { this.status = s; this._render(); }
  displayMessage(t) { this.message = t; this._render(); }
  hideMessage() { this.message = ""; this._render(); }
  displayPassword(prompt, bullets) { this.password = { prompt, bullets }; this._render(); }
  displayNormal() { this.password = null; this._render(); }
  displayQuestion(prompt, entry) { this.message = (prompt || "") + " " + (entry || ""); this._render(); }
  quit() {}
  callbackNames() { return ["bootProgress", "updateStatus", "displayMessage", "displayPassword"]; }
}

// `details` — the verbose boot log: raw status lines scrolling up the screen.
export class DetailsPlugin {
  constructor(backend, cfg) { this.be = backend; this.cfg = cfg || {}; this.lines = []; this.password = null; this.spr = null; this.max = 24; }
  static configKeys() { return ["BackgroundColor"]; }
  start() { const bg = hexColor(this.cfg.BackgroundColor, [0, 0, 0]); this.be.setBgTop(...bg); this.be.setBgBottom(...bg); this.spr = this.be.makeSprite(null); this._render(); return this; }
  _push(l) { this.lines.push(l); while (this.lines.length > this.max) this.lines.shift(); this._render(); }
  _render() {
    const body = this.lines.slice(); if (this.password) body.push((this.password.prompt || "Password") + ": " + "*".repeat(this.password.bullets));
    const img = this.be.textImage(body.join("\n") || " ", { r: 0.86, g: 0.86, b: 0.86, a: 1 }, this.cfg.Font || null, null);
    this.spr.image = img; this.spr.x = 8; this.spr.y = 8; this.be.dirty();
  }
  refresh() {}
  bootProgress(t, p) {}
  updateStatus(s) { this._push(s); }
  displayMessage(t) { this._push(t); }
  hideMessage() {}
  displayPassword(prompt, bullets) { this.password = { prompt, bullets }; this._render(); }
  displayNormal() { this.password = null; this._render(); }
  displayQuestion(prompt, entry) { this._push((prompt || "") + " " + (entry || "")); }
  quit() {}
  callbackNames() { return ["updateStatus", "displayMessage", "displayPassword"]; }
}

export function makePlugin(moduleName, backend, opts = {}) {
  switch (moduleName) {
    case "script": return new ScriptPlugin(backend, opts.source || "");
    case "two-step": return new TwoStepPlugin(backend, opts.cfg || {}, opts.assets || {});
    case "text": return new TextPlugin(backend, opts.cfg || {});
    case "details": return new DetailsPlugin(backend, opts.cfg || {});
    default: throw new Error(`Holo Splash: unknown Plymouth module '${moduleName}'`);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// I · Engine — the plymouthd/plymouth protocol around a plugin.
//     Drives a boot simulation and exposes the client commands as methods.
// ───────────────────────────────────────────────────────────────────────────────
export class Engine {
  constructor(backend, plugin) {
    this.be = backend; this.plugin = plugin;
    this.t = 0; this.progress = 0; this.running = false; this.paused = false;
    this.duration = 14; this.shown = false; this.onframe = null;
    this._lastRefresh = 0;
    this.speed = 1;            // animation-rate multiplier (granular preview speed control)
  }
  showSplash() { this.shown = true; this.be.dirty(); this.plugin.refresh && this.plugin.refresh(); this.be.paint(); }
  hideSplash() { this.shown = false; }
  // plymouth update --status=
  updateStatus(s) { this.status = s; this.plugin.updateStatus && this.plugin.updateStatus(s); this._paint(); }
  // plymouth message --text=
  message(text) { this.plugin.displayMessage && this.plugin.displayMessage(text); this._paint(); }
  hideMessage(text) { this.plugin.hideMessage && this.plugin.hideMessage(text); this._paint(); }
  // plymouth ask-for-password  → drive bullets as keys arrive, resolve on Enter
  displayPassword(prompt, bullets) { this.plugin.displayPassword && this.plugin.displayPassword(prompt, bullets); this._paint(); }
  displayQuestion(prompt, entry) { this.plugin.displayQuestion && this.plugin.displayQuestion(prompt, entry); this._paint(); }
  displayNormal() { this.plugin.displayNormal && this.plugin.displayNormal(); this._paint(); }
  keyboardInput(k) { this.plugin.keyboardInput && this.plugin.keyboardInput(k); this._paint(); }
  // plymouth change-mode --boot/--shutdown/...
  setMode(m) { if (!MODES.includes(m)) return; this.be.setMode(m); this.plugin.displayNormal && this.plugin.displayNormal(); this._paint(); }
  // plymouth system-update --progress=
  setProgress(p) { this.progress = Math.max(0, Math.min(1, p)); this.plugin.bootProgress && this.plugin.bootProgress(this.t, this.progress); this._paint(); }
  quit() { this.running = false; this.plugin.quit && this.plugin.quit(); }
  pause() { this.paused = true; } resume() { this.paused = false; }

  _paint() { this.plugin.refresh && this.plugin.refresh(); this.be.paint(); }

  // one logical frame at dt seconds (used by both rAF and the headless witness).
  // `speed` scales the animation rate (0 = frozen) without affecting real-time wall clock.
  tick(dt) {
    if (!this.running || this.paused) return;
    const sdt = dt * this.speed;
    this.t += sdt;
    if (this.progress < 1) { this.progress = Math.max(this.progress, Math.min(1, this.t / this.duration)); this.plugin.bootProgress && this.plugin.bootProgress(this.t, this.progress); }
    // Refresh fires once per 1/50 s of ENGINE time. `speed` is the animation frequency: at high
    // speed we fire it MANY times per real frame (bounded by the budget) so the animation truly
    // accelerates across the whole spectrum, not just the progress bar. Past the budget the
    // motion visually saturates — you can't show more frames than the display has — so we drop
    // the backlog, keeping every tick bounded work (no freeze at extreme frequencies).
    this._lastRefresh += sdt;
    let fired = 0;
    while (this._lastRefresh >= 1 / 50 && fired < 256) { this._lastRefresh -= 1 / 50; this.plugin.refresh && this.plugin.refresh(); fired++; }
    if (this._lastRefresh >= 1 / 50) this._lastRefresh = 0;
    this.be.paint();
    if (this.onframe) this.onframe({ t: this.t, progress: this.progress });
  }
  // Advance EXACTLY one refresh frame (1/50 s of engine time), even while paused — the
  // primitive behind frame-by-frame scrubbing of the preview.
  stepFrame() {
    this.t += 1 / 50;
    if (this.progress < 1) { this.progress = Math.max(this.progress, Math.min(1, this.t / this.duration)); this.plugin.bootProgress && this.plugin.bootProgress(this.t, this.progress); }
    this.plugin.refresh && this.plugin.refresh();
    this.be.paint();
    if (this.onframe) this.onframe({ t: this.t, progress: this.progress });
  }
  start() { this.running = true; this.shown = true; }
}
