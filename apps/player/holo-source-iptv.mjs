// holo-source-iptv.mjs — "Holo Live": the world's free, legal, public television.
//
// Built from iptv-org's OPEN API (streams + channels + logos + countries, joined) into an "all-green" wall:
// only channels that HAVE a working stream entry, ranked by resolution, grouped by category/country, and
// family-safe (NSFW + closed channels filtered out). Plus Free-TV's curated FAST list (Pluto/Samsung/Plex/
// Roku…). Pure fetch + join → Node-witnessable (inject fetch). No probing, no scraping — just their metadata,
// which is maintained + auto-checked upstream, so the wall is clean without us hammering every origin.
//
// Each channel normalizes to a player media item with live:true + a direct HLS playSrc, so it plays straight
// through Holo Video (live=1 · sr=1 · κ-audio). Resolve-on-play, public sources only.

import { parseM3U } from "./holo-source-m3u.mjs";

const API = "https://iptv-org.github.io/api";
const QH = { "2160p": 2160, "1440p": 1440, "1080p": 1080, "720p": 720, "576p": 576, "480p": 480, "360p": 360, "240p": 240, "144p": 144 };
const qh = (q) => QH[String(q || "").toLowerCase()] || 0;
const cap = (s) => String(s || "").replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
// Common ISO-639 language names — covers ~95% of channels; the rest fall back to the code. (Channels carry no
// language of their own, so we derive it from the channel's country's languages — a good practical proxy.)
const LANG_NAMES = { eng: "English", spa: "Spanish", ara: "Arabic", fra: "French", deu: "German", por: "Portuguese", rus: "Russian", ita: "Italian", hin: "Hindi", zho: "Chinese", jpn: "Japanese", kor: "Korean", tur: "Turkish", nld: "Dutch", pol: "Polish", ron: "Romanian", ell: "Greek", swe: "Swedish", ces: "Czech", hun: "Hungarian", tha: "Thai", vie: "Vietnamese", ind: "Indonesian", fas: "Persian", ukr: "Ukrainian", heb: "Hebrew", ben: "Bengali", tam: "Tamil", urd: "Urdu", msa: "Malay", fil: "Filipino", nor: "Norwegian", dan: "Danish", fin: "Finnish", bul: "Bulgarian", srp: "Serbian", hrv: "Croatian", slk: "Slovak", cat: "Catalan", glg: "Galician", eus: "Basque" };
export const langName = (code) => LANG_NAMES[code] || (code ? code.toUpperCase() : "");

// Load + join the iptv-org API into ranked, all-green, family-safe live channels.
export async function loadLive({ fetch: f, cache } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-source-iptv: fetch required");
  const get = async (name) => {
    const url = `${API}/${name}.json`;
    const go = async () => { const r = await doFetch(url); if (!r.ok) throw new Error(name + " " + r.status); return r.json(); };
    if (!cache) return go();
    try { const { body } = await cache.through("iptv|" + url, go); return body; } catch { return go(); }
  };
  const [streams, channels, logos, countries] = await Promise.all([
    get("streams"), get("channels"), get("logos"), get("countries").catch(() => []),
  ]);

  // Best stream per channel — highest resolution wins. Must carry a url + a channel id (so it joins to metadata).
  const best = new Map();
  for (const s of streams) {
    const cid = s.channel; if (!cid || !s.url) continue;
    const h = qh(s.quality); const cur = best.get(cid);
    if (!cur || h > cur._h) best.set(cid, { url: s.url, _h: h, quality: s.quality || "", ua: s.user_agent || "", ref: s.referrer || "" });
  }
  const logoOf = new Map();
  for (const l of logos) { if (l.channel && l.url && l.in_use !== false && !logoOf.has(l.channel)) logoOf.set(l.channel, l.url); }
  const cmeta = new Map((countries || []).map((c) => [c.code, c]));
  const byId = new Map(channels.map((c) => [c.id, c]));

  const items = [];
  for (const [cid, st] of best) {
    const c = byId.get(cid); if (!c || c.is_nsfw || c.closed) continue;   // all-green + family-safe
    const cats = (c.categories && c.categories.length) ? c.categories : ["general"];
    const co = cmeta.get(c.country);
    const langs = (co && co.languages && co.languages.length) ? co.languages : [];   // derived from country
    items.push({
      id: "iptv:" + cid, _url: st.url, _ua: st.ua, _ref: st.ref, kind: "live", live: true, name: c.name || cid,
      playSrc: st.url, src: st.url, type: "application/x-mpegURL",
      posterUrl: logoOf.get(cid) || null, backdrop: logoOf.get(cid) || null,
      countryCode: c.country || "", country: co ? co.name : (c.country || ""), flag: co ? co.flag : "",
      languages: langs, langNames: langs.map(langName),
      categories: cats, genres: cats.map(cap), topics: cats.map((x) => String(x).toLowerCase()),
      channel: co ? (co.flag + " " + co.name) : (c.country || "Live"),
      quality: Math.min(1, (st._h || 480) / 2160), _resH: st._h, qualityLabel: st.quality || "",
      rating: null, runtimeSec: 0, source: "live", provider: "iptv", kappa: "", holoKappa: "iptv:" + cid,
      availability: { playable: true, source: "iptv", kappa: "", playSrc: st.url, type: "application/x-mpegURL" },
      provenance: { resolver: "Holo Live", kind: "iptv", label: "Live · " + (co ? co.name : (c.country || "")) },
    });
  }
  return items;
}

// Free-TV's curated, legal FAST playlist (Pluto / Samsung TV Plus / Plex / Roku …). group-title is the country.
export async function loadFreeTV({ fetch: f, cache } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-source-iptv: fetch required");
  const url = "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8";
  const go = async () => { const r = await doFetch(url); if (!r.ok) throw new Error("freetv " + r.status); return r.text(); };
  let text; try { text = cache ? (await cache.through("freetv|" + url, go)).body : await go(); } catch { return []; }
  return parseM3U(text).map((e, i) => {
    const grp = e.group || "";
    return {
      id: "freetv:" + i + ":" + (e.url || "").slice(-16), _url: e.url, kind: "live", live: true, name: e.name || ("Channel " + i),
      playSrc: e.url, src: e.url, type: "application/x-mpegURL",
      posterUrl: e.logo || null, backdrop: e.logo || null,
      countryCode: "", country: grp, flag: "", categories: ["general"], genres: ["Live"], topics: ["general"],
      channel: grp || "Free-TV", quality: 0.7, _resH: 720, qualityLabel: "",
      rating: null, runtimeSec: 0, source: "live", provider: "freetv", kappa: "", holoKappa: "freetv:" + i,
      availability: { playable: true, source: "freetv", kappa: "", playSrc: e.url, type: "application/x-mpegURL" },
      provenance: { resolver: "Holo Live", kind: "freetv", label: "Free-TV · " + (grp || "FAST") },
    };
  });
}

export default { loadLive, loadFreeTV };
if (typeof window !== "undefined") window.HoloLive = { loadLive, loadFreeTV };
