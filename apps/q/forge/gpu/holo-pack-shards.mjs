// holo-pack-shards.mjs — present a sharded pack as ONE logical file. The single q-models.holo is delivered in <2 GiB
// parts (GitHub's per-asset cap); this stitches them behind a normal rangeReader(off,len) so openModelPack / every
// faculty loader sees one contiguous file at one address. Sharding is pure transport — never visible above here.
//
//   spanReader(parts, readPart) → async (off,len) => Uint8Array     // parts: [{start,len}]; readPart(i,off,len)->bytes
//   makeShardedRangeReader({ parts, fetchPart }) → rangeReader      // production: fetchPart(i,off,len) HTTP-Ranges part i
//
// A single read may straddle a part boundary; spanReader splits it across parts and concatenates. Production wires
// fetchPart to Range-GET part i from the release (κ-route/OPFS heal underneath), so a body that crosses a boundary
// is fetched from two assets transparently and L5-verified as one body by openHoloStream.

// stitch a logical [off,off+len) read across byte-contiguous parts. readPart(i, withinOff, n) returns ≥ n bytes.
export function spanReader(parts, readPart) {
  const total = parts.reduce((mx, p) => Math.max(mx, p.start + p.len), 0);
  return async (off, len) => {
    if (off < 0 || off + len > total) throw new Error(`span read out of range: [${off},${off + len}) of ${total}`);
    const out = new Uint8Array(len);
    let done = 0;
    while (done < len) {
      const g = off + done;
      const i = parts.findIndex((p) => g >= p.start && g < p.start + p.len);
      if (i < 0) throw new Error("no part covers offset " + g);
      const p = parts[i], within = g - p.start, n = Math.min(len - done, p.len - within);
      const chunk = await readPart(i, within, n);
      out.set(chunk.length > n ? chunk.subarray(0, n) : chunk, done);
      done += n;
    }
    return out;
  };
}

// production reader: parts from a manifest, each fetched via HTTP Range from its release asset URL (with κ-route/OPFS
// healing the bytes underneath). fetchPart(i, off, len) -> Promise<Uint8Array>.
export function makeShardedRangeReader({ parts, fetchPart }) {
  return spanReader(parts, (i, off, len) => fetchPart(i, off, len));
}

// ── HTTP transport (production) ──────────────────────────────────────────────────────────────────
// one URL's Range read, handling a 206 (partial — the normal GitHub-release case) AND a server that ignores Range
// and returns 200-whole (defensive: cache the whole body once, slice locally thereafter). fetchImpl is injectable so
// the path is witnessed in Node with a mock fetch serving local shards.
export function makeRangeFetcher({ fetchImpl } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) throw new Error("makeRangeFetcher: no fetch available");
  const whole = new Map();                              // url → full body when the server ignored Range
  return async (url, off, len) => {
    const w = whole.get(url); if (w) return w.subarray(off, off + len);
    let r; try { r = await f(url, { headers: { Range: `bytes=${off}-${off + len - 1}` } }); } catch (e) { r = null; }
    if (!r || !r.ok) throw new Error("range fetch failed (" + (r ? r.status : "network") + "): " + url);
    const u = new Uint8Array(await r.arrayBuffer());
    if (r.status === 206) return u;                      // exact slice
    if (u.length > len) { whole.set(url, u); return u.subarray(off, off + len); }   // 200-whole → cache + slice
    return u;
  };
}

// open the unified pack over its SHARDS from a release: fetch the parts manifest, build a spanning rangeReader that
// Range-GETs each part. The result's rangeReader hands straight to openModelPack — the OS sees one file, one address.
// peerResolve(part) -> Promise<Uint8Array|null>: the COMMONS source. A part is content-addressed
// (part.sha256), so it can be served by ANY peer and is hash-trustless; openHoloStream L5-verifies the
// assembled body downstream regardless, so a wrong peer byte is caught (the commons is a latency choice,
// never trust — same contract as the CDN/IPFS sources). null/throw → fall through to CDN/origin.
export async function openShardedPack({ partsUrl, base, fetchImpl, gateway, peerResolve } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) throw new Error("openShardedPack: no fetch available");
  if (!partsUrl) throw new Error("openShardedPack needs partsUrl");
  // the manifest ships SAME-ORIGIN (tiny → in dist), so this fetch never hits a CORS wall.
  const mr = await f(partsUrl); if (!mr || !mr.ok) throw new Error("parts manifest fetch failed (" + (mr ? mr.status : "network") + "): " + partsUrl);
  const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(await mr.arrayBuffer())));
  const range = makeRangeFetcher({ fetchImpl: f });
  // SERVERLESS delivery, in priority order — all CORS + Range, no app server:
  //  1. CDN over a GitHub repo (manifest.cdnBase, jsDelivr): {cdnBase}/{name}. Global immutable CDN, fast any-device.
  //     manifest.rawBase (raw.githubusercontent) is the same-repo fallback. Override via window.HOLO_PACK_CDN.
  //  2. IPFS gateway by CID (manifest.gateway + per-part cid): {gateway}/ipfs/{cid}. Override via HOLO_PACK_GATEWAY.
  //  3. a co-located mirror by part name ({base}/{name}).
  // Every block is L5-verified regardless of source (a source is a latency choice, never trust).
  const G = (typeof globalThis !== "undefined") ? globalThis : {};
  const cdn = (G.HOLO_PACK_CDN || manifest.cdnBase || "").replace(/\/+$/, "");
  const raw = (manifest.rawBase || "").replace(/\/+$/, "");
  const gw = (gateway || G.HOLO_PACK_GATEWAY || manifest.gateway || "").replace(/\/+$/, "");
  const baseUrl = base || partsUrl.replace(/[^/]*$/, "");
  const primary = (p) => cdn ? `${cdn}/${p.name}` : (gw && p.cid) ? `${gw}/ipfs/${p.cid}` : (baseUrl + p.name);
  const peerWhole = new Map();                            // i → whole verified part from a peer (null = peer miss)
  const fabricOn = () => !(typeof globalThis !== "undefined" && globalThis.HoloFabric && globalThis.HoloFabric.enabled === false);   // ONE kill switch
  const fetchPart = async (i, off, len) => {
    const p = manifest.parts[i];
    if (peerResolve && fabricOn()) {                      // COMMONS first: a peer that already has this part (by κ)
      let whole = peerWhole.get(i);
      if (whole === undefined) { try { whole = (await peerResolve(p)) || null; } catch { whole = null; } peerWhole.set(i, whole); }
      if (whole && whole.length >= p.len) return whole.subarray(off, off + len);   // 0 bytes from origin
    }
    try { return await range(primary(p), off, len); }
    catch (e) { if (cdn && raw) return range(`${raw}/${p.name}`, off, len); throw e; }   // jsDelivr miss → raw.githubusercontent
  };
  return { manifest, rangeReader: makeShardedRangeReader({ parts: manifest.parts, fetchPart }) };
}

// THE one call the OS makes: open the unified pack, preferring the monolithic file when reachable (dev / FORGE local
// mount — a single <2 GiB-cap-free file), else the sharded release. Returns the OPENED pack (openModelPack shape) +
// how it was reached. monolithicUrl is probed with one tiny Range read of the "HOLO" magic; any failure → shards.
export async function openQPack({ monolithicUrl, partsUrl, base, fetchImpl, openModelPack, gateway, peerResolve } = {}) {
  if (!openModelPack) ({ openModelPack } = await import("./holo-model-pack.mjs"));
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (monolithicUrl && f) {
    try {
      const range = makeRangeFetcher({ fetchImpl: f });
      // time-box the probe: an absent 4.6GB monolithic can trigger host-side κ-healing that hangs instead of 404ing.
      // A real same-origin monolithic (dev) answers a 4-byte Range in well under a second; anything slower → shards.
      const magic = await Promise.race([range(monolithicUrl, 0, 4), new Promise((_, r) => setTimeout(() => r(new Error("monolithic probe timeout")), 2500))]);
      if (magic && magic.length >= 4 && magic[0] === 0x48 && magic[1] === 0x4f) {   // "HO" — the monolithic file is served whole (dev / same-origin)
        const pack = await openModelPack({ rangeReader: (off, len) => range(monolithicUrl, off, len) });
        return { via: "monolithic", pack };
      }
    } catch { /* fall through to shards */ }
  }
  const { manifest, rangeReader } = await openShardedPack({ partsUrl, base, fetchImpl: f, gateway, peerResolve });
  const pack = await openModelPack({ rangeReader });
  return { via: "sharded", manifest, pack };
}

export default { spanReader, makeShardedRangeReader, makeRangeFetcher, openShardedPack, openQPack };
