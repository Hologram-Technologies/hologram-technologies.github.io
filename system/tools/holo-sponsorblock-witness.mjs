// holo-sponsorblock-witness.mjs — pure-logic witness for the in-video sponsor-skip core.
//   node holo-os/system/tools/holo-sponsorblock-witness.mjs
import {
  AD_CATEGORIES, sha256HexPrefix, normalizeSegments, mergeSegments, skipTarget, fetchSegments, videoIdFromVstream,
} from "../os/usr/lib/holo/holo-sponsorblock.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("FAIL: " + name); } };
const eq = (name, a, b) => ok(name + " (" + JSON.stringify(a) + ")", a === b);

// --- categories: ad-class only (not creator intro/outro) ---
ok("ad categories are the ad-class", AD_CATEGORIES.includes("sponsor") && AD_CATEGORIES.includes("selfpromo") && AD_CATEGORIES.includes("interaction"));
ok("does NOT skip creator intro by default", !AD_CATEGORIES.includes("intro") && !AD_CATEGORIES.includes("music_offtopic"));

// --- privacy hash prefix ---
const px = await sha256HexPrefix("dQw4w9WgXcQ", 4);
ok("hash prefix is 4 hex chars", /^[0-9a-f]{4}$/.test(px));
ok("hash prefix is deterministic", (await sha256HexPrefix("dQw4w9WgXcQ", 4)) === px);

// --- normalize: drop bad/zero-length, keep real ranges ---
const norm = normalizeSegments([
  { segment: [10, 25], category: "sponsor" },
  { segment: [50, 50], category: "sponsor" },        // zero length → dropped
  { segment: [70], category: "selfpromo" },          // malformed → dropped
  { segment: [80, 60], category: "sponsor" },        // negative → dropped
  { segment: [100, 130], category: "interaction" },
]);
eq("normalize keeps only valid ranges", norm.length, 2);
eq("normalize start", norm[0].start, 10);
eq("normalize category", norm[1].category, "interaction");

// --- merge overlapping/adjacent ---
const merged = mergeSegments([
  { start: 10, end: 20, category: "sponsor" },
  { start: 19, end: 30, category: "sponsor" },       // overlaps → merge to 10-30
  { start: 30.3, end: 40, category: "selfpromo" },   // within gap 0.5 → merge to 10-40
  { start: 100, end: 110, category: "interaction" }, // separate
]);
eq("merge collapses overlaps/adjacents", merged.length, 2);
eq("merged end extends", merged[0].end, 40);
eq("merged separate kept", merged[1].start, 100);

// --- skip decision ---
const segs = [{ start: 10, end: 25, category: "sponsor" }, { start: 100, end: 130, category: "selfpromo" }];
eq("before a segment → no skip", skipTarget(5, segs), null);
eq("inside first segment → skip to its end", skipTarget(15, segs), 25);
eq("at segment start (pad) → skip", skipTarget(9.9, segs), 25);
eq("just past a segment → no skip", skipTarget(24.8, segs), null);
eq("between segments → no skip", skipTarget(60, segs), null);
eq("inside second segment → skip to its end", skipTarget(120, segs), 130);

// --- videoId extraction from the /sc/vstream projected source ---
const v = (id) => "holo://os/sc/vstream?url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id) + "&h=1080";
eq("id from vstream youtube watch", videoIdFromVstream(v("abc123XYZ")), "abc123XYZ");
eq("id from vstream shorts", videoIdFromVstream("holo://os/sc/vstream?url=" + encodeURIComponent("https://www.youtube.com/shorts/SHRT1")), "SHRT1");
eq("id from vstream youtu.be", videoIdFromVstream("holo://os/sc/vstream?url=" + encodeURIComponent("https://youtu.be/BE_ID9")), "BE_ID9");
eq("non-youtube vstream (vimeo) → null", videoIdFromVstream("holo://os/sc/vstream?url=" + encodeURIComponent("https://vimeo.com/123456")), null);
eq("non-vstream holo source → null", videoIdFromVstream("holo://os/apps/video/index.html"), null);
eq("garbage → null", videoIdFromVstream("not a url"), null);

// --- fetchSegments with an injected fetch (privacy endpoint shape) ---
const fakeApi = (rows) => async (url) => ({ ok: true, status: 200, text: async () => JSON.stringify(rows), json: async () => rows });
{
  const segs2 = await fetchSegments("abc123XYZ", { fetch: fakeApi([
    { videoID: "otherVid", segments: [{ segment: [0, 999], category: "sponsor" }] },   // different video → ignored
    { videoID: "abc123XYZ", segments: [{ segment: [12, 30], category: "sponsor" }, { segment: [29, 45], category: "selfpromo" }] },
  ]) });
  eq("fetch picks OUR video + merges", segs2.length, 1);
  eq("fetch merged range", segs2[0].end, 45);
}
{
  const none = await fetchSegments("abc123XYZ", { fetch: async () => ({ ok: false, status: 404 }) });
  ok("fetch fail-open → [] (never breaks playback)", Array.isArray(none) && none.length === 0);
}
{
  const empty = await fetchSegments("abc123XYZ", { fetch: fakeApi([]) });
  ok("no segments for video → []", Array.isArray(empty) && empty.length === 0);
}

const total = pass + fail;
console.log((fail === 0 ? "GREEN " : "RED ") + pass + "/" + total + " assertions");
process.exit(fail === 0 ? 0 : 1);
