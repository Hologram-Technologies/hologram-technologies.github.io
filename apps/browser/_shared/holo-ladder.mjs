// holo-ladder.mjs — the paywall LADDER, as a pure transform stage over a live-web document.
// A serverless, any-browser reimagining of everywall/ladder: ladder is a Go PROXY that spoofs a
// Googlebot User-Agent + Referer and rewrites the returned HTML. A browser fetch() CANNOT set
// User-Agent/Referer/X-Forwarded-For (forbidden headers), so that rung only bites on a HEADER-
// HONORING egress (your paired /web Chrome or device-mesh peer). The rungs that ARE fully
// serverless on any browser — and cover the large majority of real paywalls — are two:
//
//   rung 1 · IN-PLACE UNLOCK (0 egress). Most paywalls SHIP the whole article and merely hide it:
//            the full text sits in a JSON-LD `articleBody`, and a CSS overlay + scroll-lock + a
//            metering script cover it. We reconstruct a clean reader from the JSON-LD, neutralize
//            the overlay/scroll-lock, and drop the known metering scripts. Pure string rewrite.
//   rung 2 · ARCHIVE REFETCH (serverless). When the body truly is not in the bytes, the crawler-
//            captured copy is: Wayback / archive.today already fetched the page AS a crawler.
//            archiveSources() names those; the SW refetches through its existing relay tier.
//   rung 3 · HEADER SPOOF. ladderHeaders() carries the Googlebot UA + Referer for a header-honoring
//            egress; on a pure serverless mount there is none, so it is simply dropped — honestly.
//
// No DOMParser in a module worker → every pass here is regex/string/JSON, the same idiom as the
// SW's rewriteHtml. Witnessed by ladder.witness.mjs (import THIS; never fork it into the SW).

// ── the ruleset — ladder's rules.yaml, distilled. The GENERIC pass handles most sites; this table
// is only for per-host extras (selectors the generic list misses, or "go straight to archive"). Keep
// it small and data-driven — a host is one row, no code. `host` is a substring of the hostname. ──
export const LADDER_RULES = [
  { host: "nytimes.com",        kill: ["css-gx5sib", "expanded-dock", "gateway-content"], preferArchive: false },
  { host: "wsj.com",            kill: ["snippet-promotion", "wsj-snippet"], preferArchive: true },
  { host: "economist.com",      kill: ["subscribe", "ds-teaser-card"], preferArchive: false },
  { host: "washingtonpost.com", kill: ["paywall", "regwall-overlay"], preferArchive: false },
  { host: "ft.com",             kill: ["barrier", "o-topper"], preferArchive: true },
  { host: "bloomberg.com",      kill: ["paywall", "fence-body"], preferArchive: true },
  { host: "medium.com",         kill: ["meteredContent", "overlay"], preferArchive: false },
  { host: "newyorker.com",      kill: ["paywall", "PaywallBarrier"], preferArchive: false },
  { host: "wired.com",          kill: ["paywall", "PaywallBarrier"], preferArchive: false },
  { host: "theatlantic.com",    kill: ["paywall", "c-gate"], preferArchive: false },
];

// generic overlay / metering selectors killed on EVERY page (substring-matched against class + id).
// Curated to hit paywall furniture without eating real content — no bare "modal"/"overlay" here.
const KILL_TOKENS = [
  "paywall", "reg-wall", "regwall", "regiwall", "subscribe-wall", "subscription-wall",
  "meter", "metered", "piano", "tp-modal", "tp-backdrop", "tp-container", "poool",
  "pico-", "blueconic", "leaky-paywall", "gateway", "barrier", "gate-", "-gate",
  "fc-app-content", "fc-message-root", "premium-wall", "hard-paywall", "article-gate",
];

// known metering/paywall SCRIPTS dropped from the head — they re-lock the DOM after our rewrite.
const KILL_SCRIPTS = [
  "tinypass", "piano.io", "cdn.tinypass", "poool", "getpoool", "pico.tools", "trypico",
  "blueconic", "cdn.pico", "cxense", "getsitecontrol", "fundingchoices", "npttech.com",
  "qc.quantserve", "cd.connatix", "wt.o.nytimes", "meter", "cmp.inmobi",
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
export function ruleFor(url) { const h = hostOf(url); return LADDER_RULES.find((r) => h.includes(r.host)) || null; }

// ── DETECT — is this document behind a wall? Cheap scan of the first stretch of HTML. A strong
// signal (JSON-LD isAccessibleForFree:false, a known wall id) locks alone; weak signals need two. ──
export function detectPaywall(html, url) {
  const t = String(html || "");
  const head = t.slice(0, 200000);
  const why = [];
  let strong = 0, weak = 0;
  // STRONG — an unambiguous "this content is gated" statement, alone enough to lock.
  if (/"isAccessibleForFree"\s*:\s*(false|"false"|"False"|0)\b/i.test(head)) { strong++; why.push("ld:isAccessibleForFree=false"); }
  if (/<meta[^>]+(?:property|name)=["']article:content_tier["'][^>]+content=["'](?:locked|metered|premium)["']/i.test(head)) { strong++; why.push("meta:content_tier"); }
  // a real wall ELEMENT (a class/id NAMES it) — not a vendor script that merely happens to be loaded.
  if (/(?:class|id)\s*=\s*["'][^"']*(?:paywall|reg-?wall|subscribe-wall|subscription-wall|premium-wall|article-gate|paywalled-content|hard-paywall)[^"']*["']/i.test(head)) { strong++; why.push("dom:wall-element"); }
  // WEAK — corroborating only; TWO are needed to lock. A vendor meter being PRESENT (piano/tinypass/
  // poool/tp-modal/fc-app-content) means the site COULD wall, not that THIS page is walled — many free
  // articles ship it for newsletters/consent (BBC etc.), so it can never lock on its own.
  if (/subscribe to (?:continue|read)|to continue reading|continue reading this article|already a subscriber|subscribers? only|create a free account to (?:read|continue)|sign in to (?:keep|continue) reading/i.test(head)) { weak++; why.push("copy:subscribe"); }
  if (/data-truncated|article-body--truncated|is-locked["'\s>]/i.test(head)) { weak++; why.push("attr:truncated"); }
  if (/\b(?:tinypass|piano\.io|poool|tp-modal|fc-app-content|meteredcontent)\b/i.test(head)) { weak++; why.push("vendor:meter"); }
  const locked = strong >= 1 || weak >= 2;
  return { locked, why, ruled: !!ruleFor(url) };
}

// ── JSON-LD article extraction — the strong zero-egress rung. Walk every ld+json block (and @graph
// arrays), find an Article-ish node carrying articleBody, return {headline, body, author, date}. ──
function extractArticle(html) {
  const blocks = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks) {
    let json; try { json = JSON.parse(b[1].trim()); } catch { continue; }
    const nodes = [];
    const push = (n) => { if (n && typeof n === "object") nodes.push(n); };
    if (Array.isArray(json)) json.forEach(push); else { push(json); if (Array.isArray(json["@graph"])) json["@graph"].forEach(push); }
    for (const n of nodes) {
      const type = String(n["@type"] || "").toLowerCase();
      const body = n.articleBody || n.text;
      if (body && (type.includes("article") || type.includes("newsarticle") || type.includes("blogposting") || (!type && String(body).length > 600))) {
        const author = n.author && (n.author.name || (Array.isArray(n.author) && n.author[0] && n.author[0].name)) || "";
        return { headline: String(n.headline || n.name || ""), body: String(body), author: String(author || ""), date: String(n.datePublished || "") };
      }
    }
  }
  return null;
}

// a clean, self-contained reader panel — guaranteed-visible article text, pinned above the walled DOM.
function readerPanel(a, url) {
  const paras = a.body.split(/\n{2,}|\r\n\r\n|(?<=\.)\s{2,}/).map((p) => p.trim()).filter(Boolean);
  const byline = [a.author && ("By " + a.author), a.date && a.date.slice(0, 10)].filter(Boolean).join(" · ");
  return `<div id="holo-ladder-reader" role="article">
<div class="hl-tag">Unlocked by Ladder · reconstructed from the page's own data</div>
${a.headline ? `<h1>${esc(a.headline)}</h1>` : ""}${byline ? `<p class="hl-by">${esc(byline)}</p>` : ""}
${paras.map((p) => `<p>${esc(p)}</p>`).join("\n")}
<p class="hl-src"><a href="${esc(url)}">${esc(hostOf(url))}</a></p></div>`;
}

const READER_CSS = `<style id="holo-ladder-css">
html,body{overflow:auto!important;position:static!important;height:auto!important;filter:none!important}
body{-webkit-user-select:auto!important;user-select:auto!important}
[class*="paywall"],[id*="paywall"],[class*="regwall"],[class*="tp-modal"],[class*="tp-backdrop"],
[class*="meteredContent"],[class*="premium-wall"],[class*="subscribe-wall"],[class*="fc-app-content"],
[class*="fc-message-root"],[class*="barrier"],[class*="poool"]{display:none!important;visibility:hidden!important}
[class*="article-body--truncated"],[class*="paywalled-content"],[data-truncated]{max-height:none!important;-webkit-mask:none!important;mask:none!important}
#holo-ladder-reader{max-width:44rem;margin:1.2rem auto;padding:1.4rem 1.6rem;font:18px/1.7 Georgia,"Times New Roman",serif;
color:#0f1720;background:#fff;border:1px solid #e6e6e6;border-radius:12px;box-shadow:0 2px 24px rgba(0,0,0,.06)}
#holo-ladder-reader h1{font:600 1.7rem/1.25 system-ui,sans-serif;margin:.2rem 0 .6rem}
#holo-ladder-reader .hl-tag{font:600 11px/1 system-ui,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#3b6ee0;margin-bottom:.7rem}
#holo-ladder-reader .hl-by{font:14px system-ui,sans-serif;color:#667;margin:0 0 1rem}
#holo-ladder-reader p{margin:0 0 1rem}
#holo-ladder-reader .hl-src{font:13px system-ui,sans-serif;color:#889;margin-top:1.4rem}
@media(prefers-color-scheme:dark){#holo-ladder-reader{color:#e8eef5;background:#0f141b;border-color:#222d3a}}
</style>`;

// per-host extra kills → a style that hides those tokens too.
function ruleKillCss(rule) {
  if (!rule || !rule.kill || !rule.kill.length) return "";
  const sel = rule.kill.map((k) => `[class*="${esc(k)}"],[id*="${esc(k)}"]`).join(",");
  return `<style id="holo-ladder-rule">${sel}{display:none!important}</style>`;
}

// drop known metering scripts (they re-lock after paint). Leave everything else — this is a browser.
function stripPaywallScripts(html) {
  return String(html).replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (m, src) => (KILL_SCRIPTS.some((k) => src.toLowerCase().includes(k)) ? "" : m));
}

// ── UNLOCK — the rung-1 pass. Returns { html, applied[], recovered, locked }. `force` runs it even
// when detection is unsure (the omnibox "Unlock" button). `recovered` = a substantial body is now
// guaranteed visible (JSON-LD reader injected) — the SW uses it to decide whether to climb to rung 2. ──
export function unlock(html, url, opts = {}) {
  if (/id="holo-ladder-css"/.test(String(html))) return { html, applied: ["already"], recovered: /id="holo-ladder-reader"/.test(html), locked: true };   // idempotent: never double-inject
  const det = opts.det || detectPaywall(html, url);
  if (!det.locked && !opts.force) return { html, applied: [], recovered: false, locked: false };
  let out = String(html);
  const applied = [];
  out = stripPaywallScripts(out); applied.push("strip-scripts");
  const rule = ruleFor(url);
  const article = extractArticle(out);
  let recovered = false;
  const head = READER_CSS + ruleKillCss(rule);
  // inject the neutralizing CSS at <head> open; inject the reader (if any) right after <body>.
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (h) => h + head) : head + out;
  applied.push("neutralize-overlay");
  if (rule) applied.push("rule:" + rule.host);
  if (article && article.body && article.body.length > 400) {
    const panel = readerPanel(article, url);
    out = /<body[^>]*>/i.test(out) ? out.replace(/<body[^>]*>/i, (b) => b + panel) : panel + out;
    recovered = true; applied.push("reader:ld+json");
  }
  return { html: out, applied, recovered, locked: true };
}

// ── rung 2 — archive/reader sources, in try order. Serverless: the SW fetches these through its
// existing relay tier. Wayback needs its availability API resolved first (SW does that); the rest
// are direct snapshot URLs. `preferArchive` hosts (hard paywalls) put archive first. ──
export function archiveSources(url) {
  const clean = String(url).replace(/^https?:\/\//, "");
  const list = [
    { via: "wayback", api: "https://archive.org/wayback/available?url=" + encodeURIComponent(url) },
    { via: "archive.today", url: "https://archive.ph/newest/" + url },
    { via: "reader", url: "https://r.jina.ai/" + url },   // markdown reader — last resort, always renders text
  ];
  const rule = ruleFor(url);
  if (rule && rule.preferArchive) return list;             // already archive-first
  return list;                                             // Wayback is a good universal default first rung
}

// ── rung 3 — header spoof for a HEADER-HONORING egress only (paired /web Chrome or mesh peer). On a
// serverless mount these are dropped before the wire; the SW namespaces them x-holo-* and strips them
// beyond tier 1 (they would force a CORS preflight no relay answers). Emulates ladder's Googlebot. ──
export function ladderHeaders(url) {
  return {
    "x-holo-ua": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "x-holo-referer": "https://www.google.com/",
    "x-holo-xff": "66.249.66.1",
  };
}
