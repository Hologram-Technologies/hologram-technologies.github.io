#!/usr/bin/env node
// holo-home-ask-witness.mjs — proves ASK (holo-home-ask): the "just ask" surface for the personal cloud,
// following the unified agent-registry contract and routing through the SAME seams the taps use (the
// manifest + the one open path). Two privacy invariants: bounded to YOUR manifest (find only lists your
// files; open only opens a PINNED app) and grounding is REFERENCES, never bytes (your data never leaves the
// device to answer). Drives the real substrate: holo-home over holo-strand with a real enrolled operator.
//
// Checks (all must hold):
//   1 toolsAdvertised      — describe/listTools expose find_files, open_app, ask_grounding (ambient).
//   2 findFilesBounded      — find_files returns matching manifest files only; empty query ⇒ all; nothing fabricated.
//   3 openAppRoutesOnePath  — open_app on a pinned app fires THE injected open path with that app's ref.
//   4 refusesUnpinnedApp    — open_app for an app NOT in the manifest is refused ("isn't in your apps").
//   5 groundingRefsOnly     — ask_grounding returns the manifest's context κ-refs and carries NO file bytes.
//   6 failSoftBrokenManifest— a tampered manifest ⇒ clean { ok:false }, never a throw.
//
// Authority: holospaces Laws L1/L2/L5 · rests on #holo-home-ask + #holo-home + #holo-open + #holo-strand.
// node tools/holo-home-ask-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeHome } from "../os/usr/lib/holo/holo-home.mjs";
import { makeHomeAsk } from "../os/usr/lib/holo/holo-home-ask.mjs";
import { makeOpen } from "../os/usr/lib/holo/holo-open.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let store = clone(init); return { load: async () => clone(store), save: async (r) => { store = clone(r); }, dump: () => clone(store) }; };

let tick = 0;
const now = () => `2026-06-24T06:00:${String(tick++).padStart(2, "0")}.000Z`;
const op = await enroll({ label: "ask-owner", passphrase: "correct horse battery staple six" });

const NOTES = "did:holo:sha256:" + "a".repeat(64);
const PHOTO = "did:holo:sha256:" + "b".repeat(64);
const APP = "holo://org.hologram.atlas";

const backend = arrayBackend();
const home = makeHome({ backend, now, signer: op });
await home.init({ owner: op.kappa, title: "Ask Home" });
await home.addFile(NOTES, "notes.md");
await home.addFile(PHOTO, "trip.jpg");
await home.pinApp(APP, "web");
await home.setAskContext([NOTES]);                          // Q may ground on notes.md (by reference)

// the one open path, instrumented
const seen = { fallback: null, app: null };
const open = makeOpen({ app: async (id) => { seen.app = id; return "opened-app"; }, fallback: async (ref) => { seen.fallback = ref; return "opened-fallback"; } });
const ask = makeHomeAsk({ home, open });

// ── 1 · tools advertised, ambient ────────────────────────────────────────────────────────────────────
const tools = ask.listTools();
ok("toolsAdvertised",
  ask.describe().id === "home" && tools.length === 3
  && tools.find((t) => t.name === "find_files") && tools.find((t) => t.name === "open_app") && tools.find((t) => t.name === "ask_grounding")
  && tools.every((t) => t.gated === false),
  JSON.stringify(tools.map((t) => t.name)));

// ── 2 · find_files is bounded to the manifest ────────────────────────────────────────────────────────
const fAll = await ask.invoke("find_files", {});
const fTrip = await ask.invoke("find_files", { query: "trip" });
ok("findFilesBounded",
  fAll.ok && fAll.files.length === 2
  && fTrip.ok && fTrip.files.length === 1 && fTrip.files[0].ref === PHOTO && fTrip.files[0].name === "trip.jpg",
  JSON.stringify({ all: fAll.files.length, trip: fTrip.files.map((f) => f.name) }));

// ── 3 · open_app routes through THE one open path ────────────────────────────────────────────────────
const o3 = await ask.invoke("open_app", { query: "atlas" });
ok("openAppRoutesOnePath", o3.ok === true && o3.opened === APP && seen.app === "org.hologram.atlas", JSON.stringify({ opened: o3.opened, seen }));

// ── 4 · an app that isn't pinned is refused ──────────────────────────────────────────────────────────
const o4 = await ask.invoke("open_app", { query: "holo://org.evil.miner" });
ok("refusesUnpinnedApp", o4.ok === false && /isn't in your apps/.test(o4.reason), JSON.stringify(o4));

// ── 5 · grounding is references only — no bytes ──────────────────────────────────────────────────────
const g5 = await ask.invoke("ask_grounding", {});
// the leak test scans the CONTEXT ENTRIES (not the human-readable note): each must be a κ-ref/address,
// none may carry inline bytes / base64 / data-URIs. The note prose is descriptive, not data.
const ctxStr = JSON.stringify(g5.context || []);
ok("groundingRefsOnly",
  g5.ok && Array.isArray(g5.context) && g5.context.length === 1 && g5.context[0] === NOTES
  && g5.context.every((c) => /^did:holo:sha256:[0-9a-f]{64}$/i.test(c))
  && !/base64|data:|bytes/i.test(ctxStr) && !("bytes" in g5),
  JSON.stringify(g5));

// ── 6 · a tampered manifest fails soft (no throw) ────────────────────────────────────────────────────
const tampered = clone(backend.dump()); tampered[1]["holstr:payload"].name = "evil.md";
const askBroken = makeHomeAsk({ home: makeHome({ backend: arrayBackend(tampered) }), open });
let threw = false; let r6;
try { r6 = await askBroken.invoke("find_files", {}); } catch (e) { threw = true; }
ok("failSoftBrokenManifest", threw === false && r6 && r6.ok === false, JSON.stringify({ threw, r6 }));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-home-ask — ASK: the 'just ask' surface for the personal cloud, following the unified agent-registry contract and routing through the same seams the taps use (the manifest + the one open path). Bounded to YOUR manifest (find lists only your files; open opens only a pinned app — Q cannot conjure a file you don't have or open what isn't yours) and grounding is references, never bytes (your data never leaves the device to answer). All tools are ambient; a broken manifest fails soft.",
  authority: "holospaces Laws L1/L2/L5 · rests on #holo-home-ask + #holo-home + #holo-open + #holo-strand",
  witnessed,
  covers: witnessed ? ["tools-advertised", "find-files-bounded", "open-app-one-path", "refuse-unpinned-app", "grounding-refs-only", "fail-soft-broken-manifest"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-home-ask-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-home-ask witness — just ask: find your files, open your apps, grounded in refs (never bytes)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  ask about your stuff — bounded to your manifest, grounded in references, data stays home" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
