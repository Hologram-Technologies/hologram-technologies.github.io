// holo-media-route-witness.mjs — pure-logic witness for the multi-platform media handoff decision core.
// No browser, no host: asserts on holo-media-route.mjs exactly the branches the browser app relies on.
//   node holo-os/system/tools/holo-media-route-witness.mjs
import {
  classifyMedia, buildVstreamSrc, holoVideoRoute, decideMediaRoute, SUPPORTED_PLATFORMS,
} from "../os/usr/lib/holo/holo-media-route.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("FAIL: " + name); } };
const eq = (name, a, b) => ok(name + " (" + JSON.stringify(a) + ")", a === b);

// --- YouTube: every shape folds onto one canonical watch URL ---
eq("yt watch", classifyMedia("https://www.youtube.com/watch?v=xaurMcGqZHU").platform, "youtube");
eq("yt watch canonical", classifyMedia("https://www.youtube.com/watch?v=xaurMcGqZHU&list=RDx").canonical, "https://www.youtube.com/watch?v=xaurMcGqZHU");
eq("yt shorts", classifyMedia("https://www.youtube.com/shorts/SHRT1").id, "SHRT1");
eq("yt embed", classifyMedia("https://www.youtube.com/embed/EMB42").id, "EMB42");
eq("youtu.be", classifyMedia("https://youtu.be/BE_ID9").id, "BE_ID9");
eq("yt music host", classifyMedia("https://music.youtube.com/watch?v=MUS1").id, "MUS1");
eq("yt home is not a watch", classifyMedia("https://www.youtube.com/"), null);
eq("yt results is not a watch", classifyMedia("https://www.youtube.com/results?search_query=david+guetta"), null);

// --- Vimeo ---
eq("vimeo numeric", classifyMedia("https://vimeo.com/123456789").platform, "vimeo");
eq("vimeo canonical", classifyMedia("https://vimeo.com/123456789").canonical, "https://vimeo.com/123456789");
eq("vimeo /video/", classifyMedia("https://player.vimeo.com/video/987654").id, "987654");
eq("vimeo home is not a watch", classifyMedia("https://vimeo.com/"), null);

// --- Twitch ---
eq("twitch vod", classifyMedia("https://www.twitch.tv/videos/1122334455").id, "1122334455");
eq("twitch vod canonical", classifyMedia("https://www.twitch.tv/videos/1122334455").canonical, "https://www.twitch.tv/videos/1122334455");
eq("twitch clip", classifyMedia("https://www.twitch.tv/somechan/clip/HappyClipSlug").id, "HappyClipSlug");
eq("clips.twitch.tv", classifyMedia("https://clips.twitch.tv/AnotherSlug").id, "AnotherSlug");
eq("twitch bare channel is NOT auto-routed", classifyMedia("https://www.twitch.tv/somechannel"), null);

// --- Dailymotion ---
eq("dailymotion", classifyMedia("https://www.dailymotion.com/video/x8abcde").id, "x8abcde");
eq("dai.ly short", classifyMedia("https://dai.ly/x8abcde").platform, "dailymotion");

// --- Internet Archive ---
eq("archive details", classifyMedia("https://archive.org/details/some_film_1969").id, "some_film_1969");

// --- look-alikes & non-media never match (no hijack) ---
eq("evil youtube look-alike", classifyMedia("https://evil-youtube.com/watch?v=x"), null);
eq("youtube.com.evil.com", classifyMedia("https://youtube.com.evil.com/watch?v=x"), null);
eq("plain web page", classifyMedia("https://news.ycombinator.com/"), null);
eq("non-http scheme", classifyMedia("holo://os/apps/video/index.html"), null);
eq("garbage", classifyMedia("not a url"), null);

// --- /sc/vstream route building (the PROVEN form) ---
const src = buildVstreamSrc("https://www.youtube.com/watch?v=abc123", 1080);
ok("src points at /sc/vstream", src.startsWith("holo://os/sc/vstream?url="));
ok("src encodes the canonical url", src.includes(encodeURIComponent("https://www.youtube.com/watch?v=abc123")));
ok("src carries height", src.endsWith("&h=1080"));
ok("src does NOT use v=<id> shorthand", !/[?&]v=/.test(src.replace(/%3Fv%3D/gi, "")));

// --- projector route: same-origin Holo Video page, super-res on, src round-trips ---
const route = holoVideoRoute("https://www.youtube.com/watch?v=abc123");
ok("route is the relative video app", route.startsWith("../video/index.html?"));
ok("route enables gpu+grade, sr off by default (crash-safe)", /gpu=1/.test(route) && /sr=0/.test(route) && /grade=0\.4/.test(route));
(() => {
  // the inner src param must decode back to the exact /sc/vstream form (single layer of outer encoding)
  const q = new URLSearchParams(route.split("?")[1]);
  eq("route src decodes to /sc/vstream", q.get("src"), buildVstreamSrc("https://www.youtube.com/watch?v=abc123", 1080));
  eq("route type is webm", q.get("type"), "video/webm");
})();

// --- end-to-end decision + fail-open gates ---
const d1 = decideMediaRoute("https://www.youtube.com/watch?v=abc123");
ok("decide: yt watch → route", d1 && d1.platform === "youtube" && d1.route.includes("video/index.html"));
ok("decide: yt OK status → route", decideMediaRoute("https://www.youtube.com/watch?v=abc", { playable: { status: "OK" } }) !== null);
ok("decide: yt LOGIN_REQUIRED → null (fail-open to YouTube)", decideMediaRoute("https://www.youtube.com/watch?v=abc", { playable: { status: "LOGIN_REQUIRED" } }) === null);
ok("decide: yt UNPLAYABLE → null", decideMediaRoute("https://www.youtube.com/watch?v=abc", { playable: { status: "UNPLAYABLE" } }) === null);
ok("decide: vimeo (no gate) → route", (decideMediaRoute("https://vimeo.com/123456789") || {}).platform === "vimeo");
ok("decide: plain page → null", decideMediaRoute("https://news.ycombinator.com/") === null);
(() => {
  const r = decideMediaRoute("https://vimeo.com/123456789", { h: 720 });
  const innerSrc = new URLSearchParams(r.route.split("?")[1]).get("src");
  ok("decide: custom height honored", innerSrc.endsWith("&h=720"));
})();

// --- the registry is the extension point ---
ok("platforms registered", SUPPORTED_PLATFORMS.length >= 5 && SUPPORTED_PLATFORMS.includes("youtube") && SUPPORTED_PLATFORMS.includes("vimeo"));

const total = pass + fail;
console.log((fail === 0 ? "GREEN " : "RED ") + pass + "/" + total + " assertions");
process.exit(fail === 0 ? 0 : 1);
