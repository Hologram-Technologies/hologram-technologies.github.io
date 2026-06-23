#!/usr/bin/env node
// holo-workspace-share-witness.mjs — proves Phase D: SHARE A TAB/APP AS A LIVE κ-LINK. A window is its
// own source chain; the share is that chain + its head κ. The recipient re-validates on RECEIPT
// (holo-strand-admit, verify-before-trust): a faithful bundle opens to the EXACT verified state; any
// tamper, drop, reorder, or forged signature is REFUSED (fail-closed) — a shared window can't be faked.
// Real holo-identity signer; real per-app strand (the browser binding wires the same over transports).
//
// Checks (all must hold):
//   1 shareThenOpen     — build a window (2 saves) → share → open → state matches exactly, verified.
//   2 headNamesChain    — the κ-link (bundle.head) equals the chain's actual head κ.
//   3 authorshipCarried — the admitted bundle reports the operator κ as author (signed).
//   4 tamperRefused     — mutate a snapshot payload → refused at integrity (Law L5); nothing mounted.
//   5 dropRefused       — drop a middle entry → refused (prev-link-broken).
//   6 reorderRefused    — swap two entries → refused (seq/link broken).
//   7 forgedSigRefused  — replace an entry's signature → refused (bad-sig).
//   8 headMismatchRefused — a link naming a different κ than the bundle's chain → refused.
//
// Authority: UOR-ADDR · holospaces Laws L1/L2/L5 · RFC 9334 (RATS, verify-before-trust) · rests on
// #holo-strand + #holo-strand-admit + #holo-workspace + #holo-identity. node tools/holo-workspace-share-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { makeWorkspace } from "../os/usr/lib/holo/holo-workspace.mjs";
import { shareWorkspace, openSharedWorkspace } from "../os/usr/lib/holo/holo-workspace-share.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
let tick = 0; const now = () => `2026-06-23T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "ws-share-tester", passphrase: "share pass" });
const APP = "did:holo:sha256:" + "a".repeat(64);

// author a window: 2 meaningful changes on its own per-app chain
const backend = (() => { let s = []; return { load: async () => clone(s), save: async (e) => { s = clone(e); } }; })();
const strand = makeStrand({ backend, now, signer: op });
const ws = makeWorkspace({ appKappa: APP, strand, now });
await ws.save({ doc: "draft", cursor: 1 });
await ws.save({ doc: "final draft", cursor: 42 });

const bundle = await shareWorkspace(strand);

// ── 1 · a faithful bundle opens to the exact verified state ──────────────────────────────────────────
{
  const r = await openSharedWorkspace(clone(bundle));
  ok("shareThenOpen", r.ok === true && r.state && r.state.doc === "final draft" && r.state.cursor === 42, JSON.stringify(r));
}
// ── 2 · the κ-link names the chain head ──────────────────────────────────────────────────────────────
ok("headNamesChain", bundle.head && bundle.head === strand.head(), `${String(bundle.head).slice(0, 24)}`);
// ── 3 · authorship travels (operator-signed) ─────────────────────────────────────────────────────────
{
  const r = await openSharedWorkspace(clone(bundle));
  ok("authorshipCarried", r.ok && r.actor === op.kappa, String(r.actor).slice(0, 24));
}
// ── 4 · a tampered snapshot payload is refused (Law L5, fail-closed) ─────────────────────────────────
{
  const bad = clone(bundle); bad.entries[1]["holstr:payload"].state.doc = "STOLEN";
  const r = await openSharedWorkspace(bad);
  ok("tamperRefused", r.ok === false && r.state === undefined, JSON.stringify(r));
}
// ── 5 · a dropped middle entry is refused (link broken) ──────────────────────────────────────────────
{
  const bad = clone(bundle); bad.entries.splice(1, 1);     // remove the middle entry
  const r = await openSharedWorkspace(bad);
  ok("dropRefused", r.ok === false, JSON.stringify(r));
}
// ── 6 · reordered entries are refused ────────────────────────────────────────────────────────────────
{
  const swap = clone(bundle);                              // swap first and last entries (≥2 exist)
  const a = swap.entries[swap.entries.length - 1]; swap.entries[swap.entries.length - 1] = swap.entries[0]; swap.entries[0] = a;
  const r = await openSharedWorkspace(swap);
  ok("reorderRefused", r.ok === false, JSON.stringify(r));
}
// ── 7 · a forged signature is refused ────────────────────────────────────────────────────────────────
{
  const bad = clone(bundle);
  const last = bad.entries[bad.entries.length - 1];
  last["holstr:sig"] = Buffer.from("forged-signature-bytes-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").toString("base64");
  const r = await openSharedWorkspace(bad);
  ok("forgedSigRefused", r.ok === false, JSON.stringify(r));
}
// ── 8 · a link naming a different κ than the bundle is refused ────────────────────────────────────────
{
  const bad = clone(bundle); bad.head = "did:holo:sha256:" + "f".repeat(64);
  const r = await openSharedWorkspace(bad);
  ok("headMismatchRefused", r.ok === false && r.why === "head-mismatch", JSON.stringify(r));
}

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-workspace-share D — a tab/app is shared as a live κ-link: the bundle is that app's source chain + its head κ. The recipient re-validates on receipt (holo-strand-admit, verify-before-trust): a faithful bundle opens to the exact verified state and carries the operator's authorship; any tamper, drop, reorder, forged signature, or mismatched link κ is refused (fail-closed). 'Your live window, not a copy' — and one that can't be faked. Pure assembly over holo-strand + holo-strand-admit; no new crypto.",
  authority: "UOR-ADDR · holospaces Laws L1/L2/L5 · RFC 9334 (RATS) · rests on #holo-strand + #holo-strand-admit + #holo-workspace + #holo-identity",
  witnessed,
  covers: witnessed ? ["share-then-open", "head-names-chain", "authorship-carried", "tamper-refused", "drop-refused", "reorder-refused", "forged-sig-refused", "head-mismatch-refused"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-workspace-share-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-workspace-share witness — share a window as a live, verify-before-trust κ-link\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  a shared window is the live verified original — and can't be faked" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
