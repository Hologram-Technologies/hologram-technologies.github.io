// holo-truename.mjs — Tier-1 EDGE-NAMES: every κ-object names itself, honestly.
//
// A truename is another deterministic PROJECTION of the same JCS-canonical content
// that produced the κ — not a registry entry, not stored anywhere. Two parts:
//   <semantic-slug> ~ <proquint tail>      e.g.  amp~rotiz-...
// The slug is re-projected from the object's own attributes (self-describing); the
// tail is a proquint of the κ's leading bits (memorable, speakable, disambiguating).
//
// LAW L1: the κ stays the only identity — a truename is a label, never an @id.
// LAW L5: a truename is a HINT, not a proof. matchesTruename() re-derives BOTH the
// slug and the κ-prefix and admits only on exact match, so a name CANNOT LIE: no
// object can wear another's truename. Truncating the κ to a few quints is safe ONLY
// because resolve re-derives and verifies — that invariant is load-bearing.
//
// Authority: holospaces Law L1/L2/L5 · W3C DID Core (alsoKnownAs) · schema.org/SKOS.

import { address } from "./holo-object.mjs";
import { encode as pqEncode, decode as pqDecode } from "./holo-proquint.mjs";

const hexOf = (did) => String(did).split(":").pop();
const toHex = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0"); return s; };
const hexToBytes = (hex) => { const u = new Uint8Array(hex.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(hex.substr(i * 2, 2), 16); return u; };

// 48-bit (3-quint) tail by default: ample within-closure disambiguation; L5 closes
// the residual. Speakable like what3words (3 words), but content-derived + open.
export const DEFAULT_QUINTS = 3;

// slug — re-projected from the object's human attributes, deterministic & stable.
export function slugOf(obj) {
  const t = obj["@type"];
  const raw = obj["schema:name"] || obj.name || obj.title || obj["dcterms:title"] ||
    (Array.isArray(t) ? t[0] : t) || "holo";
  return String(raw)
    .toLowerCase()
    .replace(/^[a-z]+:/, "")           // drop a vocab prefix (schema:SoftwareApplication → softwareapplication)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "holo";
}

// the proquint tail of a κ's leading quints*16 bits.
export function tailOfKappa(kappa, quints = DEFAULT_QUINTS) {
  const hex = hexOf(kappa).slice(0, quints * 4);     // quints*16 bits = quints*4 hex chars
  return pqEncode(hexToBytes(hex));
}

// kappaOf — the object's identity κ (re-derived if not already sealed).
export function kappaOf(obj) {
  return obj.id && /^did:holo:(sha256|blake3):[0-9a-f]{64}$/.test(obj.id) ? obj.id : address(obj);
}

// truenameOf(obj) → "slug~tail" — the object's self-described, human name.
export function truenameOf(obj, { quints = DEFAULT_QUINTS } = {}) {
  return `${slugOf(obj)}~${tailOfKappa(kappaOf(obj), quints)}`;
}

// parseTruename("amp~rotiz-bisog-...") → { slug, tail, prefixHex } | null.
// prefixHex is the κ-prefix the tail decodes to — the resolver's candidate filter.
export function parseTruename(s) {
  const m = /^([a-z0-9][a-z0-9-]*)~([bdfghjklmnprstvz][aiou][bdfghjklmnprstvz][aiou][bdfghjklmnprstvz](?:-[bdfghjklmnprstvz][aiou][bdfghjklmnprstvz][aiou][bdfghjklmnprstvz])*)$/.exec(String(s).trim().toLowerCase());
  if (!m) return null;
  let prefixHex;
  try { prefixHex = toHex(pqDecode(m[2])); } catch { return null; }
  return { slug: m[1], tail: m[2], prefixHex };
}

// is this κ a candidate for a parsed truename? (cheap prefix filter, pre-verify)
export function kappaMatchesPrefix(kappa, prefixHex) {
  return hexOf(kappa).startsWith(String(prefixHex).toLowerCase());
}

// LAW L5 on names: admit ONLY if the object's OWN derived slug AND κ-prefix equal
// what was typed. A phishing object cannot wear another's truename.
export function matchesTruename(obj, typed) {
  const p = parseTruename(typed);
  if (!p) return false;
  const quints = p.tail.split("-").length;
  return truenameOf(obj, { quints }) === `${p.slug}~${p.tail}`;
}

// looksLikeTruename — for the resolver / looksLikeNavigation seam.
export const looksLikeTruename = (s) => parseTruename(s) !== null;

// ── NAME RESOLUTION (Tier-1): a truename → its κ, verified against a candidate set ──
// The candidates are any catalog entries with a κ + a name (the apps index, the
// closure, a holospace's members). Resolution is registryless: re-derive each
// candidate's OWN truename and admit only on exact match (Law L5, fail-closed).
const kappaIn = (c) => c && (c.id || c["@id"] || c.kappa || c["holo:root"]);
const nameIn = (c) => (c && (c["schema:name"] || c.name)) || "";
const typeIn = (c) => c && (c["@type"] || c.type);

// truenameForEntry(entry) — a catalog entry → its truename (the κ→name reverse index,
// the ip6.arpa analog — but FREE, because the name self-derives; no zone to maintain).
export function truenameForEntry(entry, opts) {
  return truenameOf({ id: kappaIn(entry), "schema:name": nameIn(entry), "@type": typeIn(entry) }, opts);
}

// resolveTruename(typed, candidates) → [{ kappa, name, entry }] — VERIFIED matches.
// Empty = unresolved (refuse, never guess). >1 = ambiguous (caller disambiguates).
export function resolveTruename(typed, candidates) {
  const p = parseTruename(typed);
  if (!p) return [];
  const out = [];
  for (const c of candidates || []) {
    const kappa = kappaIn(c);
    if (!kappa || !kappaMatchesPrefix(kappa, p.prefixHex)) continue;          // cheap κ-prefix filter
    if (matchesTruename({ id: kappa, "schema:name": nameIn(c), "@type": typeIn(c) }, typed))
      out.push({ kappa, name: nameIn(c), entry: c });                        // L5 verify before admit
  }
  return out;
}

// expandTruename(typed, candidates) → "holo://<hex>" — a truename is an alias for a κ,
// so expand it to the κ link the existing navigation already mounts. null unless it
// resolves to EXACTLY one (fail-closed on miss or ambiguity).
export function expandTruename(typed, candidates) {
  const hits = resolveTruename(typed, candidates);
  return hits.length === 1 ? "holo://" + String(hits[0].kappa).split(":").pop() : null;
}

// suggestTruenames(prefix, candidates) — verified autocomplete over a candidate set.
export function suggestTruenames(prefix, candidates, limit = 8) {
  const q = String(prefix || "").trim().toLowerCase();
  const out = [];
  for (const c of candidates || []) {
    if (!kappaIn(c)) continue;
    const truename = truenameForEntry(c);
    if (!q || truename.startsWith(q) || slugOf({ "schema:name": nameIn(c) }).startsWith(q))
      out.push({ truename, kappa: kappaIn(c), name: nameIn(c) });
    if (out.length >= limit) break;
  }
  return out;
}

// ── browser binding: window.HoloTruename over the live apps catalog. The omnibar /
// holospace.html projection call expand(typed) to turn a truename into its κ link,
// then mount as usual — one front door, the κ stays identity (Law L1). The shell may
// inject the already-loaded catalog via setCatalog() to avoid a second fetch.
if (typeof window !== "undefined" && !window.HoloTruename) {
  let _cat = null, _loading = null;
  const fromDoc = (j) => (j && (j["dcat:dataset"] || j["@graph"])) || (Array.isArray(j) ? j : []);
  async function catalog() {
    if (_cat) return _cat;
    if (!_loading) _loading = (async () => {
      for (const u of ["apps/index.jsonld", "/apps/index.jsonld"]) {
        try { const r = await fetch(u); if (r.ok) return (_cat = fromDoc(await r.json())); } catch (e) { /* try next */ }
      }
      return (_cat = []);
    })();
    return _loading;
  }
  window.HoloTruename = {
    truenameOf, truenameForEntry, slugOf, parseTruename, matchesTruename, looksLikeTruename,
    setCatalog: (j) => { _cat = fromDoc(j); },
    resolve: async (typed) => resolveTruename(typed, await catalog()),
    expand: async (typed) => expandTruename(typed, await catalog()),
    suggest: async (prefix, limit) => suggestTruenames(prefix, await catalog(), limit),
  };
}
