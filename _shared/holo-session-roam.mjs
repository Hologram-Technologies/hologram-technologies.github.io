// holo-session-roam.mjs — roam the SESSION MANIFEST (tabs + apps + order + route + deep-resume appState) to
// your OTHER devices, so "It's me" on device B resumes device A's exact live world. Sits on the relay leg
// (holo-relay-bus → window.HoloRelay) and reuses the session arc's own manifest — NOT a parallel store.
//
// WHY plaintext-over-E2E (not the vault blob): holo-session seals at rest under a key salted by the LOCAL
// deviceId, so device B literally cannot open device A's vault bytes. Roam therefore carries the PLAINTEXT
// manifest (holo-session.currentExperienceManifest) encrypted END-TO-END under the PAIR key (shared only by
// the linked devices). The relay stays content-blind (ciphertext only). On receipt: decrypt → L5 re-derive
// the κ and refuse a mismatch → reconcile by (seq, κ): newer ⇒ fast-forward+resume; identical ⇒ in-sync;
// older/equal-but-different ⇒ DIVERGED, keep BOTH (one quiet user choice), never clobber.
//
// Pure core: relay + cipher + manifest accessors injected (node-witnessable with a fake hub + real AES-GCM).

const te = new TextEncoder(), td = new TextDecoder();
const b64e = (u8) => { let s = ""; const a = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoaSafe(s); };
const b64d = (s) => { const r = atobSafe(s); const u = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) u[i] = r.charCodeAt(i); return u; };
const btoaSafe = (s) => (typeof btoa === "function") ? btoa(s) : Buffer.from(s, "binary").toString("base64");
const atobSafe = (s) => (typeof atob === "function") ? atob(s) : Buffer.from(s, "base64").toString("binary");

// makeSessionRoam({ relay, topic, cipher, kappaOf, getLocal, applyRemote, onDiverged, self })
//   relay     : { publish(topic,msg), subscribe(topic,cb)→unsub }   (window.HoloRelay)
//   cipher    : { seal(u8)->u8, open(u8)->u8|null }                  (E2E pair-key AES-GCM; holo-session.makeCipher)
//   kappaOf   : (body) -> string | Promise<string>                  (re-derive the manifest κ for L5 verify)
//   getLocal  : () -> { body, seq } | Promise<…> | null             (this device's current manifest + seq)
//   applyRemote(body)  : resume the remote world (applyBody)
//   onDiverged(body,info): a true fork — offer ONE choice, never auto-clobber
export function makeSessionRoam({ relay, topic, cipher, kappaOf, getLocal, applyRemote, onDiverged, self } = {}) {
  if (!relay || !topic || !cipher || typeof kappaOf !== "function" || typeof getLocal !== "function" || typeof applyRemote !== "function") {
    throw new Error("holo-session-roam: relay, topic, cipher, kappaOf, getLocal, applyRemote required");
  }
  const me = self || "self";
  let unsub = null;

  async function publish() {
    try {
      const L = await getLocal(); if (!L || !L.body) return;
      const kappa = await kappaOf(L.body);
      const blob = await cipher.seal(te.encode(JSON.stringify(L.body)));
      relay.publish(topic, { __sr: 1, from: me, head: { kappa, seq: L.seq | 0 }, blob: b64e(blob) });
    } catch (e) {}
  }

  async function onMsg(msg) {
    try {
      if (!msg || msg.__sr !== 1 || msg.from === me || !msg.head || !msg.blob) return;
      const ptb = await cipher.open(b64d(msg.blob)); if (!ptb) return;            // wrong pair key / tamper → ignore
      let body; try { body = JSON.parse(td.decode(ptb)); } catch (e) { return; }
      if (!body || (await kappaOf(body)) !== msg.head.kappa) return;              // L5: bytes must re-derive to the advertised κ
      const L = await getLocal();
      const has = !!(L && L.body);
      const localSeq = has ? (L.seq | 0) : -1;
      const localK = has ? await kappaOf(L.body) : null;
      if (localK && msg.head.kappa === localK) return;                           // in-sync: identical experience
      if ((msg.head.seq | 0) > localSeq) { await applyRemote(body); return; }    // fast-forward → resume their world
      try { onDiverged && onDiverged(body, { remote: msg.head, localSeq }); } catch (e) {}   // diverged → keep BOTH
    } catch (e) {}
  }

  const api = {
    self: me,
    publish,
    onMsg,
    start() { if (!unsub) unsub = relay.subscribe(topic, (m) => { onMsg(m); }); return api; },
    stop() { try { unsub && unsub(); } catch (e) {} unsub = null; },
  };
  return api;
}

export default { makeSessionRoam };
