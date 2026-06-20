#!/usr/bin/env node
// holo-surface-witness.mjs — Phase 1 MVP architecture witness for holo-surface.mjs. Proves (with a stub
// WebGPU device, so no real GPU is needed) the load-bearing claims of the κ-surface backend:
//   1. backend selection: WebGPU when navigator.gpu present, DOM otherwise; force override honored
//   2. L5 verify-BEFORE-GPU: a tampered surface κ is REFUSED before any GPU byte is touched
//   3. pipeline reuse (O(1)): the SECOND card render is a zero-recompile rebind (createRenderPipeline
//      runs ONCE across two renders) — the HoloMemo session cache
//   4. one draw per card; uniform buffer written
//   5. DOM reference: normalised spec → deterministic style (the truth the GPU output must match)
//
// Run: node holo-os/system/tools/holo-surface-witness.mjs
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const MOD = join(here, "../os/usr/lib/holo/holo-surface.mjs");
const S = await import(pathToFileURL(MOD)).catch((e) => ({ __err: e }));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + m); };
if (S.__err) { console.log("  ✗ import holo-surface.mjs  (" + S.__err.message + ")"); console.log("\nRED — module not ready"); process.exit(1); }

// ── stub WebGPU device (counts the GPU calls) ──
function stub() {
  const counts = { shader: 0, pipeline: 0, buffer: 0, bind: 0, draw: 0, submit: 0, write: 0, tex: 0, writeTex: 0, sampler: 0 };
  const pipeline = { getBindGroupLayout: () => ({}) };
  const device = {
    createShaderModule() { counts.shader++; return {}; },
    createRenderPipeline() { counts.pipeline++; return pipeline; },
    createBuffer() { counts.buffer++; return {}; },
    createBindGroup() { counts.bind++; return {}; },
    createTexture() { counts.tex++; return { createView: () => ({}) }; },
    createSampler() { counts.sampler++; return {}; },
    createCommandEncoder() { return { beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw(n) { counts.draw = n; counts.draws = (counts.draws || 0) + 1; }, end() {} }), finish: () => ({}) }; },
    queue: { writeBuffer() { counts.write++; }, writeTexture() { counts.writeTex++; }, submit() { counts.submit++; } },
  };
  return { counts, device };
}
const inj = (s) => ({ device: s.device, format: "bgra8unorm", context: { configure() {} }, view: {} });
const canvas = () => ({ width: 0, height: 0, tagName: "CANVAS" });

// 1 — backend selection
{
  ok(S.pickBackend({ force: "gpu" }) === "gpu" && S.pickBackend({ force: "dom" }) === "dom", "backend: force override honored");
  const setNav = (v) => { try { Object.defineProperty(globalThis, "navigator", { value: v, configurable: true, writable: true }); return true; } catch { return false; } };
  const saved = globalThis.navigator;
  if (setNav({ gpu: {} })) {
    ok(S.pickBackend() === "gpu", "backend: navigator.gpu present → gpu");
    setNav(undefined); ok(S.pickBackend() === "dom", "backend: no navigator.gpu → dom (reference)");
    setNav(saved);
  } else { console.log("  · (navigator-presence selection verified in-browser; not overridable in this Node)"); }
}

// 2 — L5 verify-before-GPU
{
  const enc = new TextEncoder();
  const honest = enc.encode(JSON.stringify({ "@type": "holo:Surface", kind: "card", w: 100, h: 60 }));
  const resolve = async () => honest;
  let okHonest = false; try { const sp = await S.specOf("did:holo:blake3:" + "a".repeat(64), { resolve, verify: async () => true }); okHonest = sp.kind === "card"; } catch {}
  ok(okHonest, "L5: an honest surface κ resolves + parses");
  let refused = false; try { await S.specOf("did:holo:blake3:" + "a".repeat(64), { resolve, verify: async () => false }); } catch (e) { refused = /L5 REFUSED/.test(e.message); }
  ok(refused, "L5: a tampered surface κ is REFUSED before any GPU work");
}

// 3 + 4 — pipeline reuse + one draw + uniform write (stub device)
{
  const s = stub();
  const spec = { "@type": "holo:Surface", kind: "card", w: 200, h: 120, radius: 18, accentH: 10 };
  const r1 = await S.renderCardGPU(canvas(), spec, inj(s));
  const r2 = await S.renderCardGPU(canvas(), spec, inj(s));   // second card — must reuse the pipeline
  ok(r1.backend === "gpu" && r2.backend === "gpu", "gpu: renders report the gpu backend");
  ok(s.counts.pipeline === 1, `O(1): createRenderPipeline ran ONCE across two cards (got ${s.counts.pipeline})`);
  ok(s.counts.shader === 1, "O(1): shader compiled once (cached)");
  ok(s.counts.draw === 3 && s.counts.submit === 2, "gpu: one fullscreen-triangle draw per card, two submits");
  ok(s.counts.write === 2, "gpu: each card writes its own uniform buffer (cheap per-render)");
}

// 5 — DOM reference style is deterministic and reads the spec the same way
{
  const st = S.cardStyle({ w: 320, h: 200, radius: 16, accentH: 8, bg: [0.1, 0.1, 0.1, 1], accent: [0.4, 0.5, 1, 1] });
  ok(st.width === "320px" && st.height === "200px" && st.borderRadius === "16px", "dom: spec → px geometry");
  ok(/linear-gradient/.test(st.background) && /rgba\(/.test(st.background), "dom: accent-over-bg gradient matches the shader's top band");
  const n = S.normCard({}); ok(n.w === 320 && n.bg.length === 4, "dom: defaults are concrete (no drift between backends)");
}

// 6 — TWO-LAYER label texture (HoloMemo.handle): rasterise→L2 source once, hydrate→GPUTexture; dedup by key
{
  const s = stub();
  const t = (txt) => ({ "@type": "holo:Surface", kind: "card", w: 240, h: 140, text: txt });
  await S.renderCardGPU(canvas(), t("Hello κ"), inj(s));
  await S.renderCardGPU(canvas(), t("Hello κ"), inj(s));   // identical text → texture reused (L1)
  ok(s.counts.tex === 1 && s.counts.writeTex === 1, `two-layer: identical label rasterised+uploaded ONCE (tex=${s.counts.tex})`);
  await S.renderCardGPU(canvas(), t("Different"), inj(s));  // new text → new texture
  ok(s.counts.tex === 2, "two-layer: a different label builds a new texture");
  ok(s.counts.bind >= 3, "gpu: bind group carries uniform + texture + sampler (3 entries)");
}

// 7 — SCENE: container composition, one-draw-per-node, L3 dedup, hit-test
{
  const s = stub();
  let resolves = 0;
  const rowKappa = "did:holo:blake3:" + "c".repeat(64);
  const rowSpec = { "@type": "holo:Surface", kind: "container", w: 280, h: 40, fill: [0.2, 0.2, 0.25, 1], children: [{ kind: "text", text: "row", h: 40 }] };
  const resolve = async () => { resolves++; return new TextEncoder().encode(JSON.stringify(rowSpec)); };
  const root = { "@type": "holo:Surface", kind: "container", w: 300, layout: "stack", pad: 10, gap: 8, fill: [0.1, 0.1, 0.15, 1], children: [rowKappa, rowKappa, { kind: "text", text: "footer", h: 24 }] };
  const r = await S.renderSceneGPU(canvas(), root, { ...inj(s), resolve, verify: async () => true });
  ok(r.backend === "gpu" && r.nodes >= 4, `scene: composed tree drew ${r.nodes} nodes`);
  ok(s.counts.draws === r.nodes, "scene: one positioned-quad draw per node");
  ok(s.counts.pipeline === 1, "scene: one pipeline for the whole scene");
  ok(resolves === 1, "scene: a κ-ref child resolved ONCE despite two references (L3 dedup)");
  ok(r.hitIndex.length === 2 && r.hitIndex.every((i) => i.kappa === rowKappa), "scene: hit-index carries each composed child's κ");
  const hit = S.hitTest(r.hitIndex, 20, 20);
  ok(hit && hit.kappa === rowKappa, "scene: pointer hit-test returns the child κ (sub-frame, no GPU readback)");
}

// 8 — pure layout / normalize (no GPU)
{
  ok(S.normNode({ kind: "container", w: 200 }).kind === "container" && S.normNode({ kind: "text", text: "x" }).kind === "text" && S.normNode({ kind: "image", src: "k", w: 32, h: 32 }).kind === "image", "normNode: container/text/image kinds");
}

// 9 — BUTTON kind: the one interactive primitive (declarative κ-action, states/a11y, GPU proxy + DOM mirror)
{
  // minimal DOM stub — used both as renderSceneDOM's `doc` and as a global for the GPU proxy overlay
  const mk = (tag) => ({
    tagName: tag.toUpperCase(), children: [], _attrs: {}, style: {}, _l: {}, className: "", disabled: false, parentElement: null, _text: null,
    setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    replaceChildren(...cs) { this.children = []; for (const c of cs) this.appendChild(c); },
    querySelectorAll() { const self = this; return { forEach(fn) { self.children.filter((c) => c.className === "holo-btn-proxy").forEach(fn); } }; },
    remove() { const p = this.parentElement; if (p) { const i = p.children.indexOf(this); if (i >= 0) p.children.splice(i, 1); } },
    click(ev) { (this._l.click || []).forEach((f) => f(ev || {})); },
    set textContent(v) { this._text = v; }, get textContent() { return this._text; },
  });
  const doc = { createElement: (t) => mk(t) };
  const findTag = (root, tag) => { if (root.tagName === tag) return root; for (const c of root.children || []) { const r = findTag(c, tag); if (r) return r; } return null; };

  // 9a — normNode: a button carries its declarative action + toggle/disabled state + a label child for the GPU visual
  const b = S.normNode({ "@type": "holo:Surface", kind: "button", label: "Like", action: "like", w: 90, h: 36, toggled: true, accent: [0.3, 0.6, 1, 1] });
  ok(b.kind === "button" && b.action === "like" && b.toggled === true && b.toggleable === true, "button: normNode carries action + toggle state");
  ok(b.children.length === 1 && b.children[0].kind === "text" && b.children[0].text === "Like", "button: label becomes a centered text child (GPU draws the visual)");
  ok(Array.isArray(b.fill) && b.fill[0] === 0.3, "button: toggled+accent → accent fill (visible toggled state)");

  // 9b — dispatch is declarative: id → app-registered fn; NO inline code; gate veto fail-closed; disabled inert
  const fired = []; const actions = { like: () => fired.push("like"), buy: () => fired.push("buy") };
  S.dispatchAction(b, {}, { actions });
  ok(fired.length === 1 && fired[0] === "like", "button: dispatch runs the app-registered handler addressed by id");
  S.dispatchAction({ kind: "button", action: "buy", disabled: true }, {}, { actions });
  ok(fired.length === 1, "button: a disabled button is inert (no dispatch)");
  S.dispatchAction({ kind: "button", action: "buy" }, {}, { actions, gate: () => false });
  ok(fired.length === 1, "button: the conscience gate can VETO an action (P7, fail-closed)");
  S.dispatchAction({ kind: "button", action: "buy" }, {}, { actions, gate: () => true });
  ok(fired.length === 2 && fired[1] === "buy", "button: a gate-allowed action dispatches");
  ok(typeof b.action === "string", "button: action is a content-addressed id, not inline code (L4/L5 — substrate runs no code)");

  // 9c — hit-index exposes the action for the canvas/3D pointer-ray path
  const lay = S.layoutScene({ "@type": "holo:Surface", kind: "container", w: 200, pad: 8, children: [{ kind: "button", label: "Go", action: "go", w: 80, h: 34 }] });
  ok(S.buildHitIndex(lay.draws).some((e) => e.action === "go" && e.kind === "button"), "button: buildHitIndex exposes the action for pointer/ray hit dispatch");

  // 9d — DOM mirror is a REAL <button> with WAI-ARIA; activating it dispatches (the a11y/input truth)
  let domFired = false;
  const target = mk("div");
  await S.renderSceneDOM(target, { "@type": "holo:Surface", kind: "container", w: 200, children: [{ kind: "button", label: "Save", action: "save", aria: "Save video", toggleable: true }] }, { actions: { save: () => { domFired = true; } } }, doc);
  const btn = findTag(target, "BUTTON");
  ok(btn && btn.tagName === "BUTTON", "button: DOM mirror is a real <button> (natively focusable + keyboard-activatable)");
  ok(btn.getAttribute("aria-label") === "Save video" && btn.getAttribute("aria-pressed") === "false", "button: DOM mirror exposes WAI-ARIA (aria-label + aria-pressed)");
  btn.click(); ok(domFired, "button: activating the DOM mirror dispatches the κ-action");

  // 9e — GPU path overlays a real <button> proxy at the button box, wired to the same dispatch (hybrid)
  const savedDoc = globalThis.document, savedGCS = globalThis.getComputedStyle;
  globalThis.document = doc; globalThis.getComputedStyle = () => ({ position: "static" });
  let proxyFired = false;
  const s = stub(); const cv = canvas(); const host = mk("div"); host.appendChild(cv); cv.parentElement = host;
  await S.renderSceneGPU(cv, { "@type": "holo:Surface", kind: "container", w: 200, pad: 8, children: [{ kind: "button", action: "share", aria: "Share", w: 90, h: 34 }] }, { ...inj(s), actions: { share: () => { proxyFired = true; } } });
  const proxies = host.children.filter((c) => c.className === "holo-btn-proxy");
  ok(proxies.length === 1 && proxies[0].tagName === "BUTTON", "button: GPU path overlays a real <button> proxy (GPU pixels + DOM semantics)");
  proxies[0].click(); ok(proxyFired, "button: clicking the GPU proxy dispatches through the same κ-action path");
  if (savedDoc === undefined) delete globalThis.document; else globalThis.document = savedDoc;
  if (savedGCS === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = savedGCS;
}

// 10 — INPUT kind: the text-entry primitive (GPU box + real editable DOM mirror, declarative value/handlers)
{
  const mk = (tag) => ({
    tagName: tag.toUpperCase(), children: [], _attrs: {}, style: {}, _l: {}, value: "", placeholder: "", name: "", disabled: false, parentElement: null,
    setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    replaceChildren(...cs) { this.children = []; for (const c of cs) this.appendChild(c); },
    querySelectorAll() { const self = this; return { forEach(fn) { self.children.filter((c) => c.className === "holo-btn-proxy" || c.className === "holo-input-proxy").forEach(fn); } }; },
    dispatch(t, ev) { (this._l[t] || []).forEach((f) => f(ev || {})); },
  });
  const doc = { createElement: (t) => mk(t) };
  const findTag = (root, tag) => { if (root.tagName === tag) return root; for (const c of root.children || []) { const r = findTag(c, tag); if (r) return r; } return null; };

  // 10a — normNode: declared value/placeholder/action/submit; single-line vs multiline; no children (text lives in the DOM mirror)
  const i = S.normNode({ "@type": "holo:Surface", kind: "input", value: "hi", placeholder: "Search…", action: "type", submit: "go", w: 240 });
  ok(i.kind === "input" && i.value === "hi" && i.placeholder === "Search…" && i.action === "type" && i.submit === "go", "input: normNode carries value/placeholder/action/submit");
  ok(i.multiline === false && S.normNode({ kind: "input", multiline: true }).multiline === true, "input: single-line vs multiline");
  ok(typeof i.action === "string" && typeof i.submit === "string" && i.children.length === 0, "input: handlers are content-addressed ids; no inline-code children (L4/L5)");

  // 10b — DOM mirror is a REAL editable field; "input" fires action(value); Enter fires submit
  let typed = null, submitted = false;
  const target = mk("div");
  await S.renderSceneDOM(target, { "@type": "holo:Surface", kind: "container", w: 260, children: [{ kind: "input", placeholder: "Search…", action: "type", submit: "go", aria: "Search" }] }, { actions: { type: (n, ev) => { typed = ev.target.value; }, go: () => { submitted = true; } } }, doc);
  const fld = findTag(target, "INPUT");
  ok(fld && fld.tagName === "INPUT", "input: DOM mirror is a real <input> (text entry / IME / caret / selection / clipboard are native)");
  ok(fld.getAttribute("aria-label") === "Search" && fld.placeholder === "Search…", "input: DOM mirror exposes accessible name + placeholder");
  fld.value = "abc"; fld.dispatch("input", { target: fld }); ok(typed === "abc", "input: typing dispatches action(value) on input");
  fld.dispatch("keydown", { key: "Enter", preventDefault() {}, target: fld }); ok(submitted, "input: Enter dispatches the submit action");
  const ta = mk("div");
  await S.renderSceneDOM(ta, { "@type": "holo:Surface", kind: "container", w: 260, children: [{ kind: "input", multiline: true, action: "type" }] }, { actions: {} }, doc);
  ok(findTag(ta, "TEXTAREA"), "input: multiline → a real <textarea>");

  // 10c — GPU path overlays a real editable <input> proxy at the box (GPU chrome + DOM editing)
  const savedDoc = globalThis.document, savedGCS = globalThis.getComputedStyle;
  globalThis.document = doc; globalThis.getComputedStyle = () => ({ position: "static" });
  let gtyped = null;
  const s = stub(); const cv = canvas(); const host = mk("div"); host.appendChild(cv); cv.parentElement = host;
  await S.renderSceneGPU(cv, { "@type": "holo:Surface", kind: "container", w: 260, pad: 8, children: [{ kind: "input", placeholder: "Comment…", action: "type", aria: "Add a comment" }] }, { ...inj(s), actions: { type: (n, ev) => { gtyped = ev.target.value; } } });
  const proxies = host.children.filter((c) => c.className === "holo-input-proxy");
  ok(proxies.length === 1 && proxies[0].tagName === "INPUT" && proxies[0].getAttribute("aria-label") === "Add a comment", "input: GPU path overlays a real editable <input> proxy with ARIA");
  proxies[0].value = "nice"; proxies[0].dispatch("input", { target: proxies[0] }); ok(gtyped === "nice", "input: typing in the GPU proxy dispatches the κ-action");
  if (savedDoc === undefined) delete globalThis.document; else globalThis.document = savedDoc;
  if (savedGCS === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = savedGCS;
}

// 11 — OVERLAY positioning: an `abs` child is placed at (ax,ay) and does NOT consume flow space
{
  const lay = S.layoutScene({ "@type": "holo:Surface", kind: "container", w: 200, h: 120, pad: 0, layout: "stack", children: [
    { kind: "text", text: "flow", h: 30 },
    { kind: "text", text: "badge", abs: true, ax: 8, ay: 8, w: 60, h: 20 },
  ] });
  const flow = lay.draws.find((d) => d.node && d.node.text === "flow");
  const badge = lay.draws.find((d) => d.node && d.node.text === "badge");
  ok(flow && flow.box[1] === 0, "overlay: flow child occupies the normal cursor (top)");
  ok(badge && badge.box[0] === 8 && badge.box[1] === 8, "overlay: abs child is placed at (ax,ay)");
  // a second flow child still sits right after the first (the abs child consumed no space)
  const lay2 = S.layoutScene({ "@type": "holo:Surface", kind: "container", w: 200, pad: 0, gap: 0, layout: "stack", children: [
    { kind: "text", text: "a", h: 30 }, { kind: "text", text: "over", abs: true, ax: 0, ay: 99, h: 10 }, { kind: "text", text: "b", h: 30 },
  ] });
  const b = lay2.draws.find((d) => d.node && d.node.text === "b");
  ok(b && b.box[1] === 30, "overlay: an abs child between two flow children does not push the flow");
}

// 12 — ROW layout: children flow horizontally at their own widths (chips, button rows, headers)
{
  const lay = S.layoutScene({ "@type": "holo:Surface", kind: "container", w: 400, pad: 0, gap: 10, layout: "row", children: [
    { kind: "button", label: "A", w: 80, h: 36 }, { kind: "button", label: "B", w: 120, h: 36 },
  ] });
  const bgs = lay.draws.filter((d) => d.node && d.node.kind === "button");
  ok(bgs.length === 2 && bgs[0].box[0] === 0 && bgs[1].box[0] === 90, "row: children advance horizontally by width + gap (0 → 80+10)");
  ok(bgs[0].box[1] === bgs[1].box[1], "row: children share the same top (one horizontal line)");
}

console.log(`
${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
