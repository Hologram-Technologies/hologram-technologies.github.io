// holo-keys.js — the NATIVE keyboard layer for Hologram OS. Feature-complete shortcuts
// (chords + Gmail-style sequences + per-OS modifier normalization + focus rules) AND an
// on-screen virtual keyboard that MIRRORS physical typing live and fires the same commands.
// No Mousetrap, no Hotkeys.js, no dependency — the web platform's KeyboardEvent is the engine
// (Law L4). Resolution is O(1): a chord canonicalizes to a string that is effectively its
// address, looked up in one Map. Every binding is a content-addressed COMMAND and the whole
// keymap canonicalizes to a string the shell turns into a did:holo (share your config as a
// link; a peer re-derives + verifies it — Law L5). Isomorphic: the parse/canon/resolve core is
// pure (node-testable); attach() + the virtual keyboard touch the DOM only in the browser.

const SPECIAL = { " ": "space", spacebar: "space", arrowup: "up", arrowdown: "down", arrowleft: "left", arrowright: "right", escape: "esc", delete: "del", backspace: "backspace", enter: "enter", return: "enter", tab: "tab" };
const MOD = new Set(["mod", "ctrl", "control", "cmd", "command", "meta", "win", "super"]);
const ORDER = ["mod", "alt", "shift"];
const normKey = (k) => { k = String(k).toLowerCase(); return SPECIAL[k] || k; };
const cap = (s) => String(s).replace(/^\w/, (c) => c.toUpperCase());

export function createKeymap(opts = {}) {
  const apple = !!opts.apple;
  const chords = new Map(), seqs = [], registry = [], listeners = new Set();
  const seqMs = opts.seqMs || 900;
  let buf = [], bufT = null;
  const isEditable = (el) => !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || "") || el.isContentEditable);

  function parse(spec) {
    spec = String(spec).trim();
    if (/\s/.test(spec)) return { seq: spec.toLowerCase().split(/\s+/).map(normKey) };
    const mods = new Set(); let key = "";
    for (const p of spec.toLowerCase().split("+").map((s) => s.trim()).filter(Boolean)) {
      if (p === "alt" || p === "option") mods.add("alt");
      else if (p === "shift") mods.add("shift");
      else if (MOD.has(p)) mods.add("mod");
      else key = normKey(p);
    }
    return { mods, key };
  }
  const canon = (mods, key) => [...ORDER.filter((m) => mods.has(m)), key].join("+");
  function eventParsed(e) {
    const mods = new Set();
    if (apple ? e.metaKey : e.ctrlKey) mods.add("mod");
    if (e.altKey) mods.add("alt");
    const key = normKey(e.key);
    // a shifted printable char already encodes shift; only add shift for chords / named keys
    if (e.shiftKey && (mods.size || key.length > 1)) mods.add("shift");
    return { mods, key };
  }
  const resetSeq = () => { buf = []; clearTimeout(bufT); bufT = null; };

  // bind(spec | [specs], run, { id, title, group, global }) → a content-addressed command.
  function bind(spec, run, info = {}) {
    const specs = Array.isArray(spec) ? spec : [spec];
    const entry = { id: info.id || specs[0], specs, spec: specs[0], run, title: info.title || "", group: info.group || "General", global: !!info.global };
    for (const s of specs) { const p = parse(s); if (p.seq) seqs.push({ keys: p.seq, entry }); else chords.set(canon(p.mods, p.key), entry); }
    registry.push(entry); return entry;
  }
  const run = (id) => { const e = registry.find((x) => x.id === id); if (e) { e.run(); return true; } return false; };

  function handle(e) {
    const k = String(e.key || "").toLowerCase();
    if (["control", "shift", "alt", "meta", "os"].includes(k)) return false; // ignore bare modifiers
    const inField = (typeof document !== "undefined" && isEditable(document.activeElement)) || isEditable(e.target);
    const p = eventParsed(e);
    for (const l of listeners) { try { l("down", p, e); } catch {} }
    const entry = chords.get(canon(p.mods, p.key));
    if (entry && (entry.global || !inField || p.mods.has("mod"))) { e.preventDefault && e.preventDefault(); resetSeq(); entry.run(e); return true; }
    if (!p.mods.size && !inField && p.key.length === 1) {                 // Gmail-style sequence
      buf.push(p.key); clearTimeout(bufT); bufT = setTimeout(resetSeq, seqMs);
      for (const s of seqs) { const n = s.keys.length; if (buf.length >= n && s.keys.every((kk, i) => kk === buf[buf.length - n + i])) { e.preventDefault && e.preventDefault(); resetSeq(); s.entry.run(e); return true; } }
    } else resetSeq();
    return false;
  }

  function attach(target) {
    target = target || (typeof window !== "undefined" ? window : null); if (!target) return () => {};
    const kd = (e) => handle(e), ku = (e) => { const p = eventParsed(e); for (const l of listeners) { try { l("up", p, e); } catch {} } };
    target.addEventListener("keydown", kd, true); target.addEventListener("keyup", ku, true);
    return () => { target.removeEventListener("keydown", kd, true); target.removeEventListener("keyup", ku, true); };
  }
  const onKey = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  function label(spec) {
    const p = parse(spec); if (p.seq) return p.seq.join(" ").toUpperCase();
    const sym = { mod: apple ? "⌘" : "Ctrl", alt: apple ? "⌥" : "Alt", shift: "⇧" };
    const parts = ORDER.filter((m) => p.mods.has(m)).map((m) => sym[m]);
    parts.push((p.key || "").length === 1 ? p.key.toUpperCase() : cap(p.key || ""));
    return parts.join(apple ? " " : "+");
  }
  // a stable string for content-addressing the WHOLE keymap (the shell turns it into a did:holo).
  const canonical = () => JSON.stringify(registry.map((e) => [e.specs.join("|"), e.id, e.title]).sort((a, b) => (a[1] < b[1] ? -1 : 1)));

  return { apple, bind, run, runChord: (c) => { const e = chords.get(c); if (e) { e.run(); return true; } return false; }, handle, attach, onKey, registry, label, parse, canon, eventParsed, canonical, get chords() { return chords; }, get seqs() { return seqs; } };
}

// ── the on-screen virtual keyboard — a real OSK that mirrors physical typing + fires commands ──
const VK_ROWS = [
  ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "backspace"],
  ["tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\"],
  ["caps", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "enter"],
  ["shift", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "shift"],
  ["mod", "alt", "space", "alt", "mod"],
];
const VK_WIDE = { backspace: 2, tab: 1.5, "\\": 1.5, caps: 1.8, enter: 2.2, shift: 2.4, mod: 1.6, alt: 1.4, space: 7 };
const VK_LABEL = { backspace: "⌫", tab: "⇥", caps: "⇪", enter: "⏎", shift: "⇧", alt: "⌥", space: "" };

// renderKeyboard(km, { onType }) → a DOM element. Mirrors physical keystrokes (highlights caps),
// modifier keys are sticky; a char with sticky modifiers FIRES the bound command, otherwise it
// types via onType(key). Pure web platform; no dependency.
export function renderKeyboard(km, { onType } = {}) {
  if (typeof document === "undefined") throw new Error("holo-keys: renderKeyboard needs a DOM");
  const wrap = document.createElement("div"); wrap.className = "holo-vk";
  const sticky = new Set();
  for (const row of VK_ROWS) {
    const r = document.createElement("div"); r.className = "vk-row";
    for (const key of row) {
      const b = document.createElement("button"); b.className = "vk-key"; b.dataset.key = key;
      b.style.flexGrow = String(VK_WIDE[key] || 1);
      b.textContent = key === "mod" ? (km.apple ? "⌘" : "Ctrl") : (VK_LABEL[key] != null ? VK_LABEL[key] : key);
      b.onclick = () => {
        if (["mod", "alt", "shift"].includes(key)) { sticky.has(key) ? sticky.delete(key) : sticky.add(key); wrap.querySelectorAll(`[data-key="${key}"]`).forEach((x) => x.classList.toggle("on", sticky.has(key))); return; }
        if (sticky.size) { km.runChord([...ORDER.filter((m) => sticky.has(m)), normKey(key)].join("+")); sticky.clear(); wrap.querySelectorAll(".vk-key.on").forEach((x) => x.classList.remove("on")); }
        else if (onType) onType(normKey(key));
      };
      r.appendChild(b);
    }
    wrap.appendChild(r);
  }
  // live mirror — physical keystrokes light up the on-screen caps
  km.onKey((phase, p) => {
    wrap.querySelectorAll(".vk-key.press").forEach((x) => x.classList.remove("press"));
    if (phase !== "down") return;
    const main = wrap.querySelector(`[data-key="${CSS.escape(p.key)}"]`); if (main) main.classList.add("press");
    for (const m of ORDER) if (p.mods.has(m)) wrap.querySelectorAll(`[data-key="${m}"]`).forEach((x) => x.classList.add("press"));
  });
  return wrap;
}
