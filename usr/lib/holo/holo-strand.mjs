// holo-strand.mjs — THE OPERATOR'S SOURCE CHAIN. One hash-linked, operator-signed, append-only
// thread of everything the operator did, so history, provenance and resume are a SINGLE re-derivable
// spine instead of a dozen bags of records. This is Holochain's source-chain insight projected ONTO
// the κ substrate — and nothing else: no DHT, no consensus, no chain-of-blocks. Each entry is a UOR
// object whose identity is the hash of its content (Law L1) AND that commits to the PREVIOUS entry's
// κ (`prev`) and its position (`seq`). So the head κ attests the WHOLE ordered history: drop, reorder,
// insert or mutate ANY entry and verify() refuses (Law L5 over the sequence, not just each record).
//
// Where holo-memory seals records INDIVIDUALLY (a bag — order and omissions are NOT tamper-evident),
// the strand seals the LINKAGE: every entry's κ depends on the one before it, a Merkle thread. An
// optional operator SIGNATURE (the same Ed25519/ECDSA axis as holo-identity) binds AUTHORSHIP over the
// entry κ — proving WHO appended, not just WHAT. Unsigned still chains (the content-address linkage is
// the headline); signed adds non-repudiable authorship when an unlocked operator is attached.
//
// Anchored 100% in the existing substrate — no new primitive:
//   • seal/verify (holo-object.mjs)  — id = did:holo:sha256:H(jcs(content)); the ONE canonical form (Law L2).
//   • addressOf    (holo-identity.mjs) — an operator κ IS the content address of its public key (CC-1).
//   • activeCipher (holo-session.mjs) — AES-GCM at rest under the operator's sovereign vault key (fail-closed).
//
// The core is adapter-injectable (makeStrand) — node-testable with an in-memory backend + a real
// enrolled principal as signer; the browser binding wires the encrypted κ-store and the live operator.

import { seal, verify as verifyObj, UOR_CONTEXT } from "./holo-object.mjs";
import { addressOf } from "./holo-identity.mjs";

const NS = "https://hologram.os/ns/strand#";
const te = new TextEncoder();
const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const keyParams = (a) => (a === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" });
const sigParams = (a) => (a === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" });

// an entry body → a sealed UOR object (id commits to seq, prev, kind, payload, op, time). The sealed
// `id` is THIS entry's κ; the next entry's `prev` will be exactly this id — that is the hash-link.
const entryBody = (props) => seal({ "@context": [...UOR_CONTEXT, { holstr: NS }], "@type": ["prov:Entity", "holstr:Entry"], ...props });

// verifyEntry — Law L5 for one entry: its id must re-derive from its body, and (if signed) the operator
// signature must verify over that id and the pubkey must content-address to the committed operator κ.
// Signature fields live OUTSIDE the addressed body (they can't commit to a κ that depends on them).
export async function verifyEntry(rec) {
  try {
    const { "holstr:sig": sig, "holstr:alg": alg, "holstr:pub": pub, ...body } = rec;
    if (!verifyObj(body)) return { ok: false, why: "id-not-rederive" };          // content tampered (Law L5)
    if (!sig) return { ok: true, signed: false };                                 // unsigned: content-verified
    if (!pub || !alg || !body["holstr:op"]) return { ok: false, why: "sig-missing-key" };
    if (!SUB) return { ok: true, signed: true, note: "sig-uncheckable-no-subtle" };
    if ((await addressOf(unb64(pub))) !== body["holstr:op"]) return { ok: false, why: "op-not-pubkey" };
    const key = await SUB.importKey("raw", unb64(pub), keyParams(alg), false, ["verify"]);
    if (!(await SUB.verify(sigParams(alg), key, unb64(sig), te.encode(body.id)))) return { ok: false, why: "bad-sig" };
    return { ok: true, signed: true };
  } catch (e) { return { ok: false, why: "verify-threw:" + (e && e.message) }; }
}

// makeStrand({ backend, now, signer }) → the source chain.
//   backend : durable store { load: async()→entries[]|null, save: async(entries)→void }. Absent ⇒ in-memory.
//   now     : () → ISO string (the moment committed into each entry — events are distinct in time).
//   signer  : an unlocked principal { kappa, alg, pub, sign(strOrBytes)→b64 } (holo-identity). Optional.
// NEVER bounded — the strand is HISTORY, not a cache; it only grows (append-only).
export function makeStrand({ backend = null, now = () => "1970-01-01T00:00:00Z", signer = null } = {}) {
  let entries = [];
  let hydrated = false;
  let _signer = signer;

  async function ready() {
    if (hydrated) return;
    hydrated = true;
    if (backend && typeof backend.load === "function") {
      try { const r = await backend.load(); if (Array.isArray(r)) entries = r; } catch (e) {}
    }
  }
  async function persist() { if (backend && typeof backend.save === "function") { try { await backend.save(entries); } catch (e) {} } }

  function head() { return entries.length ? entries[entries.length - 1].id : null; }
  function length() { return entries.length; }
  function setSigner(s) { _signer = s || null; }

  // append — seal a new entry linked to the current head, optionally sign it, persist, advance the head.
  async function append(signal = {}) {
    await ready();
    const props = {
      "holstr:seq": entries.length,                 // 0 at genesis, monotonic
      "holstr:prev": head(),                         // null at genesis, else the prior entry's κ (the link)
      "holstr:kind": String(signal.kind || "event"),
      "holstr:payload": signal.payload ?? null,
      "prov:generatedAtTime": now(),
    };
    if (_signer && _signer.kappa) props["holstr:op"] = _signer.kappa;   // authorship committed INTO the id
    let rec = entryBody(props);                                          // rec.id = this entry's κ (Law L1)
    if (_signer && typeof _signer.sign === "function") {
      rec = { ...rec, "holstr:sig": await _signer.sign(rec.id), "holstr:alg": _signer.alg, "holstr:pub": _signer.pub };
    }
    entries.push(rec);
    await persist();
    return rec;
  }

  const replay = ({ kind = null, since = 0 } = {}) =>
    entries.slice(since).filter((r) => (kind ? r["holstr:kind"] === kind : true));

  // ── resume on the spine (P1) ───────────────────────────────────────────────────────────────────────
  // resumePoint — the operator's TRUE last resume point: the payload of the most recent session.snapshot
  // entry ({ realm, kappa, seq }). Because it lives on the hash-linked chain, it cannot be silently moved.
  async function resumePoint() {
    await ready();
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i]["holstr:kind"] === "session.snapshot") return entries[i]["holstr:payload"] || null;
    return null;
  }
  // reconcileResume — given the LIVE session head κ (last-write-wins, swappable), decide what to actually
  // resume. The spine is the source of truth: if the chain is intact and its last recorded κ disagrees with
  // the live head, the live head DRIFTED (swapped / forged / stale) → recover the chain's κ. A broken chain
  // is never trusted (fail-closed). Returns { kappa, continuity, strandHead, ... }.
  //   ok        — live head matches the spine (or there's no live head and the spine supplies one).
  //   recovered — live head ≠ spine's last κ → resume the spine's κ (drift caught).
  //   empty     — the spine has no snapshot yet → fall back to the live head.
  //   chain-broken — the spine fails verification → trust nothing, keep the live head, report the break.
  async function reconcileResume(sessionHeadKappa = null) {
    await ready();
    const v = await verify();
    if (!v.ok) return { kappa: sessionHeadKappa, continuity: "chain-broken", strandHead: v.head ?? null, brokeAt: v.brokeAt, why: v.why };
    const rp = await resumePoint();
    if (!rp || !rp.kappa) return { kappa: sessionHeadKappa, continuity: "empty", strandHead: head() };
    if (sessionHeadKappa && rp.kappa === sessionHeadKappa) return { kappa: rp.kappa, continuity: "ok", strandHead: head() };
    return { kappa: rp.kappa, continuity: "recovered", strandHead: head(), sessionHead: sessionHeadKappa || null };
  }

  // verify — walk the WHOLE chain: each entry re-derives (L5) and verifies its signature, seq is in
  // order, and each prev exactly equals the prior entry's κ. Any break (tamper / reorder / drop /
  // insert) is reported with its index. This is the source-chain guarantee the head κ stands for.
  async function verify() {
    await ready();
    let prev = null;
    for (let i = 0; i < entries.length; i++) {
      const rec = entries[i];
      const v = await verifyEntry(rec);
      if (!v.ok) return { ok: false, length: entries.length, brokeAt: i, why: v.why };
      if (rec["holstr:seq"] !== i) return { ok: false, length: entries.length, brokeAt: i, why: "seq-out-of-order" };
      if (rec["holstr:prev"] !== prev) return { ok: false, length: entries.length, brokeAt: i, why: "prev-link-broken" };
      prev = rec.id;
    }
    return { ok: true, length: entries.length, head: prev };
  }

  // adopt(candidate) — replace the local chain with one RECEIVED from a peer (cross-device roam),
  // VERIFY-BEFORE-ADOPT (fail-closed): the candidate must re-derive + link end-to-end (Law L5 over the
  // sequence), else refuse and keep the local chain untouched. The caller decides WHEN to adopt (e.g. only
  // on a fast-forward from holo-workspace-roam.reconcileRemote); this just makes adoption safe + atomic.
  async function adopt(candidate) {
    await ready();
    if (!Array.isArray(candidate)) return { ok: false, why: "not-a-chain" };
    let prev = null;
    for (let i = 0; i < candidate.length; i++) {
      const v = await verifyEntry(candidate[i]);
      if (!v.ok) return { ok: false, why: v.why, brokeAt: i };
      if (candidate[i]["holstr:seq"] !== i) return { ok: false, why: "seq-out-of-order", brokeAt: i };
      if (candidate[i]["holstr:prev"] !== prev) return { ok: false, why: "prev-link-broken", brokeAt: i };
      prev = candidate[i].id;
    }
    entries = candidate.slice();
    await persist();
    return { ok: true, length: entries.length, head: head() };
  }

  return { ready, append, head, length, replay, verify, setSigner, resumePoint, reconcileResume, adopt };
}

// ── browser binding: window.HoloStrand over an AES-GCM-encrypted IndexedDB backend (the SAME sovereign
// vault cipher as holo-memory / holo-session — fail-closed: locked ⇒ never write plaintext). The strand
// is bound on operator surfaces only; an unlocked operator is attached as signer via setSigner so entries
// gain authorship. Until attached it still hash-links (content-addressed). Law L1 private-first, L2 one wire.
if (typeof window !== "undefined") {
  const idbBackend = () => {
    const KEY = "holo.strand.v1", DB = "holo-strand", STORE = "kv";
    const open = () => new Promise((res, rej) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const s = t.objectStore(STORE); const rq = fn(s); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); };
    const td = new TextDecoder();
    const cipher = async () => { try { const m = await import("./holo-session.mjs"); return m.activeCipher ? (await m.activeCipher()).cipher : null; } catch (e) { return null; } };
    return {
      load: async () => {
        const raw = await tx("readonly", (s) => s.get(KEY)); if (!raw) return [];
        if (raw.v === 1 && raw.blob) { const c = await cipher(); if (!c) return []; try { const pt = await c.open(raw.blob); return pt ? JSON.parse(td.decode(pt)) : []; } catch (e) { return []; } }
        return [];
      },
      save: async (recs) => {
        const c = await cipher(); if (!c) return null;                            // locked / no key → never write plaintext
        const blob = await c.seal(te.encode(JSON.stringify(recs)));
        return tx("readwrite", (s) => s.put({ v: 1, blob }, KEY));
      },
    };
  };
  const wire = async () => {
    try {
      if (window.HoloStrand) return;
      const backend = typeof indexedDB !== "undefined" ? idbBackend() : null;
      const strand = makeStrand({ backend, now: () => new Date().toISOString() });
      await strand.ready();
      window.HoloStrand = strand;
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-strand-ready"));
    } catch (e) { /* leave unset; callers fail-soft */ }
  };
  wire();
}
