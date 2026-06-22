// holo-q-design-conscience.mjs — beauty as an INVARIANT (S4). Model output is not trusted to be on-brand; it
// is audited against the holo product/UX spec and REPAIRED before render. Deterministic: raw colors snap to the
// nearest --holo-* token, ad-hoc spacing snaps to the token scale, the token :root (dark-default) is injected so
// every var() resolves, a responsive viewport meta is ensured, and <img> get alt text (a11y). enforce() is
// idempotent — once repaired, a re-audit is clean. Pure + sync → Node-witnessed; the codegen calls enforce()
// on each build/edit so "well-formatted and beautiful" is verified, not hoped (verify-before-use, like L5).
//
//   audit(html)   -> { violations:[{rule,detail}], clean:boolean }
//   repair(html)  -> { html, fixed:[{rule,...}] }
//   enforce(html) -> { html, fixed, clean }            // repair, then confirm the result audits clean
//   TOKENS, SPACE                                       // the holo design vocabulary

// the holo dark design tokens (canonical values; the OS uses these --holo-* names).
export const TOKENS = {
  "--holo-bg": "#0b0e16", "--holo-surface": "#161a26", "--holo-elevate": "#1e2230",
  "--holo-fg": "#cdd6f4", "--holo-muted": "#8b8b92", "--holo-border": "#2a2a31",
  "--holo-accent": "#2563eb", "--holo-accent-2": "#7c3aed", "--holo-success": "#22c55e", "--holo-danger": "#ef4444",
};
export const SPACE = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64];

const hexToRgb = (h) => {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const parseColor = (c) => {
  c = c.trim();
  if (c[0] === "#") return hexToRgb(c);
  const m = /rgba?\(([^)]+)\)/i.exec(c); if (m) { const p = m[1].split(",").map((x) => parseFloat(x)); return [p[0] | 0, p[1] | 0, p[2] | 0]; }
  return null;
};
const TOKEN_RGB = Object.entries(TOKENS).map(([name, hex]) => ({ name, rgb: hexToRgb(hex) }));
function nearestToken(color) {
  const rgb = parseColor(color); if (!rgb) return null;
  let best = null, bd = Infinity;
  for (const t of TOKEN_RGB) { const d = (rgb[0] - t.rgb[0]) ** 2 + (rgb[1] - t.rgb[1]) ** 2 + (rgb[2] - t.rgb[2]) ** 2; if (d < bd) { bd = d; best = t.name; } }
  return best;
}
const snapSpace = (px) => SPACE.reduce((a, b) => (Math.abs(b - px) < Math.abs(a - px) ? b : a), SPACE[0]);

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;
const SPACING_RE = /\b(margin|padding|gap)(-(?:top|right|bottom|left))?\s*:\s*([^;}"']+)/gi;
const TOKEN_MARK = "/*holo-tokens*/";

// transform a chunk of CSS: raw colors → token vars; ad-hoc margin/padding/gap px → space-scale token vars.
function fixCss(css) {
  css = css.replace(COLOR_RE, (m) => { const t = nearestToken(m); return t ? `var(${t})` : m; });
  css = css.replace(SPACING_RE, (full, prop, side, val) => {
    const v2 = val.replace(/(\d+(?:\.\d+)?)px/g, (mm, num) => `var(--holo-space-${snapSpace(parseFloat(num))})`);
    return full.slice(0, full.length - val.length) + v2;
  });
  return css;
}

// apply fixCss to every <style> block (except the injected token root) and every style="" attribute.
function fixAllCss(html) {
  // style blocks
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, body) => (body.includes(TOKEN_MARK) ? full : full.replace(body, fixCss(body))));
  // inline style attributes
  html = html.replace(/\sstyle\s*=\s*"([^"]*)"/gi, (full, body) => ` style="${fixCss(body)}"`);
  return html;
}

function tokenRootCss() {
  const vars = Object.entries(TOKENS).map(([k, v]) => `${k}:${v}`).join(";");
  const spaces = SPACE.map((n) => `--holo-space-${n}:${n}px`).join(";");
  return `${TOKEN_MARK}:root{color-scheme:dark;${vars};${spaces};--holo-radius:10px}body{background:var(--holo-bg);color:var(--holo-fg)}`;
}

const hasTokens = (h) => h.includes(TOKEN_MARK);
const hasViewport = (h) => /<meta[^>]+name\s*=\s*["']?viewport/i.test(h);

function injectIntoHead(html, snippet) {
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/(<head\b[^>]*>)/i, `$1${snippet}`);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/(<html\b[^>]*>)/i, `$1<head>${snippet}</head>`);
  return snippet + html;   // a fragment → prepend
}

// ── audit ─────────────────────────────────────────────────────────────────────────────────────────────────
export function audit(html) {
  const s = String(html == null ? "" : html);
  const violations = [];
  // raw colors outside the token root
  const cssSurfaces = (s.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || []).filter((b) => !b.includes(TOKEN_MARK)).join("\n")
    + (s.match(/\sstyle\s*=\s*"([^"]*)"/gi) || []).join("\n");
  const rawColors = cssSurfaces.match(COLOR_RE) || [];
  if (rawColors.length) violations.push({ rule: "raw-color", detail: `${rawColors.length} raw color(s) not using --holo-* tokens` });
  // off-scale spacing
  let offScale = 0; let m;
  const re = new RegExp(SPACING_RE.source, "gi");
  while ((m = re.exec(cssSurfaces))) { const nums = (m[3].match(/(\d+(?:\.\d+)?)px/g) || []).map((x) => parseFloat(x)); for (const num of nums) if (!SPACE.includes(num)) offScale++; }
  if (offScale) violations.push({ rule: "off-scale-spacing", detail: `${offScale} spacing value(s) off the token scale` });
  if (!hasTokens(s)) violations.push({ rule: "no-tokens-root", detail: "missing the --holo-* token :root (dark-default + resolvable vars)" });
  if (!hasViewport(s) && /<html\b/i.test(s)) violations.push({ rule: "no-viewport", detail: "missing responsive viewport meta" });
  const imgsNoAlt = (s.match(/<img\b(?![^>]*\salt\s*=)[^>]*>/gi) || []).length;
  if (imgsNoAlt) violations.push({ rule: "img-no-alt", detail: `${imgsNoAlt} <img> without alt (a11y)` });
  return { violations, clean: violations.length === 0 };
}

// ── repair ────────────────────────────────────────────────────────────────────────────────────────────────
// repair(html, { fragment }) — fragment:true is for a single ELEMENT edit (S3): apply the token/spacing/alt
// fixes but DON'T inject the document-level token :root or viewport (those belong to the app, not an element).
export function repair(html, opts = {}) {
  let s = String(html == null ? "" : html);
  const fixed = [];
  const before = audit(s);
  s = fixAllCss(s);                                                       // colors → tokens, spacing → scale
  if (before.violations.some((v) => v.rule === "raw-color")) fixed.push({ rule: "raw-color" });
  if (before.violations.some((v) => v.rule === "off-scale-spacing")) fixed.push({ rule: "off-scale-spacing" });
  if (!opts.fragment) {
    if (!hasTokens(s)) { s = injectIntoHead(s, `<style>${tokenRootCss()}</style>`); fixed.push({ rule: "tokens-root" }); }   // dark-default + resolvable vars
    if (!hasViewport(s) && /<html\b/i.test(s)) { s = injectIntoHead(s, `<meta name="viewport" content="width=device-width, initial-scale=1">`); fixed.push({ rule: "viewport" }); }
  }
  s = s.replace(/<img\b(?![^>]*\salt\s*=)([^>]*?)(\/?)>/gi, (full, attrs, sc) => { fixed.push({ rule: "img-alt" }); return `<img${attrs} alt=""${sc}>`; });
  return { html: s, fixed };
}

export function enforce(html, opts = {}) {
  const r = repair(html, opts);
  const a = audit(r.html);
  return { html: r.html, fixed: r.fixed, clean: a.clean, remaining: a.violations };
}

export default { audit, repair, enforce, TOKENS, SPACE };
