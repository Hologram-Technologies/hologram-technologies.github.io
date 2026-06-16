// holo-playground-forces-witness.mjs — proves Holo Playground 3.0, Stage 2 (FORCES). A "tornado" or "earthquake"
// ravages the screen apart object by object, yet it is NOT a special case in the κ model: a force is an automated
// driver of the SAME ephemeral play session (ADR-0110, Stage 1). The PURE physics — field functions + the
// integrator (gravity · damping · floor/wall collision) — is deterministic and witnessed with no rAF, no random,
// no browser; and a force simulated over the real session is EPHEMERAL (Reset → byte-identical, never seals).
// pretext-evaluated text-shatter geometry (layoutWords) is pure and witnessed via an injected metric stub.
//
// Run: node system/tools/holo-playground-forces-witness.mjs

import { vortexForce, radialForce, integrate, zeroForce, FORCES, forceById, isTextish } from "../os/usr/lib/holo/holo-playground-forces.mjs";
import { layoutWords, splitWords } from "../os/usr/lib/holo/holo-playground-shatter.mjs";
import { createPlaygroundAgent } from "../os/usr/lib/holo/holo-playground-agent.mjs";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};
let pass = 0, fail = 0, kn = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const ok = (n, c, x = "") => { (c ? pass++ : fail++); checks[(slug(n) || "check") + "-" + (++kn)] = !!c; console.log((c ? "  ok  " : " FAIL ") + n + (x ? "  — " + x : "")); };

// ── a tiny deterministic DOM (same shape as the Stage 1 witness — only what serializeNode + the session need) ──
class N {
  constructor(type, name) { this.nodeType = type; this.nodeName = name; this.childNodes = []; this.parentNode = null; this.attributes = []; this.nodeValue = ""; }
  get localName() { return this.nodeType === 1 ? this.nodeName.toLowerCase() : undefined; }
  getAttribute(n) { const a = this.attributes.find((a) => a.name === n); return a ? a.value : null; }
  setAttribute(n, v) { const a = this.attributes.find((a) => a.name === n); if (a) a.value = String(v); else this.attributes.push({ name: n, value: String(v) }); }
  removeAttribute(n) { const i = this.attributes.findIndex((a) => a.name === n); if (i >= 0) this.attributes.splice(i, 1); }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.childNodes.indexOf(this); return i >= 0 ? (p.childNodes[i + 1] || null) : null; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((c) => c.textContent).join(""); }
  remove() { const p = this.parentNode; if (!p) return; const i = p.childNodes.indexOf(this); if (i >= 0) p.childNodes.splice(i, 1); this.parentNode = null; }
  insertBefore(node, ref) { if (node.parentNode) node.remove(); const i = ref ? this.childNodes.indexOf(ref) : -1; if (i >= 0) this.childNodes.splice(i, 0, node); else this.childNodes.push(node); node.parentNode = this; return node; }
}
const text = (t) => { const n = new N(3, "#text"); n.nodeValue = t; return n; };
const el = (tag, attrs = {}, kids = []) => { const n = new N(1, tag.toUpperCase()); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); for (const k of kids) n.insertBefore(k, null); return n; };

// ── 1) PURE field functions — direction is correct (a tornado swirls; a black hole pulls in) ─────────────────
const env = { w: 1000, h: 800, eye: { x: 500, y: 400 }, strength: 1500 };
const right = { x: 0, y: 0, cx0: 800, cy0: 400, w: 40, h: 24 };   // a particle to the RIGHT of the eye
const below = { x: 0, y: 0, cx0: 500, cy0: 700, w: 40, h: 24 };   // a particle BELOW the eye
const fR = vortexForce(right, env), fB = vortexForce(below, env);
ok("vortex swirls counter-clockwise: a particle to the right is pushed DOWN", fR.fy > 0);
ok("vortex pulls slightly INWARD: the right particle also gets a leftward (toward-eye) component", fR.fx < 0);
ok("vortex swirl is consistent: a particle below the eye is pushed LEFT", fB.fx < 0);
const bh = radialForce(right, env, -1, "inverse");
ok("black hole pulls toward the eye (right particle → leftward force)", bh.fx < 0 && Math.abs(bh.fy) < 1e-6);
const mNear = radialForce({ ...right, cx0: 600 }, { ...env, strength: 7 }, -1, "linear");
const mFar = radialForce({ ...right, cx0: 900 }, { ...env, strength: 7 }, -1, "linear");
ok("magnet (linear) strengthens with distance (|force| at 400px > at 100px)", Math.abs(mFar.fx) > Math.abs(mNear.fx));

// ── 2) PURE integrator — gravity, damping, floor + wall collision ────────────────────────────────────────────
{
  const p0 = { x: 0, y: 0, vx: 0, vy: 0, cx0: 500, cy0: 100, w: 40, h: 24 };
  const p1 = integrate(p0, env, { field: zeroForce, gravity: { x: 0, y: 1600 }, damping: 0.99 }, 1 / 60);
  ok("gravity accelerates a particle downward (vy>0, y>0 after a step)", p1.vy > 0 && p1.y > 0);
}
{
  const p0 = { x: 0, y: 0, vx: 100, vy: 0, cx0: 500, cy0: 400, w: 40, h: 24 };
  const p1 = integrate(p0, env, { field: zeroForce, damping: 0.9 }, 1 / 60);
  ok("damping bleeds momentum (a coasting particle slows: vx<100)", p1.vx < 100 && p1.vx > 0);
}
{
  // a particle just above the floor moving down fast → clamps to the floor and bounces (restitution flips vy)
  const p0 = { x: 0, y: 0, vx: 0, vy: 4000, cx0: 500, cy0: 780, w: 40, h: 40 };   // cy0+halfH = 800 = floor
  const p1 = integrate(p0, env, { field: zeroForce, floor: true, damping: 1, restitution: 0.4 }, 1 / 60);
  ok("floor collision clamps to the viewport bottom and bounces (vy flips negative)", p1.vy < 0 && (p1.cy0 + p1.y + p1.h / 2) <= env.h + 0.001);
}
{
  const p0 = { x: 0, y: 0, vx: 5000, vy: 0, cx0: 960, cy0: 400, w: 80, h: 24 };   // near the right wall, moving right
  const p1 = integrate(p0, env, { field: zeroForce, walls: true, damping: 1, restitution: 0.4 }, 1 / 60);
  ok("wall collision clamps inside the viewport and reflects (vx flips negative)", p1.vx < 0 && (p1.cx0 + p1.x + p1.w / 2) <= env.w + 0.001);
}

// ── 3) the data-driven REGISTRY — forces are data; tornado + earthquake are present and well-formed ──────────
ok("the registry ships a tornado and an earthquake (and more) as DATA presets", forceById("tornado") && forceById("earthquake") && FORCES.length >= 4);
ok("tornado opts into text-shatter; earthquake configures gravity + floor (a settle, not a swirl)", forceById("tornado").shatterText === true && forceById("earthquake").spec().floor === true && forceById("earthquake").spec().gravity.y > 0);
ok("an unknown force id resolves to null (honest, no throw)", forceById("nope") === null);
ok("isTextish: a multi-word leaf is shatterable; a single word / a container is not", isTextish(el("p", {}, [text("hello world here")])) === true && isTextish(el("p", {}, [text("Solo")])) === false && isTextish(el("div", {}, [el("p"), el("p")])) === false);

// ── 4) text-shatter geometry (pretext's core idea) — DOM-free, deterministic via an injected metric stub ─────
{
  const measure = (s) => s === " " ? 4 : s.length * 10;     // a deterministic stand-in for canvas measureText
  const words = splitWords("the quick brown fox jumps");
  const flat = layoutWords(words, measure, 0, 20);
  ok("layoutWords places words left-to-right by measured width (no wrap, y stays 0)", flat.length === 5 && flat[0].x === 0 && flat[1].x === measure("the") + measure(" ") && flat.every((b) => b.y === 0));
  const wrapped = layoutWords(words, measure, 90, 20);      // narrow box ⇒ must wrap to a second line
  ok("layoutWords wraps at maxWidth onto new lines (a later word gets y>0, x resets)", wrapped.some((b) => b.y > 0) && wrapped.find((b) => b.y > 0).x === 0);
}

// ── 5) THE SPINE — a force SIMULATED over the real session is EPHEMERAL: Reset → byte-identical, never seals ──
{
  const style = el("style", { "data-holo-ephemeral": "" }, [text(".x{}")]);
  const h1 = el("h1", { class: "title" }, [text("Hello")]);
  const p = el("p", {}, [text("world")]);
  const head = el("head", {}, [style]);
  const body = el("body", { class: "app" }, [h1, p]);
  const html = el("html", { lang: "en" }, [head, body]);
  const doc = { nodeType: 9, nodeName: "#document", documentElement: html, body, childNodes: [html] };
  const posted = [];
  const agent = createPlaygroundAgent({ doc, win: null, surfaceId: "win-1", postUp: (m) => posted.push(m) });
  const pristine = agent.serialize();

  // simulate a tornado on the h1 WITHOUT the rAF engine: integrate a few steps, writing each through the session.
  let part = { x: agent.playSession.transformOf(h1).x, y: 0, vx: 0, vy: 0, rot: 0, vrot: 90, cx0: 120, cy0: 60, w: 80, h: 30 };
  const spec = forceById("tornado").spec(env);
  for (let i = 0; i < 30; i++) { part = integrate(part, env, spec, 1 / 60); agent.playSession.setTransform(h1, { x: part.x, y: part.y, rot: part.rot }); }
  const mid = agent.serialize();
  ok("a simulated force moves the object live (a transform is in the source)", /<h1 class="title" style="transform:/.test(mid) && mid !== pristine, mid.match(/<h1[^>]*>/)[0]);

  // an ephemeral shard layer (what shatter injects) must be stripped by serialize, never sealed
  const shardLayer = el("div", { class: "holo-pg-shards", "data-holo-ephemeral": "" }, [el("span", {}, [text("Hello")])]);
  body.insertBefore(shardLayer, null);
  ok("serialize STRIPS the ephemeral text-shard layer (never sealed)", !/holo-pg-shards/.test(agent.serialize()));
  ok("merely running a force posts NOTHING up — a force never seals (the L5 play rule)", posted.length === 0);

  shardLayer.remove();
  agent.playSession.reset();
  ok("Reset after a force restores the EXACT pre-force bytes (zero κ churn)", agent.serialize() === pristine, agent.serialize());
}

const result = { "@type": "earl:TestResult", witnessed: fail === 0,
  subject: "Holo Playground 3.0 (Stage 2, whole-screen FORCES) — a tornado / earthquake (and a data-driven field registry: black hole, magnet, confetti, gravity-flip) ravages the armed screen object by object, yet a force is just an automated driver of the SAME ephemeral play session (ADR-0110): it sets transforms frame by frame and NEVER seals, so Reset restores byte-for-byte and Freeze bakes the final arrangement through the ONE primitive. The PURE physics (field functions + integrator: gravity, damping, floor/wall collision) is deterministic; text-shatter geometry (pretext's DOM-free measure idea, scoped to word offsets via an injected metric) lays out + wraps words by arithmetic; the ephemeral [data-holo-ephemeral] shard layer is stripped before sealing (L5)",
  covers: ["field functions (vortex/radial direction)", "integrator (gravity/damping/floor+wall collision)", "data-driven force registry", "isTextish gate", "shatter layoutWords (pretext core, wrapping)", "a force is ephemeral (Reset byte-identical, never seals)", "shard layer stripped (L5)"],
  passed: pass, failed: fail, checks };
writeFileSync(join(here, "holo-playground-forces-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("\n" + (fail === 0 ? "PASS" : "FAIL") + " — " + pass + " ok, " + fail + " fail");
process.exit(fail === 0 ? 0 : 1);
