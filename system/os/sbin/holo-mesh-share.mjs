// holo-mesh-share.mjs — the MANUAL/SHARE rung: a sealed page's share CARRIES the WebRTC rendezvous, so
// "share this page" IS "offer a friend a peer connection to fetch it from you." No server, no store gatekeeper
// — one string out (the share link, with rootCid + offer), one string back (the answer). On connect, the
// κ-block exchange (holo-mesh-blocks, L5) runs over the data channel; the joiner fetches the snapshot from the
// host AND caches every block into its own κ-store, so it then renders the page from its OWN commons (and can
// re-serve it onward — the commons spreads). encode/decode are pure (Node-verifiable); host/join are browser.

import { createOfferer, createAnswerer } from "./holo-webrtc-link.mjs";
import { createMeshBlocks, dataChannelWire } from "./holo-mesh-blocks.mjs";
import { blockSource, publishToKStore } from "./holo-web-snapshot.mjs";
import { resolveIpfsPath } from "./holo-ipfs-gateway.mjs";

const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="))));

// the share token carries rootCid + the WebRTC offer; the answer token carries the WebRTC answer.
export const encodeOffer = ({ rootCid, offer }) => b64u(JSON.stringify({ v: 1, c: rootCid, o: offer }));
export const decodeOffer = (tok) => { const j = JSON.parse(unb64u(tok)); return { rootCid: j.c, offer: j.o }; };
export const encodeAnswer = (answer) => b64u(JSON.stringify({ v: 1, a: answer }));
export const decodeAnswer = (tok) => JSON.parse(unb64u(tok)).a;
export const shareLink = (token, base = "") => `${base}#holo-peer=${token}`;                 // the rendezvous rides the fragment
export const tokenFromLink = (href) => { const m = String(href).match(/[#&]holo-peer=([^&]+)/); return m ? m[1] : null; };

// host(snapshot,{onConnected}) → { token, link, accept(answerTok), close } — A offers + serves its blocks P2P.
export async function host({ rootCid, blocks }, { onConnected, base = "" } = {}) {
  const link = await createOfferer({ onChannel: (dc) => { createMeshBlocks(dataChannelWire(dc), { getLocalBlock: blockSource(blocks) }); onConnected && onConnected(); } });
  const token = encodeOffer({ rootCid, offer: link.offer });
  return { rootCid, token, link: shareLink(token, base), accept: (answerTok) => link.accept(decodeAnswer(answerTok)), close: link.close };
}

// join(token,{onConnected,cache}) → { rootCid, answerToken, fetch(path), close } — B answers; on connect,
// fetches A's snapshot over the mesh (re-derived, L5) and CACHES each block locally so it renders from its own
// commons and can re-serve it. `fetch("")` warms the whole DAG → then open /ipfs/<rootCid>/ to render.
export async function join(token, { onConnected, cache = true } = {}) {
  const { rootCid, offer } = decodeOffer(token);
  let resolveMesh; const meshReady = new Promise((r) => (resolveMesh = r));
  const ans = await createAnswerer(offer, { onChannel: (dc) => { const mesh = createMeshBlocks(dataChannelWire(dc)); onConnected && onConnected(); resolveMesh(mesh); } });
  // getBlock = pull from the host over the mesh, then cache into our κ-store (so we render + re-serve)
  const meshGetBlock = async (cidStr) => { const mesh = await meshReady; const b = await mesh.wantBlock(cidStr); if (b && cache) { try { await publishToKStore(new Map([[cidStr, b]])); } catch {} } return b; };
  return {
    rootCid, answerToken: encodeAnswer(ans.answer), close: ans.close,
    fetch: (path = "") => resolveIpfsPath(rootCid, path, meshGetBlock),
  };
}

export default { encodeOffer, decodeOffer, encodeAnswer, decodeAnswer, shareLink, tokenFromLink, host, join };
