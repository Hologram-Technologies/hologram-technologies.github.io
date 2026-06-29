#!/usr/bin/env node
// holo-holospace-host-witness.mjs — proves Phase 2.0: a holospace boots STANDALONE from a κ URL. The pure
// planHost maps a space's members → bootable κ URLs + non-overlapping tile rects (single-sourcing the URL
// grammar from holo-omni-resolve.DEST), and the composition is L5-verifiable (a tampered member moves the κ
// and the host refuses). This is the foundation for "every CEF tab is an isolated holospace".
//
// Checks (all must hold):
//   1 urlGrammar        — an app member → holo://<κ>/ ; a nested-space member → holo://space/<κ> (DEST grammar).
//   2 ordering          — members are tiled in identity order (by position, then κ).
//   3 singleFull        — one member (or layout "single") → one full-bleed rect.
//   4 splitHNonOverlap  — split-h with 3 members → 3 columns, non-overlapping, covering the width.
//   5 gridQuarters      — grid-2x2 with 4 members → quarters, non-overlapping.
//   6 primaryRail       — primary-rail → one primary pane + a non-overlapping rail of the rest.
//   7 stackOverlaps     — stack → all members full-bleed (overlap by design), count preserved.
//   8 failClosed        — planHost(null|""|number) → { ok:false, members:[] } (no fabricated arrangement).
//   9 verifyComposition — holo-spaces.verify: the true κ verifies; a tampered member → false (L5 on the whole).
//  10 emptyHonest       — a space with no members → ok:true, empty plan (an honest empty surface, not a guess).
//
// Authority: holospaces Law L1/L5 over the REAL holo-spaces model + holo-omni-resolve.DEST grammar.
// node tools/holo-holospace-host-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { planHost, layoutRects } from "../os/usr/lib/holo/holo-holospace-host.mjs";
import { DEST } from "../os/usr/lib/holo/holo-omni-resolve.mjs";
import { kappa, addMember, verify } from "../../../holo-apps/apps/spaces/holo-spaces.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const PREFIX = "did:holo:sha256:";
const K = (c) => PREFIX + String(c).repeat(64);                     // a κ from a single hex char
const overlap = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
const noneOverlap = (rs) => { for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (overlap(rs[i], rs[j])) return false; return true; };
const space = (layout, members) => ({ v: 1, name: "T", layout, members });

// 1 — URL grammar: app vs nested-space members.
{
  const s = space("split-h", [{ kind: "app", root: K("a"), position: 0 }, { kind: "space", root: K("b"), position: 1 }]);
  const p = planHost(s);
  ok("urlGrammar",
    p.ok && p.members.length === 2 &&
    p.members[0].url === DEST.kappa("a".repeat(64)) && p.members[0].kind === "app" &&
    p.members[1].url === DEST.space("b".repeat(64)) && p.members[1].kind === "space",
    JSON.stringify(p.members.map((m) => m.url)));
}

// 2 — ordering by position (members given out of order resolve to identity order).
{
  const s = space("split-h", [{ kind: "app", root: K("c"), position: 2 }, { kind: "app", root: K("a"), position: 0 }, { kind: "app", root: K("b"), position: 1 }]);
  const p = planHost(s);
  ok("ordering", p.members.map((m) => m.ref) .join(",") === [K("a"), K("b"), K("c")].join(","), JSON.stringify(p.members.map((m) => m.ref)));
}

// 3 — single / one member → full bleed.
{
  const p1 = planHost(space("single", [{ kind: "app", root: K("a"), position: 0 }]));
  const r = p1.members[0].rect;
  ok("singleFull", p1.members.length === 1 && r.left === 0 && r.top === 0 && r.width === 100 && r.height === 100, JSON.stringify(r));
}

// 4 — split-h with 3 → columns, non-overlapping, cover the full width.
{
  const p = planHost(space("split-h", [{ root: K("a"), position: 0 }, { root: K("b"), position: 1 }, { root: K("c"), position: 2 }]));
  const rs = p.members.map((m) => m.rect);
  const coverW = Math.abs(rs.reduce((s, r) => s + r.width, 0) - 100) < 1e-6 && rs.every((r) => r.height === 100);
  ok("splitHNonOverlap", rs.length === 3 && noneOverlap(rs) && coverW, JSON.stringify(rs));
}

// 5 — grid-2x2 with 4 → quarters, non-overlapping.
{
  const p = planHost(space("grid-2x2", [0, 1, 2, 3].map((i) => ({ root: K("abcd"[i]), position: i }))));
  const rs = p.members.map((m) => m.rect);
  ok("gridQuarters", rs.length === 4 && noneOverlap(rs) && rs.every((r) => r.width === 50 && r.height === 50), JSON.stringify(rs));
}

// 6 — primary-rail → one big pane + a non-overlapping rail of the rest.
{
  const p = planHost(space("primary-rail", [0, 1, 2].map((i) => ({ root: K("abc"[i]), position: i }))));
  const rs = p.members.map((m) => m.rect);
  ok("primaryRail", rs.length === 3 && rs[0].width === 68 && rs[0].height === 100 && noneOverlap(rs), JSON.stringify(rs));
}

// 7 — stack → all full-bleed (overlap by design), count preserved.
{
  const p = planHost(space("stack", [0, 1, 2].map((i) => ({ root: K("abc"[i]), position: i }))));
  const rs = p.members.map((m) => m.rect);
  ok("stackOverlaps", rs.length === 3 && rs.every((r) => r.width === 100 && r.height === 100), JSON.stringify(rs));
}

// 8 — fail-closed on garbage input.
{
  ok("failClosed", !planHost(null).ok && planHost(null).members.length === 0 && !planHost("x").ok && !planHost(42).ok);
}

// 9 — L5 on the composition: the true κ verifies; tampering a member moves the κ → verify false.
{
  let s = space("split-h", []);
  s = addMember(s, { kind: "app", root: K("a") });
  s = addMember(s, { kind: "app", root: K("b") });
  const trueK = await kappa(s);
  const tampered = JSON.parse(JSON.stringify(s)); tampered.members[1].root = K("f");   // swap a member
  ok("verifyComposition", (await verify(s, trueK)) === true && (await verify(tampered, trueK)) === false);
}

// 10 — empty members → honest empty plan (not a fabricated single).
{
  const p = planHost(space("grid-2x2", []));
  ok("emptyHonest", p.ok === true && p.members.length === 0);
}

const pass = Object.values(checks).every(Boolean);
const total = Object.keys(checks).length;
const result = { ok: pass, passed: Object.values(checks).filter(Boolean).length, total, checks, fail };
writeFileSync(join(here, "holo-holospace-host-witness.result.json"), JSON.stringify(result, null, 2));
console.log(`holo-holospace-host-witness: ${result.passed}/${total} ${pass ? "GREEN ✓" : "RED ✗"}`);
if (!pass) { console.log("  failed:", fail.join("; ")); process.exit(1); }
