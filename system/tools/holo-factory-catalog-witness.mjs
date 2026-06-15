#!/usr/bin/env node
// holo-factory-catalog-witness.mjs — proves the CANDIDATE CATALOG (ADR-0097): the live enumeration of
// fixable targets that lets triage locate WITHOUT the user passing candidates (the last seam to fully
// hands-off). Booleans over the real os/usr/lib/holo/q/holo-factory-catalog.mjs:
//   1. mergesAndDedups   — providers compose into one list, de-duped by id (first wins); explicit targets come first
//   2. targetSelfRegister— target(id, spec) appears in candidates carrying its read/write (the app self-register seam)
//   3. liveEditWrite     — a liveEdit-surface candidate WRITES through the governed agentEdit door; a refusal throws
//   4. liveEditRead      — with a resolveSource it READS the surface's current source (κ → source)
//   5. honestDegrade     — no resolveSource ⇒ read omitted; an editor without agentEdit ⇒ write omitted (no faking a door)
//   6. kRouteResolver    — resolves κ → source over the content-addressed route; a miss is null (Law L5: bytes ARE the κ)
//   7. catalogFeedsTriage— end to end: triage locates the right target FROM the catalog (no hand-passed candidates)
//
//   node tools/holo-factory-catalog-witness.mjs        (also run live by tools/gate.mjs)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createCatalog, liveEditProvider, listProvider, kRouteResolver } from "../os/usr/lib/holo/q/holo-factory-catalog.mjs";
import { createTriage } from "../os/usr/lib/holo/q/holo-factory-triage.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};

// ── 1. mergesAndDedups — compose + dedup, explicit first ──
{
  const cat = createCatalog([listProvider([{ id: "a", text: "A" }, { id: "b", text: "B" }]), listProvider([{ id: "b", text: "B2" }, { id: "c", text: "C" }])]);
  cat.target("z", { text: "Z" });
  const ids = (await cat.candidates()).map((c) => c.id);
  checks.mergesAndDedups = ids[0] === "z" && ids.filter((x) => x === "b").length === 1 && JSON.stringify(ids) === JSON.stringify(["z", "a", "b", "c"]);
}

// ── 2. targetSelfRegister — an app self-registers a rich target ──
{
  const cat = createCatalog();
  let src = "x = 1";
  cat.target("note", { text: "my notepad", read: () => src, write: (s) => { src = s; }, lang: "js" });
  const c = (await cat.candidates()).find((x) => x.id === "note");
  checks.targetSelfRegister = !!c && c.text === "my notepad" && typeof c.read === "function" && typeof c.write === "function" && c.read() === "x = 1";
}

// ── 3+4. liveEditWrite + liveEditRead — surfaces write via agentEdit, read via resolveSource ──
{
  const edits = [];
  const editor = { list: () => ["notepad", "wallet"], kappaOf: (id) => "did:holo:sha256:" + id + "K",
    agentEdit: async (id, src) => { edits.push({ id, src }); return { ok: true, kappa: "did:holo:sha256:new" + id }; } };
  const resolveSource = async (k) => "SOURCE_OF:" + k;
  const prov = liveEditProvider(editor, { resolveSource });
  const list = await prov.list();
  const np = list.find((c) => c.id === "notepad");
  const wrote = await np.write("y = 2"); const read = await np.read();
  checks.liveEditWrite = wrote.ok === true && edits.length === 1 && edits[0].id === "notepad" && edits[0].src === "y = 2";
  checks.liveEditRead = read === "SOURCE_OF:did:holo:sha256:notepadK";
  // a refusing editor ⇒ write throws
  const refuse = liveEditProvider({ list: () => ["x"], kappaOf: () => "k", agentEdit: async () => ({ ok: false, reason: "blocked" }) }, {});
  let threw = false; try { await (await refuse.list())[0].write("z"); } catch (e) { threw = /blocked|refused/.test(String(e.message)); }
  checks.liveEditWrite = checks.liveEditWrite && threw;
}

// ── 5. honestDegrade — no faked doors ──
{
  const editor = { list: () => ["a"], kappaOf: () => "k", agentEdit: async () => ({ ok: true, kappa: "k2" }) };
  const noRead = (await liveEditProvider(editor, {}).list())[0];            // no resolveSource → read omitted
  const noWrite = (await liveEditProvider({ list: () => ["a"], kappaOf: () => "k" }, { resolveSource: async () => "s" }).list())[0];  // no agentEdit → write omitted
  checks.honestDegrade = noRead.read === undefined && typeof noRead.write === "function" && noWrite.write === undefined && typeof noWrite.read === "function";
}

// ── 6. kRouteResolver — κ → source over the route; miss ⇒ null ──
{
  const okFetch = async (url) => ({ ok: true, text: async () => "BYTES@" + url });
  const missFetch = async () => ({ ok: false });
  const r1 = await kRouteResolver(okFetch)("did:holo:sha256:abc");
  const r2 = await kRouteResolver(missFetch)("did:holo:sha256:abc");
  checks.kRouteResolver = r1 === "BYTES@/.holo/sha256/abc" && r2 === null;
}

// ── 7. catalogFeedsTriage — triage locates the right target FROM the catalog ──
{
  const VEC = { "keep my notepad working": [1, 0.1, 0], "a notepad for writing text": [0.97, 0.15, 0], "a wallet for coins": [0, 0, 1] };
  const embed = async (t) => Array.isArray(t) ? t.map((x) => VEC[x] || [0, 0, 0]) : (VEC[t] || [0, 0, 0]);
  const triage = createTriage({ embed });
  const cat = createCatalog([listProvider([{ id: "wallet", text: "a wallet for coins" }])]);
  cat.target("notepad", { text: "a notepad for writing text", read: () => "x(", write: () => {} });
  const loc = await triage.locate("keep my notepad working", await cat.candidates(), { threshold: 0.5 });
  checks.catalogFeedsTriage = !!loc.target && loc.target.id === "notepad";
}

const witnessed = Object.values(checks).every(Boolean);
const out = {
  spec: "Holo Factory CANDIDATE CATALOG (ADR-0097) — the live enumeration of fixable targets so triage locates WITHOUT the "
    + "user passing candidates (the last seam to fully hands-off on real holospaces): with a catalog wired, Q.factory.watch('keep "
    + "my notepad working') finds the surface and closes the loop unattended. The catalog COMPOSES injected providers (each { list() "
    + "→ candidates }) plus a self-register seam target(id, spec), de-duping by id. Built-ins: liveEditProvider (every live mounted "
    + "holospace surface — write via the governed agentEdit door, read via an injected κ→source resolver) and kRouteResolver (κ → "
    + "source over /.holo/sha256/<hex>, Law L5). HONEST: no resolver ⇒ read omitted, no agentEdit ⇒ write omitted (never fakes a door).",
  authority: "W3C DID Core · IETF RFC 8785 (JCS) · UOR-ADDR (κ = H(canonical form), the κ-route) · the Holo Constitution conscience "
    + "gate (ADR-033, agentEdit default-deny) · Holo Live Edit (the ONE governed edit primitive) · Holo Factory ADR-0097 · Holo Mind "
    + "ADR-0081 (injected-faculty isomorphism) · holospaces Laws L1/L4/L5",
  witnessed,
  covers: ["holo-factory", "candidate-catalog", "self-register", "live-targets", "hands-off", "law-l4", "law-l5"],
  checks,
  notes: { core: "os/usr/lib/holo/q/holo-factory-catalog.mjs", basis: "createCatalog(providers)+target(); liveEditProvider over HoloLiveEdit; kRouteResolver over /.holo/sha256/" },
};
writeFileSync(join(here, "holo-factory-catalog-witness.result.json"), JSON.stringify(out, null, 2));
console.log(`holo-factory-catalog-witness: ${witnessed ? "PASS" : "FAIL"}`);
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"} ${k}`);
process.exit(witnessed ? 0 : 1);
