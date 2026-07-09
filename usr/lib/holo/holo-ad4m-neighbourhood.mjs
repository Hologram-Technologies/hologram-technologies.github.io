// holo-ad4m-neighbourhood.mjs — AD4M's NEIGHBOURHOOD on the κ substrate: a shared Perspective that many
// agents read and write, with NO server in the middle. Each agent keeps their OWN Perspective (a holo-strand
// of their own signed Links — append-only, longest-valid-wins per author). A Neighbourhood is the VERIFIED
// UNION of all members' strands: I broadcast my strand, I receive yours, and the shared graph is the merge.
//
// This mirrors holo-zone-net's want/have protocol exactly — gather candidates over a dumb, untrusted channel,
// then ADOPT only what re-derives end-to-end AND is signed by the claimed author (Law L5 + authorship). A
// chain tampered in flight, or a peer trying to inject Links as someone else, is refused: the answer is the
// math, never the messenger. Append-only ⇒ a peer with a STALE copy can never override an author's latest.
//
// AD4M's LinkLanguage/perspective-diff-sync is exactly this merge; we reuse the strand's verify-before-adopt
// (no new crypto, no consensus, no DHT). Node-testable over an injected loopback channel; the browser binds
// it to a BroadcastChannel (separate tabs/devices are real peers), like holo-zone-net.

import { verifyEntry } from "./holo-strand.mjs";
import { linksFromEntries } from "./holo-ad4m.mjs";

// verifyAuthoredChain(entries, author) — a received strand is trustworthy only if (Law L5 over the sequence):
//   • every entry re-derives + (if signed) its signature binds to its committed operator κ, AND
//   • seq is 0..n with each prev = the prior entry's κ (the hash-link), AND
//   • every entry is authored by EXACTLY `author` (a peer cannot speak for another agent).
// An unsigned chain is accepted only when no author is asserted (anonymous contribution).
export async function verifyAuthoredChain(entries, author = null) {
  if (!Array.isArray(entries)) return { ok: false, why: "not-a-chain" };
  let prev = null;
  for (let i = 0; i < entries.length; i++) {
    const rec = entries[i];
    const v = await verifyEntry(rec);
    if (!v.ok) return { ok: false, why: v.why, brokeAt: i };
    if (rec["holstr:seq"] !== i) return { ok: false, why: "seq-out-of-order", brokeAt: i };
    if (rec["holstr:prev"] !== prev) return { ok: false, why: "prev-link-broken", brokeAt: i };
    if (author && (rec["holstr:op"] || null) !== author) return { ok: false, why: "author-mismatch", brokeAt: i };
    prev = rec.id;
  }
  return { ok: true, length: entries.length, head: prev };
}

// makeNeighbourhood({ perspective, me, post, self }) → a live shared Perspective.
//   perspective : THIS agent's own Perspective (from makeAd4m().perspective(...)). Required.
//   me          : this agent's κ (author of the local strand). Required for authored merge.
//   post        : (msg) → broadcast to peers (the transport). Absent ⇒ offline (local-only).
//   self        : a transport id so own echoes are ignored.
export function makeNeighbourhood({ perspective, me, post = () => {}, self = "peer" } = {}) {
  if (!perspective) throw new Error("a Neighbourhood needs a local perspective");
  const members = new Map();                 // authorκ → that author's VERIFIED entry array (their strand)

  const myEntries = () => perspective.raw.replay({});

  // publish() — advertise my whole strand. Peers verify it before adopting (the channel is untrusted).
  function publish() {
    try { post({ t: "ad4m:links", author: me, entries: myEntries(), from: self }); } catch (e) {}
  }

  // onMessage — the want/have protocol. A "want" → answer with my strand. A "links" advertisement → adopt it
  // under its author IFF it verifies as that author's chain AND is longer than what I already hold (newest).
  async function onMessage(msg) {
    if (!msg || msg.from === self) return;
    if (msg.t === "ad4m:want") { publish(); return; }
    if (msg.t === "ad4m:links") {
      const r = await verifyAuthoredChain(msg.entries, msg.author);
      if (!r.ok) return;                                          // tampered / forged-author → refuse (fail-closed)
      const have = members.get(msg.author);
      if (!have || msg.entries.length > have.length) members.set(msg.author, msg.entries.slice());
    }
  }

  // join(neighbourhood?) — ask the net for everyone's contributions, then advertise mine. Returns when one
  // round has been posted (callers await sync() for convergence over an async channel).
  function join() { try { post({ t: "ad4m:want", from: self }); } catch (e) {} publish(); }

  // sync() — one reconcile round: advertise mine (peers adopt), and return the converged head/size of the
  // shared graph. Over a synchronous loopback this converges immediately; over an async channel, call again.
  function sync() {
    publish();
    return { head: perspective.head(), members: members.size + 1, links: sharedLinks().length };
  }

  // sharedLinks(query?) — the MERGED graph: my Links ∪ every adopted member's Links, tombstones honored
  // per author (an author can only tombstone their own). A pure projection — no second index to drift.
  function sharedLinks(query = {}) {
    let out = linksFromEntries(myEntries());
    for (const entries of members.values()) out = out.concat(linksFromEntries(entries));
    if (query.source) out = out.filter((l) => l.source === query.source);
    if (query.predicate) out = out.filter((l) => l.predicate === query.predicate);
    if (query.target) out = out.filter((l) => l.target === query.target);
    return out;
  }

  // members() — the distinct agent κ set in this Neighbourhood (me + everyone whose strand I've adopted).
  function memberAgents() { return [me, ...members.keys()]; }

  return { publish, onMessage, join, sync, sharedLinks, members: memberAgents, addLink: perspective.addLink };
}

// browser binding: a live Neighbourhood over BroadcastChannel — separate tabs/windows/devices are real peers,
// no server. window.HoloNeighbourhood.attach(perspective, me, name?) → { sync, sharedLinks, members, close }.
if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
  window.HoloNeighbourhood = {
    attach(perspective, me, name = "holo-ad4m-neighbourhood") {
      const bc = new BroadcastChannel(name);
      const self = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : "tab-" + Date.now();
      const nb = makeNeighbourhood({ perspective, me, self, post: (m) => { try { bc.postMessage(m); } catch (e) {} } });
      bc.onmessage = (e) => { nb.onMessage(e.data); };
      nb.join();
      return { ...nb, channel: bc, close: () => { try { bc.close(); } catch (e) {} } };
    },
  };
}

export default { makeNeighbourhood, verifyAuthoredChain };
