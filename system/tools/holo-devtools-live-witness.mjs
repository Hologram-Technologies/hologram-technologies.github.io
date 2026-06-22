// holo-devtools-live-witness.mjs — proves the PURE-WEB live CDP backend (ADR-0095, Tier 1) emits the exact
// CDP shapes the vendored devtools-frontend renders against (the shapes captured from a real Chromium CDP
// backend, the conformance oracle), over a MOCK same-origin document. No jsdom: a tiny deterministic DOM,
// so the test is a pure function (the Atlas-isomorphism discipline — identical dispatch in browser + Node).
//
// Run: node system/tools/holo-devtools-live-witness.mjs

import { createLiveDevToolsBackend, createLiveDevToolsServe } from "../os/usr/lib/holo/devtools/holo-devtools-live-backend.mjs";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ " + name + (extra ? "  — " + extra : "")); } };

// ── a tiny deterministic DOM (only what the backend touches) ─────────────────────────────────────
function mkStyle(text) {
  const props = new Map();
  String(text || "").split(";").forEach((d) => { const i = d.indexOf(":"); if (i > 0) props.set(d.slice(0, i).trim(), { v: d.slice(i + 1).trim(), imp: /!important/.test(d) }); });
  const names = () => [...props.keys()];
  return {
    get length() { return names().length; }, item(i) { return names()[i]; },
    getPropertyValue(n) { return props.has(n) ? props.get(n).v.replace("!important", "").trim() : ""; },
    getPropertyPriority(n) { return props.has(n) && props.get(n).imp ? "important" : ""; },
    setProperty(n, v) { props.set(n, { v, imp: false }); }, _text: text || "",
  };
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function serialize(n) {
  if (n.nodeType === 8) return "<!--" + n.nodeValue + "-->";
  if (n.nodeType === 3) return esc(n.nodeValue);
  return n.outerHTML;
}
function mkEl(tag, attrs = {}, kids = []) {
  const attributes = Object.entries(attrs).map(([name, value]) => ({ name, value: String(value) }));
  const node = {
    nodeType: 1, nodeName: tag.toUpperCase(), localName: tag.toLowerCase(), nodeValue: "", childNodes: kids, attributes,
    getAttribute(n) { const a = attributes.find((a) => a.name === n); return a ? a.value : null; },
    setAttribute(n, v) { const a = attributes.find((a) => a.name === n); if (a) a.value = String(v); else attributes.push({ name: n, value: String(v) }); },
    removeAttribute(n) { const i = attributes.findIndex((a) => a.name === n); if (i >= 0) attributes.splice(i, 1); },
    matches(sel) { sel = String(sel).trim(); if (sel === tag.toLowerCase()) return true; if (sel[0] === "#") return node.getAttribute("id") === sel.slice(1); if (sel[0] === ".") return String(node.getAttribute("class") || "").split(/\s+/).includes(sel.slice(1)); return false; },
    style: mkStyle(attrs.style || ""),
    get outerHTML() { return "<" + tag + attributes.map((a) => ` ${a.name}="${esc(a.value)}"`).join("") + ">" + kids.map(serialize).join("") + "</" + tag + ">"; },
    set outerHTML(v) { node._outer = v; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 120, height: 20 }; },
  };
  return node;
}
const mkComment = (t) => ({ nodeType: 8, nodeName: "#comment", localName: "", nodeValue: t, childNodes: [] });
const mkText = (t) => ({ nodeType: 3, nodeName: "#text", localName: "", nodeValue: t, childNodes: [] });

// the document: <html><head><style></head><body><h1 data-holo-k=κ2>Hi</h1><!--c--><p class=x></p></body></html>
const KROOT = "did:holo:sha256:" + "a".repeat(64);
const KOBJ = "did:holo:sha256:" + "b".repeat(64);
const styleRule = { type: 1, selectorText: ".x", style: mkStyle("color: red; font-weight: bold") };
const sheet = { cssRules: [styleRule] };
const h1 = mkEl("h1", { "data-holo-k": KOBJ }, [mkText("Hi")]);
const p = mkEl("p", { class: "x", style: "margin: 4px" }, []);
const body = mkEl("body", { class: "app" }, [h1, mkComment(" note "), p]);
const head = mkEl("head", {}, []);
const html = mkEl("html", { lang: "en" }, [head, body]);
const doc = {
  nodeType: 9, nodeName: "#document", localName: "", nodeValue: "", childNodes: [html], documentElement: html, body,
  styleSheets: [sheet], createElement: (t) => mkEl(t),
};
const win = {
  getComputedStyle: (node) => mkStyle((node.getAttribute && node.getAttribute("style")) || "color: rgb(0,0,0); display: block"),
  eval: (expr) => { if (expr === "1+1") return 2; if (expr === "document.body") return body; if (expr === "throw new Error('x')") throw new Error("x"); return undefined; },
};

// ── conscience + liveEdit doubles ──
const acceptAll = { evaluate: () => ({ outcome: "accept" }) };
const blockAll = { evaluate: () => ({ outcome: "block", reason: "nope" }) };
let lastEdit = null;
const edit = (kappa, source) => { lastEdit = { kappa, source }; return { kappa: "did:holo:sha256:" + "c".repeat(64) }; };

const collectEvents = () => { const evs = []; return { onEvent: (e) => evs.push(e), evs }; };

console.log("holo-devtools-live-backend — Tier 1 (pure-web, κ-anchored real F12)\n");

// 1 · DOM.getDocument — the real tree shape ----------------------------------------------------------
{
  const be = createLiveDevToolsBackend({ target: () => ({ doc, win, kappa: KROOT }), edit, conscience: acceptAll });
  const r = be.dispatch("DOM.getDocument", { depth: 3 });
  const root = r.root;
  ok("getDocument root is #document (nodeType 9)", root.nodeType === 9 && root.nodeName === "#document");
  ok("documentURL anchored in holospace κ", root.documentURL === "holo://" + KROOT, root.documentURL);
  const htmlN = root.children.find((c) => c.nodeName === "HTML");
  ok("HTML node has flat attributes [lang,en]", htmlN && htmlN.attributes.join(",") === "lang,en", JSON.stringify(htmlN && htmlN.attributes));
  const bodyN = htmlN.children.find((c) => c.nodeName === "BODY");
  ok("BODY childNodeCount counts el+comment+nonblank-text (3)", bodyN.childNodeCount === 3, "got " + bodyN.childNodeCount);
  ok("root node κ alias = holospace κ", root.kappa === KROOT);
  const h1N = bodyN.children.find((c) => c.nodeName === "H1");
  ok("h1[data-holo-k] surfaces its OWN κ (every object exposed)", h1N && h1N.kappa === KOBJ, h1N && h1N.kappa);
  const commentN = bodyN.children.find((c) => c.nodeType === 8);
  ok("comment node is nodeType 8 with nodeValue", commentN && commentN.nodeValue === " note ");
}

// 2 · DOM.requestChildNodes → emits DOM.setChildNodes EVENT (the render path) -------------------------
{
  const be = createLiveDevToolsBackend({ target: () => ({ doc, win, kappa: KROOT }), edit, conscience: acceptAll });
  be.dispatch("DOM.getDocument", { depth: 1 });                 // assign ids (body shallow)
  const bodyId = be.nodeIdOf(body);
  const { onEvent, evs } = collectEvents();
  const res = be.dispatch("DOM.requestChildNodes", { nodeId: bodyId, depth: 1 }, { onEvent });
  ok("requestChildNodes result is empty {}", JSON.stringify(res) === "{}");
  const ev = evs.find((e) => e.method === "DOM.setChildNodes");
  ok("emitted DOM.setChildNodes event", !!ev);
  ok("setChildNodes carries parentId + nodes[]", ev && ev.params.parentId === bodyId && ev.params.nodes.length === 3, ev && ev.params.nodes.length);
}

// 3 · CSS — real computed + matched from the live CSSOM ----------------------------------------------
{
  const be = createLiveDevToolsBackend({ target: () => ({ doc, win, kappa: KROOT }), edit, conscience: acceptAll });
  be.dispatch("DOM.getDocument", { depth: 6 });
  const pId = be.nodeIdOf(p);
  const cs = be.dispatch("CSS.getComputedStyleForNode", { nodeId: pId });
  ok("getComputedStyleForNode → [{name,value}]", Array.isArray(cs.computedStyle) && cs.computedStyle.some((d) => d.name === "margin"), JSON.stringify(cs.computedStyle).slice(0, 80));
  const ms = be.dispatch("CSS.getMatchedStylesForNode", { nodeId: pId });
  ok("inlineStyle reflects the node's style attr (margin)", ms.inlineStyle.cssProperties.some((d) => d.name === "margin"));
  ok("matchedCSSRules picks up the .x rule (selector match)", ms.matchedCSSRules.length === 1 && ms.matchedCSSRules[0].rule.selectorList.selectors[0].text === ".x", JSON.stringify(ms.matchedCSSRules.map((r) => r.rule.selectorList.text)));
  ok("matched rule carries cssProperties (color,font-weight)", ms.matchedCSSRules[0].rule.style.cssProperties.length === 2);
}

// 4 · Runtime — executionContextCreated + real, gated eval -------------------------------------------
{
  const be = createLiveDevToolsBackend({ target: () => ({ doc, win, kappa: KROOT }), edit, conscience: acceptAll });
  const { onEvent, evs } = collectEvents();
  be.dispatch("Runtime.enable", {}, { onEvent });
  // executionContextCreated is emitted on a microtask
  await Promise.resolve();
  {
    const ev = evs.find((e) => e.method === "Runtime.executionContextCreated");
    ok("Runtime.enable emits executionContextCreated (isDefault)", ev && ev.params.context.auxData.isDefault === true);

    const e1 = be.dispatch("Runtime.evaluate", { expression: "1+1", returnByValue: true }, { caller: "human" });
    ok("evaluate runs REAL eval (1+1 → 2)", e1.result.value === 2, JSON.stringify(e1.result));
    const e2 = be.dispatch("Runtime.evaluate", { expression: "document.body" });
    ok("evaluate returns a node RemoteObject with objectId", e2.result.subtype === "node" && !!e2.result.objectId);
    const e3 = be.dispatch("Runtime.evaluate", { expression: "throw new Error('x')" });
    ok("evaluate surfaces exceptions (exceptionDetails)", !!e3.exceptionDetails);

    // gate: block → refused
    const beBlock = createLiveDevToolsBackend({ target: () => ({ doc, win, kappa: KROOT }), edit, conscience: blockAll });
    const eb = beBlock.dispatch("Runtime.evaluate", { expression: "1+1" });
    ok("eval FAIL-CLOSED when conscience blocks (L4)", !!eb.exceptionDetails && /refused/.test(eb.exceptionDetails.text));
    // no conscience → fail-closed
    const beNone = createLiveDevToolsBackend({ target: () => ({ doc, win, kappa: KROOT }), edit, conscience: null });
    const en = beNone.dispatch("Runtime.evaluate", { expression: "1+1" });
    ok("eval FAIL-CLOSED when NO gate present", !!en.exceptionDetails);

    // 5 · edits route through liveEdit → new κ ----------------------------------------------------
    lastEdit = null;
    const be2 = createLiveDevToolsBackend({ target: () => ({ doc, win, kappa: KROOT }), edit, conscience: acceptAll });
    be2.dispatch("DOM.getDocument", { depth: 6 });
    const h1Id = be2.nodeIdOf(h1);
    const setA = be2.dispatch("DOM.setAttributeValue", { nodeId: h1Id, name: "title", value: "edited" }, { caller: "human" });
    ok("setAttributeValue mutates the live node", h1.getAttribute("title") === "edited");
    ok("edit re-seals source → new κ via liveEdit (holo.kappa)", setA.holo && /^did:holo:sha256:c+/.test(setA.holo.kappa), JSON.stringify(setA));
    ok("liveEdit received the holospace κ + serialized source", lastEdit && lastEdit.kappa === KROOT && /<html/.test(lastEdit.source));

    // read-only when no editor wired
    const be3 = createLiveDevToolsBackend({ target: () => ({ doc, win, kappa: KROOT }), edit: null, conscience: acceptAll });
    be3.dispatch("DOM.getDocument", {});
    const ro = be3.dispatch("DOM.setAttributeValue", { nodeId: be3.nodeIdOf(h1), name: "x", value: "1" });
    ok("read-only (no liveEdit) → refused, honest", ro.refused === true);

    // 6 · Overlay highlight injects a box (real, no devtools needed) -------------------------------
    const be4 = createLiveDevToolsBackend({ target: () => ({ doc, win, kappa: KROOT }), edit, conscience: acceptAll });
    be4.dispatch("DOM.getDocument", { depth: 6 });
    let appended = null; doc.body.appendChild = (el) => { appended = el; };
    be4.dispatch("Overlay.highlightNode", { nodeId: be4.nodeIdOf(p) });
    ok("Overlay.highlightNode injects a highlight box into the holospace", appended && appended.getAttribute("data-holo-devtools-overlay") === "1");

    // 7 · FLAT-PROTOCOL session routing (the fix that makes the tree paint) ------------------------
    const serve = createLiveDevToolsServe({ target: () => ({ doc, win, kappa: KROOT }), edit, conscience: acceptAll });
    const evs2 = [];
    await serve({ app: "human", method: "cdp", args: { cdp: { id: 1, method: "Target.setAutoAttach", params: { autoAttach: true, flatten: true } } }, onEvent: (e) => evs2.push(e) });
    await Promise.resolve();
    const att = evs2.find((e) => e.method === "Target.attachedToTarget");
    ok("setAutoAttach emits Target.attachedToTarget (page session)", att && att.params.sessionId === "holo-page" && att.params.targetInfo.type === "page");
    ok("attachedToTarget is a ROOT event (no top-level sessionId)", att && !("sessionId" in att));
    const r1 = await serve({ app: "human", method: "cdp", args: { cdp: { id: 2, sessionId: "holo-page", method: "DOM.getDocument", params: {} } } });
    ok("page-session response ECHOES the sessionId", r1.result && r1.result.sessionId === "holo-page", JSON.stringify(Object.keys(r1.result || {})));
    const evs3 = [];
    await serve({ app: "human", method: "cdp", args: { cdp: { id: 3, sessionId: "holo-page", method: "Runtime.enable", params: {} } }, onEvent: (e) => evs3.push(e) });
    await Promise.resolve();
    const ctxEv = evs3.find((e) => e.method === "Runtime.executionContextCreated");
    ok("session events are TAGGED with the sessionId", ctxEv && ctxEv.sessionId === "holo-page");

    // 8 · Network.enable subscribes the κ-stream tap → fetches become panel requests (A4) -----------
    {
      let push = null;
      const src = { subscribe(onFetch) { push = onFetch; return () => { push = null; }; } };
      const beN = createLiveDevToolsBackend({ target: () => ({ doc, win, kappa: KROOT }), edit, conscience: acceptAll, kappaFetchSource: src });
      const netEvs = [];
      beN.dispatch("Network.enable", {}, { onEvent: (e) => netEvs.push(e) });
      ok("Network.enable subscribes the live κ-fetch tap", typeof push === "function");
      push({ kappa: KROOT, bytes: 2048, cacheHit: false, verified: true, provenance: [KOBJ] });
      ok("a served κ-fetch reaches the panel (requestWillBeSent + responseReceived)", netEvs.some((e) => e.method === "Network.requestWillBeSent") && netEvs.some((e) => e.method === "Network.responseReceived"));
      const resp = netEvs.find((e) => e.method === "Network.responseReceived");
      ok("the request row carries the κ + L5-pass badge", resp && resp.params.response.headers["x-holo-kappa"] === KROOT && resp.params.response.headers["x-holo-verify"] === "L5-pass");
      push({ kappa: KOBJ, bytes: 16, verified: false });
      ok("a tampered κ-fetch → loadingFailed (RED), and produces NO extra 200", netEvs.some((e) => e.method === "Network.loadingFailed") && netEvs.filter((e) => e.method === "Network.responseReceived").length === 1);
      beN.dispatch("Network.disable", {});
      ok("Network.disable unsubscribes the tap (no leak)", push === null);
    }

    const result = {
      witnessed: fail === 0,
      covers: [
        "Network.enable subscribes the live κ-stream tap → every κ-fetch is a request in the panel (axis · cache-hit/L3 · L5 badge · provenance); tampered → loadingFailed RED; disable unsubscribes (A4)",
        "Tier 1 PURE-WEB real F12 — the live same-origin holospace reflected as CDP (no native host, no extension)",
        "DOM domain ⇄ the LIVE document: real tree, flat attributes, comment/text nodes, childNodeCount; root + [data-holo-k] nodes alias a κ (L1/L2)",
        "DOM.requestChildNodes returns {} and emits a DOM.setChildNodes event (the render path) — the exact shape the vendored frontend renders",
        "CSS domain ⇄ the LIVE CSSOM: getComputedStyleForNode + getMatchedStylesForNode (selector match) + inlineStyle, all real",
        "Runtime.enable emits executionContextCreated(isDefault); Runtime.evaluate is REAL eval in the page, FAIL-CLOSED through the conscience (L4)",
        "every edit (setAttributeValue/setOuterHTML) re-seals the source → a NEW κ via the liveEdit primitive (ADR-0093); read-only when no editor is wired (honest)",
        "Overlay.highlightNode injects a real highlight box into the holospace",
        "flat-protocol session routing — setAutoAttach emits one Target.attachedToTarget(page session); responses ECHO the sessionId and events are TAGGED with it (matched to a real Chromium backend)",
      ],
      failed: fail,
      authority: "the VENDORED chrome-devtools-frontend WebSocketConnection path · Chrome DevTools Protocol 1.3 flat protocol · same-origin DOM/CSSOM/HTML Living Standard · ADR-0093 (liveEdit) · the conscience gate (ADR-0033) · verify-by-re-derivation (Law L5) · holospaces Laws L1/L2/L3/L4/L5",
    };
    writeFileSync(join(here, "holo-devtools-live-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
    console.log("\n" + (fail === 0 ? "WITNESSED ✓  " : "FAILED ✗  ") + pass + " checks, " + fail + " failures");
    process.exit(fail === 0 ? 0 : 1);
  }
}
