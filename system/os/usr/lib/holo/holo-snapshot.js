// holo-snapshot.js — Save any web2 page to the dweb. The web2 web is location-addressed
// and mutable: a URL is a promise that can change or vanish, and you must trust the server.
// This turns a live page into a SINGLE self-contained HTML file (stylesheets inlined,
// images/fonts as data URLs, scripts neutralized for a safe archive, provenance stamped),
// which Holo IPFS then content-addresses (UnixFS → CID) — so it becomes PERMANENT,
// VERIFIABLE (re-derives to its CID, Law L5), OWNED (in the κ-store), and a first-class
// object in the same substrate as IPFS/ENS/holospaces. An archive, honestly: it captures
// what was fetched at save time (the origin web2 server is not itself content-addressed),
// but from then on the snapshot is self-verifying and can never silently change.
//
// Pure, dependency-free, and DOM-free (regex rewriting) so it runs identically in the page
// and in the Node witness. The network fetch is INJECTED (getResource), so it's testable.

const enc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function resolveUrl(href, base) { try { return new URL(href, base).href; } catch { return null; } }
const utf8 = (bytes) => new TextDecoder().decode(bytes);
function base64(bytes) {
  let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return (typeof btoa === "function") ? btoa(s) : Buffer.from(bytes).toString("base64");
}
const dataUrl = (r) => `data:${(r.contentType || "application/octet-stream").split(";")[0]};base64,${base64(r.bytes)}`;

// getResource(absUrl) → { bytes, contentType } | null  (injected: proxy / direct / fixture)
export async function inlineHtml(html, baseUrl, getResource, opts = {}) {
  let out = String(html);
  // 1) neutralize scripts — a content archive that renders safely sandboxed
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<!-- script removed by Holo snapshot -->");
  out = out.replace(/<script\b[^>]*\/>/gi, "");
  // 2) inline <link rel=stylesheet> → <style>, and favicons → data URL
  for (const tag of out.match(/<link\b[^>]*>/gi) || []) {
    const rel = (tag.match(/rel\s*=\s*["']?([^"'>\s]+)/i) || [])[1] || "";
    const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1]; if (!href) continue;
    const abs = resolveUrl(href, baseUrl); if (!abs) continue;
    try {
      if (/stylesheet/i.test(rel)) { const r = await getResource(abs); if (r) out = out.replace(tag, `<style data-holo-from="${enc(abs)}">\n${utf8(r.bytes)}\n</style>`); }
      else if (/icon/i.test(rel)) { const r = await getResource(abs); if (r) out = out.replace(tag, tag.replace(href, dataUrl(r))); }
    } catch {}
  }
  // 3) inline <img src> (drop srcset so the data URL is used)
  for (const tag of out.match(/<img\b[^>]*>/gi) || []) {
    const src = (tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1]; if (!src || /^data:/i.test(src)) continue;
    const abs = resolveUrl(src, baseUrl); if (!abs) continue;
    try { const r = await getResource(abs); if (r) out = out.replace(tag, tag.replace(/\ssrcset\s*=\s*["'][^"']*["']/i, "").replace(src, dataUrl(r))); } catch {}
  }
  // 4) <base> for any leftover relative links + provenance the substrate can read
  const at = opts.at || new Date().toISOString();
  const inject = `<base href="${enc(baseUrl)}"><meta name="holo-source" content="${enc(baseUrl)}"><meta name="holo-archived" content="${enc(at)}">`;
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => m + inject) : inject + out;
  return `<!-- Holo IPFS snapshot · ${enc(baseUrl)} · ${enc(at)} · self-verifying from here on -->\n` + out;
}

// What the snapshot links to (for provenance / the UOR object) — discovered, not fetched.
export function resources(html, baseUrl) {
  const urls = new Set();
  for (const m of String(html).matchAll(/<(?:link|img|script)\b[^>]*\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) { const a = resolveUrl(m[1], baseUrl); if (a) urls.add(a); }
  return [...urls];
}

export const VERSION = "holo-snapshot 1.0";
