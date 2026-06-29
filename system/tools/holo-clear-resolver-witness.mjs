// holo-clear-resolver-witness.mjs — the canonical clear-web resolver: ANY http(s) URL → a κ-stream play item
// routed through /sc/vstream → Holo Video (not a platform MSE embed). No browser, pure logic.
//   node holo-os/system/tools/holo-clear-resolver-witness.mjs
import { classifyClearUrl, vstream } from "../../../holo-apps/apps/player/holo-clear-resolver.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.error("FAIL: " + n); } };
const enc = (u) => encodeURIComponent(u);

// non-http → null (only the search box's http(s) path reaches liveItem)
ok("holo:// → null", classifyClearUrl("holo://os/apps/player") === null);
ok("bare text → null", classifyClearUrl("the office s3") === null);

// YouTube (verified path) — must stay byte-for-byte the proven shape
const yt = classifyClearUrl("https://www.youtube.com/watch?v=t20rcCn_lDA");
ok("yt kind stream", yt.kind === "stream");
ok("yt provider youtube", yt.provider === "youtube");
ok("yt playSrc /sc/vstream of canonical watch", yt.playSrc === "holo://os/sc/vstream?url=" + enc("https://www.youtube.com/watch?v=t20rcCn_lDA") + "&h=1080");
ok("yt type webm", yt.type === "video/webm");
ok("yt embedFallback youtube-nocookie", /youtube-nocookie\.com\/embed\/t20rcCn_lDA/.test(yt.embedFallback));
ok("yt poster maxres", /maxresdefault/.test(yt.posterUrl));
ok("youtu.be short", classifyClearUrl("https://youtu.be/AOCQp6lAfEE").id === "live:yt:AOCQp6lAfEE");
ok("yt NOT a live embed item", yt.kind !== "live" && !yt.embed);

// Vimeo → now routed through /sc/vstream (was a broken embed)
const vim = classifyClearUrl("https://vimeo.com/76979871");
ok("vimeo provider", vim.provider === "vimeo");
ok("vimeo playSrc /sc/vstream of page", vim.playSrc === "holo://os/sc/vstream?url=" + enc("https://vimeo.com/76979871") + "&h=1080");
ok("vimeo type webm", vim.type === "video/webm");
ok("vimeo embedFallback player.vimeo", /player\.vimeo\.com\/video\/76979871/.test(vim.embedFallback));
ok("vimeo NOT a live embed", vim.kind === "stream" && !vim.embed);

// Direct media file → plays straight (no resolve)
const mp4 = classifyClearUrl("https://cdn.example.com/clip.webm");
ok("direct webm plays straight (src=url)", mp4.src === "https://cdn.example.com/clip.webm" && mp4.playSrc === "https://cdn.example.com/clip.webm");
ok("direct webm not vstream", !/sc\/vstream/.test(mp4.playSrc));
ok("direct webm flagged", mp4.direct === true && mp4.provider === "webm");
ok("hls m3u8 direct", classifyClearUrl("https://x.com/live/master.m3u8").direct === true);

// Any other platform page → the catch-all clear resolver (yt-dlp)
const tw = classifyClearUrl("https://www.twitch.tv/videos/123456789");
ok("twitch provider clear-web", tw.provider === "clear-web");
ok("twitch playSrc /sc/vstream of page", tw.playSrc === "holo://os/sc/vstream?url=" + enc("https://www.twitch.tv/videos/123456789") + "&h=1080");
ok("twitch type webm", tw.type === "video/webm");
ok("twitch embedFallback = the page", tw.embedFallback === "https://www.twitch.tv/videos/123456789");
const dm = classifyClearUrl("https://www.dailymotion.com/video/x8abcde");
ok("dailymotion clear-web vstream", dm.provider === "clear-web" && /sc\/vstream/.test(dm.playSrc));

// vstream + height
ok("vstream builds route", vstream("https://a.com/x", 720) === "holo://os/sc/vstream?url=" + enc("https://a.com/x") + "&h=720");
ok("height honored", classifyClearUrl("https://www.twitch.tv/videos/9", 720).playSrc.endsWith("&h=720"));

// every clear item carries the fields play() needs
for (const it of [yt, vim, tw, dm]) { ok("item " + it.provider + " has page/source/topics/kappa", it.page && it.source === "open" && Array.isArray(it.topics) && it.kappa === ""); }

const total = pass + fail;
console.log((fail === 0 ? "GREEN " : "RED ") + pass + "/" + total + " assertions");
process.exit(fail === 0 ? 0 : 1);
