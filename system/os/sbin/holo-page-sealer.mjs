// holo-page-sealer.mjs — auto-seal a browsed page into a SELF-CONTAINED κ-snapshot (the commons leg, live in
// the browser). It collects the page's HTML + the subresources the κ-store already minted, REWRITES the HTML so
// every asset points at a flat name INSIDE the snapshot (and drops the injected <base>), then seals the lot into
// a real IPFS κ-DAG (holo-web-snapshot.mjs). Re-served from /ipfs/<rootCid>/, the page loads entirely from the
// commons — zero egress, no origin, re-derived (L5). Pure core (fetchResource injected) → Node-witnessable.

import { sealSnapshot, publishToKStore } from "./holo-web-snapshot.mjs";

const extOf = (u) => { const m = String(u).split(/[?#]/)[0].match(/\.([a-z0-9]{1,6})$/i); return m ? m[1].toLowerCase() : "bin"; };

// sealPage({ pageUrl, html, fetchResource, assetUrls? }) → { rootCid, did, blocks, html, assets } | throws.
// fetchResource(absUrl) → Promise<Uint8Array|ArrayBuffer|null> (served from the κ-store O(1) in the browser; a
// fixture in the witness). assetUrls (optional) = extra URLs from Resource Timing the HTML scan might miss.
export async function sealPage({ pageUrl, html, fetchResource, assetUrls = null }) {
  const abs = (u) => { try { return new URL(u, pageUrl).href; } catch { return null; } };
  // candidate assets: src/href in the HTML + any provided (Resource Timing). Same-doc/non-http skipped.
  const cand = new Set();
  for (const m of String(html).matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) { const a = abs(m[1]); if (a && /^https?:/i.test(a) && a !== pageUrl) cand.add(a); }
  if (assetUrls) for (const u of assetUrls) { const a = abs(u); if (a && /^https?:/i.test(a) && a !== pageUrl) cand.add(a); }
  // deterministic naming → a stable rootCid for identical input
  const urls = [...cand].sort();
  const byUrl = new Map(); let i = 0;
  for (const u of urls) {
    let bytes = null; try { bytes = await fetchResource(u); } catch {}
    if (!bytes) continue; const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length) byUrl.set(u, { name: "r" + (i++) + "." + extOf(u), bytes: b });
  }
  // rewrite: drop the injected <base> (the snapshot is self-contained), point each captured asset at its flat name
  let out = String(html).replace(/<base\b[^>]*>/gi, "");
  out = out.replace(/(\b(?:src|href)\s*=\s*["'])([^"']+)(["'])/gi, (full, pre, ref, post) => { const a = abs(ref); const e = a && byUrl.get(a); return e ? pre + e.name + post : full; });
  const resources = [{ name: "index.html", bytes: new TextEncoder().encode(out) }, ...[...byUrl.values()].map((v) => ({ name: v.name, bytes: v.bytes }))];
  const snap = await sealSnapshot({ resources });
  return { ...snap, html: out, assets: [...byUrl.entries()].map(([url, v]) => ({ url, name: v.name, size: v.bytes.length })) };
}

// sealCurrentPage(opts) — the BROWSER entry: seal the page this code runs in (its live DOM + Resource-Timing
// assets, all served from the κ-store) and PUBLISH the blocks to the local commons, so the same page re-serves
// from /ipfs/<rootCid>/ with zero egress. Returns { addr:"ipfs://<rootCid>", rootCid, blocks, assets } | null.
export async function sealCurrentPage({ pageUrl = null, publish = true } = {}) {
  if (typeof document === "undefined") return null;
  const url = pageUrl
    || (document.querySelector('meta[name="holo-source"]') || {}).content   // browser-sw stamps the real origin
    || location.href;
  const html = "<!doctype html>" + document.documentElement.outerHTML;
  let assetUrls = [];
  try { assetUrls = performance.getEntriesByType("resource").map((e) => e.name); } catch {}
  const snap = await sealPage({ pageUrl: url, html, assetUrls, fetchResource: async (u) => { try { const r = await fetch(u); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; } } });
  if (publish) { try { await publishToKStore(snap.blocks); } catch {} }
  return { addr: "ipfs://" + snap.rootCid, rootCid: snap.rootCid, did: snap.did, blocks: snap.blocks, assets: snap.assets, source: url };
}

export default { sealPage, sealCurrentPage };
