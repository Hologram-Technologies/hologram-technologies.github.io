// holo-devtools-kappa-network.mjs — Stage A4 of the κ-CDP DevTools (ADR-0095): the Network panel, RE-INTERPRETED
// onto the substrate. Not HTTP — the κ-addressed streamed-object fetch/render timeline. Each "request" is a κ
// fetch, mapped to the CDP Network events the vendored frontend's Network panel renders, annotated with the κ,
// the axis (sha256/blake3), the CACHE-HIT (the O(1) κ-memo `Map.get` — Law L3), the L5 VERIFY badge (re-derive
// pass → 200; tampered → loadingFailed, RED), the render cost, and the stream PROVENANCE (prov:wasDerivedFrom).
// The requestId is a stable content-derived alias of the κ (L1). Pure → Node-witnessed; the live backend wires
// trackKappaFetches() into Network.enable → the cross-frame :delta channel.
//
//   kappaToNetworkEvents(fetch) -> CDP event[]      // requestWillBeSent → responseReceived → loadingFinished (or loadingFailed)
//   trackKappaFetches(emit) -> onFetch(fetch)        // the tap the backend installs

// a stable CDP requestId aliasing a κ (content-derived, L1) — DevTools needs a string id per request.
const reqId = (kappa, seq) => "k:" + String(kappa || "").slice(0, 16) + ":" + (seq || 0);

// fetch: { kappa, axis?, bytes?, cacheHit?, verified?, provenance?:[κ…], renderMs?, ts?, seq? }
export function kappaToNetworkEvents(f = {}) {
  const id = reqId(f.kappa, f.seq), axis = f.axis || "sha256";
  const url = "holo://" + axis + "/" + f.kappa, ts = f.ts || 0;
  const events = [{
    method: "Network.requestWillBeSent",
    params: {
      requestId: id, loaderId: "holo", documentURL: url, timestamp: ts, wallTime: ts,
      request: { url, method: "GET", headers: {}, initialPriority: "High", referrerPolicy: "no-referrer" },
      type: "Other", initiator: { type: "other" },
      holo: { kappa: f.kappa, axis, provenance: f.provenance || [] },   // κ-native annotations (surfaced in the row)
    },
  }];
  if (f.verified === false) {                                            // a tampered κ → RED, no response
    events.push({ method: "Network.loadingFailed", params: { requestId: id, timestamp: ts, type: "Other", canceled: false, errorText: "L5 REFUSE — content does not re-derive to its κ", holo: { kappa: f.kappa, verified: false } } });
    return events;
  }
  const len = f.cacheHit ? 0 : (f.bytes || 0);                          // cache-hit = the O(1) κ-memo (L3) → 0 bytes on the wire
  events.push({
    method: "Network.responseReceived",
    params: {
      requestId: id, loaderId: "holo", timestamp: ts, type: "Other",
      response: {
        url, status: 200, statusText: "OK", mimeType: "application/octet-stream",
        headers: { "x-holo-kappa": f.kappa, "x-holo-axis": axis, "x-holo-verify": "L5-pass", "x-holo-cache": f.cacheHit ? "hit" : "miss", "x-holo-prov": (f.provenance || []).join(",") },
        encodedDataLength: len, fromDiskCache: !!f.cacheHit, fromServiceWorker: false,
        timing: { requestTime: ts, receiveHeadersEnd: f.cacheHit ? 0 : (f.renderMs || 0) },
      },
      holo: { kappa: f.kappa, verified: true, cacheHit: !!f.cacheHit, renderMs: f.renderMs || 0 },
    },
  });
  events.push({ method: "Network.loadingFinished", params: { requestId: id, timestamp: ts, encodedDataLength: len, holo: { kappa: f.kappa } } });
  return events;
}

// the tap the live backend installs on Network.enable: each κ-fetch → its events, emitted on the :delta channel.
export function trackKappaFetches(emit) {
  let seq = 0;
  return function onFetch(f) {
    const evs = kappaToNetworkEvents(Object.assign({ seq: seq++ }, f));
    for (const e of evs) { try { emit(e); } catch (x) {} }
    return evs;
  };
}

export default { kappaToNetworkEvents, trackKappaFetches };
