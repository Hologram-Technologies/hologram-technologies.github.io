// holo-openbank-roam.mjs — roam your BANK CONNECTIONS to your other paired devices, so a bank you linked
// on the phone (where the bank's SCA app lives) is already live on the desktop with NO second SCA.
//
// First principles:
//   • A connection is a κ-consent (holo-openbank). Roaming it is roaming sovereign state — so it rides the
//     SAME proven seam as the session manifest (holo-session-roam): E2E under the PAIR key, relay content-blind,
//     L5 re-derive the κ on receipt and refuse a mismatch. We DON'T fold bank state into the tab manifest
//     (different lifecycle, different altitude) — we run a second makeSessionRoam on its own topic.
//   • The ACCESS TOKEN roams too, E2E under the pair key — NOT the device-salted vault key. This is sound:
//     a PSD2 AIS token is bound to the CONSENT and the TPP, not to a device; the user's own paired devices
//     acting as the same TPP client under the same consent is legitimate. The bank-side SCA already happened
//     once on device A; device B inherits the consent and reads immediately. (State this honestly to the user.)
//   • Bank state is a GROW/SHRINK SET, not a single experience — so reconciliation is a MERGE, never a clobber.
//     Connect Monzo on A and Barclays on B ⇒ both devices end with both. A revoke travels as a TOMBSTONE so the
//     disconnect propagates and a peer never resurrects it. Merge is commutative; both the fast-forward and the
//     "diverged" path route to it, so devices converge regardless of message order.
//   • Convergence terminates: the roam κ is taken over the STATE ONLY (consents+tombstones), excluding the
//     local revision counter — so once two devices hold the same set their κ matches and the relay goes quiet.
//
// Pure core: store, relay, cipher injected (node-witnessable with an in-memory hub + real AES-GCM pair cipher).

import { makeSessionRoam } from "./holo-session-roam.mjs";
import { kappaOf as obKappa, verifyConsent } from "./holo-openbank.mjs";

const REV_KEY = "bank.roam.rev";     // device-local logical clock (monotonic per device)
const TOMB_KEY = "bank.roam.tomb";   // JSON array of revoked consent κs (tombstones)

export function makeBankRoam({ store, relay, topic = "holo-bank-roam", cipher, self } = {}) {
  if (!store || !relay || !cipher) throw new Error("holo-openbank-roam: store, relay, cipher required");

  const tombstones = async () => (await store.get(TOMB_KEY)) || [];
  const rev = async () => (await store.get(REV_KEY)) | 0;
  const bumpRev = async () => store.set(REV_KEY, (await rev()) + 1);

  // a deterministic snapshot of every connection on THIS device: {consent (κ-body incl id), token}, sorted by κ.
  async function snapshotConsents() {
    const keys = (await store.keys()).filter((k) => k.startsWith("consent:"));
    const out = [];
    for (const k of keys) {
      const consent = await store.get(k);
      const token = await store.get("token:" + consent.id);
      out.push({ consent, token });
    }
    return out.sort((a, b) => (a.consent.id < b.consent.id ? -1 : a.consent.id > b.consent.id ? 1 : 0));
  }

  async function buildBody() {
    return { "@type": "BankRoamState", consents: await snapshotConsents(), tombstones: (await tombstones()).slice().sort(), rev: await rev() };
  }
  // the roam κ — over STATE ONLY (rev excluded) so converged devices match and the relay falls silent.
  const roamKappa = (body) => obKappa({ "@type": body["@type"], consents: body.consents, tombstones: body.tombstones });
  const getLocal = async () => { const body = await buildBody(); return { body, seq: body.rev | 0 }; };

  // MERGE a remote snapshot into the local store. Commutative, tombstone-aware, L5-checked. Returns changed?.
  async function merge(remote) {
    if (!remote || remote["@type"] !== "BankRoamState") return false;
    let changed = false;
    const localTomb = new Set(await tombstones());
    const remoteTomb = new Set(remote.tombstones || []);
    // 1) absorb remote tombstones — delete locally, remember (so we never resurrect a revoked connection).
    for (const id of remoteTomb) {
      if (!localTomb.has(id)) { localTomb.add(id); changed = true; }
      if (await store.get("consent:" + id)) { await store.del("consent:" + id); await store.del("token:" + id); changed = true; }
    }
    // 2) add remote connections we don't have and nobody has revoked — but only if the κ re-derives (L5).
    for (const { consent, token } of remote.consents || []) {
      if (!consent || !verifyConsent(consent)) continue;            // tampered/forged κ ⇒ refuse
      const id = consent.id;
      if (localTomb.has(id) || remoteTomb.has(id)) continue;        // revoked somewhere ⇒ stays gone
      if (!(await store.get("consent:" + id))) {
        await store.set("consent:" + id, consent);
        await store.set("token:" + id, token);                     // the roamed token — no re-auth on this device
        changed = true;
      }
    }
    if (changed) { await store.set(TOMB_KEY, [...localTomb].sort()); await bumpRev(); }
    return changed;
  }

  // both paths merge then re-publish, so the set converges across devices regardless of who saw what first.
  const apply = async (body) => { if (await merge(body)) await roam.publish(); };
  const roam = makeSessionRoam({ relay, topic, cipher, kappaOf: roamKappa, getLocal, applyRemote: apply, onDiverged: apply, self });

  return {
    ...roam, getLocal, merge, buildBody, roamKappa,
    // the wallet calls this after a local grant/reconfirm so the new connection roams.
    async notifyChanged() { await bumpRev(); await roam.publish(); },
    // the wallet calls this after a local revoke so the disconnect roams as a tombstone.
    async revoked(id) {
      const t = new Set(await tombstones()); t.add(id); await store.set(TOMB_KEY, [...t].sort());
      await store.del("consent:" + id); await store.del("token:" + id);
      await this.notifyChanged();
    },
  };
}

// bankRoamOnChange(roam) — the wallet's one-line composer: pass it as makeOpenBank({ onChange }) and every
// local grant / reconfirm / revoke roams automatically. The ONLY non-obvious case is reconfirm: it mints a NEW
// consent κ and retires the old one, so we tombstone prevId (revoked() also re-publishes the fresh snapshot that
// already carries the new consent) — otherwise a peer would keep the stale duplicate with its now-dead token.
export function bankRoamOnChange(roam) {
  return async (ev) => {
    if (!ev || !ev.kind) return;
    if (ev.kind === "revoke") return roam.revoked(ev.id);
    if (ev.kind === "reconfirm" && ev.prevId) return roam.revoked(ev.prevId);   // retire old κ + publish new set
    return roam.notifyChanged();                                                 // grant (or reconfirm w/o prevId)
  };
}

export default makeBankRoam;
