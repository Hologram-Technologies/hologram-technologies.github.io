// holo-stations.js — Holo Music's internet sources: live radio, curated channels,
// and podcasts, all from FREE, key-free, CORS-open public directories — no server,
// no API key. Everything normalizes to the SAME "stream item" shape the player already
// plays, so an internet station drops into the same queue as a content-addressed κ-track.
//
//   • Radio  — Radio Browser (api.radio-browser.info): ~50k community stations. Search /
//               top / by-tag(genre) / tag list, plus the /url click-counter and /vote, so
//               Holo Music is a good citizen of the directory it draws from.
//   • Channels — SomaFM (somafm.com/channels.json): curated, commercial-free channels
//               with live listener counts + now-playing; direct Icecast MP3 streams.
//   • Podcasts — iTunes Search API (no key, CORS): discover shows, then best-effort parse
//               of the RSS feed for episodes (works wherever the feed permits CORS).
//
// Honest model: a live stream is LOCATION-addressed (not content-addressable). What UOR
// adds here is content-addressing the *curation* — your saved collection becomes a κ you
// can share (Holo Music computes + stamps it) — and the option to PIN a finite podcast
// episode into the κ-store (content-addressed, κ-verified) via the holo-serve /ingest path.

(function () {
  "use strict";
  if (window.HoloStations) return;

  const J = async (url, opt) => { const r = await fetch(url, opt); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); };

  // ── Radio Browser — failover across the public mirrors ──────────────────────────
  const RB_HOSTS = ["https://de1.api.radio-browser.info", "https://nl1.api.radio-browser.info",
    "https://at1.api.radio-browser.info", "https://fi1.api.radio-browser.info"];
  let rbHost = null;
  async function rb(path) {
    const hosts = rbHost ? [rbHost, ...RB_HOSTS.filter((h) => h !== rbHost)] : RB_HOSTS;
    let err;
    for (const h of hosts) { try { const j = await J(h + path); rbHost = h; return j; } catch (e) { err = e; } }
    throw err || new Error("radio-browser unreachable");
  }
  const normStation = (s) => ({
    id: s.stationuuid, kind: "radio", title: (s.name || "").trim() || "(unnamed station)",
    artist: [s.country, s.codec && (s.codec.toUpperCase() + (s.bitrate ? " " + s.bitrate + "k" : ""))].filter(Boolean).join(" · "),
    album: (s.tags || "").split(",").map((t) => t.trim()).filter(Boolean).slice(0, 3).join(" · "),
    coverArtId: s.favicon || "", src: s.url_resolved || s.url, homepage: s.homepage || "",
    tags: (s.tags || "").split(",").map((t) => t.trim()).filter(Boolean), country: s.country || "",
    codec: s.codec || "", bitrate: s.bitrate || 0, votes: s.votes || 0, clicks: s.clickcount || 0,
    source: "internet", isStream: true, _live: true, _favKey: "radio:" + s.stationuuid, kappa: "",
  });
  const radio = {
    async search({ name = "", tag = "", country = "", order = "clickcount", limit = 60 } = {}) {
      const p = new URLSearchParams({ hidebroken: "true", order, reverse: "true", limit: String(limit) });
      if (name) p.set("name", name); if (tag) p.set("tagList", tag); if (country) p.set("country", country);
      return (await rb("/json/stations/search?" + p.toString())).map(normStation);
    },
    async top(limit = 60) { return (await rb("/json/stations/topclick/" + limit)).map(normStation); },
    async byTag(tag, limit = 80) { return this.search({ tag, limit }); },
    async tags(limit = 60) {
      const j = await rb("/json/tags?order=stationcount&reverse=true&hidebroken=true&limit=" + limit);
      return j.filter((t) => t.name && t.stationcount > 3).map((t) => ({ name: t.name, count: t.stationcount }));
    },
    async resolve(uuid) { try { const j = await rb("/json/url/" + uuid); return j && j.url; } catch { return null; } }, // counts a click
    async vote(uuid) { try { const j = await rb("/json/vote/" + uuid); return !!(j && j.ok); } catch { return false; } },
  };

  // ── SomaFM — curated, commercial-free channels (direct Icecast MP3) ──────────────
  const SOMA_FALLBACK = [
    { id: "groovesalad", title: "Groove Salad", genre: "ambient downtempo" },
    { id: "dronezone", title: "Drone Zone", genre: "ambient space" },
    { id: "lush", title: "Lush", genre: "vocal electronica" },
    { id: "indiepop", title: "Indie Pop Rocks!", genre: "indie pop" },
    { id: "secretagent", title: "Secret Agent", genre: "downtempo lounge" },
    { id: "u80s", title: "Underground 80s", genre: "80s synthpop" },
    { id: "bootliquor", title: "Boot Liquor", genre: "americana" },
    { id: "spacestation", title: "Space Station Soma", genre: "ambient electronica" },
    { id: "beatblender", title: "Beat Blender", genre: "deep house downtempo" },
    { id: "poptron", title: "PopTron", genre: "electro indie pop" },
    { id: "thetrip", title: "The Trip", genre: "progressive house" },
    { id: "sonicuniverse", title: "Sonic Universe", genre: "jazz fusion" },
    { id: "fluid", title: "Fluid", genre: "instrumental hip-hop" },
    { id: "deepspaceone", title: "Deep Space One", genre: "ambient deep space" },
  ];
  const somaStream = (id) => "https://ice1.somafm.com/" + id + "-128-mp3";
  const somaImg = (c) => c.xlimage || c.largeimage || c.image || ("https://somafm.com/img/" + c.id + "120.png");
  const normSoma = (c) => ({
    id: "soma:" + c.id, kind: "channel", title: c.title, artist: "SomaFM", album: c.genre || c.description || "",
    coverArtId: somaImg(c), src: somaStream(c.id), homepage: "https://somafm.com/" + c.id + "/",
    tags: (c.genre || "").split(/[ ,]+/).filter(Boolean), listeners: +c.listeners || 0,
    source: "internet", isStream: true, _live: true, _favKey: "channel:soma:" + c.id, kappa: "", _somaId: c.id,
  });
  const soma = {
    async channels() {
      try { const j = await J("https://somafm.com/channels.json"); return (j.channels || []).map(normSoma); }
      catch { return SOMA_FALLBACK.map(normSoma); }
    },
    async nowPlaying(somaId) {
      try { const j = await J("https://somafm.com/songs/" + somaId + ".json"); const s = (j.songs || [])[0];
        return s ? [s.artist, s.title].filter(Boolean).join(" — ") : ""; } catch { return ""; }
    },
  };

  // ── Podcasts — iTunes Search (discover) + best-effort feed parse (episodes) ──────
  const normPodcast = (p) => ({
    id: "pod:" + p.collectionId, kind: "podcast", title: p.collectionName, artist: p.artistName,
    album: (p.genres || []).filter((g) => g !== "Podcasts").join(" · "),
    coverArtId: p.artworkUrl600 || p.artworkUrl100 || "", feedUrl: p.feedUrl || "",
    homepage: p.collectionViewUrl || "", episodeCount: +p.trackCount || 0,
    source: "internet", isStream: false, _favKey: "podcast:" + p.collectionId, kappa: "",
  });
  const parseDur = (d) => { if (!d) return 0; d = String(d).trim(); if (/^\d+$/.test(d)) return +d;
    return d.split(":").map(Number).reduce((a, b) => a * 60 + (b || 0), 0) || 0; };
  const txt = (el, sel) => { const n = el.querySelector(sel); return n ? n.textContent.trim() : ""; };
  const nsAttr = (el, tag, attr) => { const n = el.getElementsByTagName(tag)[0]; return n ? n.getAttribute(attr) : ""; };
  const nsTxt = (el, tag) => { const n = el.getElementsByTagName(tag)[0]; return n ? n.textContent.trim() : ""; };
  const podcasts = {
    async search(term, limit = 40) {
      const j = await J("https://itunes.apple.com/search?media=podcast&limit=" + limit + "&term=" + encodeURIComponent(term));
      return (j.results || []).filter((r) => r.feedUrl).map(normPodcast);
    },
    // Returns an episode array, or null if the feed couldn't be fetched at all. Tries a
    // direct fetch first, then the holo-serve /fetch CORS proxy (so feeds that block CORS
    // still load when the dev server is running) — near-universal episode coverage.
    async episodes(feedUrl, showArt = "", limit = 80) {
      const feedText = async (u) => {
        try { const r = await fetch(u, { redirect: "follow" }); if (r.ok) { const t = await r.text(); if (t) return t; } } catch {}
        try { const r = await fetch("/fetch?url=" + encodeURIComponent(u)); if (r.ok) { const t = await r.text(); if (t) return t; } } catch {}
        return null;
      };
      try {
        const xml = await feedText(feedUrl);
        if (xml == null) return null;
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        if (doc.querySelector("parsererror")) return null;
        const chanTitle = txt(doc, "channel > title") || "";
        const chanImg = txt(doc, "channel > image > url") || nsAttr(doc, "itunes:image", "href") || showArt;
        return [...doc.querySelectorAll("item")].slice(0, limit).map((it) => {
          const enc = it.querySelector("enclosure");
          const url = enc ? enc.getAttribute("url") : "";
          const img = nsAttr(it, "itunes:image", "href") || chanImg;
          return {
            id: "ep:" + (txt(it, "guid") || url || Math.random().toString(36)), kind: "episode",
            title: txt(it, "title") || "(episode)", artist: chanTitle, album: "",
            coverArtId: img || showArt, src: url, homepage: txt(it, "link"),
            duration: parseDur(nsTxt(it, "itunes:duration")), pubDate: txt(it, "pubDate"),
            source: "internet", isStream: false, _favKey: "episode:" + url, kappa: "",
          };
        }).filter((e) => e.src);
      } catch { return null; }
    },
  };

  // ── Internet Archive — the on-demand backbone (millions of free, full tracks) ────
  // archive.org has a fully open, CORS-enabled Advanced Search + Metadata API and no key.
  // We field-scope to music (creator/title) and require an MP3 derivative + exclude the big
  // spoken-word collections, so results read like a music library, not an audio dump. Each
  // item is an "album"; its MP3 files are tracks streamed straight from /download.
  const IA = "https://archive.org";
  const iaImg = (id) => IA + "/services/img/" + encodeURIComponent(id);
  const IA_EXCL = "-collection:(librivoxaudio) AND -collection:(oldtimeradio) AND -collection:(radioprograms) AND -collection:(podcasts) AND -collection:(audio_bookspoetry)";
  const yr = (v) => { const n = parseInt(String(v || "").slice(0, 4), 10); return Number.isFinite(n) ? n : null; };
  const parseLen = (v) => { if (v == null) return 0; v = String(v).trim(); if (/^[\d.]+$/.test(v)) return Math.round(+v);
    if (v.includes(":")) return v.split(":").map(Number).reduce((a, b) => a * 60 + (b || 0), 0); return 0; };
  const normIaAlbum = (d) => ({ id: "ia:" + d.identifier, identifier: d.identifier, kind: "album",
    name: d.title || d.identifier, title: d.title || d.identifier, artist: (Array.isArray(d.creator) ? d.creator[0] : d.creator) || "Unknown",
    album: d.title || d.identifier, coverArtId: iaImg(d.identifier), year: yr(d.year), downloads: d.downloads || 0,
    source: "archive", isStream: false, homepage: IA + "/details/" + d.identifier, _favKey: "album:ia:" + d.identifier, kappa: "" });
  const archive = {
    async search(q, rows = 36) {
      const query = `(creator:(${q}) OR title:(${q})) AND mediatype:(audio) AND format:(VBR MP3) AND ${IA_EXCL}`;
      const u = `${IA}/advancedsearch.php?q=${encodeURIComponent(query)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=downloads&sort[]=downloads+desc&rows=${rows}&output=json`;
      const j = await J(u); return ((j.response && j.response.docs) || []).map(normIaAlbum);
    },
    // a curated lane: the Live Music Archive (etree) — legal, taper-friendly concerts.
    async live(q, rows = 36) {
      const u = `${IA}/advancedsearch.php?q=${encodeURIComponent(`creator:(${q}) AND collection:(etree)`)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=year&fl[]=downloads&sort[]=downloads+desc&rows=${rows}&output=json`;
      const j = await J(u); return ((j.response && j.response.docs) || []).map(normIaAlbum);
    },
    // ALWAYS choose the highest quality the source offers: group a track's representations
    // (an original + its derivatives, linked by `original`) and pick the best browser-playable
    // one — lossless FLAC/ALAC/WAV first, then highest-bitrate MP3/Ogg. So IA streams + pins
    // at source fidelity (often lossless), not the lossy MP3 derivative.
    async album(identifier) {
      const m = await J(`${IA}/metadata/${encodeURIComponent(identifier)}`);
      const md = m.metadata || {}, cover = iaImg(identifier);
      const ext = (n) => (String(n).split(".").pop() || "").toLowerCase();
      const PLAYABLE = /^(flac|mp3|m4a|aac|ogg|oga|opus|wav)$/;          // codecs a browser decodes
      const ctOf = { flac: "audio/flac", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", wav: "audio/wav" };
      const qLabel = (f, e) => { const fmt = f.format || ""; if (e === "flac") return /24/.test(fmt) ? "FLAC 24-bit" : "FLAC · lossless"; if (e === "wav") return "WAV · lossless"; if (e === "m4a" && /lossless|alac/i.test(fmt)) return "ALAC · lossless"; const br = parseInt(f.bitrate, 10) || 0; return (e.toUpperCase()) + (br ? " " + br + "k" : ""); };
      const rank = (f) => { const e = ext(f.name), fmt = (f.format || "").toLowerCase(), br = parseInt(f.bitrate, 10) || 0;
        if (e === "flac" || /flac/.test(fmt)) return 1000 + (/24/.test(fmt) ? 50 : 0);
        if (e === "wav" || /wave|aiff/.test(fmt)) return 960; if (e === "m4a" && /lossless|alac/.test(fmt)) return 950;
        if (e === "mp3" || /mp3/.test(fmt)) return 500 + br / 10; if (/ogg|vorbis/.test(fmt) || e === "ogg" || e === "oga") return 480 + br / 10;
        if (e === "m4a" || e === "aac" || e === "opus") return 470 + br / 10; return 100; };
      const groups = new Map();                                          // track-key → all representations
      for (const f of (m.files || [])) {
        if (!f.name || !PLAYABLE.test(ext(f.name))) continue;
        const key = (f.original || f.name).replace(/\.[^.]+$/, "").toLowerCase();
        if (!groups.has(key)) groups.set(key, []); groups.get(key).push(f);
      }
      const dl = (n) => `${IA}/download/${encodeURIComponent(identifier)}/${n.split("/").map(encodeURIComponent).join("/")}`;
      const songs = [...groups.values()].map((list) => {
        const best = list.reduce((a, b) => (rank(b) > rank(a) ? b : a));
        const mp3 = list.filter((f) => ext(f.name) === "mp3").sort((a, b) => (parseInt(b.bitrate, 10) || 0) - (parseInt(a.bitrate, 10) || 0))[0];
        const e = ext(best.name);
        // src = the highest quality the source offers (lossless when present); _altSrc = a
        // reliably-streamable MP3 the player falls back to if a big lossless file won't stream.
        return {
          id: "ia:" + identifier + "/" + best.name, kind: "track",
          title: best.title || best.name.replace(/\.[^.]+$/, "").replace(/^\d+\s*[-.]\s*/, ""),
          album: md.title || identifier, artist: best.artist || (Array.isArray(md.creator) ? md.creator[0] : md.creator) || "Unknown",
          track: parseInt(best.track, 10) || null, year: yr(md.year), duration: parseLen(best.length),
          suffix: e, contentType: ctOf[e] || "audio/mpeg", qualityLabel: qLabel(best, e), coverArtId: cover, type: "music",
          src: dl(best.name), _altSrc: mp3 && mp3.name !== best.name ? dl(mp3.name) : "", _altQuality: mp3 ? qLabel(mp3, "mp3") : "",
          source: "archive", isStream: false, _live: false, _ownable: true, _favKey: "track:ia:" + identifier + "/" + best.name, kappa: "",
        };
      }).sort((a, b) => (a.track || 999) - (b.track || 999) || a.title.localeCompare(b.title));
      return {
        id: "ia:" + identifier, identifier, name: md.title || identifier, title: md.title || identifier,
        artist: (Array.isArray(md.creator) ? md.creator[0] : md.creator) || "Unknown", coverArtId: cover, year: yr(md.year),
        genre: [].concat(md.subject || []).slice(0, 2).join(" · "), songCount: songs.length,
        duration: songs.reduce((n, s) => n + s.duration, 0), source: "archive", homepage: IA + "/details/" + identifier,
        _favKey: "album:ia:" + identifier, kind: "album", isStream: false, kappa: "", songs,
      };
    },
  };

  // ── SoundCloud — mediated by the host's yt-dlp (no open/CORS API exists) ─────────
  // The browser can't talk to SoundCloud directly (CORS-locked + signed urls), so we go
  // through holo-serve's /sc/* routes (yt-dlp). Flat search already returns rich metadata
  // + ARTWORK + a clean url, so browse is artwork-rich with no extra calls. Play streams
  // best-effort via /sc/stream (subject to SoundCloud's rate limits); ⬇ Pin owns it
  // forever (ingest → content-addressed κ-track) — the robust, offline, κ-verified path.
  const scJson = async (path) => { const r = await fetch(path); let j; try { j = await r.json(); } catch { throw new Error("SoundCloud unavailable"); } if (j && j.error) throw new Error(j.error); return j; };
  const scArt = (e) => { const ts = e.thumbnails || []; const o = ts.find((t) => /original/i.test(t.id || "") || /-original\./i.test(t.url || "")); if (o) return o.url;
    let best = "", bw = -1; for (const t of ts) if ((t.width || 0) > bw) { bw = t.width || 0; best = t.url; } return best || e.thumbnail || ""; };
  const scTrack = (e) => { const u = e.webpage_url || e.url || ""; return {
    id: "sc:" + (u || e.id), kind: "sctrack", title: e.title || "(track)", artist: (e.artists && e.artists[0]) || e.uploader || e.uploader_id || "",
    album: "", coverArtId: scArt(e), duration: Math.round(e.duration || 0), genre: (e.genres && e.genres[0]) || e.genre || "",
    scUrl: u, homepage: u, src: "/sc/stream?url=" + encodeURIComponent(u), source: "soundcloud", isStream: false, _live: false,
    _noSeek: true, _ownable: true, _favKey: "sc:" + (u || e.id), kappa: "" }; };
  const soundcloud = {
    async search(q, n = 24) { const j = await scJson(`/sc/search?q=${encodeURIComponent(q)}&n=${n}`); return ((j && j.entries) || []).filter((e) => e.webpage_url || e.url).map(scTrack); },
    async resolve(url) { const j = await scJson(`/sc/resolve?url=${encodeURIComponent(url)}`);
      if (j && j.entries) return { kind: "set", title: j.title || "SoundCloud", uploader: j.uploader || "", art: scArt(j), items: (j.entries || []).filter((e) => e.webpage_url || e.url).map(scTrack) };
      return { kind: "track", item: scTrack(j) }; },
    async track(url) { const j = await scJson(`/sc/track?url=${encodeURIComponent(url)}`); return scTrack(j); },
  };

  // ── resolve ANY url → something playable (the limitless "paste anything" path) ───
  async function resolveUrl(url) {
    url = String(url).trim();
    if (/^https?:\/\/(?:[\w-]+\.)?(?:soundcloud\.com|snd\.sc)\//i.test(url)) return { type: "soundcloud", url };
    let m = url.match(/archive\.org\/(?:details|download|embed)\/([^/?#]+)/i);
    if (m) return { type: "album", identifier: decodeURIComponent(m[1]) };
    if (/\.(m3u8|pls|m3u)(\?|#|$)/i.test(url)) return { type: "track", item: { id: "url:" + url, kind: "radio", title: hostOf(url), artist: "stream", album: "", coverArtId: "", src: url, source: "internet", isStream: true, _live: true, _favKey: "url:" + url, kappa: "" } };
    if (/\.(mp3|m4a|aac|ogg|oga|opus|flac|wav)(\?|#|$)/i.test(url)) return { type: "track", item: { id: "url:" + url, kind: "track", title: decodeURIComponent((url.split("/").pop() || "").split("?")[0]) || hostOf(url), artist: hostOf(url), album: "", coverArtId: "", src: url, source: "internet", isStream: false, _live: false, _favKey: "url:" + url, kappa: "" } };
    return { type: "external", url };                    // YouTube/Bandcamp/etc — link out (or ingest)
  }
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

  window.HoloStations = { radio, soma, podcasts, archive, soundcloud, resolveUrl, SOMA_FALLBACK };
})();
