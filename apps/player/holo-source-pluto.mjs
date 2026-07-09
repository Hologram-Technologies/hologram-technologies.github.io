// holo-source-pluto.mjs — Pluto TV (official, free, ad-supported FAST) as a SourceProvider: 200+ branded
// linear channels (movies, documentaries, news, sport, kids, comedy…), each with an official HLS feed, logo,
// category and synopsis. Pure fetch of the public channels.json → Node-witnessable. Played AS SERVED (Pluto's
// SSAI ads stay intact — the free model). A per-session deviceId/sid is filled so the stitcher serves a stream.
//
// Boundary: official free source, content-neutral, no ad-stripping, no DRM. This is the legitimate breadth tier.

const cap = (s) => String(s || "").replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());

// Pluto's many genres → our category keys (LIVE_CATS).
function mapCat(g) {
  const s = String(g || "").toLowerCase();
  if (/news|opinion/.test(s)) return "news";
  if (/movie|film|cinema/.test(s)) return "movies";
  if (/sport/.test(s)) return "sports";
  if (/kid|toon|anime|family/.test(s)) return "kids";
  if (/comedy/.test(s)) return "comedy";
  if (/music/.test(s)) return "music";
  if (/doc|true crime|paranormal|adventure|science|nature|history/.test(s)) return "documentary";
  if (/food|cook/.test(s)) return "cooking";
  if (/life|home|travel/.test(s)) return "lifestyle";
  if (/business|money/.test(s)) return "business";
  if (/entertain|reality|drama|sci-fi|fantasy|gaming|classic|explore|español|spanish|tv/.test(s)) return "entertainment";
  return "general";
}
const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "00000000-0000-4000-8000-" + String(Math.floor(Math.random() * 1e12)).padStart(12, "0"));
// Fill the stitcher session params so Pluto serves a stream (deviceId/sid/deviceType/appName).
const withSession = (u, dev, sid) => String(u || "")
  .replace(/deviceId=[^&]*/, "deviceId=" + dev).replace(/sid=[^&]*/, "sid=" + sid)
  .replace(/deviceType=[^&]*/, "deviceType=web").replace(/deviceMake=[^&]*/, "deviceMake=Chrome")
  .replace(/deviceModel=[^&]*/, "deviceModel=web").replace(/appName=[^&]*/, "appName=web").replace(/appVersion=[^&]*/, "appVersion=8");

export async function loadPluto({ fetch: f, now } = {}) {
  const doFetch = f || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!doFetch) throw new Error("holo-source-pluto: fetch required");
  // The timeline endpoint returns each channel WITH its EPG (now/next programmes) — fetched fresh (time-sensitive).
  const t0 = now || Date.now();
  const iso = (ms) => new Date(ms).toISOString().slice(0, 19) + "Z";
  const url = "https://api.pluto.tv/v2/channels?start=" + encodeURIComponent(iso(t0)) + "&stop=" + encodeURIComponent(iso(t0 + 6 * 3600 * 1000));
  let list; try { const r = await doFetch(url); if (!r.ok) throw new Error("pluto " + r.status); list = await r.json(); } catch { return []; }
  const dev = newId();
  const out = [];
  for (const c of list || []) {
    const raw = c.stitched && c.stitched.urls && c.stitched.urls[0] && c.stitched.urls[0].url; if (!raw) continue;
    const hls = withSession(raw, dev, newId());
    const logo = (c.colorLogoPNG && c.colorLogoPNG.path) || (c.logo && c.logo.path) || (c.solidLogoPNG && c.solidLogoPNG.path) || null;
    const cat = mapCat(c.category || c.genre);
    const id = c._id || c.id || c.slug || c.name;
    // EPG — full schedule + now-playing + next, from the channel's timelines.
    const tl = (c.timelines || []).map((t) => ({ title: t.title, start: +new Date(t.start), stop: +new Date(t.stop) }));
    const cur = tl.find((t) => t.start <= t0 && t.stop > t0) || tl[0] || null;
    const ci = cur ? tl.indexOf(cur) : -1;
    const nxt = ci >= 0 ? tl[ci + 1] : null;
    const epgNow = cur ? { title: cur.title, start: cur.start, stop: cur.stop } : null;
    const epgNext = nxt ? { title: nxt.title, start: nxt.start } : null;
    out.push({
      id: "pluto:" + id, _url: hls, kind: "live", live: true, name: c.name || "Channel",
      playSrc: hls, src: hls, type: "application/x-mpegURL",
      posterUrl: logo, backdrop: logo, country: "Pluto TV", flag: "", countryCode: "",
      categories: [cat], topics: [cat], genres: [cap(cat)], languages: [],
      channel: "Pluto TV", quality: 0.8, _resH: 720, qualityLabel: "HD",
      overview: c.summary || "", blurb: c.summary || "", epgNow, epgNext, _timelines: tl,
      source: "live", provider: "pluto", kappa: "", holoKappa: "pluto:" + id,
      availability: { playable: true, source: "pluto", playSrc: hls, type: "application/x-mpegURL" },
      provenance: { resolver: "Pluto TV", kind: "fast", label: "Pluto TV · Free" },
    });
  }
  return out;
}

export default { loadPluto };
if (typeof window !== "undefined") window.HoloSourcePluto = { loadPluto };
