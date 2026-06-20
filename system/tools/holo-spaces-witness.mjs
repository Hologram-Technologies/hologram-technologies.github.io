#!/usr/bin/env node
// holo-spaces-witness.mjs — witness the NET-NEW invariants of Holo Spaces (the spine).
// Runs the EXACT module the browser runs (holo-spaces.mjs is isomorphic), so a green
// witness is evidence about the shipped bytes, not a parallel re-implementation.
//
//   node tools/holo-spaces-witness.mjs        → exit 0 (all green) | 1 (any red)
//
// Invariants proved here (data-plane). The render properties (lazy + concurrent nested
// mount, fail-closed empty slot) are browser-verified on holo-serve-fhs — noted, not faked.

import { readFileSync } from "node:fs";
import {
  identity, kappa, verify, addMember, removeMember, nest, encode, decode, makeStore, LAYOUTS, SHELL_LAYOUTS, poster, hexSpiral, hexLayout,
} from "../../../holo-apps/apps/spaces/holo-spaces.mjs";
import {
  planSpace, planWithQ, pickApps, chooseMood, chooseLayout, tokens, qPickIds,
} from "../../../holo-apps/apps/spaces/holo-spaces-plan.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const K = (n) => "did:holo:sha256:" + String(n).repeat(64).slice(0, 64);   // a deterministic stand-in κ
const A = K("a"), B = K("b"), C = K("c");

const base = { name: "Cozy", layout: "split-h", accent: "#F2C14E", members: [
  { kind: "app", root: A, position: 0 },
  { kind: "app", root: B, position: 1 },
] };

console.log("\nHolo Spaces witness — a Space IS a content κ\n");

// 1 — compose → ONE κ, deterministic regardless of formatting / key order / case in accent.
console.log("[1] compose → one deterministic κ");
{
  const k1 = await kappa(base);
  const reordered = { accent: "#f2c14e", members: [ { root: B, kind: "app", position: 1 }, { position: 0, root: A, kind: "app" } ], layout: "split-h", name: "Cozy" };
  const k2 = await kappa(reordered);
  ok(/^did:holo:sha256:[0-9a-f]{64}$/.test(k1), "κ is a well-formed content address");
  ok(k1 === k2, "byte-different but identical arrangement → same κ (identity is the tuple, not the JSON)");
}

// 2 — reopen → EXACT arrangement: self-contained link round-trips and re-derives its κ.
console.log("[2] reopen by link → exact arrangement (L5 on decode)");
{
  const k = await kappa(base);
  const payload = encode(base);
  const back = decode(payload);
  ok(await verify(back, k), "decode(encode(space)) re-derives the same κ");
  ok(JSON.stringify(identity(back)) === JSON.stringify(identity(base)), "decoded identity is byte-exact");
}

// 3 — tamper → REFUSE: flip a member κ, the original κ no longer verifies (fail-closed).
console.log("[3] tamper a member → verify refuses");
{
  const k = await kappa(base);
  const tampered = JSON.parse(JSON.stringify(base)); tampered.members[0].root = C;
  ok((await verify(tampered, k)) === false, "swapped member → original κ refuses the arrangement");
  ok((await kappa(tampered)) !== k, "tampered arrangement has a different κ");
}

// 4 — nesting: a Space can be a member of a Space; the parent pins the child by κ.
console.log("[4] infinite nesting — a Space is just another κ thing");
{
  const childK = await kappa(base);
  const parent = nest({ name: "World", layout: "primary-rail", members: [ { kind: "app", root: A } ] }, childK);
  const id = identity(parent);
  const spaceMember = id.members.find((m) => m.kind === "space");
  ok(!!spaceMember, "parent carries a member of kind 'space'");
  ok(spaceMember && spaceMember.root === childK, "the nested member is the child Space's exact κ");
  ok(/^did:holo:sha256:/.test(await kappa(parent)), "the nesting parent has its own κ (nest one level deeper → repeat)");
  // editing the child yields a new child κ; the parent that referenced the OLD κ is unchanged (immutability up the tree)
  const childK2 = await kappa(addMember(base, { kind: "app", root: C }));
  ok(childK2 !== childK, "editing the child mints a new child κ; the parent's reference is immutable");
}

// 5 — fork is immutable: every edit returns a new κ; the original is untouched.
console.log("[5] fork — one gesture, a new immutable κ");
{
  const k = await kappa(base);
  const forked = addMember(base, { kind: "app", root: C });
  ok((await kappa(forked)) !== k, "adding a member → a different κ (a fork, not a mutation)");
  ok(await verify(base, k), "the original Space still verifies to its κ (untouched)");
  ok((await kappa(removeMember(forked, 2))) === k, "removing the added member returns to the original κ (pure)");
}

// 6 — store: put → κ, get re-derives (L5), drifted bytes are refused.
console.log("[6] content store — resolve by κ, re-derive on read");
{
  const mem = new Map();
  const store = makeStore({ get: (h) => mem.get(h) || null, put: (h, b) => void mem.set(h, b) });
  const k = await store.put(base);
  const got = await store.get(k);
  ok(got && JSON.stringify(identity(got)) === JSON.stringify(identity(base)), "get(put(space)) returns the same arrangement");
  // simulate drift: corrupt the stored bytes under the κ → get must refuse (return null)
  mem.set(k.split(":").pop(), new TextEncoder().encode("{\"v\":1,\"name\":\"evil\"}"));
  ok((await store.get(k)) === null, "bytes that no longer hash to the κ are refused (fail-closed)");
}

// 7 — layout vocabulary: the shell's in-room set, plus the app-level "honeycomb" lobby.
console.log("[7] layouts — shell's in-room set + the honeycomb lobby");
ok(SHELL_LAYOUTS.join(",") === "split-h,split-v,primary-rail,grid-2x2,stack,single", "shell in-room tiling vocabulary unchanged (geomFor/layoutStates)");
ok(LAYOUTS.includes("honeycomb") && LAYOUTS.length === SHELL_LAYOUTS.length + 1, "app adds exactly 'honeycomb' (the lobby) atop the shell set");

// 8 — intent → a Space (the planner): deterministic baseline, Q as a validated upgrade.
console.log("[8] one voice — intent grounds a whole Space");
{
  const k = (n) => String(n).repeat(64).slice(0, 64);
  const cat = [
    { root: k("1"), name: "Holo Book", desc: "Read books and longform.", id: "org.hologram.HoloBook" },
    { root: k("2"), name: "Holo Music", desc: "Lossless music and playlists.", id: "org.hologram.HoloMusic" },
    { root: k("3"), name: "Holo Trade", desc: "Trade tokens on chain.", id: "org.hologram.HoloTrade" },
    { root: k("4"), name: "Holo Scan", desc: "Inspect chain transactions.", id: "org.hologram.HoloEtherscan" },
    { root: k("5"), name: "Holo Q", desc: "On device AI assistant.", id: "org.hologram.HoloQ" },
  ];
  const reading = pickApps("a cozy reading room with music", cat, 4);
  const ids = reading.map((a) => a.id);
  ok(ids.includes("org.hologram.HoloBook") && ids.includes("org.hologram.HoloMusic"), "‘cozy reading room with music’ → Book + Music");
  ok(!ids.includes("org.hologram.HoloTrade"), "irrelevant apps (Trade) are not pulled in");

  const m = chooseMood(tokens("a cozy quiet reading room"));
  ok(m.mood === "calm" && m.accent === "#c77bff", "cozy/quiet/reading → calm mood + its accent");
  ok(chooseMood(tokens("a crypto trading desk")).mood === "market", "crypto/trading → market mood");

  ok(chooseLayout("two apps side by side", 2) === "split-h", "‘side by side’ → split-h");
  ok(chooseLayout("anything", 3) === "primary-rail", "3 members → primary-rail (shell's choice)");

  const a = planSpace("a cozy reading room with music", cat);
  const b = planSpace("a cozy reading room with music", cat);
  ok((await kappa(a)) === (await kappa(b)), "same intent → same Space κ (deterministic, offline)");
  ok(a.members.every((x) => /^did:holo:sha256:[0-9a-f]{64}$/.test(x.root)), "every planned member is a content address");

  const baseline = await planWithQ("a trading desk", cat, null);
  ok(baseline.members.some((x) => x.root.includes(k("3"))), "no Q → baseline still arranges (Trade)");
  const junkQ = { generate: async () => "I think you should use a hammer." };
  ok((await planWithQ("a trading desk", cat, junkQ)).members.length > 0, "Q returns junk → falls back to baseline, never empty");
  const goodQ = { generate: async () => '["org.hologram.HoloQ","org.hologram.HoloBook"]' };
  const qPlan = await planWithQ("anything", cat, goodQ);
  ok(qPlan.members.length === 2 && qPlan.members[0].root.includes(k("5")), "Q picks (validated against catalog) are honored, in order");
  const hallucQ = { generate: async () => '["org.hologram.DoesNotExist"]' };
  ok((await planWithQ("a reading room", cat, hallucQ)).members.length > 0, "Q hallucinates an app id → dropped, baseline fills in (content-addressing not bypassed)");
}

// 9 — the honeycomb (the lobby) and its poster: a Space-of-Spaces, re-derived (L5).
console.log("[9] the honeycomb — a Space-of-Spaces, poster re-derived to a fallback");
{
  const leafA = { name: "A", layout: "split-h", accent: "#f2c14e", members: [{ kind: "app", root: A }, { kind: "app", root: B }] };
  const leafB = { name: "B", layout: "single", accent: "#c77bff", members: [{ kind: "app", root: C }] };
  const kA = await kappa(leafA), kB = await kappa(leafB);
  const lobby = { name: "Lobby", layout: "honeycomb", accent: "#2dd4bf", members: [{ kind: "space", root: kA }, { kind: "space", root: kB }] };
  const kLobby = await kappa(lobby);
  ok(identity(lobby).layout === "honeycomb", "honeycomb is an accepted, identity-bearing layout");
  ok(await verify(lobby, kLobby), "the honeycomb is a κ and reopens exact (L5)");
  ok(identity(lobby).members.length === 2 && identity(lobby).members.every((m) => m.kind === "space"), "its hexes are Spaces (a Space-of-Spaces)");

  const nestedHive = { name: "Inner", layout: "honeycomb", accent: "#8b5cf6", members: [{ kind: "space", root: kA }] };
  const kNested = await kappa(nestedHive);
  const outer = nest(lobby, kNested);
  ok(identity(outer).members.some((m) => m.kind === "space" && m.root === kNested), "a honeycomb can contain a honeycomb (infinite nesting)");
  ok((await kappa(outer)) !== kLobby, "nesting a honeycomb mints a new κ (immutable)");

  const pOk = await poster(leafA, kA);
  ok(pOk.kind === "poster" && pOk.accent === "#f2c14e", "poster of a Space at its own κ → themed (accent carried, re-derived)");
  const pDrift = await poster(leafA, kB);                  // leafA's bytes filed under leafB's κ → drift
  ok(pDrift.kind === "identicon", "a poster whose bytes don't match its κ → identicon fallback (fail-closed)");
}

// 10 — the ONE hex packer (the fractal honeycomb): deterministic, centre-out, centred.
console.log("[10] hex packing — one packer, every scale");
{
  const a = hexSpiral(19), b = hexSpiral(19);
  ok(JSON.stringify(a) === JSON.stringify(b), "hexSpiral is deterministic (same n → same cells)");
  ok(a.length === 19 && a[0].q === 0 && a[0].r === 0, "first cell is the centre (0,0)");
  ok(JSON.stringify(hexSpiral(7)) === JSON.stringify(a.slice(0, 7)), "a smaller cluster is a prefix of a bigger one (centre-out)");
  const ring1 = a.slice(1, 7);                              // first ring = exactly 6 neighbours of the centre
  ok(ring1.every((c) => Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(c.q + c.r)) === 1), "ring 1 is the 6 immediate neighbours");
  const pts = hexLayout(7, 100);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  ok(Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9, "hexLayout is centred on the origin (centroid ≈ 0)");
  ok(Math.abs(pts[1].x) > 0 || Math.abs(pts[1].y) > 0, "ring cells are placed away from the centre");
}

// 11 — the catalog feeds the category filter: apps carry applicationCategory + keywords/categories.
console.log("[11] catalog exposes categories + keywords for the filter");
{
  let ds = [];
  try { ds = JSON.parse(readFileSync(new URL("../../../holo-apps/apps/index.jsonld", import.meta.url)))["dcat:dataset"] || []; } catch (e) { /* */ }
  ok(ds.length > 0, "catalog loads with apps");
  ok(ds.every((a) => a["schema:applicationCategory"]), "every app has an applicationCategory (the colour/chip axis)");
  ok(ds.filter((a) => Array.isArray(a["schema:keywords"]) && a["schema:keywords"].length).length >= ds.length * 0.8, "most apps emit keywords (the ranker's haystack)");
  ok(ds.filter((a) => Array.isArray(a["holo:categories"]) && a["holo:categories"].length).length >= ds.length * 0.8, "most apps emit categories");
}

// 12 — Q powers the "ask" filter (validated): Q's picks resolve to real apps or are dropped.
console.log("[12] Q-filter upgrade — qPickIds validates against the catalog");
{
  const cat = [
    { root: "a".repeat(64), name: "Holo Music", id: "org.hologram.HoloMusic" },
    { root: "b".repeat(64), name: "Holo Amp", id: "org.hologram.HoloAmp" },
    { root: "c".repeat(64), name: "Holo Trade", id: "org.hologram.HoloTrade" },
  ];
  ok((await qPickIds("music", cat, null)).length === 0, "no Q → empty (caller keeps its deterministic baseline)");
  const goodQ = { generate: async () => '["org.hologram.HoloAmp","org.hologram.HoloMusic"]' };
  const picks = await qPickIds("something to listen to", cat, goodQ);
  ok(picks.length === 2 && picks[0] === "b".repeat(64), "Q picks → validated κ-roots, in Q's order");
  const hallucQ = { generate: async () => '["org.hologram.DoesNotExist","org.hologram.HoloTrade"]' };
  const hp = await qPickIds("trade", cat, hallucQ);
  ok(hp.length === 1 && hp[0] === "c".repeat(64), "a hallucinated id is dropped; only real apps survive");
  const junkQ = { generate: async () => "I suggest a hammer." };
  ok((await qPickIds("x", cat, junkQ)).length === 0, "unparseable Q reply → empty (fail-soft to baseline)");
}

console.log(`\n${fail ? "✗" : "✓"} ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
