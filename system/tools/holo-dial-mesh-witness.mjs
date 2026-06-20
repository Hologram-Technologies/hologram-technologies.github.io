#!/usr/bin/env node
// holo-dial-mesh-witness.mjs — ADR-0113 (Holo Dial) S1: prove the dial-by-κ ORCHESTRATOR (holo-dial.mjs)
// fans a `want` across many peers, returns the first re-derived block, lets a HONEST peer win past a LIAR,
// SERVES the device's own κ to peers (the device seeds), integrates as a resolver source (full substrate
// path), and — the load-bearing safety property — returns null with ZERO peers, byte-for-byte the old
// `askMesh = async () => null` stub, so wiring it into the pinned heal/boot loop is behaviour-preserving.
//
// Channels are simulated with in-memory pairWires (the live RTCPeerConnection leg is browser-only and is the
// two-tab / offline-LAN proof that follows). The κ-block protocol, re-derivation, and fan-out logic — the
// parts that decide correctness — are all here and Node-provable.
//
// Checks (all must hold):
//   1 fansAcrossPeers      — 3 peers, only one holds κX ⇒ askMesh finds it; bytes re-derive to κX.
//   2 honestAmongLiars     — a peer serves TAMPERED κY, another serves HONEST κY ⇒ askMesh returns the honest bytes.
//   3 noPeersReturnsNull   — zero peers ⇒ askMesh(κ) === null (the old stub exactly: safe to wire into boot).
//   4 servesLocalToPeers   — getLocalBlock backed by the κ-store ⇒ a remote peer pulls a κ THIS device holds (seeds).
//   5 integratesResolver   — askMesh as a bridgePeer source resolves κ end-to-end; a κ no peer holds ⇒ unresolved.
//   6 detachStopsServing   — after detach() the peer is gone (peerCount drops) and its κ is no longer found.
//
// Authority (external): holospaces Laws L1/L3/L5 · ADR-026 Sovereign Delivery · ADR-0113 Holo Dial ·
// W3C WebRTC DataChannel · IPFS Trustless Gateways (κ = CIDv1 sha2-256). Usage: node tools/holo-dial-mesh-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeDial } from "../os/sbin/holo-dial.mjs";
import { createMeshBlocks, pairWires } from "../os/sbin/holo-mesh-blocks.mjs";
import { bridgePeer, kappaToCid } from "../os/sbin/holo-peers.mjs";
import { resolveByKappa, reDerive, hexOf } from "../os/sbin/holo-resolver.mjs";
import * as ipfs from "../os/usr/lib/holo/holo-ipfs.js";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-dial-mesh-witness.result.json"), JSON.stringify(r, null, 2) + "\n");
const enc = (s) => new TextEncoder().encode(s);
const kOf = async (b) => "did:holo:sha256:" + (await reDerive(b));
const mkObj = async (text) => { const bytes = enc(text); const k = await kOf(bytes); return { bytes, k, cid: kappaToCid(k, ipfs) }; };

// attachRemote(dial, remoteBlocks) → detach : wire a simulated remote peer (Map cid→bytes it serves) to the dial.
const attachRemote = (dial, remoteBlocks) => {
  const [wLocal, wRemote] = pairWires();
  createMeshBlocks(wRemote, { getLocalBlock: (cid) => remoteBlocks.get(cid) || null });   // the REMOTE side serves
  return dial.addWire(wLocal);                                                             // our side joins the dial
};

const checks = {};
const X = await mkObj("κX — held by exactly one of several peers");
const Y = await mkObj("κY — the honest bytes");
const Ybad = enc("κY — TAMPERED");
const W = await mkObj("κW — nobody on the mesh holds this");
const L = await mkObj("κL — a block this DEVICE holds, to serve to peers");

// ── 1 · fan across peers: 3 peers, only peer #3 holds κX ─────────────────────────────────────────────
{
  const dial = makeDial({ ipfs, timeoutMs: 1000 });
  attachRemote(dial, new Map());                                  // peer 1: holds nothing
  attachRemote(dial, new Map());                                  // peer 2: holds nothing
  attachRemote(dial, new Map([[X.cid, X.bytes]]));               // peer 3: holds κX
  const bytes = await dial.askMesh(X.k);
  checks.fansAcrossPeers = !!bytes && (await reDerive(bytes)) === hexOf(X.k) && dial.peerCount() === 3;
}

// ── 2 · honest among liars: one peer lies (tampered κY), one is honest ⇒ honest bytes returned ────────
{
  const dial = makeDial({ ipfs, timeoutMs: 1500 });
  attachRemote(dial, new Map([[Y.cid, Ybad]]));                  // liar: wrong bytes (mesh verify drops → never settles)
  attachRemote(dial, new Map([[Y.cid, Y.bytes]]));              // honest: settles promptly
  const bytes = await dial.askMesh(Y.k);
  checks.honestAmongLiars = !!bytes && (await reDerive(bytes)) === hexOf(Y.k);
}

// ── 3 · zero peers ⇒ null (the old stub exactly) — the safety proof for wiring into the pinned boot loader ─
{
  const dial = makeDial({ ipfs });
  const r = await dial.askMesh(X.k);
  checks.noPeersReturnsNull = r === null && dial.peerCount() === 0;
}

// ── 4 · this device SERVES its κ-store to a remote peer (the device becomes a seed) ───────────────────
{
  const deviceStore = new Map([[L.cid, L.bytes]]);              // what this device holds
  const dial = makeDial({ ipfs, getLocalBlock: (cid) => deviceStore.get(cid) || null });
  const [wLocal, wRemote] = pairWires();
  dial.addWire(wLocal);                                          // our side (serves from deviceStore)
  const remote = createMeshBlocks(wRemote);                     // a remote peer that ASKS us
  const got = await remote.wantBlock(L.cid);
  checks.servesLocalToPeers = !!got && (await reDerive(got)) === hexOf(L.k);
}

// ── 5 · integrates as a resolver source: full substrate path resolves κ; an unheld κ stays unresolved ──
{
  const dial = makeDial({ ipfs, timeoutMs: 500 });
  attachRemote(dial, new Map([[X.cid, X.bytes]]));
  const source = bridgePeer("mesh", (kappa) => dial.askMesh(kappa));
  const bytes = await resolveByKappa(X.k, [source], new Map());
  let unheld = false;
  await resolveByKappa(W.k, [source], new Map()).catch(() => { unheld = true; });
  checks.integratesResolver = (await reDerive(bytes)) === hexOf(X.k) && unheld;
}

// ── 6 · detach stops serving: drop the peer and its κ is no longer found ──────────────────────────────
{
  const dial = makeDial({ ipfs, timeoutMs: 400 });
  const detach = attachRemote(dial, new Map([[X.cid, X.bytes]]));
  const before = await dial.askMesh(X.k);
  detach();
  const after = await dial.askMesh(X.k);
  checks.detachStopsServing = !!before && after === null && dial.peerCount() === 0;
}

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Holo Dial (ADR-0113) S1 — the dial-by-κ orchestrator (holo-dial.mjs) fans want across peers and returns the first re-derived block, lets honest beat liar, serves the device's κ-store to peers, integrates as a resolver source, and returns null with zero peers (byte-for-byte the old stub → safe to wire into the pinned heal/boot loop)",
  authority: "holospaces Laws L1/L3/L5 · ADR-026 Sovereign Delivery · ADR-0113 Holo Dial · W3C WebRTC DataChannel · IPFS Trustless Gateways (κ = CIDv1 sha2-256)",
  witnessed,
  covers: witnessed ? ["dial-orchestrator", "multi-peer-fanout", "honest-among-liars", "device-seeds", "resolver-source", "behaviour-preserving-stub", "law-l5"] : [],
  checks,
});

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ the dial orchestrator fans across peers, lets truth beat lies, seeds to peers, and is a safe (null-with-no-peers) drop-in for the boot loop" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
