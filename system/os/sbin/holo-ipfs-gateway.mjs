// holo-ipfs-gateway.mjs — a VERIFIED IPFS path gateway. Resolve ipfs/<cid>/<path> through the UnixFS DAG,
// re-deriving every block against its CID (Law L5), and hand back a renderable payload. The point: an IPFS
// site browses NATIVELY in Hologram — a page served at /ipfs/<cid>/index.html loads its relative ./style.css
// and follows its <a href="docs/"> through THIS SAME gateway, so the whole object graph feels like the web,
// except every byte is content-addressed and gateway-trustless (a source is a latency choice, never trust).
//
// Pure ESM, no DOM, no top-level effects → Node-witnessable and SW-importable. It REUSES the DAG walk
// (assembleUnixFs) and the trustless-gateway set; this file adds path traversal + directory index + a
// beautiful native listing + the nav-reporter the shell reads to track the address bar. Block fetch is
// injected, so the witness drives it with a fixture store and the SW drives it with real gateways.

import * as holoIpfs from "../usr/lib/holo/holo-ipfs.js";
import { assembleUnixFs } from "./holo-omni-object.mjs";
import { IPFS_GATEWAYS } from "./holo-peers.mjs";
import { discoverGateways } from "./holo-routing.mjs";
import { selectRender, kindOfContentType } from "./holo-render-contract.mjs";   // dependency-free (no node:crypto) — SW-safe

const MIME = {
  html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", mjs: "text/javascript",
  json: "application/json", jsonld: "application/ld+json", svg: "image/svg+xml", png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  ico: "image/x-icon", pdf: "application/pdf", txt: "text/plain", md: "text/markdown", xml: "application/xml",
  wasm: "application/wasm", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
};
export const mimeOf = (name) => MIME[String(name || "").split(".").pop().toLowerCase()] || null;

// sniff(bytes, name) — content type for a leaf with no (or unknown) extension. Magic bytes first, then a
// crude printable-ratio test for text vs binary. HTML detection lets an extensionless root page render.
export function sniff(bytes, name) {
  const ext = mimeOf(name); if (ext) return ext;
  if (!bytes || !bytes.length) return "application/octet-stream";
  const b = bytes.subarray(0, 16);
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 256)).trim().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<svg")) return head.startsWith("<svg") ? "image/svg+xml" : "text/html";
  let printable = 0; for (const c of bytes.subarray(0, 256)) if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
  return printable > bytes.subarray(0, 256).length * 0.85 ? "text/plain" : "application/octet-stream";
}

// dispatchRender(bytes, name) — the SINGLE serve-time render dispatch the SW imports. If the bytes are a
// UOR envelope that DECLARES a render contract, honor it (a self-describing object chooses how it renders);
// otherwise fall back to the existing extension/magic-byte sniff. Pure over ALREADY-VERIFIED bytes — trust
// is recovered upstream by re-derivation (Law L5), never here. Returns { kind, contentType }.
export function dispatchRender(bytes, name) {
  const obj = tryParseUor(bytes);
  if (obj && obj.render) {
    const r = selectRender(obj);
    return { kind: r.kind, contentType: r.contentType || mimeOf(name) || sniff(bytes, name), declared: true };
  }
  const ct = mimeOf(name) || sniff(bytes, name);
  return { kind: kindOfContentType(ct), contentType: ct, declared: false };
}
// tryParseUor(bytes) → a UOR envelope object | null. A UOR object is canonical JSON-LD with @context + a
// content-derived id; anything that does not parse as one is left to the byte sniffer untouched.
function tryParseUor(bytes) {
  try {
    if (!bytes || bytes.length > 1 << 20) return null;            // contracts are tiny; don't parse large media
    const o = JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
    return (o && o["@context"] && typeof o.id === "string" && o.id.startsWith("did:holo:")) ? o : null;
  } catch { return null; }
}

// parseIpfsPath(rel) → { ns, root, path } | null. rel is the BASE-stripped path, e.g. "ipfs/<cid>/a/b.html".
export function parseIpfsPath(rel) {
  const m = String(rel || "").match(/^(ipfs|ipns)\/([^/?#]+)(?:\/([^?#]*))?/i);
  if (!m) return null;
  return { ns: m[1].toLowerCase(), root: m[2], path: m[3] || "" };
}

// makeGetBlock(fetchImpl, cfg) → async (cidStr) => Uint8Array | null. Races the trustless gateways, accepts
// the FIRST block that re-derives against its CID (Law L5), and falls back to Delegated-Routing discovery.
export function makeGetBlock(fetchImpl, { gateways = IPFS_GATEWAYS, discover = true, timeoutMs = 9000 } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  const pull = async (gws, cidStr) => {
    const tasks = gws.map(async (g) => {
      // Time-box each gateway: a slow/blocked endpoint (e.g. a browser shield dropping the cross-origin
      // fetch) must FAIL FAST so Promise.any can settle and the caller surfaces a clear error, not a blank
      // hang. AbortController works in both the SW and Node.
      const ac = (typeof AbortController !== "undefined") ? new AbortController() : null;
      const to = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
      try {
        const r = await f(`${String(g).replace(/\/$/, "")}/ipfs/${cidStr}?format=raw`, { headers: { accept: "application/vnd.ipld.raw" }, ...(ac ? { signal: ac.signal } : {}) });
        if (!r || !r.ok) throw new Error("gateway " + (r && r.status));
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (!(await holoIpfs.verifyBlock(cidStr, bytes))) throw new Error("cid mismatch — gateway not trusted");
        return bytes;
      } finally { if (to) clearTimeout(to); }
    });
    try { return await Promise.any(tasks); } catch { return null; }
  };
  return async (cidStr) => {
    if (!f) return null;
    const cached = await blockCacheGet(cidStr); if (cached) return cached;   // L1/L2 — O(1), no network
    let b = await pull(gateways, cidStr);
    if (!b && discover) { try { const extra = await discoverGateways(cidStr, { fetchImpl: f }); if (extra.length) b = await pull(extra, cidStr); } catch {} }
    if (b) await blockCachePut(cidStr, b);                                   // verified block → unified κ-store
    return b;
  };
}
// Block cache — every CID-verified block is content-addressed (immutable), so cache it: L1 an in-memory hot
// map (O(1), no async), L2 the durable Cache API shared with the OS (holo-kappa-v2). Re-access of any block —
// a re-visited page, a shared chunk, a streamed file walked twice — is then network-free. The IPFS twin of
// the browser seam's L1/L2. No-op caching in Node (no `caches`); the L1 map still gives intra-run O(1).
const BLOCK_L1 = new Map();
async function blockCacheGet(cidStr) {
  const hot = BLOCK_L1.get(cidStr); if (hot) return hot;
  if (typeof caches === "undefined") return null;
  try { const c = await caches.open("holo-kappa-v2"); const r = await c.match("/.holo/ipfs/" + cidStr); if (r) { const b = new Uint8Array(await r.arrayBuffer()); BLOCK_L1.set(cidStr, b); return b; } } catch {}
  return null;
}
async function blockCachePut(cidStr, bytes) {
  BLOCK_L1.set(cidStr, bytes);
  if (typeof caches === "undefined") return;
  try { const c = await caches.open("holo-kappa-v2"); await c.put("/.holo/ipfs/" + cidStr, new Response(bytes, { headers: { "x-holo-cid": cidStr, "x-holo-verified": "L5" } })); } catch {}
}

// childCid(dirCid, name, getBlock) → the cid of a named link in a UnixFS/dag-pb directory, or null.
async function childCid(dirCid, name, getBlock) {
  const { parseCID, cidToString, decodeDagPb, CODEC } = holoIpfs;
  const cid = parseCID(dirCid);
  const block = await getBlock(cidToString(cid));
  if (!block) throw new Error("missing block " + String(dirCid).slice(0, 16) + "…");
  if (cid.codec !== CODEC.DAG_PB) return null;            // not a directory we can descend
  const node = decodeDagPb(block);
  for (const l of node.links) if ((l.name || "") === name) return cidToString(l.cid);
  return null;
}

// peekNode(cidStr, getBlock) → { kind:"directory"|"file"|"raw"|"missing", node?, block?, raw? } — decide a
// node's kind from its OWN block only (cheap; does NOT walk a file's whole DAG, unlike assembleUnixFs).
async function peekNode(cidStr, getBlock) {
  const { parseCID, cidToString, decodeDagPb, decodeUnixFs, UNIXFS, CODEC } = holoIpfs;
  const cid = parseCID(cidStr);
  const block = await getBlock(cidToString(cid));
  if (!block) return { kind: "missing" };
  if (cid.codec === CODEC.RAW) return { kind: "file", raw: true, block };
  if (cid.codec !== CODEC.DAG_PB) return { kind: "raw", block };
  const node = decodeDagPb(block);
  const u = node.data ? decodeUnixFs(node.data) : null;
  if (u && u.type === UNIXFS.Directory) return { kind: "directory", node, block };
  return { kind: "file", node, block };
}

// streamUnixFsFile(rootCid, getBlock) → ReadableStream of a file's bytes — walk the DAG IN ORDER and enqueue
// each leaf as it is fetched + re-derived to its CID (Law L5, in getBlock). A big file (video / large image /
// server-rendered page) starts rendering on its FIRST leaf instead of after the whole tree assembles. This is
// the κ-addressable object, STREAMED. Bounded by the DAG; blocks are O(1) on re-walk (block cache above).
export function streamUnixFsFile(rootCid, getBlock) {
  const { parseCID, cidToString, decodeDagPb, decodeUnixFs, CODEC } = holoIpfs;
  return new ReadableStream({
    async start(ctrl) {
      try {
        const walk = async (cidStr) => {
          const cid = parseCID(cidStr);
          const block = await getBlock(cidToString(cid));
          if (!block) throw new Error("missing block " + String(cidStr).slice(0, 16) + "…");
          if (cid.codec === CODEC.RAW) { ctrl.enqueue(block); return; }
          if (cid.codec !== CODEC.DAG_PB) { ctrl.enqueue(block); return; }
          const node = decodeDagPb(block);
          const u = node.data ? decodeUnixFs(node.data) : null;
          if (!node.links.length) { ctrl.enqueue((u && u.data) || new Uint8Array(0)); return; }
          if (u && u.data && u.data.length) ctrl.enqueue(u.data);   // inline head (rare)
          for (const l of node.links) await walk(cidToString(l.cid));
        };
        await walk(rootCid);
        ctrl.close();
      } catch (e) { ctrl.error(e); }
    },
  });
}

// resolveIpfsPath(root, path, getBlock) → a renderable result:
//   { kind:"file", cidStr, bytes, contentType, name, servedIndex? }
//   { kind:"directory", cidStr, entries:[{name,cid,size}] }
//   { kind:"error", reason, status }
// Path segments must be directories; the final node is assembled (file bytes) or listed (directory). A
// directory with an index.html serves it (the web's "open the folder → see the page" convention).
export async function resolveIpfsPath(root, path, getBlock) {
  const { parseCID, cidToString } = holoIpfs;
  let cur;
  try { cur = cidToString(parseCID(root)); } catch { return { kind: "error", reason: "not a CID: " + root, status: 400 }; }
  const segs = String(path || "").split("/").filter(Boolean);
  for (const seg of segs) {
    let next; try { next = await childCid(cur, seg, getBlock); } catch (e) { return { kind: "error", reason: (e && e.message) || String(e), status: 502 }; }
    if (next == null) return { kind: "error", reason: "no such path segment: " + seg, status: 404 };
    cur = next;
  }
  // PEEK the target node from its own block (cheap — does not assemble a whole file), then either list a
  // directory or hand back a STREAM factory for a file. The file's bytes are never buffered here.
  let peek; try { peek = await peekNode(cur, getBlock); } catch (e) { return { kind: "error", reason: (e && e.message) || String(e), status: 502 }; }
  if (peek.kind === "missing") return { kind: "error", reason: "missing block for " + cur, status: 502 };
  if (peek.kind === "directory") {
    const entries = peek.node.links.map((l) => ({ name: l.name, cid: cidToString(l.cid), size: l.tsize }));
    const idx = entries.find((e) => e.name === "index.html") || entries.find((e) => e.name === "index.htm");
    if (idx) return { kind: "file", cidStr: idx.cid, contentType: "text/html", name: idx.name, servedIndex: true, stream: () => streamUnixFsFile(idx.cid, getBlock) };
    return { kind: "directory", cidStr: cur, entries };
  }
  // file / raw → STREAM. A render contract DECLARED in the bytes wins (a self-describing object chooses how
  // it renders, S1); else the name extension; else sniff the raw leaf / the file's first leaf. For a single
  // raw leaf we hold the whole block, so dispatchRender can honor a UOR render-contract envelope right here.
  const name = segs.length ? segs[segs.length - 1] : "";
  let ct = null, renderKind = null;
  if (peek.raw) { const d = dispatchRender(peek.block, name); ct = d.contentType; if (d.declared) renderKind = d.kind; }
  if (!ct) ct = mimeOf(name);
  if (!ct && peek.node && peek.node.links && peek.node.links.length) { try { const first = await getBlock(cidToString(peek.node.links[0].cid)); if (first) ct = sniff(first, name); } catch {} }
  if (!ct && peek.node && !(peek.node.links || []).length && peek.node.data) { try { const u = holoIpfs.decodeUnixFs(peek.node.data); if (u && u.data) ct = sniff(u.data, name); } catch {} }
  if (!ct) ct = "application/octet-stream";
  return { kind: "file", cidStr: cur, contentType: ct, name, ...(renderKind ? { renderKind } : {}), stream: () => streamUnixFsFile(cur, getBlock) };
}

// ── the navigation reporter — a tiny script injected into served HTML (a COPY of already-verified bytes,
//    the same discipline as the OS subpath rewrite). It reports the iframe's current URL UP to the shell so
//    the omnibox address bar tracks the journey, and nudges a report after each in-page link click. The
//    page's own bytes are unchanged on the wire/in the κ — this rides only on the rendered copy. ──
export function navReporter() {
  return "<script>(function(){try{"
    + "var rep=function(){try{var bt=((document.body&&document.body.innerText)||'').replace(/\\s+/g,' ').trim().slice(0,6000);parent.postMessage({type:'holo-ipfs:nav',url:location.href,title:document.title,text:bt},'*')}catch(e){}};"
    + "rep();addEventListener('load',rep);addEventListener('hashchange',rep);addEventListener('popstate',rep);"
    + "addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(a)setTimeout(rep,40);},true);"
    + "}catch(e){}})();</script>";
}
export function injectNavReporter(htmlText) {
  const s = navReporter();
  if (/<head[^>]*>/i.test(htmlText)) return htmlText.replace(/<head[^>]*>/i, (m) => m + s);
  if (/<html[^>]*>/i.test(htmlText)) return htmlText.replace(/<html[^>]*>/i, (m) => m + s);
  return s + htmlText;
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const human = (n) => { n = +n || 0; if (n < 1024) return n + " B"; if (n < 1048576) return (n / 1024).toFixed(1) + " KB"; if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB"; return (n / 1073741824).toFixed(2) + " GB"; };
const looksDir = (name) => !/\.[a-z0-9]{1,8}$/i.test(name || "");   // no extension → probably a directory (the SW redirects either way)

// directoryListingHtml(root, path, entries) — a beautiful, native Hologram listing. Links are RELATIVE to the
// directory's URL (served with a trailing slash), so clicking an entry browses deeper through the gateway.
export function directoryListingHtml(root, path, entries) {
  const crumbs = String(path || "").split("/").filter(Boolean);
  const trail = crumbs.length ? " / " + crumbs.map(esc).join(" / ") : "";
  const rows = (entries || []).map((e) => {
    const dir = looksDir(e.name);
    const href = esc(e.name) + (dir ? "/" : "");
    return `<a class="row" href="${href}"><span class="ic">${dir ? "📁" : "📄"}</span><span class="nm">${esc(e.name)}</span><span class="sz">${e.size != null ? human(e.size) : ""}</span><span class="cid">${esc(String(e.cid).slice(0, 14))}…</span></a>`;
  }).join("");
  const up = crumbs.length ? `<a class="row up" href="../"><span class="ic">↑</span><span class="nm">..</span></a>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ipfs://${esc(root)}${trail ? trail : "/"}</title>
<style>
  :root{--bg:#05070d;--panel:#0c111b;--panel2:#121a28;--line:#1d2840;--ink:#e8eef9;--dim:#7d8aa6;--accent:#a78bfa;--good:#34d399;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
  *{box-sizing:border-box} html,body{margin:0} body{background:radial-gradient(1000px 540px at 50% -10%,#0b1426,var(--bg) 60%);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;padding:34px 22px 70px}
  .wrap{max-width:880px;margin:0 auto}
  .hd{display:flex;align-items:center;gap:12px;margin:0 0 4px} .hd .glyph{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;background:#2a2150;color:#cbb8ff;font-size:17px;flex:none}
  h1{font-size:17px;font-weight:650;margin:0;letter-spacing:-.01em} .sub{color:var(--dim);font:11.5px var(--mono);margin:2px 0 22px;word-break:break-all}
  .sub .ok{color:var(--good)}
  .list{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
  .row{display:flex;align-items:center;gap:13px;padding:11px 16px;border-bottom:1px solid #131a28;text-decoration:none;color:var(--ink);transition:.1s} .row:last-child{border:0}
  .row:hover{background:#0e1726} .row.up{color:var(--dim)}
  .ic{width:22px;text-align:center;flex:none;font-size:14px} .nm{flex:1;word-break:break-all} .sz{color:var(--dim);font:11.5px var(--mono);flex:none} .cid{color:#4a5573;font:10.5px var(--mono);flex:none;margin-left:6px}
  .foot{color:#4a5573;font:11px var(--mono);margin-top:18px;text-align:center}
</style></head><body>
<div class="wrap">
  <div class="hd"><div class="glyph">⬡</div><h1>Index of ${trail ? esc("/" + crumbs.join("/")) : "/"}</h1></div>
  <div class="sub">ipfs://${esc(root)}${trail ? esc("/" + crumbs.join("/")) : ""} · <span class="ok">✓ ${(entries || []).length} entries · verified by re-derivation (Law L5)</span></div>
  <div class="list">${up}${rows || '<div class="row"><span class="ic">∅</span><span class="nm" style="color:var(--dim)">empty directory</span></div>'}</div>
  <div class="foot">content-addressed · gateway-trustless · every block re-hashed to its CID</div>
</div></body></html>`;
}

// ipfsErrorHtml(p, out) — a clear, native failure page (not a raw gateway error).
export function ipfsErrorHtml(p, out) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ipfs · ${esc(out.status || "")}</title>
<style>body{margin:0;background:radial-gradient(900px 480px at 50% -10%,#0b1426,#05070d 60%);color:#e8eef9;font:15px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;display:grid;place-items:center;padding:30px}.c{max-width:520px;text-align:center}.g{font-size:34px}.t{font-size:16px;font-weight:650;margin:12px 0 6px}.s{color:#7d8aa6;font:12px ui-monospace,monospace;word-break:break-all}.r{color:#f87171;margin-top:10px;font:12.5px ui-monospace,monospace}</style></head>
<body><div class="c"><div class="g">⬡</div><div class="t">Couldn't resolve this object</div><div class="s">ipfs://${esc(p.root)}${p.path ? "/" + esc(p.path) : ""}</div><div class="r">${esc(out.reason || "no source served a verified copy")} · ${esc(out.status || 502)}</div></div></body></html>`;
}

export default { parseIpfsPath, makeGetBlock, resolveIpfsPath, directoryListingHtml, ipfsErrorHtml, injectNavReporter, navReporter, mimeOf, sniff, dispatchRender };
