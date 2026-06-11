// holo-subsonic.js — Holo Music's data layer: ONE item shape, two sources.
//
// Strict adherence to Navidrome's actual external contract — the Subsonic API
// (subsonic-response 1.16.1 / OpenSubsonic, the protocol Navidrome implements) —
// WITHOUT its Go server. The native library (music/library.json) is already emitted in
// Subsonic shape by scan-music.mjs, and this module ALSO speaks the real Subsonic REST
// endpoints with salted-token auth (ping · getArtists · getArtist · getAlbum ·
// getAlbumList2 · search3 · getGenres · getPlaylists · stream · getCoverArt · star ·
// setRating · scrobble), so Holo Music doubles as a genuine Navidrome/Subsonic client.
// Both sources normalize to the same render objects; the native one is content-addressed
// (a κ that re-derives, Law L5), the remote one is location-addressed (a server URL) —
// honestly labelled. No framework, no build: a single vendored script, like the page.

(function () {
  "use strict";
  if (window.HoloSubsonic) return;

  // ── MD5 (RFC 1321) — Subsonic salted-token auth is md5(password + salt). Compact,
  //    public-domain implementation; the spec's recommended auth, so we implement it
  //    rather than send a plaintext password. ────────────────────────────────────────
  function md5(str) {
    function rl(n, c) { return (n << c) | (n >>> (32 - c)); }
    function cmn(q, a, b, x, s, t) { a = (((a + q) | 0) + ((x + t) | 0)) | 0; return (((rl(a, s)) | 0) + b) | 0; }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
    function toBytes(s) { const u = unescape(encodeURIComponent(s)), b = []; for (let i = 0; i < u.length; i++) b.push(u.charCodeAt(i)); return b; }
    const bytes = toBytes(str), n = bytes.length, words = [];
    for (let i = 0; i < n; i++) words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << ((i % 4) * 8));
    words[n >> 2] = (words[n >> 2] || 0) | (0x80 << ((n % 4) * 8));
    const bits = n * 8, len = (((n + 8) >> 6) + 1) * 16;
    while (words.length < len) words.push(0);
    words[len - 2] = bits;
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < len; i += 16) {
      const oa = a, ob = b, oc = c, od = d, w = (j) => words[i + j] | 0;
      a = ff(a, b, c, d, w(0), 7, -680876936); d = ff(d, a, b, c, w(1), 12, -389564586); c = ff(c, d, a, b, w(2), 17, 606105819); b = ff(b, c, d, a, w(3), 22, -1044525330);
      a = ff(a, b, c, d, w(4), 7, -176418897); d = ff(d, a, b, c, w(5), 12, 1200080426); c = ff(c, d, a, b, w(6), 17, -1473231341); b = ff(b, c, d, a, w(7), 22, -45705983);
      a = ff(a, b, c, d, w(8), 7, 1770035416); d = ff(d, a, b, c, w(9), 12, -1958414417); c = ff(c, d, a, b, w(10), 17, -42063); b = ff(b, c, d, a, w(11), 22, -1990404162);
      a = ff(a, b, c, d, w(12), 7, 1804603682); d = ff(d, a, b, c, w(13), 12, -40341101); c = ff(c, d, a, b, w(14), 17, -1502002290); b = ff(b, c, d, a, w(15), 22, 1236535329);
      a = gg(a, b, c, d, w(1), 5, -165796510); d = gg(d, a, b, c, w(6), 9, -1069501632); c = gg(c, d, a, b, w(11), 14, 643717713); b = gg(b, c, d, a, w(0), 20, -373897302);
      a = gg(a, b, c, d, w(5), 5, -701558691); d = gg(d, a, b, c, w(10), 9, 38016083); c = gg(c, d, a, b, w(15), 14, -660478335); b = gg(b, c, d, a, w(4), 20, -405537848);
      a = gg(a, b, c, d, w(9), 5, 568446438); d = gg(d, a, b, c, w(14), 9, -1019803690); c = gg(c, d, a, b, w(3), 14, -187363961); b = gg(b, c, d, a, w(8), 20, 1163531501);
      a = gg(a, b, c, d, w(13), 5, -1444681467); d = gg(d, a, b, c, w(2), 9, -51403784); c = gg(c, d, a, b, w(7), 14, 1735328473); b = gg(b, c, d, a, w(12), 20, -1926607734);
      a = hh(a, b, c, d, w(5), 4, -378558); d = hh(d, a, b, c, w(8), 11, -2022574463); c = hh(c, d, a, b, w(11), 16, 1839030562); b = hh(b, c, d, a, w(14), 23, -35309556);
      a = hh(a, b, c, d, w(1), 4, -1530992060); d = hh(d, a, b, c, w(4), 11, 1272893353); c = hh(c, d, a, b, w(7), 16, -155497632); b = hh(b, c, d, a, w(10), 23, -1094730640);
      a = hh(a, b, c, d, w(13), 4, 681279174); d = hh(d, a, b, c, w(0), 11, -358537222); c = hh(c, d, a, b, w(3), 16, -722521979); b = hh(b, c, d, a, w(6), 23, 76029189);
      a = hh(a, b, c, d, w(9), 4, -640364487); d = hh(d, a, b, c, w(12), 11, -421815835); c = hh(c, d, a, b, w(15), 16, 530742520); b = hh(b, c, d, a, w(2), 23, -995338651);
      a = ii(a, b, c, d, w(0), 6, -198630844); d = ii(d, a, b, c, w(7), 10, 1126891415); c = ii(c, d, a, b, w(14), 15, -1416354905); b = ii(b, c, d, a, w(5), 21, -57434055);
      a = ii(a, b, c, d, w(12), 6, 1700485571); d = ii(d, a, b, c, w(3), 10, -1894986606); c = ii(c, d, a, b, w(10), 15, -1051523); b = ii(b, c, d, a, w(1), 21, -2054922799);
      a = ii(a, b, c, d, w(8), 6, 1873313359); d = ii(d, a, b, c, w(15), 10, -30611744); c = ii(c, d, a, b, w(6), 15, -1560198380); b = ii(b, c, d, a, w(13), 21, 1309151649);
      a = ii(a, b, c, d, w(4), 6, -145523070); d = ii(d, a, b, c, w(11), 10, -1120210379); c = ii(c, d, a, b, w(2), 15, 718787259); b = ii(b, c, d, a, w(9), 21, -343485551);
      a = (a + oa) | 0; b = (b + ob) | 0; c = (c + oc) | 0; d = (d + od) | 0;
    }
    const hex = (x) => { let s = ""; for (let i = 0; i < 4; i++) s += ("0" + ((x >> (i * 8)) & 255).toString(16)).slice(-2); return s; };
    return hex(a) + hex(b) + hex(c) + hex(d);
  }

  const SUFFIX = { wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac", ogg: "audio/ogg", m4a: "audio/mp4", opus: "audio/ogg", aac: "audio/aac" };
  const CLIENT = "Holo Music", API_VERSION = "1.16.1";

  // ── normalized render shapes (both sources produce these) ─────────────────────────
  const N = {
    artist: (a, src) => ({ id: a.id, name: a.name, albumCount: a.albumCount || (a.album ? a.album.length : 0), coverArtId: a.coverArt || a.id, source: src }),
    album: (al, src) => ({
      id: al.id, name: al.name, artist: al.artist, artistId: al.artistId, coverArtId: al.coverArt || al.id,
      songCount: al.songCount, duration: al.duration || 0, year: al.year || null, genre: al.genre || "",
      created: al.created || "", source: src,
    }),
    song: (s, src, base, token) => ({
      id: s.id, title: s.title, album: s.album, albumId: s.albumId, artist: s.artist, artistId: s.artistId,
      track: s.track || null, year: s.year || null, genre: s.genre || "", duration: s.duration || 0,
      suffix: s.suffix || "", contentType: s.contentType || SUFFIX[s.suffix] || "", size: s.size || 0,
      bitRate: s.bitRate || 0, coverArtId: s.coverArt || s.albumId,
      src: src === "native" ? encodeURI(s.holoSrc) : null,   // native: content-addressed file URL
      kappa: src === "native" ? (s.kappa || "") : "", source: src, _raw: s,
    }),
    genre: (g) => ({ value: g.value, songCount: g.songCount || 0, albumCount: g.albumCount || 0 }),
    playlist: (p, src) => ({ id: p.id, name: p.name, comment: p.comment || "", songCount: p.songCount || (p.entry ? p.entry.length : 0),
      duration: p.duration || 0, owner: p.owner || "", public: !!p.public, songIds: p.songIds || null, source: src }),
  };

  // ════════════════════════════════════════════════════════════════════════════════
  // NATIVE — the κ-store catalog (default, content-addressed, serverless).
  // ════════════════════════════════════════════════════════════════════════════════
  async function native(url = "music/library.json") {
    const lib = await (await fetch(url, { cache: "no-store" })).json();
    // Merge OWNED (ingested) κ-tracks — "paste anything → own it forever" imports that
    // each re-derive to their κ (Law L5). They become first-class κ-store items: an
    // "Imported" artist · album · playlist, searchable + κ-verified on play.
    try {
      const ing = await (await fetch("music/ingested/index.json", { cache: "no-store" })).json();
      const isongs = (ing && Array.isArray(ing.songs)) ? ing.songs : [];
      if (isongs.length) {
        const artistId = "imported", albumId = "imported";
        const cover = (isongs.find((s) => s.coverArt) || {}).coverArt || "";
        for (const s of isongs) { s.albumId = albumId; s.artistId = artistId; if (!s.coverArt) s.coverArt = cover; }
        const dur = isongs.reduce((n, s) => n + (s.duration || 0), 0), ids = isongs.map((s) => s.id);
        if (!lib.artists.some((a) => a.id === artistId)) lib.artists.push({ id: artistId, name: "Imported", coverArt: cover, albumIds: [albumId], albumCount: 1 });
        if (!lib.albums.some((a) => a.id === albumId)) lib.albums.push({ id: albumId, name: "Imported", artist: "Imported", artistId, coverArt: cover, year: null, genre: "", created: new Date().toISOString(), songIds: ids, songCount: isongs.length, duration: dur });
        lib.songs = [...isongs, ...lib.songs];
        lib.playlists = lib.playlists || [];
        if (!lib.playlists.some((p) => p.id === "pl-imported")) lib.playlists.unshift({ id: "pl-imported", name: "Imported", comment: "Owned from the web — content-addressed, κ-verified.", public: false, owner: "you", songIds: ids, songCount: isongs.length, duration: dur });
        lib._imported = isongs.length;
      }
    } catch {}
    const ix = { artist: new Map(), album: new Map(), song: new Map() };
    for (const a of lib.artists) ix.artist.set(a.id, a);
    for (const al of lib.albums) ix.album.set(al.id, al);
    for (const s of lib.songs) ix.song.set(s.id, s);
    const songN = (s) => N.song(s, "native");
    const albumN = (al) => N.album(al, "native");
    // User playlists are page-owned, content-addressed, and persisted locally (no
    // server). They live alongside the catalog's own playlists; a saved playlist's
    // identity is the κ of its canonical track list (Law L5) — see the page's share.
    const PLKEY = "holomusic.userpls";
    const loadPL = () => { try { return JSON.parse(localStorage.getItem(PLKEY) || "[]"); } catch { return []; } };
    const savePL = (a) => { try { localStorage.setItem(PLKEY, JSON.stringify(a)); } catch {} };
    const _sh = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

    return {
      kind: "native", name: lib.serverName || "Holo Music", type: lib.type || "navidrome",
      version: lib.subsonicVersion || API_VERSION, ignoredArticles: lib.ignoredArticles || "",
      libraryKappa: "",                                    // filled by the page from the manifest
      async ping() { return true; },
      async getArtists() { return lib.artists.map((a) => N.artist(a, "native")); },
      async getArtist(id) { const a = ix.artist.get(id); if (!a) return null;
        return { ...N.artist(a, "native"), albums: (a.albumIds || []).map((aid) => albumN(ix.album.get(aid))).filter(Boolean) }; },
      async getAlbum(id) { const al = ix.album.get(id); if (!al) return null;
        return { ...albumN(al), songs: (al.songIds || []).map((sid) => songN(ix.song.get(sid))).filter(Boolean) }; },
      async getAlbumList2(type = "alphabeticalByName") {
        let a = lib.albums.slice();
        if (type === "alphabeticalByArtist") a.sort((x, y) => (x.artist || "").localeCompare(y.artist || "") || x.name.localeCompare(y.name));
        else if (type === "newest" || type === "recent") a.sort((x, y) => (y.created || "").localeCompare(x.created || "") || x.name.localeCompare(y.name));
        else if (type === "random") for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
        else a.sort((x, y) => x.name.localeCompare(y.name));
        return a.map(albumN);
      },
      async getSong(id) { const s = ix.song.get(id); return s ? songN(s) : null; },
      async getSongs() { return lib.songs.map(songN); },
      async search3(q) {
        const t = (q || "").trim().toLowerCase(); if (!t) return { artists: [], albums: [], songs: [] };
        const has = (s) => (s || "").toLowerCase().includes(t);
        return {
          artists: lib.artists.filter((a) => has(a.name)).map((a) => N.artist(a, "native")),
          albums: lib.albums.filter((al) => has(al.name) || has(al.artist)).map(albumN),
          songs: lib.songs.filter((s) => has(s.title) || has(s.artist) || has(s.album)).map(songN),
        };
      },
      async getGenres() { return (lib.genres || []).map(N.genre); },
      async getRandomSongs(size = 50) { return _sh(lib.songs.slice()).slice(0, size).map(songN); },
      // catalog playlists + the operator's own (editable) playlists, one shape
      async getPlaylists() { return [...(lib.playlists || []).map((p) => N.playlist(p, "native")),
        ...loadPL().map((p) => ({ ...N.playlist(p, "native"), editable: true }))]; },
      async getPlaylist(id) {
        const u = loadPL().find((p) => p.id === id);
        if (u) return { ...N.playlist(u, "native"), editable: true, songs: (u.songIds || []).map((sid) => songN(ix.song.get(sid))).filter(Boolean) };
        const p = (lib.playlists || []).find((x) => x.id === id); if (!p) return null;
        return { ...N.playlist(p, "native"), songs: (p.songIds || []).map((sid) => songN(ix.song.get(sid))).filter(Boolean) };
      },
      // Subsonic playlist CRUD (createPlaylist · updatePlaylist · deletePlaylist) — native, persisted locally
      async createPlaylist(name, songIds = []) { const a = loadPL(); const id = "upl-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        a.unshift({ id, name: name || "New Playlist", songIds: songIds.slice(), comment: "", owner: "you", public: false, created: new Date().toISOString() }); savePL(a); return id; },
      async updatePlaylist(id, patch = {}) { const a = loadPL(); const p = a.find((x) => x.id === id); if (!p) return false;
        if (patch.name != null) p.name = patch.name; if (patch.comment != null) p.comment = patch.comment; if (patch.public != null) p.public = !!patch.public;
        if (patch.songIds) p.songIds = patch.songIds.slice(); if (patch.add) p.songIds.push(...patch.add);
        if (patch.removeIndexes) for (const i of patch.removeIndexes.slice().sort((x, y) => y - x)) p.songIds.splice(i, 1); savePL(a); return true; },
      async deletePlaylist(id) { savePL(loadPL().filter((p) => p.id !== id)); return true; },
      async getLyrics(song) { const raw = ix.song.get(song.id) || song._raw || {}; return raw.lyrics || ""; },
      async getStarred2() { return { artists: [], albums: [], songs: [] }; },   // favorites are page-owned natively
      async getTopSongs(artistName) { return lib.songs.filter((s) => (s.artist || "") === artistName).map(songN); },
      async getArtistInfo() { return {}; }, async getSimilarSongs() { return []; }, async getNowPlaying() { return []; },
      streamUrl(song) { return song.src || encodeURI((ix.song.get(song.id) || {}).holoSrc || ""); },
      downloadUrl(song) { return this.streamUrl(song); },
      coverArtUrl(coverArtId) { return coverArtId && coverArtId.indexOf("sha256:") === 0 ? "music/art/" + coverArtId.slice(7) + ".svg" : ""; },
      // favorites/ratings/scrobbles are page-owned (localStorage) natively — no-ops here.
      async star() { return true; }, async unstar() { return true; }, async setRating() { return true; }, async scrobble() { return true; },
      _lib: lib,
    };
  }

  // ════════════════════════════════════════════════════════════════════════════════
  // SERVER — a real Navidrome / Subsonic server over its REST API (OpenSubsonic).
  // ════════════════════════════════════════════════════════════════════════════════
  async function server(baseUrl, username, password) {
    const base = String(baseUrl).replace(/\/+$/, "");
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
    const token = md5((password || "") + salt);
    const auth = `u=${encodeURIComponent(username)}&t=${token}&s=${salt}&v=${API_VERSION}&c=${encodeURIComponent(CLIENT)}&f=json`;
    const rest = (view, params = "") => `${base}/rest/${view}.view?${auth}${params ? "&" + params : ""}`;
    async function call(view, params) {
      const r = await (await fetch(rest(view, params), { cache: "no-store" })).json();
      const sr = r["subsonic-response"] || {};
      if (sr.status !== "ok") throw new Error((sr.error && sr.error.message) || "subsonic error");
      return sr;
    }
    const sr = await call("ping");                          // authenticate / probe
    const albumN = (al) => N.album(al, "subsonic");
    const songN = (s) => N.song(s, "subsonic", base, token);

    return {
      kind: "subsonic", name: sr.serverName || base, type: sr.type || "subsonic", version: sr.version || API_VERSION,
      ignoredArticles: "", base, token,
      async ping() { return true; },
      async getArtists() { const r = await call("getArtists"); return ((r.artists && r.artists.index) || []).flatMap((ix) => ix.artist || []).map((a) => N.artist(a, "subsonic")); },
      async getArtist(id) { const r = await call("getArtist", "id=" + encodeURIComponent(id)); const a = r.artist || {}; return { ...N.artist(a, "subsonic"), albums: (a.album || []).map(albumN) }; },
      async getAlbum(id) { const r = await call("getAlbum", "id=" + encodeURIComponent(id)); const a = r.album || {}; return { ...albumN(a), songs: (a.song || []).map(songN) }; },
      async getAlbumList2(type = "alphabeticalByName", size = 500) { const r = await call("getAlbumList2", `type=${encodeURIComponent(type)}&size=${size}`); return ((r.albumList2 && r.albumList2.album) || []).map(albumN); },
      async getSong(id) { const r = await call("getSong", "id=" + encodeURIComponent(id)); return r.song ? songN(r.song) : null; },
      async getSongs() { const r = await call("getRandomSongs", "size=500"); return ((r.randomSongs && r.randomSongs.song) || []).map(songN); },
      async search3(q) { const r = await call("search3", "query=" + encodeURIComponent(q || "") + "&artistCount=30&albumCount=50&songCount=100"); const s = r.searchResult3 || {};
        return { artists: (s.artist || []).map((a) => N.artist(a, "subsonic")), albums: (s.album || []).map(albumN), songs: (s.song || []).map(songN) }; },
      async getGenres() { const r = await call("getGenres"); return ((r.genres && r.genres.genre) || []).map(N.genre); },
      async getPlaylists() { const r = await call("getPlaylists"); return ((r.playlists && r.playlists.playlist) || []).map((p) => N.playlist(p, "subsonic")); },
      async getPlaylist(id) { const r = await call("getPlaylist", "id=" + encodeURIComponent(id)); const p = r.playlist || {}; return { ...N.playlist(p, "subsonic"), songs: (p.entry || []).map(songN) }; },
      streamUrl(song) { return rest("stream", "id=" + encodeURIComponent(song.id)); },
      coverArtUrl(coverArtId, size = 300) { return coverArtId ? rest("getCoverArt", "id=" + encodeURIComponent(coverArtId) + "&size=" + size) : ""; },
      async star(id, on = true) { try { await call(on ? "star" : "unstar", "id=" + encodeURIComponent(id)); return true; } catch { return false; } },
      async unstar(id) { return this.star(id, false); },
      async setRating(id, rating) { try { await call("setRating", "id=" + encodeURIComponent(id) + "&rating=" + (rating | 0)); return true; } catch { return false; } },
      async scrobble(id, submission = true) { try { await call("scrobble", "id=" + encodeURIComponent(id) + "&submission=" + (submission ? "true" : "false")); return true; } catch { return false; } },
      async getRandomSongs(size = 50) { const r = await call("getRandomSongs", "size=" + size); return ((r.randomSongs && r.randomSongs.song) || []).map(songN); },
      async getStarred2() { const r = await call("getStarred2"); const s = r.starred2 || {};
        return { artists: (s.artist || []).map((a) => N.artist(a, "subsonic")), albums: (s.album || []).map(albumN), songs: (s.song || []).map(songN) }; },
      // OpenSubsonic createPlaylist · updatePlaylist · deletePlaylist (real server playlists)
      async createPlaylist(name, songIds = []) { const r = await call("createPlaylist", "name=" + encodeURIComponent(name) + songIds.map((id) => "&songId=" + encodeURIComponent(id)).join("")); return (r.playlist && r.playlist.id) || ""; },
      async updatePlaylist(id, patch = {}) { let p = "playlistId=" + encodeURIComponent(id);
        if (patch.name != null) p += "&name=" + encodeURIComponent(patch.name); if (patch.comment != null) p += "&comment=" + encodeURIComponent(patch.comment);
        if (patch.public != null) p += "&public=" + (patch.public ? "true" : "false");
        (patch.add || []).forEach((sid) => { p += "&songIdToAdd=" + encodeURIComponent(sid); });
        (patch.removeIndexes || []).forEach((i) => { p += "&songIndexToRemove=" + i; });
        try { await call("updatePlaylist", p); return true; } catch { return false; } },
      async deletePlaylist(id) { try { await call("deletePlaylist", "id=" + encodeURIComponent(id)); return true; } catch { return false; } },
      // OpenSubsonic getLyricsBySongId (synced) → getLyrics fallback
      async getLyrics(song) {
        try { const r = await call("getLyricsBySongId", "id=" + encodeURIComponent(song.id)); const sl = r.lyricsList && r.lyricsList.structuredLyrics && r.lyricsList.structuredLyrics[0];
          if (sl && sl.line) return sl.line.map((l) => l.value).join("\n"); } catch {}
        try { const r = await call("getLyrics", "artist=" + encodeURIComponent(song.artist || "") + "&title=" + encodeURIComponent(song.title || "")); return (r.lyrics && (r.lyrics.value || r.lyrics)) || ""; } catch { return ""; } },
      async getArtistInfo(id) { try { const r = await call("getArtistInfo2", "id=" + encodeURIComponent(id)); const a = r.artistInfo2 || {};
        return { bio: a.biography || "", image: a.largeImageUrl || a.mediumImageUrl || "", similar: (a.similarArtist || []).map((x) => N.artist(x, "subsonic")) }; } catch { return {}; } },
      async getTopSongs(name) { try { const r = await call("getTopSongs", "artist=" + encodeURIComponent(name) + "&count=20"); return ((r.topSongs && r.topSongs.song) || []).map(songN); } catch { return []; } },
      async getSimilarSongs(id) { try { const r = await call("getSimilarSongs2", "id=" + encodeURIComponent(id) + "&count=50"); return ((r.similarSongs2 && r.similarSongs2.song) || []).map(songN); } catch { return []; } },
      async getNowPlaying() { try { const r = await call("getNowPlaying"); return ((r.nowPlaying && r.nowPlaying.entry) || []).map(songN); } catch { return []; } },
      downloadUrl(song) { return rest("download", "id=" + encodeURIComponent(song.id)); },
    };
  }

  window.HoloSubsonic = { native, server, md5 };
})();
