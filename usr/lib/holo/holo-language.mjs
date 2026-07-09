// holo-language.mjs — THE objective seam (ADAM's Language, capability-typed). A Language WRAPS a network or
// format (IPFS / Ethereum / cloud / AWS / HTTP / fediverse / a model) and emits content for the ONE substrate
// sealer — it never carries its own hasher (Law L4), and whatever it produces re-verifies on read (Law L5).
// One registry resolves every adapter through the SAME {name, capabilities, create, get} contract, by name or
// by capability. This is the single door the scattered adapters (Forge=compile, Projection/Media=codec,
// κ-Roots/Truenames=naming, Transport=replicate, fediverse=transport, web/ipfs=storage) fold onto.

import { verify as verifyObj } from "./holo-object.mjs";

// The capability taxonomy: what a Language can do for the substrate. A Language tags one or more.
export const CAPABILITIES = ["storage", "transport", "codec", "naming", "compile", "replicate"];

// defineLanguage(spec) — validate the contract and freeze it. Rejects a Language that carries its OWN hasher
// (Law L4): a Language returns plain content; only the substrate mints κ. create() may use the shared sealer.
export function defineLanguage(spec) {
  if (!spec || !spec.name) throw new Error("a Language needs a name");
  if (typeof spec.create !== "function" || typeof spec.get !== "function") {
    throw new Error("a Language needs create(data)->κ and get(ref)->κ|null");
  }
  if (spec.hasher || spec.hash) {
    throw new Error("Law L4: a Language must not carry its own hasher — emit plain content for the one substrate sealer");
  }
  const capabilities = {};
  for (const c of CAPABILITIES) if (spec.capabilities && spec.capabilities[c]) capabilities[c] = true;
  return Object.freeze({ name: String(spec.name), capabilities, create: spec.create, get: spec.get });
}

// makeLanguages() — the registry. register a spec, look up by name or capability, resolve a ref to a κ that
// is RE-VERIFIED on read (Law L5). Adding a network is ONE object, no core change (the "evolvable" property).
export function makeLanguages() {
  const langs = new Map();
  function register(spec) { const L = defineLanguage(spec); langs.set(L.name, L); return L.name; }
  const byName = (n) => langs.get(n) || null;
  const byCapability = (cap) => [...langs.values()].filter((L) => L.capabilities[cap]);
  const names = () => [...langs.keys()];
  const coveredCapabilities = () => CAPABILITIES.filter((c) => byCapability(c).length > 0);
  // resolve(ref = { language, value }) — route to the Language's get(), then re-verify. null if tampered/unknown.
  function resolve(ref) {
    const L = ref && langs.get(ref.language);
    if (!L) return null;
    const got = L.get(ref.value);
    return got && verifyObj(got) ? got : null;
  }
  return { register, byName, byCapability, names, coveredCapabilities, resolve, size: () => langs.size };
}

if (typeof window !== "undefined") window.HoloLanguages = { makeLanguages, defineLanguage, CAPABILITIES };
export default { makeLanguages, defineLanguage, CAPABILITIES };
