// holo-dm.mjs - the DELIVERY layer for Holo Direct: how a sealed envelope (holo-seal.mjs) actually reaches someone.
// Fast path is P2P over the proven datachannel (holo-together-rtc) when both are online; this module adds the OFFLINE
// path via the blind mailbox (holo-mailbox connector). The mailbox is addressed by a `tag` both sides derive from the
// recipient's public box key - the store never learns the sender, the content, or the keys.

const _te = new TextEncoder();
const _subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || (typeof crypto !== "undefined" && crypto.subtle);
async function _sha256hex(s) { const h = await _subtle().digest("SHA-256", _te.encode(s)); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join(""); }

// the mailbox address for a recipient - derived from their PUBLIC box key, so the sender (who has it, to encrypt) and
// the recipient (who has their own) both compute the same opaque tag. Rotating per-conversation tags = a later refinement.
export async function mailboxTag(recipientBoxPub) { return _sha256hex("holo-mbox-v1|" + recipientBoxPub); }

function _base(mailboxBase) { return mailboxBase || (typeof location !== "undefined" ? location.origin : ""); }

// drop a sealed envelope for `recipientBoxPub` into the mailbox (recipient offline). `wire` = holo-seal.toWire(env).
export async function mailboxDrop(recipientBoxPub, wire, { mailboxBase = null } = {}) {
  const tag = await mailboxTag(recipientBoxPub);
  const r = await fetch(_base(mailboxBase) + "/mbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag, blob: wire }) });
  return r.json();
}
// pull every waiting blob for MY box key → [{ id, blob, ts }] (blob = the sealed wire; open with holo-seal.open).
export async function mailboxPull(myBoxPub, { mailboxBase = null } = {}) {
  const tag = await mailboxTag(myBoxPub);
  const r = await fetch(_base(mailboxBase) + "/mbox?tag=" + tag);
  const d = await r.json(); return (d && d.items) || [];
}
// acknowledge delivered blobs so the mailbox drops them (it holds nothing longer than it must).
export async function mailboxAck(myBoxPub, ids, { mailboxBase = null } = {}) {
  if (!ids || !ids.length) return { ok: true };
  const tag = await mailboxTag(myBoxPub);
  const r = await fetch(_base(mailboxBase) + "/mbox/ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag, ids }) });
  return r.json();
}

// convenience: pull + open + ack in one call. Returns [{ id, result }] where result is holo-seal.open()'s output.
export async function receiveOffline(myKeys, myBoxPub, openFn, { mailboxBase = null, ackOnOpen = true } = {}) {
  const items = await mailboxPull(myBoxPub, { mailboxBase });
  const out = [], acked = [];
  for (const it of items) {
    let env = null; try { env = JSON.parse(it.blob); } catch {}
    const result = env ? await openFn(env, { myKeys }) : { ok: false, error: "corrupt" };
    out.push({ id: it.id, ts: it.ts, result });
    if (ackOnOpen && result.ok) acked.push(it.id);
  }
  if (acked.length) await mailboxAck(myBoxPub, acked, { mailboxBase });
  return out;
}
