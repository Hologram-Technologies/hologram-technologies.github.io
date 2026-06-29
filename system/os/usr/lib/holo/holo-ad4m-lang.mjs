// holo-ad4m-lang.mjs — THREE LANGUAGES, ONE SEAM: the interoperability proof. AD4M's Language is the
// adapter that turns content from SOME protocol into an Expression; here three protocols — web (HTTP/
// ActivityPub), web3 (IPFS/EVM via CAIP), and AI (a model's output) — all plug in behind the SAME
// { name, create, get } interface the facade already speaks. The point of κ: whatever the source, the
// Expression's address is `did:holo:sha256(content)` from the ONE substrate hasher (Law L4) — a Language
// never re-hashes. So a single Perspective holds Links pointing at web, web3 and AI Expressions with an
// IDENTICAL address-derivation path. That is "interoperable with web, web3 and AI" made mechanical.
//
// Separation of concerns (keeps the facade sync + κ-pure): OBTAINING bytes (network / chain / model) is
// async I/O done by the resolve* helpers; MINTING the Expression is the Language's pure create() over the
// already-obtained content + its stable provenance (source URL / CAIP id / model+prompt). Volatile origin
// (fetch/gen time) is recorded out-of-band on the operator's strand via recordExpressionProvenance, so the
// Expression stays an idempotent, re-derivable value while "where it came from" is provable on the spine.

import { seal, verify as verifyObj, address, UOR_CONTEXT } from "./holo-object.mjs";
import { recordIngest, provenanceOf } from "./holo-strand-provenance.mjs";
import { defineLanguage } from "./holo-language.mjs";

const NS = "https://hologram.os/ns/ad4m#";

// the uniform Expression body: content + STABLE provenance, sealed once by the substrate hasher (Law L1/L4).
// The address commits to data AND provenance, so it re-derives from (content, origin) regardless of Language.
function exprWithProv({ language, data, prov }) {
  return seal({
    "@context": [...UOR_CONTEXT, { ad4m: NS }],
    "@type": ["ad4m:Expression"],
    "ad4m:language": String(language),
    "ad4m:data": data ?? null,
    "ad4m:provenance": prov || {},
  });
}

// ── WEB Language (HTTP / ActivityPub) ────────────────────────────────────────────────────────────────
export const webLanguage = Object.freeze({
  name: "web",
  create: (resolved) => exprWithProv({ language: "web", data: resolved.data, prov: { source: resolved.source, contentType: resolved.contentType || null } }),
  get: (e) => (verifyObj(e) ? e : null),
});
// fetchWeb(fetchDoc, url) — obtain remote bytes (inject any fetcher: real fetch, an ActivityPub client).
export async function fetchWeb(fetchDoc, url) {
  const r = await fetchDoc(url);
  return { source: url, contentType: r.contentType || null, data: r.body };
}

// ── WEB3 Language (IPFS / EVM via CAIP) ──────────────────────────────────────────────────────────────
export const web3Language = Object.freeze({
  name: "web3",
  create: (resolved) => exprWithProv({ language: "web3", data: resolved.content, prov: { caip: resolved.caip } }),
  get: (e) => (verifyObj(e) ? e : null),
});
// resolveWeb3(resolveCaip, caip) — obtain on-chain / IPFS content (inject holo-evm / holo-ipfs / a gateway).
export async function resolveWeb3(resolveCaip, caip) {
  const content = await resolveCaip(caip);
  return { caip, content };
}

// ── AI Language (a model's output) ───────────────────────────────────────────────────────────────────
export const aiLanguage = Object.freeze({
  name: "ai",
  create: (resolved) => exprWithProv({ language: "ai", data: resolved.output, prov: { model: resolved.model, prompt: resolved.prompt } }),
  get: (e) => (verifyObj(e) ? e : null),
});
// generateAi(generate, prompt, model) — obtain a model output (inject any engine: holo-ai, a remote model).
export async function generateAi(generate, prompt, model) {
  const output = await generate(prompt, model);
  return { prompt, model, output };
}

// recordExpressionProvenance(strand, expr, meta) — put the VOLATILE origin (this fetch/gen, at this time)
// on the operator's source chain as a signed ingest entry, so provenanceOf(strand, expr.url) proves it.
export async function recordExpressionProvenance(strand, expr, { name = null, bytes = null } = {}) {
  return recordIngest(strand, { source: expr.id, name, bytes });
}

// the capability taxonomy for the three (Step B fold): web wraps HTTP/AP (storage+transport), web3 wraps
// IPFS/EVM (storage), ai wraps a model (compile). The impls are UNCHANGED — folding only tags + re-homes them.
export const LANG_CAPS = { web: { storage: true, transport: true }, web3: { storage: true }, ai: { compile: true } };

// foldInto(node) — STEP B: fold the three real Languages onto the ONE capability-typed registry (node.languages).
// Same create/get impl, now resolvable by capability through the single seam — the bespoke registerAll path
// becomes a fold. Returns the folded names. Bit-identity holds because the create() functions are reused as-is.
export function foldInto(node) {
  node.languages.register(defineLanguage({ ...webLanguage, capabilities: LANG_CAPS.web }));
  node.languages.register(defineLanguage({ ...web3Language, capabilities: LANG_CAPS.web3 }));
  node.languages.register(defineLanguage({ ...aiLanguage, capabilities: LANG_CAPS.ai }));
  return ["web", "web3", "ai"];
}

// registerAll(ad4m) — convenience: register all three Languages on a makeAd4m instance.
export function registerAll(ad4m) {
  ad4m.registerLanguage(webLanguage);
  ad4m.registerLanguage(web3Language);
  ad4m.registerLanguage(aiLanguage);
  return ["web", "web3", "ai"];
}

export { provenanceOf, address };

if (typeof window !== "undefined") {
  window.HoloAd4mLang = { webLanguage, web3Language, aiLanguage, fetchWeb, resolveWeb3, generateAi, registerAll, recordExpressionProvenance };
}

export default { webLanguage, web3Language, aiLanguage, registerAll };
