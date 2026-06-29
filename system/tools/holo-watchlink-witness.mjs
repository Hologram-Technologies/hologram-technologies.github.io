// holo-watchlink-witness.mjs — the "where to watch" actionable-chip link builder: a TMDb watch-provider name +
// a title → a "go watch it there" URL (platform search; JustWatch link / web-search fallback). Pure, no DOM.
//   node holo-os/system/tools/holo-watchlink-witness.mjs
import { watchLink, normalizeWatchProviders } from "../../../holo-apps/apps/player/holo-media-item.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.error("FAIL: " + n); } };
const item = { name: "The Last of Us" };
const q = encodeURIComponent(item.name);

// known platforms → that platform's search for the title
ok("netflix", watchLink("Netflix", item) === "https://www.netflix.com/search?q=" + q);
ok("disney", watchLink("Disney Plus", item) === "https://www.disneyplus.com/search?q=" + q);
ok("hbo max → max", watchLink("HBO Max", item) === "https://play.max.com/search?q=" + q);
ok("max", watchLink("Max", item) === "https://play.max.com/search?q=" + q);
ok("prime video", watchLink("Amazon Prime Video", item).startsWith("https://www.amazon.com/s?k=" + q));
ok("apple tv", watchLink("Apple TV", item) === "https://tv.apple.com/search?term=" + q);
ok("youtube", watchLink("YouTube", item) === "https://www.youtube.com/results?search_query=" + q);
ok("case-insensitive", watchLink("netflix", item) === watchLink("Netflix", item));
ok("strips 'with ads'", watchLink("Hulu with Ads", item) === "https://www.hulu.com/search?q=" + q);

// unknown platform → the title's JustWatch fallback link if given, else a web search
ok("unknown → fallback link", watchLink("SomeNewPlatform", item, "https://justwatch.com/x") === "https://justwatch.com/x");
ok("unknown → web search", /google\.com\/search/.test(watchLink("SomeNewPlatform", item)) && watchLink("SomeNewPlatform", item).includes(q));
ok("empty title safe", typeof watchLink("Netflix", {}) === "string");

// normalizeWatchProviders now carries the region JustWatch link per provider (so chips can fall back to it)
const norm = normalizeWatchProviders({ results: { US: { link: "https://justwatch/title", flatrate: [{ provider_name: "Netflix", logo_path: "/n.png" }] } } }, "US");
ok("normalized provider has name", norm[0] && norm[0].name === "Netflix");
ok("normalized provider carries link", norm[0] && norm[0].link === "https://justwatch/title");
ok("normalized provider tier", norm[0] && norm[0].type === "flatrate");

const total = pass + fail;
console.log((fail === 0 ? "GREEN " : "RED ") + pass + "/" + total + " assertions");
process.exit(fail === 0 ? 0 : 1);
