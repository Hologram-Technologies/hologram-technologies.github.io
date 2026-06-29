// holo-open-witness.mjs — node witness for the ONE open path (holo-open.mjs). Proves the classifier shapes and
// that makeOpen routes each kind to the right handler — including the NEW `web` seam: a http(s) url goes to
// web(url) when a web handler is wired (the shell wires it to projection in native CEF), and falls through to
// fallback(url) unchanged when it is not (behavior-preserving). Run: node holo-open-witness.mjs
import { classifyOpen, idOf, makeOpen } from "./holo-open.mjs";

let pass = 0, fail = 0;
const eq = (got, want, msg) => { const ok = got === want; (ok ? pass++ : fail++); if (!ok) console.log(`  FAIL ${msg}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// 1 · classifier shapes
eq(classifyOpen("https://example.com/").kind, "url", "https → url");
eq(classifyOpen("http://news.ycombinator.com").kind, "url", "http → url");
eq(classifyOpen("news.ycombinator.com").kind, "url", "bare domain → url");
eq(classifyOpen("holo://space/abc").kind, "space", "space");
eq(classifyOpen("holo://org.hologram.x").kind, "app", "app");
eq(classifyOpen("a.b.c").kind, "words", "three words");
eq(classifyOpen("https://cdn.test/clip.mp4").kind, "media", "media file → media (not url)");

// 2 · makeOpen routing — record where each ref lands
const trace = () => { const hit = {}; const mk = (k) => async (v) => { hit[k] = v; return k; }; return { hit, open: makeOpen({ space: mk("space"), app: mk("app"), web: mk("web"), fallback: mk("fallback") }) }; };

let t = trace();
eq(await t.open("https://example.com/"), "web", "url → web (when web wired)");
eq(t.hit.web, "https://example.com/", "web received the url");

t = trace();
eq(await t.open("holo://space/room1"), "space", "space → space");
eq(t.hit.space, "room1", "space received the bare id");

t = trace();
eq(await t.open("a.b.c"), "fallback", "words → fallback (omniGo)");

// 3 · the ADDITIVE guarantee: with NO web handler, a url falls through to fallback unchanged
const noWeb = { hit: {}, open: null };
noWeb.open = makeOpen({ fallback: async (v) => { noWeb.hit.fallback = v; return "fallback"; } });
eq(await noWeb.open("https://example.com/"), "fallback", "url → fallback when web NOT wired (behavior-preserving)");
eq(noWeb.hit.fallback, "https://example.com/", "fallback received the url");

console.log(`holo-open-witness: ${pass}/${pass + fail} GREEN${fail ? " — " + fail + " FAILED" : ""}`);
process.exit(fail ? 1 : 0);
