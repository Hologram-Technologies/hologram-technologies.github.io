// holo-mobile-defaults.mjs — the ONE pure, isomorphic helper that guarantees an app's HTML carries the
// mobile + PWA-standalone essentials, however it was produced (imported from GitHub, Forge-bundled, …).
//
// Pure string transforms (Node + browser run identical logic — the witnesses drive it headless), and
// IDEMPOTENT: it only ADDS what is missing, never rewrites authored markup, so re-running is a no-op and
// the app's κ is deterministic (same input → same output, Law L5). The standard it ensures is the vendored
// holo-mobile.css (WCAG 2.2 §1.4.10 Reflow / §2.5.8 Target Size + MD3 48dp) + the container-query
// window-size classes + PWA installability (display:standalone via the metas below). The build path
// (scaffold) links these directly; the share paths (import · Forge) route their HTML through here, so
// every app is mobile-correct AND installable at birth, with zero per-app effort.

const MOBILE_CSS = "/_shared/holo-mobile.css";

export function ensureMobileHead(html, opts = {}) {
  if (typeof html !== "string" || !html) return html;
  let out = html;
  const cssHref = opts.cssHref || MOBILE_CSS;

  // 1) the <html> element carries data-holo-surface → the `holoapp` container, so the app reflows to its
  //    WINDOW width (Compact on a phone OR in a small desktop window), not the device viewport.
  if (/<html\b/i.test(out)) {
    out = out.replace(/<html\b([^>]*)>/i, (m, attrs) =>
      /data-holo-surface/i.test(attrs) ? m : "<html" + attrs + " data-holo-surface>");
  } else {
    out = "<html data-holo-surface>" + out;
  }

  // ensure a <head> to inject into (degenerate fragments get one)
  if (!/<head\b/i.test(out)) {
    out = /<html\b[^>]*>/i.test(out)
      ? out.replace(/(<html\b[^>]*>)/i, "$1<head></head>")
      : "<head></head>" + out;
  }

  // 2) viewport-fit=cover (honor the notch / home-indicator, incl. installed standalone)
  const vp = out.match(/<meta\s+name=["']?viewport[^>]*>/i);
  if (!vp) {
    // appended below with the rest
  } else if (!/viewport-fit/i.test(vp[0])) {
    out = out.replace(/(<meta\s+name=["']?viewport[^>]*content=["'])([^"']*)(["'])/i,
      (m, a, c, z) => a + c + (c ? ", " : "") + "viewport-fit=cover" + z);
  }

  // 3) collect the still-missing head pieces and inject them once
  const add = [];
  if (!vp) add.push('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />');
  if (!/holo-mobile\.css/i.test(out)) add.push('<link rel="stylesheet" href="' + cssHref + '" data-holo-injected="mobile" />');
  if (!/name=["']?theme-color/i.test(out)) add.push('<meta name="theme-color" content="#0d0d0f" />');
  if (!/apple-mobile-web-app-capable/i.test(out))
    add.push('<meta name="apple-mobile-web-app-capable" content="yes" /><meta name="mobile-web-app-capable" content="yes" /><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />');

  if (add.length) out = out.replace(/<head\b([^>]*)>/i, (m) => m + add.join(""));
  return out;
}

export default ensureMobileHead;
