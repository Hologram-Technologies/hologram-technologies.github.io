// holo-source-youtube-witness.mjs — assert the YouTube source provider routes to the native /sc/vstream κ-stream
// (projected through Holo Video), NOT the youtube-nocookie MSE embed (which this codec build can't feed).
//   node holo-os/system/tools/holo-source-youtube-witness.mjs
import { createYouTubeProvider, parseYouTubeFeed } from "../../../holo-apps/apps/player/holo-source-youtube.mjs";
import { buildVstreamSrc } from "../os/usr/lib/holo/holo-youtube.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.error("FAIL: " + n); } };

const FEED = `<feed>
  <entry><yt:videoId>AOCQp6lAfEE</yt:videoId><title>Proven Clip</title><published>2026-01-02T00:00:00Z</published></entry>
  <entry><yt:videoId>t20rcCn_lDA</yt:videoId><title>Ibiza Mix</title><published>2026-02-01T00:00:00Z</published></entry>
</feed>`;
const fakeFetch = async () => ({ ok: true, status: 200, text: async () => FEED });

// feed parse
const parsed = parseYouTubeFeed(FEED);
ok("parses 2 entries", parsed.length === 2);
ok("first id", parsed[0].vid === "AOCQp6lAfEE");

const prov = createYouTubeProvider({ channelId: "UCxyz", name: "Test", fetch: fakeFetch });

const items = await prov.browse();
ok("browse returns items", items.length === 2);
const it = items[0];
ok("playSrc is /sc/vstream", typeof it.playSrc === "string" && it.playSrc.startsWith("holo://os/sc/vstream?url="));
ok("playSrc encodes canonical watch url", it.playSrc.includes(encodeURIComponent("https://www.youtube.com/watch?v=AOCQp6lAfEE")));
ok("playSrc carries h=1080", it.playSrc.endsWith("&h=1080"));
ok("type is video/webm", it.type === "video/webm");
ok("NOT kind:live (would hit the broken embed branch)", it.kind !== "live");
ok("NOT a youtube-nocookie embed in playSrc", !/youtube-nocookie/.test(it.playSrc));
ok("embedFallback kept for fail-open", typeof it.embedFallback === "string" && /youtube-nocookie/.test(it.embedFallback));
ok("availability.playSrc matches", it.availability && it.availability.playSrc === it.playSrc);
ok("playSrc equals canonical buildVstreamSrc", it.playSrc === buildVstreamSrc("AOCQp6lAfEE", 1080));

const r = (await prov.resolve({ _yt: "t20rcCn_lDA" }))[0];
ok("resolve playSrc is /sc/vstream", r.playSrc.startsWith("holo://os/sc/vstream?url="));
ok("resolve type video/webm", r.type === "video/webm");
ok("resolve NOT kind:live", r.kind !== "live");
ok("resolve embedFallback kept", /youtube-nocookie/.test(r.embedFallback || ""));
ok("resolve playSrc equals buildVstreamSrc", r.playSrc === buildVstreamSrc("t20rcCn_lDA", 1080));

const total = pass + fail;
console.log((fail === 0 ? "GREEN " : "RED ") + pass + "/" + total + " assertions");
process.exit(fail === 0 ? 0 : 1);
