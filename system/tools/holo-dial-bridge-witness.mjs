#!/usr/bin/env node
// holo-dial-bridge-witness.mjs — ADR-0113 (Holo Dial) S2: prove the SW↔page bridge (holo-dial-bridge.mjs)
// lets the Service-Worker resolver reach the page's live dial mesh, that the resolver re-derives every byte
// the bridge carries (a tampered reply is refused), and that a missing / silent / empty page resolves to
// null WITHOUT blocking — so the SW source is a safe, behaviour-preserving addition to the boot path.
//
// The MessageChannel + window-client posting are SIMULATED with Node's native MessageChannel (probed faithful:
// onmessage auto-starts, Uint8Array clones across) and a mock Client whose postMessage hands the transferred
// port to the page handler — exactly the browser shape. The live RTCPeerConnection leg is the browser proof
// that follows; the bridge protocol, timeout, and re-derive gate — what decide correctness — are all here.
//
// Checks (all must hold):
//   1 bridgesPageToSW      — page dial holds κX (via a peer) ⇒ SW askMesh gets it; resolveByKappa re-derives to κX.
//   2 refusesTamperedReply — page replies TAMPERED bytes for κY ⇒ the resolver re-derive refuses ⇒ unresolved (bridge ≠ trust).
//   3 noClientReturnsNull  — matchAll returns [] ⇒ askMesh → null promptly (no page to ask, boot not blocked).
//   4 silentPageTimesOut   — a client that never replies ⇒ null after the bounded timeout (a slow page can't wedge the SW).
//   5 emptyReplyNull       — page dial has nothing ⇒ {bytes:null} reply ⇒ askMesh null ⇒ unresolved, no hang.
//   6 ignoresForeignMsgs   — the page answerer ignores non-WANT messages (no spurious replies / port use).
//
// Authority (external): holospaces Laws L1/L3/L5 · ADR-026 Sovereign Delivery · ADR-0113 Holo Dial · W3C
// Service Workers (Client.postMessage + MessageChannel transfer). Usage: node tools/holo-dial-bridge-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { swAskMesh, servePageMesh, WANT } from "../os/sbin/holo-dial-bridge.mjs";
import { makeDial } from "../os/sbin/holo-dial.mjs";
import { createMeshBlocks, pairWires } from "../os/sbin/holo-mesh-blocks.mjs";
import { bridgePeer, kappaToCid } from "../os/sbin/holo-peers.mjs";
import { resolveByKappa, reDerive, hexOf } from "../os/sbin/holo-resolver.mjs";
import * as ipfs from "../os/usr/lib/holo/holo-ipfs.js";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-dial-bridge-witness.result.json"), JSON.stringify(r, null, 2) + "\n");
const enc = (s) => new TextEncoder().encode(s);
const kOf = async (b) => "did:holo:sha256:" + (await reDerive(b));
const mkObj = async (text) => { const bytes = enc(text); const k = await kOf(bytes); return { bytes, k, cid: kappaToCid(k, ipfs) }; };

// a page realm: a dial + the installed answerer. mockClient.postMessage(data,[port]) delivers to that answerer
// exactly as Client.postMessage would. Returns the client to hand to swAskMesh's matchAll.
function makePage(dial) {
  let handler = null;
  servePageMesh(dial, { addListener: (fn) => { handler = fn; } });
  return { postMessage: (data, transfer) => { Promise.resolve().then(() => handler && handler({ data, ports: transfer || [] })); } };
}
// a page that overrides the answerer to reply with fixed bytes (to simulate a tampered/empty reply directly).
function makeRawPage(replyBytes) {
  return { postMessage: (data, transfer) => { if (data && data.t === WANT) { const p = transfer && transfer[0]; Promise.resolve().then(() => p && p.postMessage({ bytes: replyBytes })); } } };
}
// attach a simulated remote peer (holding `blocks`) to a dial.
const attachRemote = (dial, blocks) => { const [a, b] = pairWires(); createMeshBlocks(b, { getLocalBlock: (cid) => blocks.get(cid) || null }); return dial.addWire(a); };

const checks = {};
const X = await mkObj("κX — held by a peer the PAGE can reach, fetched BY the SW over the bridge");
const Y = await mkObj("κY — honest bytes");
const Ybad = enc("κY — TAMPERED reply over the bridge");

// ── 1 · the full path: SW resolver → bridge → page dial → peer → back, re-derived ────────────────────
{
  const dial = makeDial({ ipfs, timeoutMs: 1000 });
  attachRemote(dial, new Map([[X.cid, X.bytes]]));               // the page can reach a peer holding κX
  const page = makePage(dial);
  const ask = swAskMesh({ matchAll: async () => [page], timeoutMs: 2000 });
  const source = bridgePeer("mesh", ask);                         // the SW's new source
  const bytes = await resolveByKappa(X.k, [source], new Map());
  checks.bridgesPageToSW = (await reDerive(bytes)) === hexOf(X.k);
}

// ── 2 · a TAMPERED reply is refused by the resolver re-derive (the bridge transports, it does not trust) ─
{
  const page = makeRawPage(Ybad);                                // page hands back wrong bytes for ANY want
  const ask = swAskMesh({ matchAll: async () => [page], timeoutMs: 1000 });
  const source = bridgePeer("mesh", ask);
  const store = new Map();
  let threw = false;
  await resolveByKappa(Y.k, [source], store).catch(() => { threw = true; });
  checks.refusesTamperedReply = threw && !store.has(hexOf(Y.k));
}

// ── 3 · no controlled client ⇒ null promptly (nothing to ask; boot path not blocked) ─────────────────
{
  const ask = swAskMesh({ matchAll: async () => [], timeoutMs: 5000 });
  const t0 = process.hrtime.bigint();
  const r = await ask(X.k);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  checks.noClientReturnsNull = r === null && ms < 500;            // returned without waiting on the timeout
}

// ── 4 · a silent page (never replies) ⇒ null after the bounded timeout (a slow page can't wedge the SW) ─
{
  const silent = { postMessage: () => {} };                      // accepts the want, never answers the port
  const ask = swAskMesh({ matchAll: async () => [silent], timeoutMs: 200 });
  const t0 = process.hrtime.bigint();
  const r = await ask(X.k);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  checks.silentPageTimesOut = r === null && ms >= 180 && ms < 1500;
}

// ── 5 · the page dial has nothing ⇒ a prompt {bytes:null} ⇒ null, unresolved, no hang ────────────────
{
  const dial = makeDial({ ipfs });                              // no peers → askMesh → null
  const page = makePage(dial);
  const ask = swAskMesh({ matchAll: async () => [page], timeoutMs: 5000 });
  const source = bridgePeer("mesh", ask);
  let threw = false;
  const t0 = process.hrtime.bigint();
  await resolveByKappa(X.k, [source], new Map()).catch(() => { threw = true; });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  checks.emptyReplyNull = threw && ms < 500;                     // empty reply, not a timeout
}

// ── 6 · the page answerer ignores non-WANT messages (no spurious port traffic) ───────────────────────
{
  const dial = makeDial({ ipfs });
  let replied = false;
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { replied = true; };
  let handler = null;
  servePageMesh(dial, { addListener: (fn) => { handler = fn; } });
  handler({ data: { t: "some-other-message" }, ports: [ch.port2] });   // a foreign message carrying a port
  await new Promise((r) => setTimeout(r, 50));
  checks.ignoresForeignMsgs = replied === false;
  try { ch.port1.close(); } catch {}
}

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Holo Dial (ADR-0113) S2 — the SW↔page bridge lets the Service-Worker resolver fetch a κ from the page's live dial mesh, re-derives every byte it carries (a tampered reply is refused), and resolves null without blocking when there is no client / a silent page / an empty reply — a safe, behaviour-preserving SW source",
  authority: "holospaces Laws L1/L3/L5 · ADR-026 Sovereign Delivery · ADR-0113 Holo Dial · W3C Service Workers (Client.postMessage + MessageChannel)",
  witnessed,
  covers: witnessed ? ["sw-bridge", "cross-realm-mesh", "resolver-final-gate", "no-block-on-absent-page", "timeout-bounded", "law-l5"] : [],
  checks,
});

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ the SW reaches the page mesh over the bridge, re-derives every byte, and never blocks on an absent/silent/empty page" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
