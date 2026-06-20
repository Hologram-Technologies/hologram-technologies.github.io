// holo-workspace-sync.mjs — the PORTABLE leg of Holo Session (ADR-0105): backup, recover, and resume
// the EXACT workspace on ANY device, serverless and content-addressed. Holo Session already captures
// the whole experience into one PROV-O `holo:SessionManifest` and seals it to a LOCAL κ-store, keyed to
// (operator, THIS device) — by design it refuses to restore on another machine. This module is the
// future axis that row deferred: it seals the SAME manifest as a real IPFS UnixFS DAG (a CIDv1 the
// existing gateway resolves), restores it on a DIFFERENT device (no device-binding check), and exports a
// single CAR file — the shareable "resume token."
//
// ONE sealer, ONE resolver, NO new substrate:
//   • seal  → holo-web-snapshot.sealSnapshot   (the same mint the web commons uses)
//   • read  → holo-ipfs-gateway.resolveIpfsPath (the same trustless DAG walk IPFS browsing uses)
//   • carry → holo-ipfs.encodeCar / CarParser   (the standard single-file IPFS bundle)
//   • bounds→ holo-session.isExperienceKey       (the privacy allowlist, re-applied defensively)
//
// (Holo Session is ADR-0104; this portable cross-device axis is ADR-0105.)
// The honest split (copied from Onion Omnisearch, ADR-0103): the resume token (root CID) is
// self-verifying with NO network — it re-derives to itself (Law L5). The BYTES need an explicit
// transport (file / pin / peer), pinned in the receipt; we never present a not-yet-transported snapshot
// as available (`directIPFS:false`, transport-honest `null`).

import * as holoIpfs from "../usr/lib/holo/holo-ipfs.js";
import { sealSnapshot, blockSource, publishToKStore } from "./holo-web-snapshot.mjs";
import { resolveIpfsPath, makeGetBlock } from "./holo-ipfs-gateway.mjs";
import { IPFS_GATEWAYS } from "./holo-peers.mjs";
import { isExperienceKey } from "../usr/lib/holo/holo-session.mjs";
import { jcs } from "../usr/lib/holo/holo-uor.mjs";

const te = new TextEncoder();
const td = new TextDecoder();
const WORKSPACE_FILE = "workspace.json";   // the single resource in the snapshot DAG

// ── base64url (environment-agnostic: Node Buffer or browser btoa/atob, chunked so a big array can't
//    overflow the call stack). The link tier carries the CAR bytes IN the URL fragment.
function b64encode(u8) {
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  let s = ""; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s);
}
function b64decode(str) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(str, "base64"));
  const bin = atob(str); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u;
}
const toB64url = (s) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return s; };

// portableManifest(manifest) — the body that ACTUALLY gets content-addressed. Two things are stripped
// so the CID is a pure function of the EXPERIENCE (real cross-device dedup, the κ-memo property):
//   • `holo:device`            — the machine anchor must NOT travel and must NOT gate restore (that
//                                device-binding refusal is exactly the wall this module removes);
//   • `prov:generatedAtTime`   — provenance is lineage; folding it into the κ breaks κ-memo (the Holo
//                                Playground lesson). It moves OUT-OF-BAND into the receipt instead.
// The settings are re-filtered through the allowlist defensively — even a hand-built manifest cannot
// smuggle an identity/device/corpus key into a shareable DAG (the privacy boundary, Law L5).
export function portableManifest(manifest) {
  const m = manifest && typeof manifest === "object" ? manifest : {};
  const out = {};
  for (const [k, v] of Object.entries(m)) { if (k === "holo:device" || k === "prov:generatedAtTime") continue; out[k] = v; }
  const exp = out["holo:experience"] && typeof out["holo:experience"] === "object" ? { ...out["holo:experience"] } : {};
  const safe = {};
  for (const [k, v] of Object.entries(exp.settings || {})) { if (isExperienceKey(k)) safe[k] = v; }
  exp.settings = safe;
  out["holo:experience"] = exp;
  return out;
}

// verifiedBlockSource(blocks) — a getBlock for resolveIpfsPath that RE-DERIVES every block against its
// CID before serving it (Law L5). A tampered or absent block → null → restore refuses → clean default.
// This makes restore trustless even from a plain in-memory map (the SW path uses makeGetBlock, which
// verifies the same way against live gateways).
export function verifiedBlockSource(blocks) {
  const raw = blockSource(blocks);
  return async (cidStr) => {
    const b = await raw(cidStr);
    if (!b) return null;
    try { if (!(await holoIpfs.verifyBlock(cidStr, b))) return null; } catch { return null; }
    return b;
  };
}

// sealWorkspace({ manifest, transport, now }) — seal the portable manifest into an IPFS UnixFS DAG.
// Returns { rootCid, did, blocks, manifest: portable, receipt }. `transport` records HOW the bytes will
// travel (default null = not transported yet); `now` is injected (no Date in this module).
export async function sealWorkspace({ manifest, transport = null, now = null } = {}) {
  const portable = portableManifest(manifest);
  const bytes = te.encode(jcs(portable));                                   // the EXACT addressed bytes
  const { rootCid, did, blocks } = await sealSnapshot({ resources: [{ name: WORKSPACE_FILE, bytes }] });
  let byteSize = 0; for (const b of blocks.values()) byteSize += b.length;
  const receipt = {
    "@context": { holo: "https://hologram.os/ns#", prov: "http://www.w3.org/ns/prov#" },
    "@type": ["prov:Entity", "holo:WorkspaceSyncReceipt"],
    "holo:rootCid": rootCid,
    "holo:resumeToken": did,                       // the self-verifying did:holo:sha256 form
    "holo:transport": transport,                   // "file" | "pin" | "peer" | null
    "holo:directIPFS": false,                      // bytes are never claimed directly P2P-served (yet)
    "holo:blockCount": blocks.size,
    "holo:byteSize": byteSize,
    "prov:generatedAtTime": (typeof now === "function" ? now() : now),   // OUT-OF-BAND lineage
  };
  return { rootCid, did, blocks, manifest: portable, receipt };
}

// drainStream(stream) → Uint8Array — concat a ReadableStream of leaf chunks (resolveIpfsPath hands back
// a stream factory, never buffered bytes).
async function drainStream(stream) {
  const reader = stream.getReader();
  const chunks = []; let total = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; if (value && value.length) { chunks.push(value); total += value.length; } }
  const out = new Uint8Array(total); let off = 0; for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// restoreWorkspace(rootCid, getBlock) → { manifest } | null. Resolves the workspace.json leaf through
// the SAME trustless gateway resolver IPFS browsing uses, re-derives (Law L5 via verifiedBlockSource /
// makeGetBlock), and parses. Returns a TRANSPORT-HONEST null when the bytes are not reachable here
// (missing block / no transport) — never a crash, never a faked restore.
export async function restoreWorkspace(rootCid, getBlock) {
  if (!rootCid || typeof getBlock !== "function") return null;
  let res; try { res = await resolveIpfsPath(rootCid, WORKSPACE_FILE, getBlock); } catch { return null; }
  if (!res || res.kind !== "file" || typeof res.stream !== "function") return null;   // error / missing → honest null
  let bytes; try { bytes = await drainStream(res.stream()); } catch { return null; }
  let manifest; try { manifest = JSON.parse(td.decode(bytes)); } catch { return null; }
  if (!manifest || !Array.isArray(manifest["@type"]) || !manifest["@type"].includes("holo:SessionManifest")) return null;
  return { manifest };
}

// exportCar(rootCid, blocks) → Uint8Array — the single-file resume token. A standard IPFS CAR
// (Content-Addressable aRchive): root + every block, each parseable + re-derivable. "Email yourself
// your desktop." Fully serverless: the user carries the file.
export function exportCar(rootCid, blocks) {
  const arr = [...blocks].map(([cid, bytes]) => ({ cid, bytes }));
  return holoIpfs.encodeCar([rootCid], arr);
}

// importCar(carBytes) → { roots, blocks: Map<cidStr,Uint8Array> } — parse a CAR back into a block map
// ready for verifiedBlockSource → restoreWorkspace. Reuses the substrate's streaming CarParser.
export function importCar(carBytes) {
  const parser = new holoIpfs.CarParser();
  const got = parser.push(carBytes instanceof Uint8Array ? carBytes : new Uint8Array(carBytes));
  const blocks = new Map();
  for (const b of got) blocks.set(b.cid, b.bytes);
  return { roots: parser.roots || [], blocks };
}

// ════════════════════ SHARE A HOLOSPACE (isolated, app-carrying) ════════════════════
// The icon beside a holospace tab shares THAT ONE holospace — its world (every open window, INCLUDING each
// authored app's own bytes via the node's srcdoc/content, and each app's saved appState), its layout, and
// ONLY this holospace's widget board. It carries NO other holospace's data and NO operator/device/global
// settings — isolation by construction (the caller passes one tab + its board slice; there is nothing else
// to reach). So a share is selective, anchored to one holospace instance, and re-keyed nowhere.

const HOLOSPACE_FILE = "holospace.json";

// buildHolospaceManifest({title,addr,snap,board}) → the content-addressed holo:HolospaceShare body. No
// operator/device/timestamp (lineage is out-of-band; identity is the content) → the SAME holospace seals
// to the SAME CID anywhere, and the bundle leaks nothing about who/which-machine made it.
export function buildHolospaceManifest({ title, addr, snap, board } = {}) {
  const s = snap && typeof snap === "object" ? snap : {};
  return {
    "@context": ["https://www.w3.org/ns/did/v1", { holo: "https://hologram.os/ns#", prov: "http://www.w3.org/ns/prov#" }],
    "@type": ["prov:Entity", "holo:HolospaceShare"],
    "holo:v": 1,
    "holo:holospace": {
      title: String(title || "Shared holospace"),
      addr: String(addr || ""),
      snap: { world: Array.isArray(s.world) ? s.world : [], layout: s.layout || null, focusedId: s.focusedId || null },
      board: Array.isArray(board) ? board : [],
    },
  };
}

// analyzeHolospace(manifest) → an HONEST account of how each surface travels (so the UI never overclaims):
//   selfContained — authored apps whose bytes (srcdoc/content) are IN the bundle → run anywhere, no origin;
//   linkedApp     — a built-in/registered κ-app referenced by appId/appDid → runs on any Hologram (κ-route);
//   web           — a live web surface → reloads from its origin (or its commons CID if it was snapshotted).
export function analyzeHolospace(manifest) {
  const hs = manifest && manifest["holo:holospace"]; const world = (hs && hs.snap && hs.snap.world) || [];
  const r = { surfaces: 0, selfContained: 0, linkedApp: 0, web: 0, widgets: Array.isArray(hs && hs.board) ? hs.board.length : 0, withState: 0 };
  for (const n of world) {
    if (!n || n.kind !== "app") continue;
    r.surfaces++;
    if (n.appState != null) r.withState++;
    if (n.srcdoc || n.content) r.selfContained++;
    else if (n.browser || n.webAddr) r.web++;
    else r.linkedApp++;
  }
  return r;
}

// sealHolospace({manifest,transport,now}) → seal the holospace body into an IPFS κ-DAG (the SAME sealer the
// web commons uses), with an honest transport receipt + the surface analysis. Returns the shareable bundle.
export async function sealHolospace({ manifest, transport = null, now = null } = {}) {
  const bytes = te.encode(jcs(manifest));
  const { rootCid, did, blocks } = await sealSnapshot({ resources: [{ name: HOLOSPACE_FILE, bytes }] });
  let byteSize = 0; for (const b of blocks.values()) byteSize += b.length;
  const analysis = analyzeHolospace(manifest);
  const receipt = {
    "@context": { holo: "https://hologram.os/ns#", prov: "http://www.w3.org/ns/prov#" },
    "@type": ["prov:Entity", "holo:HolospaceShareReceipt"],
    "holo:rootCid": rootCid, "holo:resumeToken": did, "holo:transport": transport, "holo:directIPFS": false,
    "holo:blockCount": blocks.size, "holo:byteSize": byteSize, "holo:surfaces": analysis.surfaces,
    "holo:selfContainedApps": analysis.selfContained, "prov:generatedAtTime": (typeof now === "function" ? now() : now),
  };
  return { rootCid, did, blocks, manifest, receipt, analysis };
}

// restoreHolospace(rootCid, getBlock) → { manifest } | null. Resolves holospace.json through the SAME
// trustless resolver, re-derives every block (L5), and parses. Transport-honest null when unreachable.
export async function restoreHolospace(rootCid, getBlock) {
  if (!rootCid || typeof getBlock !== "function") return null;
  let res; try { res = await resolveIpfsPath(rootCid, HOLOSPACE_FILE, getBlock); } catch { return null; }
  if (!res || res.kind !== "file" || typeof res.stream !== "function") return null;
  let bytes; try { bytes = await drainStream(res.stream()); } catch { return null; }
  let manifest; try { manifest = JSON.parse(td.decode(bytes)); } catch { return null; }
  if (!manifest || !Array.isArray(manifest["@type"]) || !manifest["@type"].includes("holo:HolospaceShare")) return null;
  return { manifest };
}

// ════════════════════ the three destinations (transports) ════════════════════
// All three share the SAME sealed DAG + the SAME self-verifying root CID. They differ only in HOW the
// bytes travel — and each is honest about its reach (ADR-0105 transport-honesty).

// 1 · LOCAL DEVICE — the CAR file, carried by you (the download is done in the UI; exportCar is the bytes).

// 2 · SOVEREIGN CLOUD (IPFS) — publish the blocks into the unified κ-store / Cache commons so the EXISTING
// IPFS gateway resolves the root CID with NO network on this device, and any IPFS peer that pins the CID
// serves it elsewhere. Returns the number of blocks published. Browser/SW only (no-op in Node: no caches).
export async function publishToCloud(blocks) { return publishToKStore(blocks); }

// pinShareToCloud(rootCid, blocks, { endpoint, fetchImpl }) → { carCid, gateways } | null. The WORLDWIDE
// reach the link alone cannot give a big holospace: the WHOLE sealed CAR is POSTed to a pin endpoint that
// holds the IPFS credential server-side (never in the page), uploaded to public IPFS, and pinned. The CAR
// is opaque bytes there, so its content id (carCid) is deterministic and any public gateway serves it back
// byte-for-byte; openCarByCid re-imports + re-derives every block (L5) on the far device. Returns null when
// no endpoint is reachable (e.g. a static host) so the UI can fall back honestly. Also mirrors the blocks
// into the local commons so THIS device resolves instantly too.
export async function pinShareToCloud(rootCid, blocks, { endpoint = "/api/pin", fetchImpl } = {}) {
  try { await publishToKStore(blocks); } catch {}
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null); if (!f) return null;
  const car = exportCar(rootCid, blocks);
  let r; try { r = await f(endpoint, { method: "POST", headers: { "content-type": "application/vnd.ipld.car" }, body: car }); } catch { return null; }
  if (!r || !r.ok) return null;
  let j; try { j = await r.json(); } catch { return null; }
  if (!j || !j.carCid) return null;
  return { carCid: j.carCid, gateways: Array.isArray(j.gateways) && j.gateways.length ? j.gateways : IPFS_GATEWAYS };
}

// openCarByCid(carCid, { fetchImpl, gateways }) → { roots, blocks } | null. Pull the pinned CAR back from
// the first public gateway that serves it, parse it, and hand the verified block map to the importer. This
// is the open side of pinShareToCloud — bytes in, the SAME L5 re-derivation as a file the user carried.
// Pinata's gateway serves a freshly pinned CID instantly; lead with it, then the public trustless gateways
// (which catch up via the DHT) so a worldwide link opens fast on a cold device that never saw the pin list.
const SHARE_GATEWAYS = ["https://gateway.pinata.cloud", ...IPFS_GATEWAYS];
export async function openCarByCid(carCid, { fetchImpl, gateways = SHARE_GATEWAYS } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null); if (!f || !carCid) return null;
  for (const g of gateways) {
    try {
      const ac = (typeof AbortController !== "undefined") ? new AbortController() : null; const to = ac ? setTimeout(() => ac.abort(), 12000) : null;
      let r; try { r = await f(`${String(g).replace(/\/$/, "")}/ipfs/${carCid}`, ac ? { signal: ac.signal } : {}); } finally { if (to) clearTimeout(to); }
      if (!r || !r.ok) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      const got = importCar(bytes); if (got && got.roots && got.roots.length) return got;
    } catch {}
  }
  return null;
}

// cloudBlockSource({fetchImpl}) → a getBlock that resolves a CID from the local κ-store commons FIRST
// (O(1), no network — the published blocks), then trustless IPFS gateways, re-deriving every block (L5).
// discover:false + a short timeout so a miss fails fast → restoreWorkspace returns an honest null.
export function cloudBlockSource({ fetchImpl } = {}) {
  return makeGetBlock(fetchImpl || (typeof fetch !== "undefined" ? fetch : null), { discover: false, timeoutMs: 6000 });
}

// 3 · SHARE AS A LINK — encode the WHOLE CAR into a URL-fragment payload. The link IS the transport: it
// carries the bytes, is sovereign (a `#fragment` never reaches a server), and opens the exact workspace
// anywhere. encodeResumeLink → the payload; the UI composes `${origin}/shell.html#wks=${payload}`.
export function encodeResumeLink(rootCid, blocks) { return toB64url(b64encode(exportCar(rootCid, blocks))); }

// decodeResumeLink(input) → { roots, blocks } | null. Accepts a bare payload, a `wks=…` query/hash, or a
// full URL; pulls the payload, base64url-decodes, and parses the CAR. Null if there is no wks payload.
export function decodeResumeLink(input) {
  try {
    const s = String(input || "").trim();
    const m = s.match(/wks=([A-Za-z0-9\-_]+)/);
    const payload = m ? m[1] : (/^[A-Za-z0-9\-_]+$/.test(s) ? s : null);
    if (!payload) return null;
    return importCar(b64decode(fromB64url(payload)));
  } catch { return null; }
}

// looksLikeToken(s) — a resume token: a did:holo:sha256 or a CIDv1 (bafy…). Used by the UI to route a
// pasted string to the cloud resolver vs. the link decoder.
export function looksLikeToken(s) { return /^did:holo:sha256:[0-9a-f]{64}$/.test(String(s || "").trim()) || /^bafy[0-9a-z]+$/.test(String(s || "").trim()); }

export default { portableManifest, verifiedBlockSource, sealWorkspace, restoreWorkspace, buildHolospaceManifest, analyzeHolospace, sealHolospace, restoreHolospace, exportCar, importCar, publishToCloud, pinShareToCloud, openCarByCid, cloudBlockSource, encodeResumeLink, decodeResumeLink, looksLikeToken };
