// holo-source-twitch.mjs — Twitch as a LIVE source: top games + live channels (esports, game plays, IRL).
// Discovery is read-only via Twitch's own public web GQL endpoint (the same the twitch.tv site uses) — no
// secret, no login. Each live channel PLAYS its OFFICIAL stream (twitch.tv/<login>) through /sc/vstream →
// Holo Video (WebGPU super-res + κ-audio). Official source, played as served (ads via Twitch's own SSAI).

const CID = "kimne78kx3ncx6brgo4mv6wki5h1ko";   // Twitch public web Client-ID (read-only)
const GQL = "https://gql.twitch.tv/gql";
const STREAM_FIELDS = "title viewersCount previewImageURL(width:440,height:248) broadcaster { login displayName profileImageURL(width:70) } game { name displayName }";

async function gql(doFetch, query) {
  const r = await doFetch(GQL, { method: "POST", headers: { "Client-ID": CID, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
  if (!r.ok) throw new Error("twitch " + r.status);
  return (await r.json()).data || {};
}

function normStream(node, vstream) {
  if (!node || !node.broadcaster) return null;
  const login = node.broadcaster.login;
  const src = vstream("https://www.twitch.tv/" + login);
  const game = node.game ? (node.game.displayName || node.game.name) : "";
  return {
    id: "twitch:" + login, name: node.broadcaster.displayName || login, live: true, kind: "live", provider: "twitch",
    streamTitle: node.title || "", channel: game || "Twitch", viewers: node.viewersCount || 0,
    thumb: node.previewImageURL || null, posterUrl: node.broadcaster.profileImageURL || null,
    topics: ["esports"], genres: [game || "Live"], languages: [], country: "Twitch", countryCode: "", flag: "",
    qualityLabel: "LIVE", _resH: 1080,
    _sources: [{ kind: "vstream", url: src, label: "Twitch · " + login }], _srcIdx: 0,
    playSrc: src, src, type: "",
    availability: { playable: true, source: "twitch", playSrc: src, type: "" },
    provenance: { resolver: "Twitch", kind: "twitch", label: "Twitch · " + login },
  };
}

// Top live channels across all of Twitch (esports + IRL + games, sorted by viewers).
export async function loadTwitchTop({ fetch: f, vstream, first = 24 } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) return [];
  try { const d = await gql(doFetch, `query { streams(first: ${first}) { edges { node { ${STREAM_FIELDS} } } } }`); return ((d.streams && d.streams.edges) || []).map((e) => normStream(e.node, vstream)).filter(Boolean); } catch { return []; }
}
// Top games/categories (box art + viewers).
export async function loadTwitchGames({ fetch: f, first = 14 } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) return [];
  try { const d = await gql(doFetch, `query { games(first: ${first}) { edges { node { name displayName viewersCount boxArtURL(width:144,height:192) } } } }`); return ((d.games && d.games.edges) || []).map((e) => ({ name: e.node.displayName || e.node.name, raw: e.node.name, viewers: e.node.viewersCount || 0, art: e.node.boxArtURL })); } catch { return []; }
}
// Live channels for one game/category (e.g. an esport title).
export async function loadTwitchGameStreams(gameName, { fetch: f, vstream, first = 16 } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) return [];
  const safe = String(gameName).replace(/\\/g, "").replace(/"/g, '\\"');
  try { const d = await gql(doFetch, `query { game(name: "${safe}") { streams(first: ${first}) { edges { node { ${STREAM_FIELDS} } } } } }`); return ((d.game && d.game.streams && d.game.streams.edges) || []).map((e) => normStream(e.node, vstream)).filter(Boolean); } catch { return []; }
}

export default { loadTwitchTop, loadTwitchGames, loadTwitchGameStreams };
if (typeof window !== "undefined") window.HoloSourceTwitch = { loadTwitchTop, loadTwitchGames, loadTwitchGameStreams };
