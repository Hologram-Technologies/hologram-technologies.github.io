// holo-q-components.mjs — the κ-component library Create builds apps FROM (S7). The on-device coder doesn't
// emit free-form HTML (which it does badly); it assembles a typed tree of these components and fills their
// props. Each component renders clean, responsive, --holo-*-tokened markup, so apps are beautiful + consistent
// BY CONSTRUCTION (the design conscience then verifies). Pure functions, no deps → Node-witnessed.
//
//   COMPONENTS[type](props, childrenHtml) -> html      // the closed vocabulary the spec may use
//   isComponent(type) -> bool    ·    componentTypes() -> string[]

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const list = (v) => Array.isArray(v) ? v : (v == null ? [] : [v]);

// every component speaks only the token vocabulary (var(--holo-*)) — the conscience guarantees the root exists.
export const COMPONENTS = {
  page: (p, kids) => `<main style="max-width:${p.width || 960}px;margin:0 auto;padding:var(--holo-space-32);display:flex;flex-direction:column;gap:var(--holo-space-24)">${kids || ""}</main>`,

  nav: (p) => `<nav style="display:flex;align-items:center;justify-content:space-between;padding:var(--holo-space-12) var(--holo-space-16);border-bottom:1px solid var(--holo-border)">`
    + `<b style="font-size:var(--holo-text-lg,1.05rem)">${esc(p.brand || "App")}</b>`
    + `<span style="display:flex;gap:var(--holo-space-16);color:var(--holo-muted)">${list(p.links).map((l) => `<a style="color:var(--holo-muted);text-decoration:none">${esc(l)}</a>`).join("")}</span></nav>`,

  hero: (p) => `<header style="text-align:${p.align || "left"};padding:var(--holo-space-24) 0">`
    + `<h1 style="margin:0 0 var(--holo-space-8);font-size:2.2rem;line-height:1.1">${esc(p.title || "")}</h1>`
    + (p.subtitle ? `<p style="margin:0;color:var(--holo-muted);font-size:1.05rem">${esc(p.subtitle)}</p>` : "")
    + (p.cta ? `\n${COMPONENTS.button({ label: p.cta })}` : "") + `</header>`,

  section: (p, kids) => `<section style="display:flex;flex-direction:column;gap:var(--holo-space-12)">`
    + (p.title ? `<h2 style="margin:0;font-size:1.3rem">${esc(p.title)}</h2>` : "") + (kids || "") + `</section>`,

  cardGrid: (p) => `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(${p.min || 220}px,1fr));gap:var(--holo-space-16)">`
    + list(p.cards).map((c) => COMPONENTS.card(c)).join("") + `</div>`,

  card: (p) => `<div style="background:var(--holo-surface);border:1px solid var(--holo-border);border-radius:14px;padding:var(--holo-space-20);display:flex;flex-direction:column;gap:var(--holo-space-8)">`
    + (p.title ? `<h3 style="margin:0;font-size:1.1rem">${esc(p.title)}</h3>` : "")
    + (p.value ? `<div style="font-size:1.9rem;font-weight:700">${esc(p.value)}</div>` : "")
    + (p.body ? `<p style="margin:0;color:var(--holo-muted)">${esc(p.body)}</p>` : "")
    + (p.cta ? `\n${COMPONENTS.button({ label: p.cta })}` : "") + `</div>`,

  stat: (p) => `<div style="display:flex;flex-direction:column;gap:2px"><span style="color:var(--holo-muted);font-size:.85rem">${esc(p.label || "")}</span>`
    + `<span style="font-size:1.6rem;font-weight:700">${esc(p.value || "")}</span></div>`,

  button: (p) => `<button type="button" data-action="${esc(p.action || "")}" style="align-self:start;background:var(--holo-accent);color:#fff;border:0;border-radius:10px;padding:var(--holo-space-8) var(--holo-space-16);font:inherit;cursor:pointer">${esc(p.label || "Go")}</button>`,

  input: (p) => `<label style="display:flex;flex-direction:column;gap:4px;color:var(--holo-muted);font-size:.85rem">${esc(p.label || "")}`
    + `<input name="${esc(p.name || "")}" type="${esc(p.type || "text")}" placeholder="${esc(p.placeholder || "")}" style="background:var(--holo-bg);color:var(--holo-fg);border:1px solid var(--holo-border);border-radius:9px;padding:var(--holo-space-8);font:inherit"></label>`,

  form: (p) => `<form data-submit="${esc(p.submit || "")}" style="display:flex;flex-direction:column;gap:var(--holo-space-12);background:var(--holo-surface);border:1px solid var(--holo-border);border-radius:14px;padding:var(--holo-space-20)">`
    + list(p.fields).map((f) => COMPONENTS.input(f)).join("") + COMPONENTS.button({ label: p.cta || "Submit", action: p.submit || "" }) + `</form>`,

  list: (p) => `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:var(--holo-space-8)">`
    + list(p.items).map((it) => `<li style="background:var(--holo-surface);border:1px solid var(--holo-border);border-radius:10px;padding:var(--holo-space-12)">${esc(typeof it === "object" ? (it.text || JSON.stringify(it)) : it)}</li>`).join("") + `</ul>`,

  text: (p) => `<p style="margin:0;color:${p.muted ? "var(--holo-muted)" : "var(--holo-fg)"};line-height:1.6">${esc(p.content || "")}</p>`,

  footer: (p) => `<footer style="margin-top:var(--holo-space-24);padding-top:var(--holo-space-16);border-top:1px solid var(--holo-border);color:var(--holo-muted);font-size:.85rem">${esc(p.text || "")}</footer>`,
};

export const isComponent = (t) => Object.prototype.hasOwnProperty.call(COMPONENTS, t);
export const componentTypes = () => Object.keys(COMPONENTS);
export const CONTAINERS = new Set(["page", "section"]);   // components that take children

export default { COMPONENTS, isComponent, componentTypes, CONTAINERS };
