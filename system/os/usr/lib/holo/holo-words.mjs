// holo-words.mjs — THREE WORDS: the whole κ, in three words a human can say.
//
// A κ → three dot-separated real words (BIP-39, the open public-domain list), the
// shortest, most memorable human handle for an address. The display name
// (schema:name) is shown; the THREE WORDS are what you say, share, and navigate by —
// like what3words, but content-derived, registryless, and verifiable.
//
// HONEST by pigeonhole: 3 words from a 2048-word list carry 33 bits; a κ is 256. So
// three words are a LOSSY projection of the κ, unique WITHIN a namespace, never a
// global bijection. Correctness is closed exactly as what3words' bounded grid is:
//   · DETERMINISTIC — same κ + same wordlist-κ → same three words, forever (Law L2).
//   · SCOPED — unique within a resolution namespace (50-app catalog, a user's space).
//   · VERIFIED — resolve re-derives each candidate's OWN words and admits only on
//     exact match (Law L5); the full κ stays the identity (Law L1) and resolves
//     directly. The three words never MIS-resolve — at worst they ask "which one?".
//
// The wordlist is a content-addressed κ-object (its sha256 IS its κ), pinned below —
// that pin is the "fixed forever" guarantee, done the Hologram way. Pure + isomorphic.
//
// Authority: BIP-39 (open) · what3words published design principles (not its IP) ·
//   W3C i18n / DID Core / schema.org / SKOS · holospaces Law L1/L2/L5.

// The pinned wordlist κ — its sha256 IS its content address (see words/PROVENANCE.txt).
export const WORDLIST_KAPPA = "did:holo:sha256:2f5eed53a4727b4bf8880d8f3f199efc90e58503646d9ff8eff3a2ed3b24dbda";
export const DEFAULT_WORDS = 3;
export const SEP = ".";

const hexOf = (k) => String(k).split(":").pop();
const parseList = (t) => String(t).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

// kappaToWords(κ, wordlist) → "w0.w1.w2" — base-W decomposition of the κ's leading bits.
// idx_i = (v / W^i) mod W, where v = the κ's leading ceil(n·log2 W / 8) bytes.
export function kappaToWords(kappa, wordlist, { n = DEFAULT_WORDS } = {}) {
  const list = Array.isArray(wordlist) ? wordlist : parseList(wordlist);
  const W = BigInt(list.length);
  if (W < 2n) throw new Error("holo-words: wordlist too small");
  const bytes = Math.ceil((n * Math.log2(list.length)) / 8);
  let v = BigInt("0x" + hexOf(kappa).slice(0, bytes * 2));
  const out = [];
  for (let i = 0; i < n; i++) { out.push(list[Number(v % W)]); v /= W; }
  return out.join(SEP);
}

// wordsToValue(words, wordlist) → bigint v = Σ idx_i·W^i (the κ-leading integer the
// words decode to) | null if any word is not in the list. The cheap candidate filter.
export function wordsToValue(words, wordlist) {
  const list = Array.isArray(wordlist) ? wordlist : parseList(wordlist);
  const map = listIndex(list);
  const parts = String(words).toLowerCase().split(SEP).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const W = BigInt(list.length);
  let v = 0n;
  for (let i = parts.length - 1; i >= 0; i--) {
    const idx = map.get(parts[i]);
    if (idx === undefined) return null;
    v = v * W + BigInt(idx);
  }
  return v;
}

// a memoized word→index map, cached on the array (Law L3: derive once).
function listIndex(list) {
  if (list._idx) return list._idx;
  const m = new Map();
  for (let i = 0; i < list.length; i++) m.set(list[i], i);
  try { Object.defineProperty(list, "_idx", { value: m, enumerable: false }); } catch { /* frozen */ }
  return m;
}

// is this exactly n dot-separated words, ALL in the list? (the surface's recognizer —
// distinguishes "pretty.needed.chill" from a domain "foo.bar.com" by membership).
export function looksLikeWords(s, wordlist, { n = DEFAULT_WORDS } = {}) {
  const list = Array.isArray(wordlist) ? wordlist : parseList(wordlist);
  const parts = String(s).trim().toLowerCase().split(SEP);
  if (parts.length !== n) return false;
  const map = listIndex(list);
  return parts.every((p) => map.has(p));
}

// ── object/catalog helpers (the candidate set: apps index, a closure, a space) ──
const kappaIn = (c) => c && (c.id || c["@id"] || c.kappa || c["holo:root"]);
const nameIn = (c) => (c && (c["schema:name"] || c.name)) || "";

// wordsForEntry(entry, wordlist) → the entry's three-word address.
export const wordsForEntry = (entry, wordlist, opts) => kappaToWords(kappaIn(entry), wordlist, opts);

// resolveWords(typed, candidates, wordlist) → [{ kappa, name, words }] — VERIFIED.
// Re-derive each candidate's OWN words and admit only on exact match (Law L5).
export function resolveWords(typed, candidates, wordlist) {
  const list = Array.isArray(wordlist) ? wordlist : parseList(wordlist);
  const want = String(typed).trim().toLowerCase();
  if (!looksLikeWords(want, list)) return [];
  const target = wordsToValue(want, list);
  const out = [];
  for (const c of candidates || []) {
    const kappa = kappaIn(c);
    if (!kappa) continue;
    const words = kappaToWords(kappa, list);
    if (wordsToValue(words, list) !== target) continue;     // cheap integer filter
    if (words === want) out.push({ kappa, name: nameIn(c), words });   // exact re-derivation (L5)
  }
  return out;
}

// expandWords(typed, candidates, wordlist) → "holo://<hex>" — the κ link the existing
// navigation already mounts. null unless EXACTLY one (fail-closed on miss/ambiguity).
export function expandWords(typed, candidates, wordlist) {
  const hits = resolveWords(typed, candidates, wordlist);
  return hits.length === 1 ? "holo://" + hexOf(hits[0].kappa) : null;
}

// suggestWords(prefix, candidates, wordlist) → verified autocomplete (AutoSuggest).
export function suggestWords(prefix, candidates, wordlist, limit = 8) {
  const list = Array.isArray(wordlist) ? wordlist : parseList(wordlist);
  const q = String(prefix || "").trim().toLowerCase();
  const out = [];
  for (const c of candidates || []) {
    if (!kappaIn(c)) continue;
    const words = wordsForEntry(c, list);
    if (!q || words.startsWith(q)) out.push({ words, kappa: kappaIn(c), name: nameIn(c) });
    if (out.length >= limit) break;
  }
  return out;
}

// ── isomorphic default-wordlist loader (Node reads the vendored file; browser fetches) ──
let _wl = null;
export async function defaultWordlist() {
  if (_wl) return _wl;
  if (typeof window !== "undefined") {
    for (const u of ["_shared/words/bip39-english.txt", "pkg/words/bip39-english.txt", "/usr/lib/holo/words/bip39-english.txt"]) {
      try { const r = await fetch(u); if (r.ok) return (_wl = parseList(await r.text())); } catch (e) { /* try next */ }
    }
    return (_wl = []);
  }
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const dir = dirname(fileURLToPath(import.meta.url));
  return (_wl = parseList(readFileSync(join(dir, "words/bip39-english.txt"), "utf8")));
}

// ── browser binding: window.HoloWords over the live apps catalog + the pinned list ──
if (typeof window !== "undefined" && !window.HoloWords) {
  let _cat = null, _loading = null;
  const fromDoc = (j) => (j && (j["dcat:dataset"] || j["@graph"])) || (Array.isArray(j) ? j : []);
  async function catalog() {
    if (_cat) return _cat;
    if (!_loading) _loading = (async () => {
      for (const u of ["apps/index.jsonld", "/apps/index.jsonld"]) {
        try { const r = await fetch(u); if (r.ok) return (_cat = fromDoc(await r.json())); } catch (e) { /* next */ }
      }
      return (_cat = []);
    })();
    return _loading;
  }
  window.HoloWords = {
    WORDLIST_KAPPA, kappaToWords, wordsForEntry, looksLikeWords,
    setCatalog: (j) => { _cat = fromDoc(j); },
    of: async (kappa) => kappaToWords(kappa, await defaultWordlist()),
    is: async (s) => looksLikeWords(s, await defaultWordlist()),
    resolve: async (typed) => resolveWords(typed, await catalog(), await defaultWordlist()),
    expand: async (typed) => expandWords(typed, await catalog(), await defaultWordlist()),
    suggest: async (prefix, limit) => suggestWords(prefix, await catalog(), await defaultWordlist(), limit),
  };
}
