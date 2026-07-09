// render/markdown.js — the message rendering pipeline over the vendored, κ-pinned libraries:
// markdown-it (GFM) → math ($…$ / $$…$$ → KaTeX) → fenced code (highlight.js) → mermaid (lazy)
// → DOMPurify sanitize. All local files, zero CDN (the audit gate forbids external URLs).
// Pipeline order mirrors LibreChat's renderer: remark gfm/math → rehype katex → highlight.

const here = (p) => new URL(p, import.meta.url).href;

let _ready = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
}
function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l);
}

export function initMarkdown() {
  if (_ready) return _ready;
  _ready = (async () => {
    loadCss(here("../vendor/highlight/github-dark.min.css"));
    loadCss(here("../vendor/katex/katex.min.css"));
    await Promise.all([
      loadScript(here("../vendor/markdown/markdown-it.min.js")),
      loadScript(here("../vendor/highlight/highlight.min.js")),
      loadScript(here("../vendor/katex/katex.min.js")),
      loadScript(here("../vendor/dompurify/purify.min.js")),
    ]);
    const md = window.markdownit({
      html: false, linkify: true, breaks: true, typographer: false,
      highlight: (code, lang) => {
        if (lang === "mermaid") return "";   // handled by the fence renderer below
        try { if (lang && window.hljs.getLanguage(lang)) return window.hljs.highlight(code, { language: lang }).value; } catch {}
        try { return window.hljs.highlightAuto(code).value; } catch {}
        return "";
      },
    });
    mathPlugin(md);
    fencePlugin(md);
    return md;
  })();
  return _ready;
}

// ── math: $…$ inline, $$…$$ block → KaTeX (single-$ requires non-space bounds, like LibreChat) ──
function mathPlugin(md) {
  md.inline.ruler.after("escape", "math_inline", (state, silent) => {
    const src = state.src, pos = state.pos;
    if (src[pos] !== "$") return false;
    const dbl = src[pos + 1] === "$";
    const open = dbl ? 2 : 1, marker = dbl ? "$$" : "$";
    if (!dbl && (pos + 1 >= src.length || /\s/.test(src[pos + 1]))) return false;
    const end = src.indexOf(marker, pos + open);
    if (end < 0 || end === pos + open) return false;
    if (!dbl && /\s/.test(src[end - 1])) return false;
    if (!silent) {
      const t = state.push(dbl ? "math_block_i" : "math_inline", "math", 0);
      t.content = src.slice(pos + open, end);
    }
    state.pos = end + open;
    return true;
  });
  const render = (tex, display) => {
    try { return window.katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" }); }
    catch { return `<code>${md.utils.escapeHtml(tex)}</code>`; }
  };
  md.renderer.rules.math_inline = (tk, i) => render(tk[i].content, false);
  md.renderer.rules.math_block_i = (tk, i) => render(tk[i].content, true);
}

// ── fences: ```mermaid → a lazy-rendered diagram node; other code → header + copy affordance ──
function fencePlugin(md) {
  const base = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const tk = tokens[idx], lang = (tk.info || "").trim().split(/\s+/)[0];
    if (lang === "mermaid") return `<div class="mermaid-pending" data-graph="${md.utils.escapeHtml(tk.content)}">rendering diagram…</div>`;
    const body = base(tokens, idx, options, env, self);
    return `<div class="codeblock"><div class="codehead"><span class="lang">${md.utils.escapeHtml(lang || "text")}</span><button class="codecopy" type="button">copy</button></div>${body}</div>`;
  };
}

// Mermaid is 2.5 MB — loaded ONLY when a ```mermaid fence appears (the lean discipline).
let _mermaid = null;
async function renderMermaids(root) {
  const pend = root.querySelectorAll(".mermaid-pending");
  if (!pend.length) return;
  if (!_mermaid) {
    _mermaid = loadScript(here("../vendor/mermaid/mermaid.min.js")).then(() => {
      window.mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
      return window.mermaid;
    });
  }
  const mermaid = await _mermaid;
  for (const el of pend) {
    const graph = el.dataset.graph;
    el.classList.remove("mermaid-pending");
    try {
      const { svg } = await mermaid.render("mmd-" + Math.random().toString(36).slice(2, 9), graph);
      el.innerHTML = window.DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      el.className = "mermaid-done";
    } catch { el.textContent = graph; el.className = "codeblock"; }
  }
}

const SANITIZE = {
  ALLOWED_TAGS: ["a","p","br","hr","b","strong","i","em","u","s","del","sub","sup","blockquote","code","pre","ul","ol","li",
    "table","thead","tbody","tr","th","td","h1","h2","h3","h4","h5","h6","img","span","div","button",
    "math","semantics","mrow","mi","mo","mn","msup","msub","msubsup","mfrac","msqrt","mroot","mtext","mspace","mover","munder","munderover","mtable","mtr","mtd","mstyle","annotation"],
  ALLOWED_ATTR: ["href","title","alt","src","class","style","data-graph","aria-hidden","type","start","colspan","rowspan","encoding","mathvariant","width","height"],
  ALLOW_DATA_ATTR: false,
};

// renderMarkdown(el, text) — render `text` into `el` (sanitized), then resolve diagrams lazily.
export async function renderMarkdown(el, text) {
  const md = await initMarkdown();
  el.innerHTML = window.DOMPurify.sanitize(md.render(text || ""), SANITIZE);
  for (const a of el.querySelectorAll("a[href]")) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
  for (const btn of el.querySelectorAll(".codecopy")) {
    btn.onclick = async () => {
      const code = btn.closest(".codeblock")?.querySelector("pre code, pre")?.textContent || "";
      try { await navigator.clipboard.writeText(code); btn.textContent = "copied"; setTimeout(() => (btn.textContent = "copy"), 1200); } catch {}
    };
  }
  renderMermaids(el);   // async, fire-and-forget
}
