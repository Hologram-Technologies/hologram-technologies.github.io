// holo-ad4m.mjs — Coasys/AD4M's agent-centric meta-ontology, projected onto the κ substrate as a THIN
// FACADE over modules that already exist. Nothing here is a new primitive; it is a vocabulary that renames
// what the substrate already is. AD4M is Holochain's semantic web (built by Holochain's own ex-core-lead),
// and Holochain's keystone — the per-agent, signed, append-only source chain — is already `holo-strand`.
//
// The mapping (each row inherits the Law of the module it rests on):
//   Agent        → an operator κ            (holo-identity.addressOf — a DID is already a content address, L1)
//   Expression   → a sealed UOR object      (holo-object.seal — an Expression URL IS did:holo:sha256, L1/L2)
//   Language     → a resolver spec          ({name, create(data)→expr, get(expr)→expr|null}, swappable, L3/L4)
//   Link         → a signed strand entry    (subject-predicate-object appended to a Perspective, L1/L5)
//   Perspective  → a holo-strand            (one agent's append-only, signed graph of Links, L5 over the seq)
//
// Serverless by construction: an Expression resolves from a content-addressed store (a Map in Node, the κ
// store in the browser) and is RE-VERIFIED on read (Law L5) — trust travels with the bytes, not a daemon.
// There is no ad4m-executor, no conductor: the substrate IS the executor.
//
// Pure + adapter-injectable: makeAd4m({ signer, store, now }) is node-testable with an in-memory store and
// a real enrolled holo-identity principal as signer; the browser binding wires the live operator + κ store.

import { seal, verify as verifyObj, UOR_CONTEXT } from "./holo-object.mjs";
import { makeStrand } from "./holo-strand.mjs";
import { blake3hex } from "./holo-blake3.mjs";

const NS = "https://hologram.os/ns/ad4m#";
const hexOf = (url) => String(url).split(":").pop();

// predicateKappa(verb) — a Link's predicate is itself a κ (content-addressed, reusable across links and
// agents), not a bare string. A verb name is minted to its stable address; an already-minted κ passes
// through. This is what turns the graph into a shared VOCABULARY (Law L1, one address per relation).
export async function predicateKappa(p) {
  const s = String(p);
  if (s.startsWith("did:holo:")) return s;
  return "did:holo:blake3:" + blake3hex(new TextEncoder().encode("ad4m:pred:" + s));
}

// The base shape of an Expression: a self-verifying UOR value. Authorship and time live on the LINK that
// references it (the strand records op + generatedAtTime), NOT inside the value — so an Expression is an
// IDEMPOTENT, shareable, content-addressed value: identical data ⇒ identical κ, regardless of who sealed it.
export function expressionBody({ language, data }) {
  return seal({
    "@context": [...UOR_CONTEXT, { ad4m: NS }],
    "@type": ["ad4m:Expression"],
    "ad4m:language": String(language),
    "ad4m:data": data ?? null,
  });
}

// linksFromEntries(entries) — project a RAW strand-entry array into the live Link graph: every ad4m:link
// not tombstoned by an ad4m:link-removed. A pure function (no instance) so a Neighbourhood (P2) can merge
// links across MANY agents' strands, and the per-Perspective links() below is just this over its own strand.
export function linksFromEntries(entries = []) {
  const removed = new Set(
    entries.filter((r) => r["holstr:kind"] === "ad4m:link-removed").map((r) => r["holstr:payload"] && r["holstr:payload"].target)
  );
  return entries
    .filter((r) => r["holstr:kind"] === "ad4m:link" && r["holstr:payload"])
    .map((r) => ({
      kappa: r.id,
      source: r["holstr:payload"].source,
      predicate: r["holstr:payload"].predicate,
      predicateKappa: r["holstr:payload"].pk ?? null,   // predicate-as-κ (D1): the relation's content address
      target: r["holstr:payload"].target,
      author: r["holstr:op"] || null,
      at: r["prov:generatedAtTime"],
    }))
    .filter((l) => !removed.has(l.kappa));
}

// The built-in "literal" Language: seal the data as-is, verify on read. The minimal proof that a Language
// is just {create, get} — every other Language (web / web3 / ai) plugs in behind this same interface.
const LITERAL = Object.freeze({
  name: "literal",
  create: (data) => expressionBody({ language: "literal", data }),
  get: (expr) => (verifyObj(expr) ? expr : null),
});

// makeAd4m({ signer, store, now }) → the agent-centric web bound to ONE operator.
//   signer : an unlocked holo-identity principal { kappa, alg, pub, sign } (the Agent). Optional → unsigned.
//   store  : a content-addressed Map-like { get(hex)→expr, set(hex, expr) }. Absent ⇒ in-memory.
//   now    : () → ISO string, threaded into every Link entry on the strand.
export function makeAd4m({ signer = null, store = new Map(), now = () => "1970-01-01T00:00:00Z" } = {}) {
  const languages = new Map([[LITERAL.name, LITERAL]]);

  // ── Agent ──────────────────────────────────────────────────────────────────────────────────────────
  const me = () => (signer && signer.kappa ? signer.kappa : null);

  // ── Language ───────────────────────────────────────────────────────────────────────────────────────
  // Register a resolver. A Language NEVER gets its own hasher (Law L4) — it returns plain content for the
  // ONE substrate sealer. create(data)→a sealed Expression; get(expr)→the expr if it still verifies.
  function registerLanguage(spec) {
    if (!spec || !spec.name || typeof spec.create !== "function" || typeof spec.get !== "function") {
      throw new Error("a Language needs { name, create(data), get(expr) }");
    }
    languages.set(spec.name, spec);
    return spec.name;
  }
  const languageNames = () => [...languages.keys()];

  // ── Expression ─────────────────────────────────────────────────────────────────────────────────────
  // createExpression(language, data) → { url, expr }. The url IS the content address (did:holo:sha256).
  // Sealing is idempotent: the same (language, data) always yields the same url.
  function createExpression(languageName, data) {
    const lang = languages.get(languageName);
    if (!lang) throw new Error("unknown Language: " + languageName);
    const expr = lang.create(data);
    store.set(hexOf(expr.id), expr);
    return { url: expr.id, expr };
  }

  // getExpression(url) → the Expression, RE-VERIFIED (Law L5), or null. A tampered stored value, or one
  // whose stored bytes don't re-derive to the requested url, fails closed. Routed through the Language's
  // get() so protocol-specific validation (re-fetch / re-derive) runs too.
  function getExpression(url) {
    const expr = store.get(hexOf(url));
    if (!expr) return null;
    const lang = languages.get(expr["ad4m:language"]);
    if (!lang) return null;
    const got = lang.get(expr);
    return got && verifyObj(got) && got.id === url ? got : null;
  }

  // ── Perspective ──────────────────────────────────────────────────────────────────────────────────────
  // A Perspective is a holo-strand of Link entries. Each Link is a signed, hash-linked entry committing a
  // {source, predicate, target} triple; the head κ attests the WHOLE ordered graph (Law L5 over the seq).
  // removeLink is append-only: it writes a tombstone (never mutates history), so the chain still verifies.
  function perspective({ backend = null } = {}) {
    const strand = makeStrand({ backend, now, signer });

    const linkOf = (rec) => ({
      kappa: rec.id,
      source: rec["holstr:payload"].source,
      predicate: rec["holstr:payload"].predicate,
      predicateKappa: rec["holstr:payload"].pk ?? null,   // predicate-as-κ (D1): the relation's content address
      target: rec["holstr:payload"].target,
      author: rec["holstr:op"] || null,
      at: rec["prov:generatedAtTime"],
    });

    // pk (optional) — the predicate's κ, carried alongside the verb name so rulesets still validate the
    // human verb while the graph projects the content address. The strand entry keeps both; conformance
    // checks `predicate`, links() expose `pk`.
    async function addLink({ source, predicate, target, pk = null }) {
      if (!source || !predicate || !target) throw new Error("a Link needs source, predicate, target");
      const payload = { source, predicate, target };
      if (pk) payload.pk = pk;
      const rec = await strand.append({ kind: "ad4m:link", payload });
      return linkOf(rec);
    }

    // removeLink(linkKappa) — append a tombstone so the Link drops out of links() while history stays intact.
    async function removeLink(linkKappa) {
      const rec = await strand.append({ kind: "ad4m:link-removed", payload: { target: linkKappa } });
      return { kappa: rec.id, removed: linkKappa };
    }

    // links(query?) — the live graph: every ad4m:link not tombstoned, filtered by any of {source,predicate,
    // target}. A pure projection over the strand replay — no second index to drift (Law L2).
    function links(query = {}) {
      let out = linksFromEntries(strand.replay({}));
      if (query.source) out = out.filter((l) => l.source === query.source);
      if (query.predicate) out = out.filter((l) => l.predicate === query.predicate);
      if (query.target) out = out.filter((l) => l.target === query.target);
      return out;
    }

    return {
      addLink,
      removeLink,
      links,
      head: () => strand.head(),
      verify: () => strand.verify(),
      adopt: (chain) => strand.adopt(chain),
      ready: () => strand.ready(),
      raw: strand, // escape hatch for Neighbourhood sync (P2) / DNA (P3)
    };
  }

  // ── the ONE link verb (the unified facade seam) ─────────────────────────────────────────────────────
  // link(subject, predicate, object) over a default Perspective; the predicate is minted to a κ. This is
  // the single entry point that edge-κ and the semantic-web slices fold onto — one verb, not many modules.
  let _defaultPersp = null;
  async function link(subject, predicate, object) {
    if (!subject || !predicate || !object) throw new Error("link needs subject, predicate, object");
    if (!_defaultPersp) _defaultPersp = perspective({});
    return _defaultPersp.addLink({ source: subject, predicate, target: object, pk: await predicateKappa(predicate) });
  }
  const graph = (q = {}) => (_defaultPersp ? _defaultPersp.links(q) : []);

  return { me, link, graph, registerLanguage, languageNames, createExpression, getExpression, perspective, store };
}

// ── browser binding: window.HoloAd4m over the live operator + κ store, on operator surfaces only. The
// Expression store and Perspective backend are the SAME sovereign-vault-encrypted axes the strand uses;
// until an operator is unlocked it still content-addresses (unsigned), Law L1 private-first, L2 one wire.
if (typeof window !== "undefined") {
  const wire = async () => {
    try {
      if (window.HoloAd4m) return;
      const signer = window.HoloPrincipal || null; // an unlocked principal if a surface attached one
      window.HoloAd4m = makeAd4m({ signer, now: () => new Date().toISOString() });
      if (document.documentElement) document.documentElement.dispatchEvent(new Event("holo-ad4m-ready"));
    } catch (e) { /* leave unset; callers fail-soft */ }
  };
  wire();
}
