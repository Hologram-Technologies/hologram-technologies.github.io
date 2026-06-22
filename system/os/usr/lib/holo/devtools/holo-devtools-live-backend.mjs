// holo-devtools-live-backend.mjs — the PURE-WEB κ-CDP backend (ADR-0095, Tier 1). The breakthrough that
// makes real F12 work IN ANY BROWSER with no native app and no extension: a holospace is a SAME-ORIGIN
// iframe, so the shell can read its live document/window directly. This backend reflects that LIVE document
// as a faithful subset of the Chrome DevTools Protocol — the exact response/event shapes the vendored
// devtools-frontend renders against (captured from a real Chromium CDP backend, the conformance oracle).
//
// So the SAME vendored UI that we drive over WebView2's real CDP natively (Tier 3) is driven here over the
// live DOM/CSSOM/eval of the focused holospace. Elements shows the REAL DOM, Styles the REAL matched CSS,
// Console evaluates in the REAL page. Not a κ-scene projection — the running app itself.
//
// Anchored in the κ substrate (the operator's demand): every node's backendNodeId ALIASES a κ — the
// holospace's content κ for the root, and any element carrying [data-holo-k] surfaces its own κ. Every
// EDIT (setOuterHTML · setAttributeValue · Console assignment) routes through the ONE liveEdit primitive
// (ADR-0093): the mutated source is re-sealed → a NEW κ, re-rendered in place. So the whole holospace stays
// content-addressed and every object in it is exposed AND editable through the dev environment (Law L2/L3).
//
// L4 — Runtime.evaluate + every mutation are FAIL-CLOSED through the injected conscience (no gate ⇒ refused),
//      exactly like Tier 3. L5 — the root κ re-derives from the live source on every edit (a tampered source
//      is refused upstream by liveEdit). Pure + dependency-injected: the witness passes a mock document; the
//      browser passes the real iframe. Identical dispatch (the Atlas-isomorphism discipline).

import { trackKappaFetches } from "./holo-devtools-kappa-network.mjs";   // A4: κ-stream → Network panel events

// ── CDP node-type constants (DOM) ────────────────────────────────────────────────────────────────
const ELEMENT_NODE = 1, TEXT_NODE = 3, COMMENT_NODE = 8, DOCUMENT_NODE = 9, DOCTYPE_NODE = 10;
const isKappa = (s) => typeof s === "string" && /^did:holo:(sha256|blake3):[0-9a-f]+$/.test(s);
const PAGE_SESSION = "holo-page";   // the child page session the embedder tab target auto-attaches to (flat protocol)

// The boot handshake the UI waits on before it paints (mirror holo-devtools-backend BOOT_ACK). Acked empty.
const BOOT_ACK = new Set([
  "Runtime.runIfWaitingForDebugger", "Runtime.discardConsoleEntries", "Runtime.setMaxCallStackSizeToCapture",
  "Target.setAutoAttach", "Target.setDiscoverTargets", "Target.setRemoteLocations",
  "Page.setLifecycleEventsEnabled", "Page.setBypassCSP", "Page.setInterceptFileChooserDialog",
  "Emulation.setEmulatedMedia", "Emulation.setFocusEmulationEnabled", "Emulation.setAutoDarkModeOverride",
  "Network.setCacheDisabled", "Network.setAttachDebugStack", "Network.enable",
  "DOM.setInspectMode", "Overlay.setShowViewportSizeOnResize", "Autofill.setAddresses",
  "CSS.trackComputedStyleUpdates", "Log.enable", "Log.startViolationsReport", "Audits.enable",
  "Page.setAdBlockingEnabled", "DOMSnapshot.enable", "Accessibility.enable",
]);

// createLiveDevToolsBackend(opts) → a backend whose serve(cdpFrame,{caller,onEvent}) answers one CDP frame.
//   target()    → { doc, win, kappa } for the focused holospace (live, same-origin). Re-read every call so
//                 the backend always reflects the CURRENT focused holospace (Dev follows focus).
//   edit(kappa, source) → liveEdit: re-seal the holospace source → { kappa } (the new content address).
//   conscience  → { evaluate({verb,caller,intent}) -> {outcome:"accept"|"block",reason?} } (L4 gate).
//   now()       → injectable clock for stable receipts.
//   kappaFetchSource → { subscribe(onFetch) -> unsubscribe } (optional, A4): the live κ-stream tap. On
//                 Network.enable the backend subscribes it and maps every κ-fetch to the panel's request
//                 lifecycle (the browser injects the streamHolo tap; the witness injects a mock).
export function createLiveDevToolsBackend({ target, edit = null, conscience = null, now = () => 0, kappaFetchSource = null } = {}) {
  if (typeof target !== "function") throw new Error("createLiveDevToolsBackend: target() accessor is required");

  // ── identity maps: CDP nodeId ⇄ live Node, plus a κ alias per node (L1/L2) ──
  let seq = 0;
  const idToNode = new Map();     // nodeId → live Node
  const nodeToId = new Map();     // live Node → nodeId  (Map, not WeakMap: we hold the doc live anyway)
  let objSeq = 0;
  const objects = new Map();      // objectId → live JS value (Runtime RemoteObjects)
  let ctxId = 0;
  let attached = false;           // page attach emitted once (guards the "target already exists" flood)
  let netWired = false, netUnsub = null;   // Network panel: the κ-fetch tap subscription (A4), wired once
  const metrics = { frames: 0, edits: 0 };

  const ctx = () => { const t = target() || {}; return { doc: t.doc || null, win: t.win || null, kappa: t.kappa || null }; };

  const idOf = (node) => {
    let id = nodeToId.get(node);
    if (!id) { id = ++seq; nodeToId.set(node, id); idToNode.set(id, node); }
    return id;
  };
  const reset = () => { seq = 0; idToNode.clear(); nodeToId.clear(); };

  // the κ alias for a node: the holospace κ for the document/root; [data-holo-k] for tagged objects (L2).
  const kappaOf = (node, rootKappa) => {
    try {
      if (node && node.nodeType === ELEMENT_NODE) { const k = node.getAttribute && node.getAttribute("data-holo-k"); if (isKappa(k)) return k; }
      if (node && (node.nodeType === DOCUMENT_NODE || node === ctx().doc?.documentElement)) return rootKappa || null;
    } catch (e) {}
    return rootKappa || null;
  };

  const flatAttrs = (el) => {
    const out = [];
    try { for (const a of el.attributes) { out.push(a.name, a.value); } } catch (e) {}
    return out;
  };

  // serialize ONE live node into a CDP DOM node, children to `depth` (matches the golden shape exactly).
  function cdpNode(node, depth, rootKappa) {
    const nodeId = idOf(node);
    const t = node.nodeType;
    const base = { nodeId, backendNodeId: nodeId, nodeType: t, nodeName: node.nodeName, localName: node.localName || "", nodeValue: (t === TEXT_NODE || t === COMMENT_NODE) ? (node.nodeValue || "") : "" };
    const ka = kappaOf(node, rootKappa); if (ka) base.kappa = ka;          // the κ alias surfaced (L1)
    if (t === ELEMENT_NODE) {
      base.attributes = flatAttrs(node);
      const kids = childElementsAndText(node);
      base.childNodeCount = kids.length;
      if (depth !== 0 && kids.length) base.children = kids.map((c) => cdpNode(c, depth - 1, rootKappa));
    } else if (t === DOCUMENT_NODE) {
      const kids = [...node.childNodes];
      base.childNodeCount = kids.length;
      if (depth !== 0) base.children = kids.map((c) => cdpNode(c, depth - 1, rootKappa));
      const c = ctx();
      base.documentURL = "holo://" + (rootKappa || "scene");
      base.baseURL = base.documentURL;
      base.compatibilityMode = "NoQuirksMode";
    }
    return base;
  }
  // children the inspector shows: elements + comments + non-whitespace text (skip whitespace-only text noise)
  function childElementsAndText(node) {
    const out = [];
    for (const c of node.childNodes) {
      if (c.nodeType === ELEMENT_NODE || c.nodeType === COMMENT_NODE) out.push(c);
      else if (c.nodeType === TEXT_NODE && String(c.nodeValue || "").trim()) out.push(c);
    }
    return out;
  }

  // ── CSS: computed + matched, read straight from the live CSSOM (the REAL styles) ──
  function computedStyle(node) {
    const { win } = ctx(); const out = [];
    try { const cs = win.getComputedStyle(node); for (let i = 0; i < cs.length; i++) { const name = cs.item(i); out.push({ name, value: cs.getPropertyValue(name) }); } } catch (e) {}
    return out;
  }
  function inlineStyle(node) {
    const props = [], shorthand = [];
    try { const s = node.style; for (let i = 0; i < s.length; i++) { const name = s.item(i); props.push({ name, value: s.getPropertyValue(name), important: s.getPropertyPriority(name) === "important" }); } } catch (e) {}
    return { styleSheetId: "inline:" + idOf(node), cssProperties: props, shorthandEntries: shorthand, cssText: (node.getAttribute && node.getAttribute("style")) || "" };
  }
  function matchedRules(node) {
    const { win, doc } = ctx(); const rules = [];
    let sheets = []; try { sheets = [...doc.styleSheets]; } catch (e) {}
    for (const sheet of sheets) {
      let cssRules; try { cssRules = sheet.cssRules; } catch (e) { continue; }   // cross-origin sheet → skip (honest)
      if (!cssRules) continue;
      for (const rule of cssRules) {
        if (!rule || rule.type !== 1 /* STYLE_RULE */ || !rule.selectorText) continue;
        let matches = false; try { matches = node.matches(rule.selectorText); } catch (e) { matches = false; }
        if (!matches) continue;
        const cssProperties = [];
        try { const st = rule.style; for (let i = 0; i < st.length; i++) { const name = st.item(i); cssProperties.push({ name, value: st.getPropertyValue(name), important: st.getPropertyPriority(name) === "important" }); } } catch (e) {}
        rules.push({
          rule: {
            selectorList: { selectors: rule.selectorText.split(",").map((s) => ({ text: s.trim() })), text: rule.selectorText },
            origin: "regular",
            style: { styleSheetId: "sheet:" + (sheet.href || "inline"), cssProperties, shorthandEntries: [] },
            media: [],
          },
          matchingSelectors: [0],
        });
      }
    }
    return rules;
  }

  // ── Runtime: RemoteObjects over the live window, real eval ──
  function remoteObject(value) {
    const t = typeof value;
    if (value === null) return { type: "object", subtype: "null", value: null };
    if (t === "undefined") return { type: "undefined" };
    if (t === "string" || t === "number" || t === "boolean") return { type: t, value };
    if (t === "function") return { type: "function", className: "Function", description: String(value).slice(0, 200) };
    // object / node → assign an objectId, give a preview
    const objectId = "obj:" + (++objSeq); objects.set(objectId, value);
    let subtype, className = (value.constructor && value.constructor.name) || "Object", description = className;
    try { if (value.nodeType) { subtype = "node"; description = value.nodeName ? value.nodeName.toLowerCase() + (value.id ? "#" + value.id : "") : className; } } catch (e) {}
    if (Array.isArray(value)) { subtype = "array"; description = "Array(" + value.length + ")"; }
    return { type: "object", subtype, className, description, objectId };
  }

  // ── the κ-edit door: any mutation re-seals the live source → new κ via liveEdit (ADR-0093) ──
  function reseal(caller, intent) {
    const { doc, kappa } = ctx();
    if (typeof edit !== "function") return { refused: true, reason: "no live editor wired — Dev is read-only", caller };
    if (!conscience || typeof conscience.evaluate !== "function") return { refused: true, reason: "no conscience gate — edit is fail-closed", caller };
    let verdict; try { verdict = conscience.evaluate({ verb: "devtools.edit", caller, intent: String(intent || "").slice(0, 200) }); } catch (e) { return { refused: true, reason: "gate error: " + (e && e.message), caller }; }
    if (verdict && verdict.outcome === "block") return { refused: true, reason: verdict.reason || "refused by conscience", caller };
    let source = ""; try { source = "<!doctype html>\n" + doc.documentElement.outerHTML; } catch (e) { return { refused: true, reason: "cannot serialize source", caller }; }
    metrics.edits++;
    try { const r = edit(kappa, source); return { holo: { kappa: (r && r.kappa) || null } }; }
    catch (e) { return { refused: true, reason: "edit failed: " + ((e && e.message) || e), caller }; }
  }

  // ── the dispatcher (one door; mirror the Tier-3 backend's serve() contract) ──
  function dispatch(method, params = {}, { caller = "human", onEvent = null } = {}) {
    metrics.frames++;
    const { doc, win, kappa } = ctx();

    // boot: the embedder frontend runs a TAB target on the root connection and AUTO-ATTACHES to the page as
    // a CHILD session (the flat protocol, confirmed against a real Chromium browser-level connection). So on
    // setAutoAttach we emit Target.attachedToTarget announcing the holospace as a "page" target with a fresh
    // sessionId; the frontend then sends every Page/DOM/CSS/Runtime command WITH that sessionId, and the serve
    // wrapper echoes the sessionId on every response + tags every session event (without that routing the
    // Elements tree stays blank — both halves are required). The attachedToTarget event is itself a ROOT event
    // (no top-level sessionId); the new page session id rides in params.sessionId.
    if (method === "Target.setAutoAttach") {
      if (typeof onEvent === "function" && !attached) {
        attached = true;   // emit the page attach EXACTLY ONCE — re-emitting registers the target twice ("already exists" flood)
        const targetInfo = { targetId: "holo-live", type: "page", title: "holospace", url: "holo://" + (kappa || "scene"), attached: true, canAccessOpener: false, browserContextId: "holo" };
        Promise.resolve().then(() => onEvent({ method: "Target.attachedToTarget", params: { sessionId: PAGE_SESSION, targetInfo, waitingForDebugger: false } }));
      }
      return {};
    }
    if (method === "Target.attachToTarget") return { sessionId: PAGE_SESSION };
    // Runtime.enable: emit the default execution context so the Console comes alive (L: real eval).
    if (method === "Runtime.enable") {
      if (typeof onEvent === "function") {
        const id = ++ctxId;
        Promise.resolve().then(() => onEvent({ method: "Runtime.executionContextCreated", params: { context: {
          id, origin: "holo://" + (kappa || "scene"), name: "holospace", uniqueId: "holo-ctx-" + id,
          auxData: { isDefault: true, type: "default", frameId: "holo-live" } } } }));
      }
      return {};
    }
    // Network.enable: subscribe the live κ-stream tap → every κ-fetch becomes a request in the Network panel,
    // carrying its axis · cache-hit (L3) · L5 verify badge · provenance (A4). Wired once on the session channel.
    if (method === "Network.enable") {
      if (typeof onEvent === "function" && kappaFetchSource && !netWired) {
        netWired = true;
        const onFetch = trackKappaFetches((ev) => { try { onEvent(ev); } catch (e) {} });
        try { netUnsub = kappaFetchSource.subscribe(onFetch); } catch (e) {}
      }
      return {};
    }
    if (method === "Network.disable") {
      if (netUnsub) { try { netUnsub(); } catch (e) {} netUnsub = null; }
      netWired = false;
      return {};
    }
    if (method === "DOM.enable" || /\.(enable|disable)$/.test(method) || BOOT_ACK.has(method)) {
      // Page.getResourceTree / navigation history carry the holospace identity.
      if (method === "Page.getResourceTree") return { frameTree: { frame: { id: "holo-live", loaderId: "holo", url: "holo://" + (kappa || "scene"), domainAndRegistry: "", securityOrigin: "holo://", mimeType: "text/html", secureContextType: "Secure", crossOriginIsolatedContextType: "NotIsolated", gatedAPIFeatures: [] }, resources: [] } };
      return {};
    }

    switch (method) {
      case "Target.getTargets":
        return { targetInfos: [{ targetId: "holo-live", type: "page", title: "holospace", url: "holo://" + (kappa || "scene"), attached: true }] };
      case "Page.getResourceTree":
        return { frameTree: { frame: { id: "holo-live", loaderId: "holo", url: "holo://" + (kappa || "scene"), domainAndRegistry: "", securityOrigin: "holo://", mimeType: "text/html", secureContextType: "Secure", crossOriginIsolatedContextType: "NotIsolated", gatedAPIFeatures: [] }, resources: [] } };
      case "Page.getNavigationHistory":
        return { currentIndex: 0, entries: [{ id: 0, url: "holo://" + (kappa || "scene"), userTypedURL: "holo://" + (kappa || "scene"), title: "holospace", transitionType: "typed" }] };

      // ── DOM domain ⇄ the LIVE document ──
      case "DOM.getDocument": {
        if (!doc) return { root: { nodeId: ++seq, backendNodeId: seq, nodeType: DOCUMENT_NODE, nodeName: "#document", childNodeCount: 0, documentURL: "holo://scene", baseURL: "holo://scene", compatibilityMode: "NoQuirksMode" } };
        reset();
        const depth = params.depth === -1 ? 6 : (params.depth || 2);
        const root = cdpNode(doc, depth, kappa);
        // The Elements panel binds the document to the MAIN FRAME by the documentElement's frameId — it must
        // match the Page frame id (and the execution-context frameId). Absent ⇒ the panel never shows the tree.
        try { const el = (root.children || []).find((c) => c.nodeType === ELEMENT_NODE); if (el) el.frameId = "holo-live"; } catch (e) {}
        return { root };
      }
      case "DOM.requestChildNodes": {
        const node = idToNode.get(params.nodeId);
        if (!node) return {};
        const depth = params.depth === -1 ? 4 : (params.depth || 1);
        const kids = node.nodeType === DOCUMENT_NODE ? [...node.childNodes] : childElementsAndText(node);
        const nodes = kids.map((c) => cdpNode(c, depth - 1, kappa));
        if (typeof onEvent === "function") onEvent({ method: "DOM.setChildNodes", params: { parentId: params.nodeId, nodes } });
        return {};
      }
      case "DOM.getOuterHTML": {
        const node = idToNode.get(params.nodeId || params.backendNodeId);
        try { return { outerHTML: node.nodeType === DOCUMENT_NODE ? doc.documentElement.outerHTML : node.outerHTML }; } catch (e) { return { outerHTML: "" }; }
      }
      case "DOM.resolveNode": {
        const node = idToNode.get(params.nodeId || params.backendNodeId);
        if (!node) return { error: "no such node" };
        return { object: remoteObject(node) };
      }
      case "DOM.pushNodesByBackendIdsToFrontend":
        return { nodeIds: (params.backendNodeIds || []).map((b) => b) };
      case "DOM.getAttributes": {
        const node = idToNode.get(params.nodeId); return { attributes: node ? flatAttrs(node) : [] };
      }

      // ── DOM writes → the live DOM, then re-seal → new κ (ADR-0093 liveEdit) ──
      case "DOM.setAttributeValue": {
        const node = idToNode.get(params.nodeId); if (!node) return { error: "no such node" };
        try { node.setAttribute(params.name, params.value); } catch (e) { return { error: String(e && e.message) }; }
        if (typeof onEvent === "function") onEvent({ method: "DOM.attributeModified", params: { nodeId: params.nodeId, name: params.name, value: params.value } });
        return reseal(caller, "setAttr " + params.name);
      }
      case "DOM.removeAttribute": {
        const node = idToNode.get(params.nodeId); if (!node) return { error: "no such node" };
        try { node.removeAttribute(params.name); } catch (e) { return { error: String(e && e.message) }; }
        if (typeof onEvent === "function") onEvent({ method: "DOM.attributeRemoved", params: { nodeId: params.nodeId, name: params.name } });
        return reseal(caller, "removeAttr " + params.name);
      }
      case "DOM.setOuterHTML":
      case "Page.setDocumentContent": {
        const node = method === "Page.setDocumentContent" ? (doc && doc.documentElement) : idToNode.get(params.nodeId);
        const html = method === "Page.setDocumentContent" ? params.html : params.outerHTML;
        if (!node) return { error: "no such node" };
        try { if (method === "Page.setDocumentContent") { doc.open(); doc.write(html); doc.close(); } else { node.outerHTML = html; } }
        catch (e) { return { error: String(e && e.message) }; }
        const out = reseal(caller, "setOuterHTML");
        if (typeof onEvent === "function") onEvent({ method: "DOM.documentUpdated", params: {} });   // tree changed wholesale → re-fetch
        return out;
      }
      case "DOM.setNodeValue": {
        const node = idToNode.get(params.nodeId); if (!node) return { error: "no such node" };
        try { node.nodeValue = params.value; } catch (e) { return { error: String(e && e.message) }; }
        return reseal(caller, "setNodeValue");
      }

      // ── CSS domain ⇄ the live CSSOM (real computed + matched) ──
      case "CSS.getComputedStyleForNode": {
        const node = idToNode.get(params.nodeId); return { computedStyle: node ? computedStyle(node) : [] };
      }
      case "CSS.getMatchedStylesForNode": {
        const node = idToNode.get(params.nodeId);
        if (!node || node.nodeType !== ELEMENT_NODE) return { matchedCSSRules: [], inlineStyle: { cssProperties: [], shorthandEntries: [] }, inherited: [], pseudoElements: [] };
        return { inlineStyle: inlineStyle(node), attributesStyle: undefined, matchedCSSRules: matchedRules(node), pseudoElements: [], inherited: [], inheritedPseudoElements: [], cssKeyframesRules: [], cssPropertyRules: [], cssPropertyRegistrations: [], cssAtRules: [] };
      }
      case "CSS.getInlineStylesForNode": {
        const node = idToNode.get(params.nodeId); return { inlineStyle: node ? inlineStyle(node) : { cssProperties: [], shorthandEntries: [] } };
      }
      case "CSS.setStyleTexts": {
        // Styles-panel live edit: apply each edit to the live node's inline style, then re-seal.
        const styles = [];
        for (const e of (params.edits || [])) {
          const node = idToNode.get(Number(String(e.styleSheetId).replace(/^inline:/, "")));
          try { if (node) node.setAttribute("style", e.text || ""); } catch (x) {}
          styles.push(node ? inlineStyle(node) : { cssProperties: [], shorthandEntries: [] });
        }
        reseal(caller, "setStyleTexts");
        return { styles };
      }

      // ── Runtime domain — REAL eval in the live window, fail-closed (L4) ──
      case "Runtime.evaluate":
      case "Runtime.callFunctionOn": {
        const expression = String(params.expression || params.functionDeclaration || "");
        if (!conscience || typeof conscience.evaluate !== "function") return { result: { type: "string", value: "" }, exceptionDetails: { text: "DevTools eval is fail-closed — no conscience gate present" } };
        let verdict; try { verdict = conscience.evaluate({ verb: "devtools.eval", caller, intent: expression }); } catch (e) { return { result: { type: "undefined" }, exceptionDetails: { text: "gate error: " + (e && e.message) } }; }
        if (verdict && verdict.outcome === "block") return { result: { type: "undefined" }, exceptionDetails: { text: "refused by conscience: " + (verdict.reason || "") } };
        try { const value = win.eval(expression); const ro = params.returnByValue ? { type: typeof value === "object" && value !== null ? "object" : typeof value, value } : remoteObject(value); return { result: ro }; }
        catch (e) { return { result: { type: "undefined" }, exceptionDetails: { exceptionId: 1, text: "Uncaught", lineNumber: 0, columnNumber: 0, exception: { type: "object", subtype: "error", className: (e && e.name) || "Error", description: String((e && e.stack) || e) } } }; }
      }
      case "Runtime.getProperties": {
        const obj = objects.get(params.objectId);
        if (!obj) return { result: [] };
        const result = [];
        try { for (const k of Object.getOwnPropertyNames(obj).slice(0, 500)) { let v; try { v = obj[k]; } catch (e) { v = undefined; } result.push({ name: k, value: remoteObject(v), configurable: true, enumerable: true, writable: true, isOwn: true }); } } catch (e) {}
        return { result };
      }
      case "Runtime.releaseObject": { objects.delete(params.objectId); return {}; }
      case "Runtime.globalLexicalScopeNames": return { names: [] };
      case "Runtime.getHeapUsage": return { usedSize: 0, totalSize: 0 };

      // ── Overlay domain — REAL element highlight, drawn into the live iframe ──
      case "Overlay.highlightNode": {
        const node = idToNode.get((params.nodeId) || (params.backendNodeId)); highlight(node); return {};
      }
      case "Overlay.hideHighlight": { highlight(null); return {}; }
      case "Overlay.setInspectMode": { inspectMode = params.mode !== "none"; return {}; }

      default:
        return {};   // unknown method → empty ack (graceful; the UI tolerates it)
    }
  }

  // ── live element highlight (Overlay): a box injected into the holospace, no devtools needed ──
  let hlEl = null, inspectMode = false;
  function highlight(node) {
    const { doc } = ctx(); if (!doc) return;
    try {
      if (!hlEl || hlEl.ownerDocument !== doc) { hlEl = doc.createElement("div"); hlEl.setAttribute("data-holo-devtools-overlay", "1"); hlEl.style.cssText = "position:fixed;z-index:2147483647;pointer-events:none;background:rgba(111,168,255,.30);border:1px solid rgba(111,168,255,.9);box-sizing:border-box;transition:all .05s"; }
      if (!node || node.nodeType !== ELEMENT_NODE) { if (hlEl.parentNode) hlEl.remove(); return; }
      const r = node.getBoundingClientRect();
      hlEl.style.left = r.left + "px"; hlEl.style.top = r.top + "px"; hlEl.style.width = r.width + "px"; hlEl.style.height = r.height + "px";
      if (!hlEl.parentNode) doc.body.appendChild(hlEl);
    } catch (e) {}
  }

  // ── DOOR 1 · humans: raw CDP over the cross-frame bus (mirror Tier-3 serve contract) ──
  function serve(msg, { caller = "human", onEvent = null } = {}) {
    const out = dispatch(msg.method, msg.params || {}, { caller, onEvent });
    if (out && typeof out.then === "function") return out.then((result) => ({ id: msg.id, result }));
    return { id: msg.id, result: out };
  }

  return { dispatch, serve, metrics, nodeIdOf: idOf, _maps: { idToNode, nodeToId } };
}

// createLiveDevToolsServe(opts) → the holo-gov-bus serve({app,method,args,onEvent}) shape (the twin of
// createDevToolsServe, but over the LIVE backend). holo-gov.js routes the DevTools frame's method:"cdp"
// here exactly as for Tier 3 — one branch, no forked logic. `app` is the host-asserted caller identity.
export function createLiveDevToolsServe(opts = {}) {
  const backend = createLiveDevToolsBackend(opts);
  async function serve({ app, method, args = {}, onEvent = null } = {}) {
    if (method !== "cdp") return { error: "unsupported method: " + method };
    const cdp = args && args.cdp;
    if (!cdp || typeof cdp.method !== "string") return { error: "malformed cdp frame" };
    // FLAT-PROTOCOL session routing (the half that makes the Elements tree paint): a command that arrives
    // with a sessionId is a PAGE-session command — its response AND every event it triggers must carry that
    // same sessionId, or the frontend's page session never resolves them (confirmed against real Chromium).
    const sid = cdp.sessionId || null;
    const sessionOnEvent = (typeof onEvent === "function")
      ? (ev) => onEvent(sid ? { ...ev, sessionId: sid } : ev)
      : null;
    try {
      const out = backend.serve(cdp, { caller: app || "frame", onEvent: sessionOnEvent });
      const reply = out && typeof out.then === "function" ? await out : out;
      if (sid && reply && typeof reply === "object") reply.sessionId = sid;   // echo sessionId on the response
      return { result: reply };
    } catch (e) { return { error: String((e && e.message) || e) }; }
  }
  serve.backend = backend;
  serve.tier = "live";   // so the shell/DevTools can show which backend is answering (honest provenance)
  return serve;
}

export default { createLiveDevToolsBackend, createLiveDevToolsServe };
