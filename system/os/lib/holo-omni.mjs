// holo-omni.mjs — the universal omnibox resolver. One box, one input, one κ-addressed holospace.
// Everything is an object addressed by its UOR-native hash; this canonicalizes ANY input into how
// to open it, within the one content-addressable substrate:
//   • an APP in the content-addressed index                          → open the holospace
//   • a holo://<hex> / did:holo:sha256:<hex>                          → that object (an app, or κ content)
//   • a CID · ipfs:// · ipns:// · <name>.eth · /ipfs/… · a DNSLink    → the content-addressed web (Holo IPFS, κ-verified)
//   • an http(s) URL or a bare domain                                → the web
//   • anything else                                                  → a search over the index
// Pure + dependency-free. Self-verification happens at the destination (Law L5); this only ROUTES,
// canonically + fast, so the same box is the door to apps, the whole web, content, and (soon) agents.

const HEX64 = /^[0-9a-f]{64}$/i;
const CIDISH = /^(baf[a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{30,})$/;   // CIDv1 (base32) · CIDv0 · multibase
const ETH = /^[a-z0-9-]+\.eth$/i;

// classify(input, catalog) → a route. `catalog` is [{ id, did, name, landing }] from the index.
export function classify(input, catalog = []) {
  const s = String(input || "").trim();
  if (!s) return { kind: "empty" };

  // THREE WORDS (holo-words) — "brass.junior.quiz": a κ's speakable address. Match the app's
  // precomputed three-word address in the index (verify-before-trust already happened at build, when
  // the words were derived from the app's κ). Tried BEFORE the bare-domain rule so a real three-word
  // address resolves to its app, while a genuine domain (no catalog match) still falls through to the web.
  const w = s.toLowerCase();
  if (/^[a-z]+\.[a-z]+\.[a-z]+$/.test(w)) {
    const app = catalog.find((a) => a.words && String(a.words).toLowerCase() === w);
    if (app) return { kind: "app", app, label: app.name };
  }

  // holo:// or did:holo → a κ object: an app if the index knows it, else raw content by κ.
  let m = s.match(/^(?:holo:\/\/|did:holo:sha256:)([0-9a-f]{64})$/i);
  if (m) {
    const hex = m[1].toLowerCase();
    const app = catalog.find((a) => String(a.did || "").toLowerCase().endsWith(hex));
    return app ? { kind: "app", app, label: app.name } : { kind: "holo", hex, label: "holo://" + hex.slice(0, 14) + "…", address: "ipfs://" + hex };
  }

  // the content-addressed web (Holo IPFS resolves + re-derives every block — Law L5).
  const head = s.split(/[/?#]/)[0];
  if (/^(ipfs|ipns):\/\//i.test(s) || /^\/(ipfs|ipns)\//.test(s) || CIDISH.test(head) || ETH.test(head)) {
    return { kind: "web", address: s, label: s };
  }

  // an http(s) URL, or a bare domain that isn't an app name → the web.
  if (/^https?:\/\//i.test(s)) return { kind: "web", address: s, label: s };
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s) && !catalog.some((a) => (a.name || "").toLowerCase() === s.toLowerCase())) {
    return { kind: "web", address: "https://" + s.replace(/^\/+/, ""), label: s };
  }

  // a single bare hex (someone pasted a κ without a scheme) → content by κ.
  if (HEX64.test(s)) { const app = catalog.find((a) => String(a.did || "").toLowerCase().endsWith(s.toLowerCase())); return app ? { kind: "app", app, label: app.name } : { kind: "holo", hex: s.toLowerCase(), label: "κ " + s.slice(0, 14) + "…", address: "ipfs://" + s.toLowerCase() }; }

  // otherwise: search the index (the spotlight filters apps by name/id).
  return { kind: "search", term: s };
}

// matches(term, catalog) → the apps whose name/id contains the term (the search rows).
export const matches = (term, catalog = []) => {
  const t = String(term || "").toLowerCase();
  return catalog.filter((a) => ((a.name || "") + (a.id || "")).toLowerCase().includes(t));
};
