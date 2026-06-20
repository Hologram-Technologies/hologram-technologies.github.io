// holo-q-search-witness.mjs — re-derivable proof that the SEARCH/RETRIEVAL plane (holo-q-search.mjs) binds
// ONE embedder to BOTH search faculties (session-search + skills-hub) through holo-q-mux, so every semantic
// search shares one vector space; ranks by cosine when an embedder is ready; falls back HONESTLY to the
// caller's lexical search when none is (or while it's still loading); and never throws. Pure Node — an
// injected fake embedder + fake autowire, no network/GPU/browser. Exit 0 = green; 1 = a divergence.
//   Run: node holo-q-search-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const muxMod = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-mux.js")).href);
const S = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-search.mjs")).href);
const mux = muxMod.default || muxMod;
const { resolveSearch, describeSearch, searchSemantic, ensureSearchEmbedder, SEARCH_FACULTIES } = S;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// a fake embedder provider in the holo-q-embed bind shape ({ id, embed }). The "vector" is a 3-dim bag so
// cosine ordering is deterministic and checkable: words → axis counts.
const AX = { red: 0, green: 1, blue: 2 };
function vec(text) { const v = [0, 0, 0]; for (const w of String(text).toLowerCase().split(/\W+/)) if (w in AX) v[AX[w]] += 1; const n = Math.hypot(...v) || 1; return v.map((x) => x / n); }
const fakeEmbedder = { id: "fake-bge", embed: async (t) => vec(t) };
const fakeAutowire = async ({ mux }) => { mux.bindSpecialist("session-search", fakeEmbedder); return { via: "fake" }; };

console.log("\nholo-q-search — search/retrieval plane witness\n");

// ── 1) unbound → lexical (deterministic search stays the honest floor) ─────────────────────────────────
console.log("unbound → lexical fallback:");
mux.unbindAll();
ok(resolveSearch(mux, { faculty: "session-search" }).semantic === false, "no embedder bound → resolveSearch.semantic=false (caller goes lexical)");
ok(describeSearch(mux, {}).mode === "lexical", "badge says 'lexical' when no embedder is loaded");
const lex = await searchSemantic(mux, "red", [{ id: "a", text: "red" }]);
ok(lex.mode === "lexical" && lex.results === null, "searchSemantic returns mode:lexical/results:null → caller runs its own lexical search");

// ── 2) ensureSearchEmbedder binds ONE embedder to BOTH faculties (one vector space) ────────────────────
console.log("\nensureSearchEmbedder — one embedder, both faculties:");
mux.unbindAll();
const r1 = await ensureSearchEmbedder(mux, { autowire: fakeAutowire });
ok(r1.ok === true, "ensure returns ok with a fake autowire");
ok(SEARCH_FACULTIES.every((f) => mux.routeTask(f) && typeof mux.routeTask(f).embed === "function"), "session-search AND skills-hub are BOTH bound to an embedder");
ok(mux.routeTask("session-search") === mux.routeTask("skills-hub"), "→ the SAME embedder instance backs both (one shared vector space, no app ships its own)");
const r2 = await ensureSearchEmbedder(mux, { autowire: fakeAutowire });
ok(r2.cached === true, "a second ensure is idempotent (already bound → cached, no re-autowire)");

// ── 3) semantic ranking actually works once bound ──────────────────────────────────────────────────────
console.log("\nsemantic ranking (cosine over the bound embedder):");
const res = await searchSemantic(mux, "red", [{ id: "g", text: "green" }, { id: "r", text: "red" }, { id: "b", text: "blue" }], { k: 3 });
ok(res.mode === "semantic" && res.model === "fake-bge", "searchSemantic now runs semantic over the bound embedder (model named)");
ok(res.results[0].id === "r", "the 'red' item ranks #1 for query 'red' (real cosine ordering)");
ok(describeSearch(mux, {}).mode === "semantic" && /fake-bge/.test(describeSearch(mux, {}).label), "badge now says 'semantic · fake-bge' — the user knows it's neural search");

// ── 4) readiness gate: an embedder still loading is treated as NOT bound → lexical until ready ──────────
console.log("\nreadiness gate (loading embedder → lexical until ready):");
mux.unbindAll();
let embReady = false;
mux.bindSpecialist("session-search", { id: "loading-bge", isReady: () => embReady, embed: async (t) => vec(t) });
ok(resolveSearch(mux, {}).semantic === false, "embedder bound but isReady()=false (κ-disk streaming) → still lexical");
embReady = true;
ok(resolveSearch(mux, {}).semantic === true, "embedder flips ready → semantic search activates (silent upgrade)");

// ── 5) honest failure: a no-autowire / bad mux never throws ────────────────────────────────────────────
console.log("\nrobustness (never throws):");
mux.unbindAll();
const none = await ensureSearchEmbedder(mux, {});                  // no autowire supplied
ok(none.ok === false && /lexical/.test(none.reason), "no autowire → ok:false with an honest 'stays lexical' reason (no throw)");
let threw = false; try { resolveSearch({}, {}); } catch (e) { threw = true; }
ok(threw, "a mux missing routeTask → clear setup error (not a silent wrong answer)");

mux.unbindAll();
console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
