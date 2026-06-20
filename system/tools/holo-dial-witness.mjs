#!/usr/bin/env node
// holo-dial-witness.mjs — ADR-0113 (Holo Dial) S0: prove the EXISTING WebRTC κ-transport spine composes
// into ONE dial-by-κ source that plugs into the substrate resolver, with NO new trust. The parts already
// ship (holo-mesh-blocks · holo-webrtc-link · holo-peers · holo-resolver); this composes them and asserts:
// a κ held only by a PEER is fetched and accepted ONLY after re-derivation (Law L5), a tampered or absent
// block is REFUSED (nothing laundered, no hang), the resolver is the final gate even if a peer lies, and a
// once-resolved κ then serves from the LOCAL store with no peer (the device becomes a seed — Iroh's
// content-addressed transfer, native). It also EXERCISES the real RTCDataChannel binary adapter
// (dataChannelWire) over a mock channel pair — the leg the prior witnesses left untouched.
//
// Checks (all must hold):
//   1 composesInMemory     — peer A holds κX; peer B fetches it via bridgePeer→mesh→resolver; bytes re-derive to κX.
//   2 composesDataChannel  — same fetch over the REAL binary frame adapter (mock RTCDataChannel + dataChannelWire).
//   3 refusesTampered      — peer A serves TAMPERED bytes for κY ⇒ mesh verify drops it AND resolver refuses ⇒ unresolved, nothing stored.
//   4 resolverIsFinalGate  — a raw lying source (bypassing the mesh) returns wrong bytes ⇒ resolveByKappa refuses (a peer is no more trusted than a hostile origin).
//   5 declinesUnheld       — no peer holds κZ ⇒ a prompt `dont` ⇒ clean null (no timeout hang), resolve unresolved.
//   6 seedsThenServesLocal — once B resolved κX it is in B's store; a second resolve with NO peer serves it locally (can-recover → will).
//
// Authority (external): holospaces Laws L1/L3/L5 (identity is content · storage is a cache of the address
// space · verify by re-derivation) · ADR-026 Sovereign Delivery (cache → peers → origin) · ADR-0113 Holo
// Dial · W3C WebRTC (DataChannel) · IPFS Trustless Gateways (a sha-256 κ IS a CIDv1 sha2-256).
// Usage: node tools/holo-dial-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createMeshBlocks, pairWires, dataChannelWire } from "../os/sbin/holo-mesh-blocks.mjs";
import { bridgePeer, kappaToCid } from "../os/sbin/holo-peers.mjs";
import { resolveByKappa, reDerive, hexOf } from "../os/sbin/holo-resolver.mjs";
import * as ipfs from "../os/usr/lib/holo/holo-ipfs.js";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-dial-witness.result.json"), JSON.stringify(r, null, 2) + "\n");
const enc = (s) => new TextEncoder().encode(s);
const kOf = async (bytes) => "did:holo:sha256:" + (await reDerive(bytes));
const mkObj = async (text) => { const bytes = enc(text); const k = await kOf(bytes); return { bytes, k, cid: kappaToCid(k, ipfs) }; };

// a mesh SOURCE for the resolver: κ → CID → wantBlock on this peer's mesh. The mesh re-derives on receipt;
// the resolver re-derives again. This is exactly the bridgePeer("mesh", …) seam holo-heal-boot.mjs stubs.
const meshSource = (mesh) => bridgePeer("mesh", async (kappa) => mesh.wantBlock(kappaToCid(kappa, ipfs)));

// mockChannelPair() — two linked objects with the minimal RTCDataChannel surface dataChannelWire touches
// (binaryType, addEventListener('message'), send(ArrayBuffer)); send delivers (async) to the other's handler.
function mockChannelPair() {
  const make = () => { const h = []; return { binaryType: "", readyState: "open", addEventListener: (t, fn) => { if (t === "message") h.push(fn); }, _emit: (data) => h.forEach((fn) => fn({ data })), send: null }; };
  const a = make(), b = make();
  a.send = (buf) => Promise.resolve().then(() => b._emit(buf));
  b.send = (buf) => Promise.resolve().then(() => a._emit(buf));
  return [a, b];
}

const checks = {};
const X = await mkObj("object-X · served only by a peer over WebRTC");
const Y = await mkObj("object-Y · the honest bytes");
const Ybad = enc("object-Y · TAMPERED — does not re-derive to κY");
const Z = await mkObj("object-Z · nobody on the mesh holds this");

// ── 1 · in-memory transport (pairWires): A holds κX, B is fetch-only; B resolves κX through the chain ──
{
  const [wA, wB] = pairWires();
  const aBlocks = new Map([[X.cid, X.bytes]]);
  createMeshBlocks(wA, { getLocalBlock: (cid) => aBlocks.get(cid) || null });   // peer A: serves what it holds
  const meshB = createMeshBlocks(wB);                                           // peer B: fetch-only
  const store = new Map();
  const bytes = await resolveByKappa(X.k, [meshSource(meshB)], store);
  checks.composesInMemory = (await reDerive(bytes)) === hexOf(X.k) && store.has(hexOf(X.k));

  // ── 6 · seed then serve local: a second resolve with NO sources serves κX from B's store (the device seeds) ──
  const bytes2 = await resolveByKappa(X.k, [], store).catch(() => null);
  checks.seedsThenServesLocal = !!bytes2 && (await reDerive(bytes2)) === hexOf(X.k);
}

// ── 2 · the REAL binary adapter (mock RTCDataChannel + dataChannelWire): same fetch over the wire format ──
{
  const [dcA, dcB] = mockChannelPair();
  const aBlocks = new Map([[X.cid, X.bytes]]);
  createMeshBlocks(dataChannelWire(dcA), { getLocalBlock: (cid) => aBlocks.get(cid) || null });
  const meshB = createMeshBlocks(dataChannelWire(dcB), { timeoutMs: 2000 });
  const bytes = await resolveByKappa(X.k, [meshSource(meshB)], new Map()).catch(() => null);
  checks.composesDataChannel = !!bytes && (await reDerive(bytes)) === hexOf(X.k);
}

// ── 3 · a TAMPERED peer block is refused twice (mesh verifyBlock drops it; the resolver re-derive backs it
//        up) ⇒ the κ stays unresolved and nothing is admitted to the store (no laundering) ──────────────
{
  const [wA, wB] = pairWires();
  const aBlocks = new Map([[Y.cid, Ybad]]);                                     // A lies: wrong bytes for κY
  createMeshBlocks(wA, { getLocalBlock: (cid) => aBlocks.get(cid) || null });
  const meshB = createMeshBlocks(wB, { timeoutMs: 300 });                       // short: the lie never settles
  const store = new Map();
  let threw = false;
  await resolveByKappa(Y.k, [meshSource(meshB)], store).catch(() => { threw = true; });
  checks.refusesTampered = threw && !store.has(hexOf(Y.k));
}

// ── 4 · the resolver is the FINAL gate: even bypassing the mesh, a raw source that hands back wrong bytes
//        is refused — a peer is trusted no more than a hostile origin (trust is in the math) ─────────────
{
  const lying = async () => Ybad;                                              // claims to have κY, returns tampered bytes
  let threw = false;
  await resolveByKappa(Y.k, [lying], new Map()).catch(() => { threw = true; });
  checks.resolverIsFinalGate = threw;
}

// ── 5 · no peer holds κZ ⇒ a prompt `dont` settles to null (no timeout hang) ⇒ resolve unresolved ───────
{
  const [wA, wB] = pairWires();
  createMeshBlocks(wA, { getLocalBlock: () => null });                          // A holds nothing → replies `dont`
  const meshB = createMeshBlocks(wB, { timeoutMs: 5000 });
  const store = new Map();
  let threw = false;
  const t0 = process.hrtime.bigint();
  await resolveByKappa(Z.k, [meshSource(meshB)], store).catch(() => { threw = true; });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  checks.declinesUnheld = threw && !store.has(hexOf(Z.k)) && ms < 1000;          // settled by `dont`, not by the 5s timeout
}

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Holo Dial (ADR-0113) S0 — the existing WebRTC κ-transport (holo-mesh-blocks · holo-webrtc-link · holo-peers) composes into one dial-by-κ resolver source: a peer-only κ is fetched and accepted ONLY after re-derivation (Law L5), a tampered/absent block is refused with no laundering and no hang, the resolver is the final gate, and a resolved κ then serves locally (the device seeds) — a native iroh-blobs",
  authority: "holospaces Laws L1/L3/L5 · ADR-026 Sovereign Delivery (cache → peers → origin) · ADR-0113 Holo Dial · W3C WebRTC DataChannel · IPFS Trustless Gateways (κ = CIDv1 sha2-256)",
  witnessed,
  covers: witnessed ? ["dial-compose", "dial-by-kappa", "peer-transport", "datachannel-adapter", "law-l5", "no-launder", "device-seeds"] : [],
  checks,
});

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ the WebRTC κ-transport composes into a dial-by-κ source, re-derives every byte, refuses every lie" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
