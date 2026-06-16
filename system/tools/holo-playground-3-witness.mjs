// holo-playground-3-witness.mjs — proves Holo Playground 3.0, the CANVAS layer (Stage 1): when armed, every
// element is directly manipulable — grab/drag to move, hide, delete — as effortlessly as child's play, and that
// play is EPHEMERAL by the L5 rule: it mutates REAL serializable bytes but NEVER seals. Freeze reseals the
// arrangement through the ONE primitive (createLiveEditor); Reset restores the exact pre-play bytes with zero κ
// churn. Pure: a tiny deterministic DOM (no jsdom), the host wired to the REAL HoloRepo.publishSource + the REAL
// createLiveEditor — the same dispatch the shell runs (the Atlas-isomorphism discipline).
//
// Run: node system/tools/holo-playground-3-witness.mjs

import { createPlaygroundAgent, createPlaygroundHost } from "../os/usr/lib/holo/holo-playground-agent.mjs";
import { createPlaySession, parseStyle, formatStyle, setStyleProp, getStyleProp, composeTransform } from "../os/usr/lib/holo/holo-playground-canvas.mjs";
import { createLiveEditor } from "../os/usr/lib/holo/holo-live-edit.mjs";
import { HoloRepo } from "../os/usr/lib/holo/holo-blocks-repo.mjs";
import { verify as verifyObject } from "../os/usr/lib/holo/holo-object.mjs";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};
let pass = 0, fail = 0, kn = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const ok = (n, c, x = "") => { (c ? pass++ : fail++); checks[(slug(n) || "check") + "-" + (++kn)] = !!c; console.log((c ? "  ok  " : " FAIL ") + n + (x ? "  — " + x : "")); };

// ── a tiny deterministic DOM with the structural ops the play session needs (setAttribute/removeAttribute,
//    parentNode, nextSibling, remove, insertBefore) — only what serializeNode + the session touch, no jsdom. ──
class N {
  constructor(type, name) { this.nodeType = type; this.nodeName = name; this.childNodes = []; this.parentNode = null; this.attributes = []; this.nodeValue = ""; }
  get localName() { return this.nodeType === 1 ? this.nodeName.toLowerCase() : undefined; }
  getAttribute(n) { const a = this.attributes.find((a) => a.name === n); return a ? a.value : null; }
  setAttribute(n, v) { const a = this.attributes.find((a) => a.name === n); if (a) a.value = String(v); else this.attributes.push({ name: n, value: String(v) }); }
  removeAttribute(n) { const i = this.attributes.findIndex((a) => a.name === n); if (i >= 0) this.attributes.splice(i, 1); }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return i >= 0 ? (p.childNodes[i + 1] || null) : null; }
  get firstElementChild() { return this.childNodes.find((c) => c.nodeType === 1) || null; }
  get id() { return this.getAttribute("id") || ""; }
  remove() { const p = this.parentNode; if (!p) return; const i = p.childNodes.indexOf(this); if (i >= 0) p.childNodes.splice(i, 1); this.parentNode = null; }
  insertBefore(node, ref) { if (node.parentNode) node.remove(); const i = ref ? this.childNodes.indexOf(ref) : -1; if (i >= 0) this.childNodes.splice(i, 0, node); else this.childNodes.push(node); node.parentNode = this; return node; }
  appendChild(node) { return this.insertBefore(node, null); }
}
const text = (t) => { const n = new N(3, "#text"); n.nodeValue = t; return n; };
const el = (tag, attrs = {}, kids = []) => { const n = new N(1, tag.toUpperCase()); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); for (const k of kids) n.insertBefore(k, null); return n; };

// the live app DOM after injection — the same shape as the agent witness: ephemeral style + scripts, a hovered h1.
function buildDoc() {
  const style = el("style", { "data-holo-ephemeral": "" }, [text(".x{color:red}")]);
  const h1 = el("h1", { class: "title holo-pg-hot" }, [text("Hello")]);
  const p = el("p", {}, [text("world")]);
  const pgScript = el("script", { id: "holo-playground-app", "data-holo-ephemeral": "", "data-surface": "win-1" }, []);
  const head = el("head", {}, [style]);
  const body = el("body", { class: "app" }, [h1, p, pgScript]);
  const html = el("html", { lang: "en" }, [head, body]);
  return { doc: { nodeType: 9, nodeName: "#document", documentElement: html, body, childNodes: [html] }, html, body, head, h1, p };
}

// ── 1) pure style-attribute helpers — a move is a REAL inline style the κ captures on Freeze ─────────────────
ok("parseStyle ⇄ formatStyle round-trips", formatStyle(parseStyle("color: red; transform: translate(2px, 3px)")) === "color: red; transform: translate(2px, 3px)");
const box = el("div", { style: "color: red" });
setStyleProp(box, "transform", "translate(4px, 5px)");
ok("setStyleProp adds a decl, preserving the others", box.getAttribute("style") === "color: red; transform: translate(4px, 5px)");
setStyleProp(box, "color", null);
ok("setStyleProp(null) removes ONE decl, keeps the rest", box.getAttribute("style") === "transform: translate(4px, 5px)");
setStyleProp(box, "transform", null);
ok("setStyleProp empties ⇒ the style attribute is dropped (clean reset, no style=\"\" residue)", box.getAttribute("style") === null);
ok("getStyleProp reads back a single decl", (() => { setStyleProp(box, "display", "none"); return getStyleProp(box, "display") === "none"; })());
ok("composeTransform omits identity parts (a zeroed move ⇒ no transform)", composeTransform({ x: 0, y: 0 }) === "" && composeTransform({ x: 1, y: 2 }) === "translate(1px, 2px)");

// ── 2) the play session — move/hide/delete mutate real bytes; backups recorded; transformOf accumulates ──────
{
  const { h1 } = buildDoc();
  const s = createPlaySession();
  s.nudge(h1, 10, 20); s.nudge(h1, 5, 0);
  ok("nudge accumulates into ONE composed transform on the live element", h1.getAttribute("style") === "transform: translate(15px, 20px)");
  ok("transformOf reflects the accumulated offset (drag start reads it back)", s.transformOf(h1).x === 15 && s.transformOf(h1).y === 20);
  ok("a moved element counts as one pending change", s.count() === 1 && !s.isEmpty());
  s.hide(h1);
  ok("hide adds display:none to the SAME element (still one tracked element)", /display:\s*none/.test(h1.getAttribute("style")) && s.count() === 1 && s.isHidden(h1));
}

// ── 3) serialize() SURVIVES play — the move is baked into the source, all play-chrome is stripped (L5) ───────
{
  const { doc, h1, body } = buildDoc();
  const posted = [];
  const agent = createPlaygroundAgent({ doc, win: null, surfaceId: "win-1", postUp: (m) => posted.push(m) });
  agent.playSession.nudge(h1, 12, 34);                         // a move (real inline style)
  const dockGhost = el("div", { class: "holo-pg-dock", "data-holo-ephemeral": "" }, [text("✦ 1 change")]);
  body.insertBefore(dockGhost, null);                          // the ephemeral dock HUD must NOT reach the κ
  const src = agent.serialize();
  ok("serialize BAKES the move (the transform is in the sealed source)", /<h1 class="title" style="transform: translate\(12px, 34px\)">Hello<\/h1>/.test(src), src);
  ok("serialize STRIPS the ephemeral dock HUD", !/holo-pg-dock|1 change/.test(src));
  ok("serialize STRIPS the transient glow class + ephemeral nodes (unchanged L5 strip)", !/holo-pg-hot|holo-playground-app|color:red/.test(src));
  ok("merely playing posts NOTHING up — play is ephemeral, no seal (the L5 rule)", posted.length === 0);
}

// ── 4) Reset is a TRUE no-op — move/hide/delete then reset() ⇒ byte-identical to the pristine source ─────────
{
  const { doc, h1, p } = buildDoc();
  const agent = createPlaygroundAgent({ doc, win: null, surfaceId: "win-1" });
  const pristine = agent.serialize();
  agent.playSession.nudge(h1, 40, 9); agent.playSession.hide(p);
  ok("after play the source differs (move + hide are live)", agent.serialize() !== pristine);
  agent.playSession.reset();
  ok("Reset restores the EXACT pre-play bytes (no style residue on the moved/hidden nodes)", agent.serialize() === pristine, agent.serialize());
  ok("Reset clears all pending state", agent.playSession.isEmpty());
}

// ── 5) ephemeral DELETE — gone from the source while playing, re-inserted at its original position on Reset ──
{
  const { doc, p } = buildDoc();
  const agent = createPlaygroundAgent({ doc, win: null, surfaceId: "win-1" });
  const pristine = agent.serialize();
  agent.playSession.del(p);
  ok("a deleted element is absent from the serialized source", !/<p>world<\/p>/.test(agent.serialize()));
  agent.playSession.reset();
  ok("Reset re-inserts the deleted element at its ORIGINAL position (byte-identical)", agent.serialize() === pristine, agent.serialize());
}

// ── 6) FREEZE routes through the ONE primitive — the arrangement is sealed to a NEW κ, then the session clears ─
{
  const { doc, h1 } = buildDoc();
  const posted = [];
  const agent = createPlaygroundAgent({ doc, win: null, surfaceId: "win-1", postUp: (m) => posted.push(m) });
  agent.playSession.nudge(h1, 7, 7);                           // arrange
  agent.commitEdit();                                          // ← the Freeze button / menu Freeze does exactly this
  ok("Freeze hands the moved source UP exactly once (the ONE outbound effect)", posted.length === 1 && posted[0].op === "reseal" && /translate\(7px, 7px\)/.test(posted[0].source));
  ok("Freeze clears the session (the arrangement is now the baseline; Reset can't undo a commit)", agent.playSession.isEmpty());

  // the host wired to the REAL substrate — the same createLiveEditor + HoloRepo the shell uses
  const repo = new HoloRepo();
  let renders = 0;
  const editor = createLiveEditor({ seal: (name, source) => repo.publishSource({ name: name || "app", source }), gate: () => null, now: () => 1700000000000 });
  editor.register("win-1", { name: "App", render: () => { renders++; } });
  const FRAME = { id: "the-app-frame" };
  const host = createPlaygroundHost({ editor, frameFor: (id) => (id === "win-1" ? FRAME : null), beforeEdit: () => {}, replyTo: () => {} });
  const r = host.handle({ data: posted[0], source: FRAME });
  ok("the frozen arrangement reseals through createLiveEditor → ok + a NEW κ", r && r.ok === true && r.changed === true && /^did:holo:sha256:/.test(r.kappa));
  ok("the frozen κ === publishSource(moved source) (pure content address — the move IS in the κ)", r.kappa === repo.publishSource({ name: "App", source: posted[0].source }).id);
  const obj = JSON.parse(repo.objStore.get(r.kappa.split(":").pop()));
  ok("the frozen surface re-derives by content (Law L5)", verifyObject({ ...obj, id: r.kappa }) === true);
}

// ── 7) arm/disarm — exiting Playground without Freeze DISCARDS the arrangement (ephemeral by default) ────────
{
  const { doc, h1 } = buildDoc();
  const agent = createPlaygroundAgent({ doc, win: null, surfaceId: "win-1" });
  const pristine = agent.serialize();
  agent.setActive(true);
  agent.playSession.nudge(h1, 99, 99);
  ok("armed + moved ⇒ the source reflects the play", /translate\(99px, 99px\)/.test(agent.serialize()));
  agent.setActive(false);
  ok("Exit Playground discards pending play (byte-identical to pristine)", agent.serialize() === pristine);
  ok("after exit the session is empty and dormant", agent.playSession.isEmpty() && agent.isActive() === false);
}

const result = { "@type": "earl:TestResult", witnessed: fail === 0,
  subject: "Holo Playground 3.0 (Stage 1, the canvas layer) — when armed every element is directly manipulable (drag to move · hide · delete) as child's play; direct manipulation is EPHEMERAL (mutates real serializable bytes, never seals — the L5 play rule), Freeze reseals the arrangement to a NEW κ through the ONE primitive (createLiveEditor) and clears the session, Reset restores the exact pre-play bytes, and exiting without Freeze discards; serialize() bakes a move into the κ while stripping every [data-holo-ephemeral] play-chrome node and the transient glow (zero injected noise, re-derivable L5)",
  covers: ["style-helpers", "ephemeral play (move/hide/delete)", "serialize survives play (move baked, chrome stripped)", "Reset is a true no-op", "Freeze through the ONE path → new κ", "arm/disarm discards"],
  passed: pass, failed: fail, checks };
writeFileSync(join(here, "holo-playground-3-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("\n" + (fail === 0 ? "PASS" : "FAIL") + " — " + pass + " ok, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
