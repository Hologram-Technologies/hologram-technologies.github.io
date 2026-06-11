// holo-roam.js — Roam Research, NATIVELY ENCODED for Hologram OS (the "Holo Notepad"
// holospace). Roam is a networked outliner: everything is a *block* in an infinitely
// nestable bullet tree; [[wiki-links]], #tags and ((block refs)) weave pages into a
// graph; every page surfaces its Linked References (backlinks). This module is that
// model, expressed on the substrate — pure, dependency-free, and Node-safe (no DOM),
// so the witness exercises it headless and the browser drives the same code.
//
// FIRST PRINCIPLES — why this is more than a notes app on Hologram OS:
//   • The graph IS a CvRDT. Block text + metadata are Lamport-LWW registers; the
//     ordered children of a block are a convergent RGA sequence. We add ZERO CRDT
//     code: we drive _shared/holo-collab.js (the same engine Holo Docs co-edits on).
//     So Holo Notepad is serverless, end-to-end-encrypted and real-time multi-user by
//     construction, and a saved graph IS its content address (holo://κ).
//   • The link graph is a PURE DERIVATION of content (Law L5), never stored. backlinks,
//     unlinked references, tag membership and queries are a deterministic function of
//     the block strings, so every peer re-derives the IDENTICAL graph: a backlink
//     cannot be forged or desynced. This is the enforceability Roam can't give — in
//     Roam the link index is a server's private mutable state; here it is recomputed
//     from content by anyone, and proven byte-identical across replicas by the witness.
//   • A block is a Merkle node. blockAddress(uid) = sha256 over {text, marks, child-κs},
//     so the outline is a content-addressed DAG and a ((ref)) is a content link.
//
// SHAPE: a Graph wraps a "store" with the holo-collab Session API (set/insert/delete/
// deleteIds + val/mapObj/mapKeys/seqVals/seqIds). The browser passes the live Session
// (edits broadcast + coalesce); a witness passes Graph.overDoc(new HoloCollab.Doc()).
// Pure helpers (parseRefs, renderInline, normTitle, dailyTitle, deriveBacklinks…) take
// plain strings and need no store at all.

(function () {
  "use strict";
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  if (G.HoloRoam) return;

  // ── tiny utils ───────────────────────────────────────────────────────────────
  const rand = (n) => {
    const c = G.crypto || (typeof require !== "undefined" && require("crypto").webcrypto);
    const a = new Uint8Array(n); c.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
  };
  // Roam-style 9-char block uid (opaque, stable identity in the graph).
  const uid = () => rand(9);
  // A PAGE's uid is DERIVED from its normalized title (content-addressed identity), so
  // [[Title]] and a daily note resolve to the SAME uid on every peer with no coordination
  // — two replicas that each first type [[Idea]] converge to one page, not two (Law L1/L5).
  const fnv = (str, seed) => { let h = seed >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, "0"); };
  const pageUidFor = (norm) => "p" + fnv(norm, 0x811c9dc5) + fnv(norm, 0x9e3779b1);
  const te = new TextEncoder();
  async function sha256Hex(str) {
    const subtle = (G.crypto && G.crypto.subtle) || (typeof require !== "undefined" && require("crypto").webcrypto.subtle);
    const buf = await subtle.digest("SHA-256", te.encode(str));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // A page key is its title, case/space-normalized — so [[Idea]], [[ idea ]] and #idea
  // resolve to ONE page (Roam folds case and trims). The display title is kept verbatim.
  const normTitle = (t) => String(t == null ? "" : t).trim().replace(/\s+/g, " ").toLowerCase();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ── pure parser: a block's text → its references (the derivation core) ─────────
  // Returns links (page/tag/block), todo state, attribute, and query/embed flags.
  // Handles nested wiki-links — Roam's [[ [[A]] [[B]] ]] links the composite AND A AND B.
  function findWiki(text) {
    // balanced [[ … ]] spans (top level); content may itself contain [[ … ]].
    const out = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "[" && text[i + 1] === "[") {
        let depth = 0;
        for (let j = i; j < text.length; j++) {
          if (text[j] === "[" && text[j + 1] === "[") { depth++; j++; }
          else if (text[j] === "]" && text[j + 1] === "]") { depth--; j++; if (depth === 0) { out.push({ start: i, end: j + 1, inner: text.slice(i + 2, j - 1) }); i = j; break; } }
        }
      }
    }
    return out;
  }

  function parseRefs(text, depth = 0) {
    text = String(text == null ? "" : text);
    const links = [];                 // { type:'page'|'tag'|'block', key, display }
    const seen = new Set();
    const addPage = (display, type = "page") => { const key = normTitle(display); if (!key) return; const id = type + ":" + key; if (seen.has(id)) return; seen.add(id); links.push({ type, key, display: String(display).trim() }); };
    const addBlock = (u) => { const id = "block:" + u; if (seen.has(id)) return; seen.add(id); links.push({ type: "block", key: u, display: u }); };

    // todo / done — {{[[TODO]]}}, {{TODO}}, {{[[DONE]]}}, {{DONE}}
    let todo = null; const mTodo = text.match(/\{\{(?:\[\[)?\s*(TODO|DONE)\s*(?:\]\])?\}\}/i);
    if (mTodo) todo = mTodo[1].toUpperCase();
    // query / embed flags ({{query: …}}, {{[[query]]: …}}, {{embed: ((uid))}})
    const hasQuery = /\{\{(?:\[\[)?\s*query\s*(?:\]\])?\s*:/i.test(text);
    const mEmbed = text.match(/\{\{(?:\[\[)?\s*embed\s*(?:\]\])?\s*:\s*\(\(([^()]+)\)\)\s*\}\}/i);

    // attribute — "Key:: value" at the block start; the key is itself a page (Roam).
    let attr = null; const mAttr = text.match(/^\s*([^:\n]+?)::\s?([\s\S]*)$/);
    if (mAttr && !/^https?$/i.test(mAttr[1].trim())) { attr = { key: mAttr[1].trim(), value: mAttr[2] }; addPage(mAttr[1]); }

    // block references ((uid))
    for (const m of text.matchAll(/\(\(([^()\n]+)\)\)/g)) addBlock(m[1].trim());

    // #[[multi word]] and #tag (tag == page)
    for (const m of text.matchAll(/#\[\[([^\]]+)\]\]/g)) addPage(m[1], "tag");
    const tagless = text.replace(/#\[\[[^\]]+\]\]/g, "");
    for (const m of tagless.matchAll(/(^|[^\w#])#([\w/_-]+)/g)) addPage(m[2], "tag");

    // [[wiki-links]] (balanced, nested) — outer composite + recurse for inner.
    for (const w of findWiki(text)) {
      addPage(w.inner);
      if (depth < 4 && /\[\[/.test(w.inner)) for (const l of parseRefs(w.inner, depth + 1).links) { const id = l.type + ":" + l.key; if (!seen.has(id)) { seen.add(id); links.push(l); } }
    }

    return { links, todo, hasQuery, embed: mEmbed ? mEmbed[1].trim() : null, attr };
  }

  // ── pure: derive the whole backlink index from a set of blocks (Law L5) ────────
  // blocks: [{ uid, text, page }]. Returns { byTarget, canonical }.
  //   byTarget: "page:<norm>" | "block:<uid>"  →  [ refBlockUid… ] (sorted, stable)
  //   canonical: deterministic JSON — IDENTICAL on every replica with the same content.
  function deriveBacklinks(blocks) {
    const byTarget = new Map();
    for (const b of blocks) {
      const { links } = parseRefs(b.text);
      for (const l of links) {
        const t = (l.type === "block" ? "block:" : "page:") + l.key;
        if (!byTarget.has(t)) byTarget.set(t, new Set());
        byTarget.get(t).add(b.uid);
      }
    }
    const obj = {};
    for (const t of [...byTarget.keys()].sort()) obj[t] = [...byTarget.get(t)].sort();
    return { byTarget, canonical: JSON.stringify(obj) };
  }

  // ── pure: inline markdown + Roam syntax → safe HTML (rendering, one nesting level) ─
  // ctx: { pageExists(norm)->bool, blockText(uid)->string|undefined, blockPage(uid)->norm }
  function renderInline(text, ctx = {}) {
    let s = esc(String(text == null ? "" : text));
    // code spans first (protect their content from other rules)
    const code = []; s = s.replace(/`([^`]+)`/g, (_, c) => { code.push(c); return " C" + (code.length - 1) + " "; });
    // todo / done checkbox
    s = s.replace(/\{\{(?:\[\[)?\s*(TODO|DONE)\s*(?:\]\])?\}\}/gi, (_, k) =>
      `<span class="todo ${k.toLowerCase()}" data-todo="${k.toUpperCase()}" role="checkbox" aria-checked="${/done/i.test(k)}">${/done/i.test(k) ? "☑" : "☐"}</span>`);
    // {{query: …}} → marker (results rendered block-level by the UI)
    s = s.replace(/\{\{(?:\[\[)?\s*query\s*(?:\]\])?\s*:[\s\S]*?\}\}/gi, `<span class="qmark">🔎 query</span>`);
    s = s.replace(/\{\{(?:\[\[)?\s*embed\s*(?:\]\])?\s*:\s*\(\(([^()]+)\)\)\s*\}\}/gi, (_, u) => `<span class="embed" data-embed="${esc(u.trim())}"></span>`);
    // block references ((uid)) → the referenced block's text (clickable)
    s = s.replace(/\(\(([^()\n]+)\)\)/g, (_, u) => { u = u.trim(); const t = ctx.blockText ? ctx.blockText(u) : undefined;
      return `<span class="ref" data-uid="${esc(u)}" title="block ((${esc(u)}))">${t == null ? "(( " + esc(u) + " ))" : renderInline(t, ctx)}</span>`; });
    // #[[multi word]] and #tag
    s = s.replace(/#\[\[([^\]]+)\]\]/g, (_, t) => pill(t, "tag", ctx, "#" + t));
    s = s.replace(/(^|[^\w#&])#([\w/_-]+)/g, (m, pre, t) => pre + pill(t, "tag", ctx, "#" + t));
    // [[wiki-links]] (single level for render; derivation handles nesting)
    s = s.replace(/\[\[([^\[\]]+)\]\]/g, (_, t) => pill(t, "page", ctx, t));
    // markdown emphasis
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^_])__([^_]+)__/g, "$1<i>$2</i>")
         .replace(/\^\^([^^]+)\^\^/g, "<mark>$1</mark>").replace(/~~([^~]+)~~/g, "<s>$1</s>");
    // plain markdown links [label](url)
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, l, u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${l}</a>`);
    // restore code spans
    s = s.replace(/ C(\d+) /g, (_, i) => `<code>${code[+i]}</code>`);
    return s;
  }
  function pill(title, type, ctx, label) {
    const norm = normTitle(title);
    const exists = ctx.pageExists ? ctx.pageExists(norm) : true;
    return `<span class="${type === "tag" ? "tag" : "wikilink"}${exists ? "" : " missing"}" data-page="${esc(norm)}" data-title="${esc(title.trim())}">${esc(label)}</span>`;
  }

  // ── daily notes — Roam's "June 9th, 2026" page-title format ─────────────────────
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const ordinal = (d) => d + (d % 10 === 1 && d !== 11 ? "st" : d % 10 === 2 && d !== 12 ? "nd" : d % 10 === 3 && d !== 13 ? "rd" : "th");
  function dailyTitle(date = new Date()) { return `${MONTHS[date.getMonth()]} ${ordinal(date.getDate())}, ${date.getFullYear()}`; }
  function dailyTitleOffset(daysAgo) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - daysAgo); return dailyTitle(d); }

  // ── store adapter over a raw holo-collab Doc (for the witness / offline) ────────
  function overDoc(doc) {
    return {
      set: (n, k, v) => doc.set(n, k, v),
      insert: (n, i, vals) => doc.insert(n, i, vals),
      delete: (n, i, c) => doc.delete(n, i, c),
      deleteIds: (n, ids) => doc.deleteIds(n, ids),
      val: (n, k) => doc.map(n).get(k),
      mapObj: (n) => doc.map(n).entriesObj(),
      mapKeys: (n) => doc.map(n).keys(),
      seqVals: (n) => doc.rga(n).vals(),
      seqIds: (n) => doc.rga(n).liveIds(),
      _doc: doc,
    };
  }

  // ── Graph — the outliner over the CvRDT store ───────────────────────────────────
  // Maps: text(uid→md) · meta(uid→{parent,page,collapsed,heading,todo}) ·
  //       pages(normTitle→pageUid) · pageTitle(pageUid→display) · shortcuts(norm→1)
  // RGAs: "kids:"+parentUid → ordered child uids (parent = pageUid at top level)
  const KIDS = (p) => "kids:" + p;
  class Graph {
    constructor(store) { this.s = store; }

    // — pages —
    pageUidByTitle(title) { return this.s.val("pages", normTitle(title)); }
    pageTitle(pageUid) { return this.s.val("pageTitle", pageUid); }
    allPages() { const o = this.s.mapObj("pageTitle"); return Object.keys(o).map((u) => ({ uid: u, title: o[u], norm: normTitle(o[u]) })); }
    pageExists(norm) { return this.s.has ? this.s.has("pages", norm) : this.s.val("pages", normTitle(norm)) != null; }
    // find-or-create a page by title (what [[X]] / #X / a daily note does in Roam). The
    // uid is DERIVED from the title, so the op is idempotent AND converges across peers.
    resolvePage(title) {
      const norm = normTitle(title);
      const u = pageUidFor(norm);
      if (this.s.val("pageTitle", u) == null) {
        this.s.set("pages", norm, u);
        this.s.set("pageTitle", u, String(title).trim());
        this.s.set("meta", u, { isPage: true, page: u });
      }
      return u;
    }
    dailyPage(date = new Date()) { return this.resolvePage(dailyTitle(date)); }

    // — blocks —
    blockText(u) { return this.s.val("text", u); }
    blockMeta(u) { return this.s.val("meta", u) || {}; }
    childUids(parentUid) { return this.s.seqVals(KIDS(parentUid)) || []; }
    childIndex(parentUid, childUid) { return this.childUids(parentUid).indexOf(childUid); }

    // create a block under parent at index (default: end). parent may be a pageUid.
    createBlock(parentUid, index = -1, text = "") {
      const u = "b" + uid();
      const kids = this.childUids(parentUid);
      const at = index < 0 || index > kids.length ? kids.length : index;
      this.s.insert(KIDS(parentUid), at, [u]);
      const page = this.blockMeta(parentUid).page || parentUid;
      this.s.set("text", u, text);
      this.s.set("meta", u, { parent: parentUid, page });
      return u;
    }
    editBlock(u, text) { this.s.set("text", u, String(text)); }
    setMeta(u, patch) { this.s.set("meta", u, { ...this.blockMeta(u), ...patch }); }
    toggleCollapse(u) { const m = this.blockMeta(u); this.setMeta(u, { collapsed: !m.collapsed }); return !m.collapsed; }
    toggleTodo(u) { const t = this.blockText(u) || "";
      if (/\{\{(?:\[\[)?\s*TODO\s*(?:\]\])?\}\}/i.test(t)) this.editBlock(u, t.replace(/\{\{(?:\[\[)?\s*TODO\s*(?:\]\])?\}\}/i, "{{[[DONE]]}}"));
      else if (/\{\{(?:\[\[)?\s*DONE\s*(?:\]\])?\}\}/i.test(t)) this.editBlock(u, t.replace(/\{\{(?:\[\[)?\s*DONE\s*(?:\]\])?\}\}/i, "{{[[TODO]]}}"));
      else this.editBlock(u, "{{[[TODO]]}} " + t);
    }

    // remove a block from its parent's child list (tombstone) — children are re-parented up.
    removeBlock(u) {
      const m = this.blockMeta(u); const parent = m.parent; if (!parent) return;
      const idx = this.childIndex(parent, u);
      // splice this block's children into the parent at its position (Roam: delete keeps kids)
      const kids = this.childUids(u);
      const ids = this.s.seqIds(KIDS(parent));
      if (idx >= 0 && idx < ids.length) this.s.deleteIds(KIDS(parent), [ids[idx]]);
      if (kids.length) { this.s.insert(KIDS(parent), idx < 0 ? this.childUids(parent).length : idx, kids); for (const k of kids) this.setMeta(k, { parent }); }
      this.s.set("text", u, "");
    }

    // move a block to (newParent, index) — the primitive behind indent/outdent/drag.
    move(u, newParent, index = -1) {
      const m = this.blockMeta(u); const oldParent = m.parent; if (!oldParent) return;
      const oldIds = this.s.seqIds(KIDS(oldParent)); const oldIdx = this.childIndex(oldParent, u);
      if (oldIdx >= 0 && oldIdx < oldIds.length) this.s.deleteIds(KIDS(oldParent), [oldIds[oldIdx]]);
      const kids = this.childUids(newParent);
      const at = index < 0 || index > kids.length ? kids.length : index;
      this.s.insert(KIDS(newParent), at, [u]);
      const page = this.blockMeta(newParent).page || newParent;
      this.setMeta(u, { parent: newParent, page });
    }
    // Tab — indent under the preceding sibling (becomes its last child).
    indent(u) { const parent = this.blockMeta(u).parent; if (!parent) return false; const sibs = this.childUids(parent); const i = sibs.indexOf(u); if (i <= 0) return false; this.move(u, sibs[i - 1], -1); return true; }
    // Shift-Tab — outdent: become the next sibling of the current parent.
    outdent(u) { const parent = this.blockMeta(u).parent; if (!parent) return false; const gp = this.blockMeta(parent).parent; if (!gp) return false; const idx = this.childIndex(gp, parent); this.move(u, gp, idx + 1); return true; }

    // — flatten a page (or block) to document order for rendering / derivation —
    flatten(rootUid, includeRoot = false) {
      const out = []; const walk = (p, d) => { for (const c of this.childUids(p)) { out.push({ uid: c, depth: d, text: this.blockText(c) || "", meta: this.blockMeta(c) }); const m = this.blockMeta(c); if (!m.collapsed) walk(c, d + 1); } };
      if (includeRoot) out.push({ uid: rootUid, depth: 0, text: this.pageTitle(rootUid) || this.blockText(rootUid) || "", meta: this.blockMeta(rootUid) });
      walk(rootUid, includeRoot ? 1 : 0); return out;
    }

    // — every block in the graph (for derivation) —
    allBlocks() { return this.s.mapKeys("text").filter((u) => !this.blockMeta(u).isPage).map((u) => ({ uid: u, text: this.s.val("text", u) || "", page: this.blockMeta(u).page })); }
    backlinks() { return deriveBacklinks(this.allBlocks()); }
    // Linked References for a page: blocks whose text links [[title]] / #title.
    linkedReferences(pageUid) {
      const title = this.pageTitle(pageUid); if (title == null) return [];
      const norm = normTitle(title); const { byTarget } = this.backlinks();
      const set = byTarget.get("page:" + norm); return set ? [...set] : [];
    }
    // Unlinked References: blocks that mention the title as plain text but don't link it.
    unlinkedReferences(pageUid) {
      const title = this.pageTitle(pageUid); if (!title) return [];
      const norm = normTitle(title); const linked = new Set(this.linkedReferences(pageUid));
      const re = new RegExp("(^|[^\\w\\[#])" + title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w\\]])", "i");
      return this.allBlocks().filter((b) => b.uid && !linked.has(b.uid) && b.page !== pageUid && re.test(b.text) && !parseRefs(b.text).links.some((l) => l.key === norm)).map((b) => b.uid);
    }
    blocksWithTag(norm) { const { byTarget } = this.backlinks(); const s = byTarget.get("page:" + norm); return s ? [...s] : []; }

    // — queries: {{query: {and: [[A]] #b}}} / {or: …} / {not: …} (Roam's core grammar) —
    parseQuery(text) {
      const m = String(text).match(/\{\{(?:\[\[)?\s*query\s*(?:\]\])?\s*:([\s\S]*)\}\}/i); if (!m) return null;
      const body = m[1];
      const clause = (label) => { const i = body.toLowerCase().indexOf("{" + label); if (i < 0) return []; let depth = 0, j = i, end = body.length; for (; j < body.length; j++) { if (body[j] === "{") depth++; else if (body[j] === "}") { depth--; if (depth === 0) { end = j; break; } } } const seg = body.slice(i, end); return [...parseRefs(seg).links].map((l) => l.key); };
      return { and: clause("and"), or: clause("or"), not: clause("not") };
    }
    runQuery(ast) {
      if (!ast) return [];
      const { byTarget } = this.backlinks();
      const hits = (k) => new Set(byTarget.get("page:" + k) || []);
      let result = null;
      if (ast.and && ast.and.length) for (const k of ast.and) { const h = hits(k); result = result == null ? new Set(h) : new Set([...result].filter((x) => h.has(x))); }
      if (ast.or && ast.or.length) { const u = new Set(); for (const k of ast.or) for (const x of hits(k)) u.add(x); result = result == null ? u : new Set([...result, ...u]); }
      if (result == null) result = new Set();
      if (ast.not) for (const k of ast.not) { const h = hits(k); result = new Set([...result].filter((x) => !h.has(x))); }
      return [...result].sort();
    }

    // — breadcrumb path (zoom) — root page → … → block —
    pathTo(u) { const out = []; let cur = u; const seen = new Set(); while (cur && !seen.has(cur)) { seen.add(cur); const m = this.blockMeta(cur); if (m.isPage) { out.unshift({ uid: cur, title: this.pageTitle(cur), isPage: true }); break; } out.unshift({ uid: cur, title: this.blockText(cur) }); cur = m.parent; } return out; }

    // — Merkle content address of a block subtree (UOR: the outline is a DAG) —
    async blockAddress(u) {
      const m = this.blockMeta(u);
      const kids = this.childUids(u); const childAddrs = [];
      for (const c of kids) childAddrs.push(await this.blockAddress(c));
      const canon = JSON.stringify([m.isPage ? this.pageTitle(u) : this.blockText(u) || "", m.heading || 0, childAddrs]);
      return "sha256:" + (await sha256Hex(canon));
    }
  }

  const HoloRoam = { Graph, overDoc, parseRefs, deriveBacklinks, renderInline, normTitle, dailyTitle, dailyTitleOffset, uid, sha256Hex, roamSelftest };
  // ── pure self-test (the witness runs this; no store, no network, no DOM) ────────
  function roamSelftest() {
    // nested wiki-links derive all three targets (Roam's [[ [[A]] [[B]] ]] behaviour)
    const nested = parseRefs("see [[ [[Alpha]] and [[Beta]] ]] today").links.map((l) => l.key).sort();
    const nestedOk = nested.join(",") === "[[alpha]] and [[beta]],alpha,beta";
    // tags, block refs, todo, attribute
    const r = parseRefs("Status:: doing #urgent and [[Plan]] ((b123abc)) {{[[TODO]]}}");
    const tagOk = r.links.some((l) => l.type === "tag" && l.key === "urgent");
    const pageOk = r.links.some((l) => l.type === "page" && l.key === "plan");
    const blockOk = r.links.some((l) => l.type === "block" && l.key === "b123abc");
    const attrOk = r.attr && r.attr.key === "Status" && r.links.some((l) => l.key === "status");
    const todoOk = r.todo === "TODO";
    // derivation is deterministic regardless of block order (Law L5)
    const blocks1 = [{ uid: "b1", text: "[[X]] #y" }, { uid: "b2", text: "((b1)) and [[X]]" }];
    const blocks2 = [blocks1[1], blocks1[0]];
    const detOk = deriveBacklinks(blocks1).canonical === deriveBacklinks(blocks2).canonical;
    // render escapes + pills + checkbox
    const html = renderInline("<script> [[A]] **b** ((z))", { pageExists: () => true, blockText: () => "hi" });
    const renderOk = !html.includes("<script>") && html.includes("wikilink") && html.includes("<b>b</b>") && html.includes("class=\"ref\"");
    const dailyOk = /^[A-Z][a-z]+ \d+(st|nd|rd|th), \d{4}$/.test(dailyTitle(new Date(2026, 5, 9)));
    const ok = nestedOk && tagOk && pageOk && blockOk && attrOk && todoOk && detOk && renderOk && dailyOk;
    return { nestedOk, tagOk, pageOk, blockOk, attrOk, todoOk, detOk, renderOk, dailyOk, ok };
  }

  G.HoloRoam = HoloRoam;
  if (typeof module !== "undefined" && module.exports) module.exports = HoloRoam;
})();
