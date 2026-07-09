// holo-sports.mjs — a live SPORTS hub: real-time scores + today's fixtures across the major leagues, from
// ESPN's public site API (the same espn.com uses client-side; CORS-open, key-free). Returns matches grouped
// live / upcoming / finished, each with teams, logos, scores, status, clock and the OFFICIAL broadcaster.
//
// Boundary: this is SCHEDULE + SCORES (informational, 100% legal). Actually watching a match goes to its
// OFFICIAL broadcaster — a free official stream where one exists, else the user's own subscription (DRM tier).
// No pirated re-streams.

const ESPN = "https://site.api.espn.com/apis/site/v2/sports";
// path · display label — the leagues people actually look for.
const LEAGUES = [
  ["soccer/eng.1", "Premier League"], ["soccer/esp.1", "La Liga"], ["soccer/ita.1", "Serie A"],
  ["soccer/ger.1", "Bundesliga"], ["soccer/fra.1", "Ligue 1"], ["soccer/uefa.champions", "Champions League"],
  ["soccer/uefa.europa", "Europa League"], ["soccer/usa.1", "MLS"], ["soccer/eng.fa", "FA Cup"],
  ["basketball/nba", "NBA"], ["football/nfl", "NFL"], ["baseball/mlb", "MLB"], ["hockey/nhl", "NHL"],
];

function team(c) {
  const t = c.team || {};
  return { name: t.shortDisplayName || t.displayName || t.name || "", abbr: t.abbreviation || "", logo: t.logo || (t.logos && t.logos[0] && t.logos[0].href) || "", score: c.score || "", winner: !!c.winner };
}
function normEvent(e, league) {
  const comp = e.competitions && e.competitions[0]; if (!comp) return null;
  const cs = comp.competitors || [];
  const home = cs.find((c) => c.homeAway === "home") || cs[0];
  const away = cs.find((c) => c.homeAway === "away") || cs[1];
  if (!home || !away) return null;
  const st = (e.status && e.status.type) || {};
  return {
    id: "sport:" + e.id, league, name: e.shortName || e.name || "", state: st.state || "pre",
    detail: st.shortDetail || st.detail || "", clock: (e.status && e.status.displayClock) || "", date: e.date || "",
    home: team(home), away: team(away),
    broadcast: (comp.broadcasts && comp.broadcasts[0] && comp.broadcasts[0].names) || [],
  };
}
async function fetchLeague(doFetch, path, label) {
  try { const r = await doFetch(`${ESPN}/${path}/scoreboard`); if (!r.ok) return []; const j = await r.json(); return (j.events || []).map((e) => normEvent(e, label)).filter(Boolean); } catch { return []; }
}

export async function loadSports({ fetch: f } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) return { live: [], today: [], done: [] };
  const all = (await Promise.all(LEAGUES.map(([p, l]) => fetchLeague(doFetch, p, l)))).flat();
  const byTime = (a, b) => new Date(a.date) - new Date(b.date);
  return {
    live: all.filter((m) => m.state === "in").sort(byTime),
    today: all.filter((m) => m.state === "pre").sort(byTime),
    done: all.filter((m) => m.state === "post").sort((a, b) => new Date(b.date) - new Date(a.date)),
  };
}

export default { loadSports };
if (typeof window !== "undefined") window.HoloSports = { loadSports };
