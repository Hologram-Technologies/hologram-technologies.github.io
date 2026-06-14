// holo-omni.mjs — ONE entry that resolves ANY address into a verified κ-node (ADR-026). The omni search
// bar / address bar / agent hands this a string and gets back self-verifying bytes plus the canonical κ,
// no matter which corner of the object universe the string names:
//
//   https://… / http://…      → IMPORT the open-web object: fetch, DERIVE its κ (it becomes substrate).
//   did:holo:sha256:<hex>      → resolve by content address: cache · IPFS · open-web edges, re-derived.
//   sha256:<hex>               → same (bare κ).
//   ipfs://<cid> · /ipfs/<cid> → fetch the block by its ORIGINAL CID (codec preserved), verify, κ = cidToDid.
//   <bare CID>  (baf… / Qm…)   → same as ipfs://.
//   holo://<cid|axis/hex>      → the holo alias of a CID, or a κ on either axis.
//
// Every path ends at the SAME re-derivation gate (Law L5): the bytes are admitted only after their hash
// is recomputed and matched to the address. So the source is a latency choice, never a trust one, and the
// four namespaces collapse into one content-addressed space (Law L2: one canonical hash, no per-surface
// drift). Discovery (Delegated Routing V1) is layered in so a bare CID is not hostage to the static
// gateway set. Pure + isomorphic (browser & Node fetch); no top-level effects, no required origin (Law L1).

import { reDerive, hexOf } from "./holo-resolver.mjs";
import { importObject, webSource } from "./holo-web.mjs";
import { ipfsPeer, kappaToCid, IPFS_GATEWAYS } from "./holo-peers.mjs";
import { discoverGateways } from "./holo-routing.mjs";
import * as holoIpfs from "../usr/lib/holo/holo-ipfs.js";

// parseRef(ref) → { kind, … } — classify an address WITHOUT touching the network. kinds:
//   "web"   { url }
//   "kappa" { axis, hex, kappa }
//   "cid"   { cidStr }                 (original CID string, codec preserved)
//   "unknown" { raw }
export function parseRef(ref) {
  const s = String(ref || "").trim();
  if (!s) return { kind: "unknown", raw: s };
  if (/^https?:\/\//i.test(s)) return { kind: "web", url: s };
  if (/^did:holo:(sha256|blake3):[0-9a-f]{64}$/i.test(s)) {
    const [, , axis, hex] = s.split(":");
    return { kind: "kappa", axis: axis.toLowerCase(), hex: hex.toLowerCase(), kappa: s };
  }
  if (/^sha256:[0-9a-f]{64}$/i.test(s)) {
    const hex = s.split(":")[1].toLowerCase();
    return { kind: "kappa", axis: "sha256", hex, kappa: "did:holo:sha256:" + hex };
  }
  if (/^holo:\/\//i.test(s)) {
    const rest = s.replace(/^holo:\/\//i, "");
    const m = rest.match(/^(sha256|blake3)\/([0-9a-f]{64})$/i);
    if (m) return { kind: "kappa", axis: m[1].toLowerCase(), hex: m[2].toLowerCase(), kappa: `did:holo:${m[1].toLowerCase()}:${m[2].toLowerCase()}` };
    try { return { kind: "cid", cidStr: holoIpfs.cidToString(holoIpfs.parseCID(rest)) }; } catch { return { kind: "unknown", raw: s }; }
  }
  if (/^ipfs:\/\//i.test(s) || /^\/ipfs\//i.test(s)) {
    try { return { kind: "cid", cidStr: holoIpfs.cidToString(holoIpfs.parseCID(s)) }; } catch { return { kind: "unknown", raw: s }; }
  }
  // bare CID: baf… (CIDv1 multibase) or Qm… (CIDv0). parseCID throws on non-CID text → unknown.
  try { const cid = holoIpfs.parseCID(s); return { kind: "cid", cidStr: holoIpfs.cidToString(cid) }; } catch { return { kind: "unknown", raw: s }; }
}

// resolveWithProvenance(hex, sources) — like resolveByKappa, but reports WHICH source served the bytes
// (for the address bar's "via" badge). Tries each in order; the first κ-verified copy wins (Law L5).
async function resolveWithProvenance(hex, sources) {
  for (const src of sources) {
    let bytes; try { bytes = await src("did:holo:sha256:" + hex); } catch { bytes = null; }
    if (!bytes) continue;
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if ((await reDerive(u)) !== hex) continue;
    return { bytes: u, via: src.peer || "source" };
  }
  return null;
}

// fetchBlock(cidStr, cfg) → Uint8Array | null — pull a CID's raw block from any of `gateways`, accept the
// FIRST that verifies against the CID multihash (codec preserved, unlike κ→raw-CID). Gateway never trusted.
async function fetchBlock(cidStr, { gateways, fetchImpl } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f || !cidStr || !gateways || !gateways.length) return null;
  const tasks = gateways.map(async (g) => {
    const r = await f(`${String(g).replace(/\/$/, "")}/ipfs/${cidStr}?format=raw`, { headers: { accept: "application/vnd.ipld.raw" } });
    if (!r || !r.ok) throw new Error("gateway " + (r && r.status));
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (!(await holoIpfs.verifyBlock(cidStr, bytes))) throw new Error("cid mismatch — gateway not trusted");
    return bytes;
  });
  try { return await Promise.any(tasks); } catch { return null; }
}

// resolveAny(ref, cfg) → result — the omni resolve. Returns:
//   { ok:true,  kind, kappa, cid?, bytes, via, ms }   on success (bytes are self-verifying)
//   { ok:false, kind, reason, ms }                    when no source served a verified copy
// cfg: { gateways=IPFS_GATEWAYS, iris=null, fetchImpl, discover=true, timeoutMs=10000, cache=null }.
//   iris(κ)→[https]  follow an object's W3C DID Core alsoKnownAs edges (open-web source).
//   cache(hex)→bytes local κ-store hit (offline-first); checked first when provided.
//   discover         on an IPFS miss, ask Delegated Routing V1 for more gateways and retry.
export async function resolveAny(ref, cfg = {}) {
  const { gateways = IPFS_GATEWAYS, iris = null, fetchImpl, discover = true, timeoutMs = 10000, cache = null, assemble = false } = cfg;
  const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
  const ms = () => (t0 ? Math.round(((performance.now ? performance.now() : 0) - t0)) : 0);
  const r = parseRef(ref);

  const run = async () => {
    if (r.kind === "web") {
      const got = await importObject(r.url, { fetchImpl });
      if (!got) return { ok: false, kind: "web", reason: "unreachable or CORS-blocked: " + r.url };
      return { ok: true, kind: "web", kappa: got.kappa, cid: cidStrOf(got.kappa), bytes: got.bytes, via: "web" };
    }

    if (r.kind === "kappa") {
      if (r.axis !== "sha256")
        return { ok: false, kind: "kappa", reason: `${r.axis} axis resolves on the substrate/mesh, not the open web (this build verifies sha256)`, kappa: r.kappa };
      const local = cache ? cacheSrc(cache) : null;
      const sources = [local, ipfsPeer({ gateways, ipfs: holoIpfs, fetchImpl }), webSource({ iris, fetchImpl })].filter(Boolean);
      let hit = await resolveWithProvenance(r.hex, sources);
      if (!hit && discover) {
        const extra = await discoverGateways(kappaToCid(r.kappa, holoIpfs), { fetchImpl });
        if (extra.length) hit = await resolveWithProvenance(r.hex, [ipfsPeer({ gateways: extra, ipfs: holoIpfs, fetchImpl })]);
      }
      if (!hit) return { ok: false, kind: "kappa", reason: "no source served a κ-verified copy", kappa: r.kappa };
      return { ok: true, kind: "kappa", kappa: r.kappa, cid: cidStrOf(r.kappa), bytes: hit.bytes, via: hit.via };
    }

    if (r.kind === "cid") {
      let usedDiscovery = false;
      // getBlock(cid) → κ-verified block bytes from the static gateways, falling back to Delegated-Routing
      // discovery. Reused as the leaf-fetcher for DAG assembly so every block in the tree is verified.
      const getBlock = async (cidStr) => {
        let b = await fetchBlock(cidStr, { gateways, fetchImpl });
        if (!b && discover) {
          const extra = await discoverGateways(cidStr, { fetchImpl });
          if (extra.length) { b = await fetchBlock(cidStr, { gateways: extra, fetchImpl }); if (b) usedDiscovery = true; }
        }
        return b;
      };
      const rootBytes = await getBlock(r.cidStr);
      if (!rootBytes) return { ok: false, kind: "cid", reason: "no gateway served the block for " + r.cidStr };
      const res = { ok: true, kind: "cid", kappa: holoIpfs.cidToDid(r.cidStr), cid: r.cidStr, bytes: rootBytes, via: usedDiscovery ? "ipfs:discovered" : "ipfs" };
      if (assemble) res.content = await assembleUnixFs(r.cidStr, getBlock);   // walk the UnixFS DAG → file bytes / dir entries
      return res;
    }

    return { ok: false, kind: "unknown", reason: "unrecognized address: " + r.raw };
  };

  const out = await Promise.race([
    run(),
    new Promise((res) => setTimeout(() => res({ ok: false, kind: r.kind, reason: `timed out after ${timeoutMs}ms`, kappa: r.kappa }), timeoutMs)),
  ]);
  return { ...out, ms: ms() };
}

// cidStrOf(κ) — the CIDv1(raw, sha2-256) string for a sha256 κ; null for other axes.
function cidStrOf(kappa) {
  try { return holoIpfs.cidToString(holoIpfs.makeCIDv1(holoIpfs.CODEC.RAW, holoIpfs.HASH.SHA2_256, holoIpfs.fromHex(hexOf(kappa))), "base32"); }
  catch { return null; }
}
// cacheSrc(get) — wrap a local κ-store getter as a labelled source for resolveWithProvenance.
function cacheSrc(get) { const s = async (k) => (await get(hexOf(k))) || null; s.peer = "cache"; return s; }

// concatBytes(arr) — join Uint8Arrays into one.
function concatBytes(arr) { let n = 0; for (const a of arr) n += a.length; const o = new Uint8Array(n); let i = 0; for (const a of arr) { o.set(a, i); i += a.length; } return o; }

// assembleUnixFs(rootCid, getBlock, lim) → { type:"file"|"directory"|"raw"|"error", bytes?|entries?|reason }.
// Walks the IPLD UnixFS/dag-pb DAG: a leaf raw block IS the bytes; a dag-pb File concatenates its child
// blocks (chunked files) or its inline data; a Directory lists its named links. getBlock re-derives every
// block against its own CID, so the assembled file is Merkle-trustworthy — the root CID commits to the
// whole tree, which is Law L5 across the DAG, not just one block. Bounded by maxBytes/maxNodes.
export async function assembleUnixFs(rootCid, getBlock, lim = {}) {
  const maxBytes = lim.maxBytes || 16 * 1024 * 1024, maxNodes = lim.maxNodes || 6000;
  const st = { nodes: 0, bytes: 0 };
  const { parseCID, cidToString, decodeDagPb, decodeUnixFs, UNIXFS, CODEC } = holoIpfs;
  async function walk(cidStr) {
    if (++st.nodes > maxNodes) throw new Error("DAG exceeds " + maxNodes + " nodes");
    const cid = parseCID(cidStr);
    const block = await getBlock(cidToString(cid));
    if (!block) throw new Error("missing block " + String(cidStr).slice(0, 16) + "…");
    if (cid.codec === CODEC.RAW) { st.bytes += block.length; return { type: "file", bytes: block }; }       // raw leaf
    if (cid.codec !== CODEC.DAG_PB) return { type: "raw", bytes: block };                                   // dag-cbor/json — hand back the block
    const node = decodeDagPb(block);
    const u = node.data ? decodeUnixFs(node.data) : null;
    if (u && u.type === UNIXFS.Directory)
      return { type: "directory", entries: node.links.map((l) => ({ name: l.name, cid: cidToString(l.cid), size: l.tsize })) };
    if (!node.links.length) { const b = (u && u.data) || new Uint8Array(0); st.bytes += b.length; return { type: "file", bytes: b }; }
    const parts = [];
    if (u && u.data && u.data.length) parts.push(u.data);                                                   // inline head (rare)
    for (const l of node.links) {                                                                          // chunked file → fetch + concat each child
      const child = await walk(cidToString(l.cid));
      if (child.type === "directory") throw new Error("file links to a directory");
      parts.push(child.bytes); st.bytes += child.bytes.length;
      if (st.bytes > maxBytes) throw new Error("file exceeds " + (maxBytes >> 20) + "MB");
    }
    return { type: "file", bytes: concatBytes(parts) };
  }
  try { return await walk(rootCid); } catch (e) { return { type: "error", reason: (e && e.message) || String(e) }; }
}
