#!/usr/bin/env node
// holo-workspace-sharelink-witness.mjs — proves Phase D1 (the share-link payload): an app's CURRENT live
// state becomes a COMPACT, self-verifying snapshot that rides a link fragment and opens exactly as you left
// it — verify-before-trust, privacy-preserving (no history travels). Drives the real makeWorkspaceHost +
// the real admit gate.
//
// Checks (all must hold):
//   1 payloadFromLiveState — shareLinkPayload seals the app's current state into a one-entry bundle.
//   2 encodeDecodeRoundtrip — encodeWorkspaceShare → decodeWorkspaceShare returns the same bundle.
//   3 openRestoresExact    — openSharedWorkspace(decoded) verifies + returns the exact state.
//   4 tamperRefused        — flipping a byte of the encoded snapshot → open refused (fail-closed).
//   5 noLiveStateNull      — an app with nothing saved → shareLinkPayload returns null (caller shares fresh).
//   6 compactNotHistory    — the payload carries ONE entry (the snapshot), not the whole chain (privacy).
//   7 qrFitFlags           — small state fits the QR; a large blob still fits a URL but not the QR.
//
// Authority: UOR-ADDR · holospaces Laws L1/L2/L5 · RFC 9334 (RATS) · rests on #holo-workspace-share +
// #holo-workspace-host + #holo-strand-admit. node tools/holo-workspace-sharelink-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { makeWorkspaceHost } from "../os/usr/lib/holo/holo-workspace-host.mjs";
import { shareLinkPayload, encodeWorkspaceShare, decodeWorkspaceShare, openSharedWorkspace } from "../os/usr/lib/holo/holo-workspace-share.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
let tick = 0; const now = () => `2026-06-23T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const stores = new Map();
const strandFor = (k) => { if (!stores.has(k)) stores.set(k, []); const s = stores.get(k); return makeStrand({ backend: { load: async () => clone(s), save: async (e) => { stores.set(k, clone(e)); } }, now }); };
const host = makeWorkspaceHost({ strandFor, now });

const APP = "did:holo:sha256:" + "a".repeat(64);

// seed multiple states so we can prove the SHARE carries only the latest, compactly
await host.workspace(APP).save({ doc: "draft 1" });
await host.workspace(APP).save({ doc: "draft 2" });
await host.workspace(APP).save({ doc: "final", caret: 99 });

// ── 1 · payload from live state ──────────────────────────────────────────────────────────────────────
const bundle = await shareLinkPayload(APP, host, { now });
ok("payloadFromLiveState", bundle && Array.isArray(bundle.entries) && bundle.entries.length >= 1 && bundle.head, JSON.stringify({ n: bundle && bundle.entries.length }));

// ── 6 · compact: ONE entry (the snapshot), not the 3-deep chain ──────────────────────────────────────
ok("compactNotHistory", bundle.entries.length === 1, `entries=${bundle.entries.length}`);

// ── 2 · encode/decode roundtrip ──────────────────────────────────────────────────────────────────────
const enc = encodeWorkspaceShare(bundle);
const dec = decodeWorkspaceShare(enc.token);
ok("encodeDecodeRoundtrip", dec && JSON.stringify(dec.entries) === JSON.stringify(bundle.entries) && dec.head === bundle.head, JSON.stringify({ len: enc.len }));

// ── 3 · open restores the exact current state ────────────────────────────────────────────────────────
{
  const r = await openSharedWorkspace(dec);
  ok("openRestoresExact", r.ok === true && r.state && r.state.doc === "final" && r.state.caret === 99, JSON.stringify(r));
}

// ── 4 · a tampered token is refused ──────────────────────────────────────────────────────────────────
{
  const bad = decodeWorkspaceShare(enc.token);
  bad.entries[0]["holstr:payload"].state.doc = "STOLEN";          // mutate after decode
  const r = await openSharedWorkspace(bad);
  ok("tamperRefused", r.ok === false, JSON.stringify(r));
}

// ── 5 · no live state → null (share fresh) ───────────────────────────────────────────────────────────
{
  const EMPTY = "did:holo:sha256:" + "e".repeat(64);
  const none = await shareLinkPayload(EMPTY, host, { now });
  ok("noLiveStateNull", none === null, JSON.stringify(none));
}

// ── 7 · qr/url fit flags ─────────────────────────────────────────────────────────────────────────────
{
  const small = encodeWorkspaceShare(bundle);
  // a large state → still a URL, not a QR
  const bigApp = "did:holo:sha256:" + "b".repeat(64);
  await host.workspace(bigApp).save({ blob: "x".repeat(4000) });
  const bigBundle = await shareLinkPayload(bigApp, host, { now });
  const big = encodeWorkspaceShare(bigBundle);
  ok("qrFitFlags", small.qrFits === true && small.fits === true && big.qrFits === false && big.fits === true, JSON.stringify({ small: small.len, big: big.len }));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-workspace-share D1 — the share-link payload: an app's current live state is re-sealed as a compact one-entry, self-verifying snapshot that rides a link fragment (or, when large, a URL/published token), opens with verify-before-trust to the exact state, refuses tampering, returns null when there's nothing live (share fresh), and never ships the private history (privacy). Pure assembly over holo-workspace-host + holo-strand-admit; no new crypto.",
  authority: "UOR-ADDR · holospaces Laws L1/L2/L5 · RFC 9334 (RATS) · rests on #holo-workspace-share + #holo-workspace-host + #holo-strand-admit",
  witnessed,
  covers: witnessed ? ["payload-from-live-state", "encode-decode-roundtrip", "open-restores-exact", "tamper-refused", "no-live-state-null", "compact-not-history", "qr-fit-flags"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-workspace-sharelink-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-workspace-sharelink witness — share an app as a compact, verifiable live snapshot\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  your current window travels in a link — verified, compact, history-private" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
