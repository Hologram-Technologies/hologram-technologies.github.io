// holo-live-premium.mjs — the curated "Premium" tier: the world's marquee channels as IDENTITIES, each with
// ORDERED official sources. The player federates them at play time (best available wins) and pre-warms the
// pick; a failed source fails over to the next automatically.
//
// Sources, in preference order:
//   yt   = the broadcaster's OFFICIAL 24/7 YouTube Live, by STABLE channel handle → /sc/vstream → Holo Video
//          (HD/4K, low-latency LL-HLS, globally reachable, WebGPU super-res + κ-audio). Handles are stable; a
//          wrong/old one just 404s and we fall over to iptv. Native CEF only (holo:// + /sc/vstream).
//   hls  = a public official manifest (where a broadcaster publishes one).
//   iptv = match our existing iptv-org feed (the guaranteed, browser-playable fallback + a logo source).
//
// Official, free, ad-supported sources only — played as served. No DRM, no paid-service scraping.

const cap = (s) => String(s || "").replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());

// name · category · country · flag · lang · brand-colour · yt(handle, optional) · iptv(match name, optional) · hls(url, optional)
export const PREMIUM = [
  // ── Global news, English — official 24/7 YouTube Live (best quality + reach) ──
  { name: "Sky News", cat: "news", country: "United Kingdom", flag: "🇬🇧", lang: "eng", brand: "#c70000", yt: "SkyNews", iptv: "Sky News" },
  { name: "Al Jazeera English", cat: "news", country: "Qatar", flag: "🇶🇦", lang: "eng", brand: "#fa9000", yt: "aljazeeraenglish", iptv: "Al Jazeera" },
  { name: "DW News", cat: "news", country: "Germany", flag: "🇩🇪", lang: "eng", brand: "#1a4884", yt: "dwnews", iptv: "DW" },
  { name: "France 24 English", cat: "news", country: "France", flag: "🇫🇷", lang: "eng", brand: "#00205b", yt: "FRANCE24English", iptv: "France 24" },
  { name: "Euronews", cat: "news", country: "Europe", flag: "🇪🇺", lang: "eng", brand: "#0c3b5d", yt: "euronews", iptv: "Euronews English" },
  { name: "TRT World", cat: "news", country: "Türkiye", flag: "🇹🇷", lang: "eng", brand: "#0a4ea2", yt: "trtworld", iptv: "TRT World" },
  { name: "Africanews", cat: "news", country: "Africa", flag: "🌍", lang: "eng", brand: "#e8a800", yt: "africanews", iptv: "Africanews English" },
  { name: "CNA", cat: "news", country: "Singapore", flag: "🇸🇬", lang: "eng", brand: "#d81a21", yt: "channelnewsasia", iptv: "CNA" },
  { name: "WION", cat: "news", country: "India", flag: "🇮🇳", lang: "eng", brand: "#c8102e", yt: "WION", iptv: "WION" },
  { name: "GB News", cat: "news", country: "United Kingdom", flag: "🇬🇧", lang: "eng", brand: "#1d2a44", yt: "GBNews", iptv: "GB News" },
  { name: "LiveNOW from FOX", cat: "news", country: "United States", flag: "🇺🇸", lang: "eng", brand: "#0c2340", yt: "livenowfox" },
  { name: "India Today", cat: "news", country: "India", flag: "🇮🇳", lang: "eng", brand: "#e30613", yt: "IndiaToday", iptv: "India Today" },
  { name: "Global News", cat: "news", country: "Canada", flag: "🇨🇦", lang: "eng", brand: "#0067b9", yt: "globalnews", iptv: "Global News" },
  { name: "Al Arabiya", cat: "news", country: "UAE", flag: "🇦🇪", lang: "ara", brand: "#c5a253", yt: "AlArabiya", iptv: "Al Arabiya" },
  // ── Business ──
  { name: "Bloomberg TV", cat: "business", country: "United States", flag: "🇺🇸", lang: "eng", brand: "#1a1a1a", yt: "markets", iptv: "Bloomberg" },
  { name: "CNBC International", cat: "business", country: "United States", flag: "🇺🇸", lang: "eng", brand: "#005594", yt: "CNBCi", iptv: "CNBC" },
  // ── Science ──
  { name: "NASA TV", cat: "science", country: "United States", flag: "🇺🇸", lang: "eng", brand: "#0b3d91", yt: "NASA", iptv: "NASA" },
  // ── Flagships via official iptv-org HLS (no public 24/7 YT live / geo-restricted) ──
  { name: "BBC News", cat: "news", country: "United Kingdom", flag: "🇬🇧", lang: "eng", brand: "#bb1919", iptv: "BBC News" },
  { name: "CGTN", cat: "news", country: "China", flag: "🇨🇳", lang: "eng", brand: "#c8102e", iptv: "CGTN" },
  { name: "NHK World-Japan", cat: "news", country: "Japan", flag: "🇯🇵", lang: "eng", brand: "#00a0e9", iptv: "NHK World" },
  { name: "ABC News", cat: "news", country: "United States", flag: "🇺🇸", lang: "eng", brand: "#1a1a1a", iptv: "ABC News Live" },
  { name: "Al Jazeera Mubasher", cat: "news", country: "Qatar", flag: "🇶🇦", lang: "ara", brand: "#fa9000", iptv: "Al Jazeera Mubasher" },
];

// Build playable premium items: identity + ordered sources. ytLive(handle)→url, matchIptv(name)→channel injected.
export function buildPremium(list, { ytLive, matchIptv } = {}) {
  const out = [];
  for (const p of list) {
    const m = matchIptv ? matchIptv(p.iptv || p.name) : null;
    const sources = [];
    if (p.yt && ytLive) sources.push({ kind: "yt", url: ytLive(p.yt), label: "YouTube Live · " + p.yt });
    if (p.hls) sources.push({ kind: "hls", url: p.hls, label: "Official HLS" });
    if (m && m.playSrc) sources.push({ kind: "iptv", url: m.playSrc, label: "Live" });
    if (!sources.length) continue;   // nothing official to play → skip
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    out.push({
      id: "prem:" + slug, name: p.name, live: true, kind: "live", premium: true,
      categories: [p.cat], topics: [p.cat], genres: [cap(p.cat)],
      country: p.country, countryCode: m ? m.countryCode : "", flag: p.flag || (m ? m.flag : ""),
      languages: p.lang ? [p.lang] : (m ? m.languages : []), brand: p.brand || "",
      posterUrl: p.logo || (m ? m.posterUrl : null), backdrop: p.logo || (m ? m.backdrop : null),
      channel: (p.flag ? p.flag + " " : "") + p.country,
      qualityLabel: sources[0].kind === "iptv" ? (m ? m.qualityLabel : "") : "HD", _resH: m ? (m._resH || 1080) : 1080,
      _sources: sources, _srcIdx: 0,
      playSrc: sources[0].url, src: sources[0].url, type: sources[0].kind === "hls" || sources[0].kind === "iptv" ? "application/x-mpegURL" : "",
      availability: { playable: true, source: "premium", playSrc: sources[0].url, type: "" },
      provenance: { resolver: "Holo Live Premium", kind: sources[0].kind, label: sources[0].label },
    });
  }
  return out;
}

export default { PREMIUM, buildPremium };
if (typeof window !== "undefined") window.HoloLivePremium = { PREMIUM, buildPremium };
