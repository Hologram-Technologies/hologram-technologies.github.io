// holo-onion-rewrite.mjs — make a fetched .onion page RENDER like web2 and be BROWSABLE.
//
// The problem: an onion page's sub-resources (css, img, script, fonts) and links are onion-relative. A plain
// iframe would try to load them over the clearnet and fail — the page paints naked and its links are dead.
// The fix: rewrite the document so every URL that resolves to a .onion flows back through the SAME onion
// transport, while clearnet URLs are left absolute (they load normally). Now the whole resource graph is
// carried over Tor, the page looks real, and clicking a link opens the next onion page — real browsing.
//
// Pure + transport-agnostic: `proxy(absUrl)` maps an absolute onion URL to however THIS context reaches it
// (the local bring-up passes `u => "/onion?url="+enc(u)`; the production ladder passes its own mapper). No
// network here — just string transforms — so it is unit-witnessable offline.

const ONION_HOST_RE = /^[a-z2-7]{16}\.onion$|^[a-z2-7]{56}\.onion$/i;
const SKIP_SCHEME_RE = /^(data:|blob:|javascript:|mailto:|tel:|#|about:)/i;

function isOnionAbs(abs) {
  try { return ONION_HOST_RE.test(new URL(abs).hostname); } catch { return false; }
}

// resolve `value` against `pageUrl`; return the proxied string for onion targets, the absolute URL for
// clearnet, or the original value when it is a scheme we must not touch.
function mapUrl(value, pageUrl, proxy) {
  const v = (value || "").trim();
  if (!v || SKIP_SCHEME_RE.test(v)) return value;
  let abs; try { abs = new URL(v, pageUrl).href; } catch { return value; }
  return isOnionAbs(abs) ? proxy(abs) : abs;
}

// rewrite a srcset value (comma-separated `url descriptor`) URL-by-URL.
function mapSrcset(value, pageUrl, proxy) {
  return value.split(",").map((part) => {
    const seg = part.trim(); if (!seg) return part;
    const sp = seg.indexOf(" ");
    const url = sp < 0 ? seg : seg.slice(0, sp);
    const desc = sp < 0 ? "" : seg.slice(sp);
    return mapUrl(url, pageUrl, proxy) + desc;
  }).join(", ");
}

// rewrite url(...) inside CSS (both <style> blocks/inline style and standalone .css responses) + @import.
export function rewriteCss(css, pageUrl, proxy) {
  return String(css)
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => `url(${q}${mapUrl(u, pageUrl, proxy)}${q})`)
    .replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import ${q}${mapUrl(u, pageUrl, proxy)}${q}`);
}

// rewrite an HTML document. Attributes that carry URLs + inline styles + <style> blocks. `<base>` is stripped
// (we resolve against pageUrl ourselves; a surviving <base> would send the browser off-Tor).
export function rewriteHtml(html, pageUrl, proxy) {
  let out = String(html);
  out = out.replace(/<base\b[^>]*>/gi, "");                                   // neutralize base — we own resolution
  // url-bearing attributes: href, src, poster, action, formaction, data (for <object>)
  out = out.replace(/\b(href|src|poster|action|formaction|data)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'<>`]+))/gi,
    (m, attr, _raw, dq, sq, uq) => {
      const val = dq != null ? dq : sq != null ? sq : uq;
      const mapped = mapUrl(val, pageUrl, proxy);
      return `${attr}="${mapped.replace(/"/g, "%22")}"`;
    });
  out = out.replace(/\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _raw, dq, sq) => {
    const val = dq != null ? dq : sq; return `srcset="${mapSrcset(val, pageUrl, proxy).replace(/"/g, "%22")}"`;
  });
  out = out.replace(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _raw, dq, sq) => {
    const val = dq != null ? dq : sq; return `style="${rewriteCss(val, pageUrl, proxy).replace(/"/g, "%22")}"`;
  });
  out = out.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, attrs, body) => `<style${attrs}>${rewriteCss(body, pageUrl, proxy)}</style>`);
  return out;
}

export const defaultProxy = (abs) => "/onion?url=" + encodeURIComponent(abs);
export default { rewriteHtml, rewriteCss, defaultProxy };
