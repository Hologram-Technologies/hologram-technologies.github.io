// holo-youtube-witness.mjs — pure-logic witness for the native YouTube player-swap shim decision core.
// No browser, no host: asserts on holo-youtube.mjs exactly the branches the boot relies on.
//   node holo-os/system/tools/holo-youtube-witness.mjs
import {
  isYouTubeHost, extractVideoId, canonicalWatchUrl, buildVstreamSrc, classifyPlayability, decideSwap,
} from "../os/usr/lib/holo/holo-youtube.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("FAIL: " + name); } };
const eq = (name, a, b) => ok(name + " (" + JSON.stringify(a) + ")", a === b);

// --- self-gate: only real youtube hosts, no look-alike bypass ---
ok("host youtube.com", isYouTubeHost("youtube.com"));
ok("host www.youtube.com", isYouTubeHost("www.youtube.com"));
ok("host m.youtube.com", isYouTubeHost("m.youtube.com"));
ok("host music.youtube.com", isYouTubeHost("music.youtube.com"));
ok("host youtu.be", isYouTubeHost("youtu.be"));
ok("host NOT evil-youtube.com", !isYouTubeHost("evil-youtube.com"));
ok("host NOT attackeryoutube.com", !isYouTubeHost("attackeryoutube.com"));
ok("host NOT youtube.com.evil.com", !isYouTubeHost("youtube.com.evil.com"));
ok("host NOT vimeo.com", !isYouTubeHost("vimeo.com"));

// --- id extraction across URL shapes ---
eq("watch id", extractVideoId("https://www.youtube.com/watch?v=t20rcCn_lDA"), "t20rcCn_lDA");
eq("watch id with extra params", extractVideoId("https://www.youtube.com/watch?v=abc123&list=PLxyz&t=42"), "abc123");
eq("shorts id", extractVideoId("https://www.youtube.com/shorts/XyZ_987"), "XyZ_987");
eq("embed id", extractVideoId("https://www.youtube.com/embed/EMB-42"), "EMB-42");
eq("live id", extractVideoId("https://www.youtube.com/live/LIV9"), "LIV9");
eq("youtu.be id", extractVideoId("https://youtu.be/SHORTID"), "SHORTID");
eq("home is not a video", extractVideoId("https://www.youtube.com/"), null);
eq("feed is not a video", extractVideoId("https://www.youtube.com/feed/subscriptions"), null);
eq("results is not a video", extractVideoId("https://www.youtube.com/results?search_query=house+music"), null);
eq("garbage url", extractVideoId("not a url"), null);

// --- route building (PROVEN form: url=<encoded watch url>&h=) ---
const src = buildVstreamSrc("abc123", 1080);
ok("src points at /sc/vstream", src.startsWith("holo://os/sc/vstream?url="));
ok("src encodes the canonical watch url", src.includes(encodeURIComponent("https://www.youtube.com/watch?v=abc123")));
ok("src carries the height", src.endsWith("&h=1080"));
ok("src does NOT use v=<id> shorthand", !/[?&]v=/.test(src));
eq("canonical watch url", canonicalWatchUrl("abc123"), "https://www.youtube.com/watch?v=abc123");
ok("src honors 720", buildVstreamSrc("abc123", 720).endsWith("&h=720"));

// --- playability gate (fail-open for anything not OK) ---
ok("OK → swap", classifyPlayability({ status: "OK" }).swap === true);
ok("no status → swap (try it)", classifyPlayability(null).swap === true);
ok("LOGIN_REQUIRED → no swap", classifyPlayability({ status: "LOGIN_REQUIRED" }).swap === false);
ok("UNPLAYABLE → no swap", classifyPlayability({ status: "UNPLAYABLE" }).swap === false);
ok("ERROR → no swap", classifyPlayability({ status: "ERROR" }).swap === false);
ok("AGE_VERIFICATION_REQUIRED → no swap", classifyPlayability({ status: "AGE_VERIFICATION_REQUIRED" }).swap === false);

// --- end-to-end decision ---
const d1 = decideSwap("https://www.youtube.com/watch?v=abc123", "www.youtube.com", { status: "OK" });
ok("decide: watch OK → swap", d1 && d1.id === "abc123" && d1.src.includes("vstream"));
ok("decide: off-host → null", decideSwap("https://vimeo.com/123", "vimeo.com", null) === null);
ok("decide: login → null", decideSwap("https://www.youtube.com/watch?v=abc", "www.youtube.com", { status: "LOGIN_REQUIRED" }) === null);
ok("decide: non-video page OK → null", decideSwap("https://www.youtube.com/feed/subscriptions", "www.youtube.com", { status: "OK" }) === null);
ok("decide: shorts → swap", (() => { const d = decideSwap("https://www.youtube.com/shorts/SS1", "m.youtube.com", null); return d && d.id === "SS1"; })());

const total = pass + fail;
console.log((fail === 0 ? "GREEN " : "RED ") + pass + "/" + total + " assertions");
process.exit(fail === 0 ? 0 : 1);
