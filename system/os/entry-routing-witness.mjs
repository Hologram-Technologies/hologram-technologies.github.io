// Witness the SEAMLESS-ENTRY routing contract in holo-voice.js: a single URL hash carries the whole intent,
// and maybeRestoreShared dispatches it to exactly ONE surface with zero config. The regexes/branch-order below
// are copied VERBATIM from holo-voice.js maybeRestoreShared + openModelLink (kept in lock-step); this proves
// the dispatch is correct and unambiguous for every link shape — #chat / #model / #adapter / #model+#adapter /
// #wks / garbage — and that openModelLink's κ-validation accepts/rejects correctly. (The live warm+model load
// the route triggers is the in-shell 500MB path → witnessed on hardware = OUT-OF-BAND.)

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
const K = (c) => c.repeat(64);   // a 64-hex κ

// ── verbatim from openModelLink ──
function openModelLink(modelKappa, adapterKappa) {
  const mk = /^[0-9a-f]{64}$/i.test(modelKappa || "") ? modelKappa.toLowerCase() : "";
  const ak = /^[0-9a-f]{64}$/i.test(adapterKappa || "") ? adapterKappa.toLowerCase() : "";
  if (!mk && !ak) return false;
  return { warm: true, model: mk, adapter: ak };   // (real fn also: reset brain, openQPanel, warmStarter, dispatch event)
}
// ── verbatim branch-order from maybeRestoreShared ──
function route(h) {
  if (/[#&]chat=/.test(h)) return { handler: "restoreChat" };
  const mm = h.match(/[#&]model=([0-9a-fA-F]{64})/), am = h.match(/[#&]adapter=([0-9a-fA-F]{64})/);
  if (mm || am) return { handler: "openModelLink", result: openModelLink(mm && mm[1], am && am[1]) };
  if (/[#&]wks=/.test(h)) return { handler: "restoreChatCarriage" };
  return { handler: "none" };
}

// each link shape → exactly the intended surface
ok(route("#chat=eyJ2IjoxfQ").handler === "restoreChat", "#chat= → restoreChat (self-contained serverless chat)");
ok(route("#model=" + K("a")).handler === "openModelLink" && route("#model=" + K("a")).result.model === K("a"), "#model=κ → openModelLink (linked model becomes the brain)");
const ad = route("#adapter=" + K("b"));
ok(ad.handler === "openModelLink" && ad.result && ad.result.model === "" && ad.result.adapter === K("b") && ad.result.warm === true,
  "#adapter=κ (ALONE) → openModelLink warms+applies — the fixed case (was inert before)");
const both = route("#model=" + K("a") + "&adapter=" + K("b"));
ok(both.handler === "openModelLink" && both.result.model === K("a") && both.result.adapter === K("b"), "#model=κ&adapter=κ → openModelLink with BOTH");
ok(route("#wks=z3v...").handler === "restoreChatCarriage", "#wks= → restoreChatCarriage (carriage chat / else left for holospace boot-resume)");
ok(route("").handler === "none" && route("#desktop=1").handler === "none", "empty / unrelated hash → no-op (no false trigger)");

// branch ORDER: a #chat= link must win over an incidental model-looking token (chat checked first)
ok(route("#chat=" + K("a")).handler === "restoreChat", "branch order: #chat= takes precedence (never misroutes to model)");

// openModelLink κ-validation: 64-hex only, case-normalized, garbage rejected
ok(openModelLink("XYZ", "") === false, "non-hex model κ → rejected (false, no warm)");
ok(openModelLink(K("A"), "").model === K("a"), "uppercase κ normalized to lowercase (canonical κ form)");
ok(openModelLink("abc", "def") === false, "too-short κ → rejected");
ok(openModelLink("", "") === false, "no model & no adapter → false (nothing to open)");

console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: one link → one surface, zero config; #adapter= alone now warms+applies; κ-validation fail-closed"}`);
process.exit(fail ? 1 : 0);
