// holo-render-block.mjs — R0 of HOLO-INTENT-RENDER: the block contract + seal + sandboxed mount.
//
// A "render-block" is ONE self-contained surface — a whole tiny HTML document (its own <style> + <script>),
// the smallest thing the platform can run as an app (Playground's block shape). Two operations:
//   sealBlock(html) → κ      content-address the block (blake3, Law L1) for identity / share / relaunch
//   mountBlock(html, host)   run it in a SANDBOXED iframe (srcdoc; sandbox="allow-scripts" and — crucially —
//                            NO allow-same-origin) → the frame is a UNIQUE OPAQUE ORIGIN: it cannot reach
//                            window.parent/top, the home DOM, cookies, or same-origin storage. Zero ambient
//                            authority (L-SANDBOX). Extra caps come ONLY via an explicit `grant`.
//
// Rendered blocks live CLIENT-SIDE (κ→bytes in IndexedDB, fail-soft to memory) so they relaunch + share with
// no server — seal = deploy, κ = address, `#space=<κ>` = the link. Every resolve re-derives the κ (Law L5):
// a tampered store can't forge a block. R0 ships a HAND-AUTHORED library (NO LLM); R1 lets Q author blocks.
import { kappo, kappoVerify } from "./holo-kappa.mjs";

const enc = new TextEncoder();
const norm = (h) => String(h == null ? "" : h);

// ── the seal (identity) ──────────────────────────────────────────────────────────────────────────────────
export const sealBlock = (html) => kappo(enc.encode(norm(html)));             // → "did:holo:blake3:<hex>"
export const verifyBlock = (html, k) => kappoVerify(enc.encode(norm(html)), k);

// ── client-side block store (κ → bytes): relaunch + share, no server. IndexedDB, fail-soft to memory. ──────
const _mem = new Map();
let _dbP = null;
function db() {
  if (_dbP) return _dbP;
  _dbP = new Promise((res) => {
    try {
      const r = indexedDB.open("holo-render", 1);
      r.onupgradeneeded = () => { try { r.result.createObjectStore("blocks"); } catch (e) {} };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch (e) { res(null); }
  });
  return _dbP;
}
async function idbPut(k, html) { const d = await db(); if (!d) return; try { d.transaction("blocks", "readwrite").objectStore("blocks").put(html, k); } catch (e) {} }
async function idbGet(k) { const d = await db(); if (!d) return null; return new Promise((res) => { try { const rq = d.transaction("blocks", "readonly").objectStore("blocks").get(k); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null); } catch (e) { res(null); } }); }

// seal + persist; returns the κ. Idempotent (identical bytes → identical κ).
export async function putBlock(html) { html = norm(html); const k = sealBlock(html); _mem.set(k, html); try { await idbPut(k, html); } catch (e) {} return k; }
// resolve a κ back to VERIFIED bytes — re-derives (Law L5), so a tampered store can't forge a block.
export async function getBlock(k) {
  let html = _mem.has(k) ? _mem.get(k) : await idbGet(k);
  if (html == null) return null;
  if (!verifyBlock(html, k)) return null;   // L-VERIFY: refuse bytes that don't re-derive to κ
  return html;
}

// ── the sandboxed mount ──────────────────────────────────────────────────────────────────────────────────
// Mount a block into a sandboxed iframe inside `host`. Returns { kappa, el, destroy }. `opts.grant` is an
// array of extra sandbox tokens the caller has decided to allow (governance's job, not the block's).
export function mountBlock(html, host, opts) {
  html = norm(html); opts = opts || {};
  const kappa = sealBlock(html);
  const f = document.createElement("iframe");
  const caps = ["allow-scripts"].concat(Array.isArray(opts.grant) ? opts.grant : []);
  f.setAttribute("sandbox", caps.join(" "));      // L-SANDBOX — allow-scripts only unless explicitly granted
  f.setAttribute("referrerpolicy", "no-referrer");
  f.setAttribute("title", opts.name || "Rendered app");
  f.setAttribute("data-holo-kappa", kappa);
  f.style.cssText = "width:100%;height:100%;border:0;background:#0f0f10;display:block;";
  f.srcdoc = html;
  host.appendChild(f);
  return { kappa: kappa, el: f, destroy: function () { try { f.src = "about:blank"; } catch (e) {} try { f.remove(); } catch (e) {} } };
}

// Mount by κ (relaunch / share): resolve verified bytes, then mount. null if unknown or tampered.
export async function mountKappa(k, host, opts) { const html = await getBlock(k); if (html == null) return null; return mountBlock(html, host, opts); }

// ── the hand-authored library (R0 — NO LLM). Each value is a whole self-contained block document. Blocks are
//    SANDBOXED (null origin) → they use no storage/parent; state is in-session, which is correct for R0. ──────
const _doc = (title, style, body, script) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
  `<title>${title}</title><style>*{box-sizing:border-box}html,body{margin:0;height:100%}` +
  `body{font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#f2f2f0;background:#0f0f10;` +
  `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;text-align:center}` +
  `button{font:inherit;color:inherit;background:#26262a;border:0;border-radius:12px;min-height:48px;padding:0 20px;cursor:pointer}` +
  `button:active{background:#33333a}${style}</style></head><body>${body}<script>${script}<\/script></body></html>`;

export const LIBRARY = {
  timer: _doc("Timer",
    `.big{font-size:64px;font-weight:200;letter-spacing:.02em;font-variant-numeric:tabular-nums}.row{display:flex;gap:10px}input{font:inherit;width:70px;text-align:center;color:inherit;background:#1b1b1e;border:0;border-radius:10px;min-height:48px}`,
    `<div class=big id=t>00:00</div><div class=row><input id=m type=number min=0 max=180 value=5 aria-label=minutes> <button id=go>Start</button> <button id=rz>Reset</button></div>`,
    `var end=0,iv=0,t=document.getElementById('t');function paint(){var ms=Math.max(0,end-Date.now()),s=Math.ceil(ms/1000);t.textContent=(s/60|0).toString().padStart(2,'0')+':'+(s%60).toString().padStart(2,'0');if(ms<=0){clearInterval(iv);iv=0;}}document.getElementById('go').onclick=function(){var mins=+document.getElementById('m').value||0;end=Date.now()+mins*60000;clearInterval(iv);iv=setInterval(paint,250);paint();};document.getElementById('rz').onclick=function(){clearInterval(iv);iv=0;end=0;t.textContent='00:00';};`),
  clock: _doc("Clock",
    `.big{font-size:60px;font-weight:200;font-variant-numeric:tabular-nums}.d{opacity:.6;font-size:18px}`,
    `<div class=big id=c>--:--:--</div><div class=d id=d></div>`,
    `function tick(){var n=new Date();document.getElementById('c').textContent=n.toLocaleTimeString();document.getElementById('d').textContent=n.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});}tick();setInterval(tick,1000);`),
  note: _doc("Note",
    `textarea{flex:1;width:100%;max-width:520px;font:inherit;color:inherit;background:#161618;border:0;border-radius:14px;padding:16px;resize:none}.h{opacity:.5;font-size:14px}`,
    `<div class=h>a calm note — yours, on your device</div><textarea id=n placeholder="type…" autofocus></textarea>`,
    `/* sandboxed null-origin: no storage by design (L-SANDBOX). R2 will persist via the host + κ. */`),
};
export function libNames() { return Object.keys(LIBRARY); }
