// holo-dial-bridge.mjs — ADR-0113 (Holo Dial) S2: the cross-realm bridge. RTCPeerConnection exists only in
// the PAGE, but the resolver that serves byte-0 runs in the SERVICE WORKER. So the SW asks a controlled
// window client over a MessageChannel, and the page answers from its live dial mesh. The resolver re-derives
// every returned byte (Law L5), so the bridge TRANSPORTS, never trusts — a wrong byte from the page (or a
// page impersonator) is refused exactly like a hostile origin. This is what lights boot · heal · app-stream
// from peers without giving the SW a WebRTC stack it cannot have.
//
// SAFE: with no controlled client, a silent page, or a slow page, swAskMesh resolves null (after a bounded
// timeout) — so the SW source is behaviour-preserving and NEVER blocks navigation/boot.

const WANT = "holo-dial/want";

const toU8 = (b) => (b == null ? null : b instanceof Uint8Array ? b : new Uint8Array(b));

// swAskMesh({ clients, timeoutMs?, matchAll? }) → ask(κ) → bytes|null, for the SW source chain:
//   sources.push(bridgePeer("mesh", swAskMesh({ clients })))
// Posts the κ to the first controlled window client over a fresh MessageChannel; resolves the reply bytes,
// or null on no-client / timeout / empty reply. `matchAll` is injectable for the witness.
export function swAskMesh({ clients, timeoutMs = 8000, matchAll } = {}) {
  const list = matchAll || (() => clients.matchAll({ type: "window", includeUncontrolled: false }));
  return async (kappa) => {
    let wins = [];
    try { wins = (await list()) || []; } catch { wins = []; }
    const target = wins[0];
    if (!target) return null;                                     // no page to ask → null (boot never blocks)
    return await new Promise((resolve) => {
      const ch = new MessageChannel();
      let done = false;
      const fin = (v) => { if (done) return; done = true; clearTimeout(to); try { ch.port1.close(); } catch {} resolve(v); };
      const to = setTimeout(() => fin(null), timeoutMs);          // a silent/slow page can never wedge the SW
      ch.port1.onmessage = (e) => fin(toU8(e.data && e.data.bytes));
      try { target.postMessage({ t: WANT, kappa }, [ch.port2]); } catch { fin(null); }
    });
  };
}

// servePageMesh(dial, { addListener? }) — install the page-side answerer: on a WANT from the SW, fetch the κ
// from the local dial and reply over the message port. `addListener` is injectable for the witness; in the
// page it defaults to navigator.serviceWorker's message event.
export function servePageMesh(dial, { addListener } = {}) {
  const on = addListener || ((fn) => navigator.serviceWorker.addEventListener("message", fn));
  on(async (e) => {
    if (!e || !e.data || e.data.t !== WANT) return;
    const port = e.ports && e.ports[0];
    if (!port) return;
    let bytes = null;
    try { bytes = await dial.askMesh(e.data.kappa); } catch {}
    try { port.postMessage({ bytes }); } catch {}                 // {bytes:null} is a valid prompt "I don't have it"
  });
}

export { WANT };
export default { swAskMesh, servePageMesh, WANT };
