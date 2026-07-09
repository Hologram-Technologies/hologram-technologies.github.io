// holo-front-page.mjs — THE LENS: the browser's home page as a PURE DERIVATION of the user's own
// κ-graph, not a page fetched from anyone. derive(sources) → a tile model with a canonical string —
// the page HAS an address (κ of its derivation input), is reproducible (same graph + same hour →
// same page), and composes with ZERO network by construction: this module is a pure function of its
// arguments — no fetch, no Date.now, no randomness. "Why am I seeing this" = show the derivation.
// (SEC-7: the graph never leaves the device; the caller reads localStorage and passes it in.)
//
// Sources (all local): visit history [{url,title,ts}] · app catalog [{url,title,desc}] · hour (0-23).
// Output: { greeting, rows: [{key,label,tiles:[{url,title,host,why}]}], canonical } — canonical is a
// stable JSON string of the derivation; κ = hash(canonical) is computed by the caller.

const HOUR = 36e5, DAY = 864e5;

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return String(u || ""); } }
function cleanTitle(t, u) { const s = String(t || "").trim(); return s && s !== u ? s : hostOf(u); }
// a search-engine HOME is not a "continue where you were" tile — you go there to search, and the
// browser's search IS Holo Search now. Exclude them so the front page shows real destinations, not a
// search box you already have. (Also drops the legacy google→DDG redirect artifact from old history.)
const SEARCH_HOME = /^(www\.)?(google|bing|duckduckgo|html\.duckduckgo|search\.brave|ecosia|startpage)\.[a-z.]+$/i;
function isSearchHome(u) { try { const x = new URL(u); return SEARCH_HOME.test(x.hostname) && (x.pathname === "/" || x.pathname === "" || x.pathname === "/html/"); } catch { return false; } }

// collapse raw visits → one candidate per URL with visit stats (count, last ts, per-hour histogram).
export function foldHistory(history) {
  const by = new Map();
  for (const e of Array.isArray(history) ? history : []) {
    if (!e || !e.url || !/^https?:\/\//.test(e.url)) continue;
    if (isSearchHome(e.url)) continue;   // search-engine home → not a destination tile
    let c = by.get(e.url);
    if (!c) { c = { url: e.url, title: cleanTitle(e.title, e.url), host: hostOf(e.url), visits: 0, last: 0, hours: new Array(24).fill(0) }; by.set(e.url, c); }
    c.visits++; c.last = Math.max(c.last, e.ts || 0);
    if (e.ts) c.hours[new Date(e.ts).getHours()]++;
  }
  return [...by.values()];
}

// deterministic ordering: score desc, then url asc (total order — no tie wobble between derives).
const ord = (score) => (a, b) => (score(b) - score(a)) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);

export function deriveFrontPage({ history = [], apps = [], hour = 8, now = 0 } = {}) {
  const cands = foldHistory(history);
  const used = new Set();
  const take = (list, n, why) => {
    const out = [];
    for (const c of list) { if (out.length >= n) break; if (used.has(c.url)) continue; used.add(c.url); out.push({ url: c.url, title: c.title, host: c.host, why: typeof why === "function" ? why(c) : why }); }
    return out;
  };

  // CONTINUE — where you just were (recency, last 48h)
  const recent = cands.filter((c) => now - c.last < 2 * DAY).sort(ord((c) => c.last));
  const rowContinue = take(recent, 3, (c) => (now - c.last < HOUR ? "Moments ago" : now - c.last < DAY ? "Earlier today" : "Yesterday"));

  // YOUR RHYTHM — what you open at THIS hour (±1h window, needs a real habit: ≥2 visits in window)
  const inWindow = (c) => c.hours[(hour + 23) % 24] + c.hours[hour] + c.hours[(hour + 1) % 24];
  const rhythm = cands.filter((c) => inWindow(c) >= 2).sort(ord(inWindow));
  const rowRhythm = take(rhythm, 4, "Your usual, this hour");

  // FREQUENT — the backbone of your web (log-damped so one binge doesn't own the row)
  const frequent = cands.filter((c) => c.visits >= 2).sort(ord((c) => Math.log(1 + c.visits) * 2 + (now - c.last < 7 * DAY ? 1 : 0)));
  const rowFrequent = take(frequent, 6, (c) => "Visited " + c.visits + "×");

  // HOLOGRAM — doors into the universe (catalog order is the catalog's own; take the front)
  const rowApps = (Array.isArray(apps) ? apps : []).filter((a) => a && a.url && a.title).slice(0, 4)
    .map((a) => ({ url: a.url, title: a.title, host: "Hologram", why: "App" }));

  const greeting = hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const rows = [
    { key: "continue", label: "Continue", tiles: rowContinue },
    { key: "rhythm", label: "Your rhythm", tiles: rowRhythm },
    { key: "frequent", label: "Frequent", tiles: rowFrequent },
    { key: "apps", label: "Hologram", tiles: rowApps },
  ].filter((r) => r.tiles.length);

  // the derivation, canonically — κ = hash(canonical) is the page's address. Deterministic by
  // construction: inputs are folded stably, every sort has a total order, no clock/random inside.
  const canonical = JSON.stringify({ v: 1, hour, rows: rows.map((r) => ({ k: r.key, t: r.tiles.map((t) => t.url) })) });
  return { greeting, rows, canonical };
}
