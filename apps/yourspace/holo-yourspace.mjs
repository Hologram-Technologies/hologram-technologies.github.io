// holo-yourspace.mjs — YOUR SPACE: the profile IS a κ-object, the link IS the space.
//
// HOLO-YOURSPACE-PROMPT.md S0-S2. MySpace's loop (see a page → "I want one" → make yours →
// share the link) rebuilt on the holospace laws. Sibling of apps/spaces/holo-spaces.mjs —
// same laws, DIFFERENT identity tuple (that tuple is frozen: any new key would move every
// shipped Space κ, so the profile is its own v2 object, not an extension).
//
// Law L1: a profile's κ is BLAKE3 over its CANONICAL identity tuple; presentation never
// enters the hash. Law L5: bytes must re-derive to their κ or they are refused, never shown.
// 100% serverless: the profile travels SELF-CONTAINED in the link fragment (#p=v2.<b64url>),
// so a cold peer on any phone or desktop reconstructs it with NO server, and the fragment
// never reaches one (server-blind, same posture as the portal #k= and room #room= links).
//
// Pure and dependency-free (browser + Node witness run the exact same bytes): the browser
// lazy-imports the served /_shared BLAKE3; the witness INJECTS it via setBlake3(). Fail-LOUD —
// a mint with no hasher THROWS (silent hash drift is what §1.2 exists to prevent).

const PREFIX = "did:holo:blake3:";
const subtle = () => globalThis.crypto.subtle;

let _b3 = null;
export function setBlake3(fn) { _b3 = fn; }
async function blake3hex(bytes) {
  // the vendored sibling FIRST (works on ANY static host, no SW, no OS tree), then the OS /_shared
  // drop-in. Fail-LOUD if neither: silent hash drift is what §1.2 exists to prevent.
  if (!_b3) { try { _b3 = (await import("./holo-blake3.mjs")).blake3hex; } catch (e) { /* keep trying */ } }
  if (!_b3) { try { _b3 = (await import("/_shared/holo-blake3.mjs")).blake3hex; } catch (e) { /* not the browser */ } }
  if (!_b3) throw new Error("holo-yourspace: BLAKE3 hasher unavailable (call setBlake3)");
  return _b3(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

// ── canonical identity ──────────────────────────────────────────────────────────────────
// A profile's identity is exactly this tuple; everything else is presentation. Frozen once
// live — extend by v3, never by mutating v2. Fields:
//   name/bio/avatar   who this is (avatar = emoji | https url | κ | "")
//   accent/mood       the look (accent = #hex; mood = a named vibe, also keys a preset wallpaper)
//   wallpaper         κ | https url | live:<scene> | preset:<name> | ""
//   song              the profile song — { title, artist, art, query, preview } (query re-finds
//                     it anywhere; preview = 30s mp3 url so a cold guest hears it instantly)
//   top               up to 8 doors — { name, link } — a friend's space link or any url
//   wall              the comments wall: a messenger room join link ("" until welded)
//   via               fork lineage — { k: parent κ hex, name: parent's name } ("" if original)
export const MOODS = ["cosmic", "vaporwave", "cozy", "neon", "noir", "sunset", "forest", "ocean", "chaos"];
export const TOP_MAX = 8;

// ── v3 — the 2004 fields (HOLO-MYSPACE-AUTHENTIC A1). v2 is FROZEN (live links must keep
// resolving); v3 EXTENDS: decode() reads both, upgrade() lifts v2 → v3 losslessly. Volatile
// things (last login, online-now, counts) are PRESENTATION and never enter this tuple.
export const V3_INTERESTS = ["general", "music", "movies", "television", "books", "heroes"];
export const V3_DETAILS = ["status", "hereFor", "hometown", "zodiac", "smokeDrink", "children", "education", "occupation"];
export const BLOG_MAX = 5;

const str = (s) => String(s || "");
const strMap = (obj, keys) => { const o = {}; for (const k of keys) o[k] = str(obj && obj[k]); return o; };

function identity3(p = {}) {
  const song = p.song && (p.song.title || p.song.query) ? {
    title: str(p.song.title), artist: str(p.song.artist),
    art: httpsOrEmpty(p.song.art), query: str(p.song.query), preview: httpsOrEmpty(p.song.preview),
  } : null;
  const via = p.via && (hexOf(p.via.k) || p.via.name) ? { k: hexOf(p.via.k), name: str(p.via.name) } : null;
  return {
    v: 3,
    kind: "profile",
    name: str(p.name),
    headline: str(p.headline),                            // the quote beside the photo (":-)")
    avatar: str(p.avatar),
    accent: /^#[0-9a-f]{3,8}$/i.test(p.accent || "") ? p.accent.toLowerCase() : "",
    mood: { emo: str(p.mood && p.mood.emo), word: str(p.mood && p.mood.word) },
    demog: strMap(p.demog, ["gender", "age", "city", "region", "country"]),
    interests: strMap(p.interests, V3_INTERESTS),
    details: strMap(p.details, V3_DETAILS),
    blurbs: { aboutMe: str(p.blurbs && p.blurbs.aboutMe), meet: str(p.blurbs && p.blurbs.meet) },
    blog: (p.blog || []).slice(0, BLOG_MAX)
      .map((b) => ({ title: str(b && b.title), link: str(b && b.link) })).filter((b) => b.title || b.link),
    wallpaper: str(p.wallpaper),
    song,
    top: (p.top || []).slice(0, TOP_MAX)
      .map((d) => ({ name: str(d && d.name), link: str(d && d.link), photo: str(d && d.photo) }))
      .filter((d) => d.link),
    wall: str(p.wall),
    layout: str(p.layout),                                // κ-link of a Layout object (A4) or ""
    customCss: sanitizeCss(p.customCss),                  // the sacred field — CSS-only, fail-closed
    via,
  };
}

// upgrade(v2) → v3, lossless: bio → blurbs.aboutMe, mood word carries over, doors gain photo:"".
export function upgrade(p) {
  const id = identity(p);
  if (id.v === 3) return id;
  return identity3({
    ...id, headline: "", mood: { emo: "", word: id.mood }, blurbs: { aboutMe: id.bio, meet: "" },
    top: id.top.map((d) => ({ ...d, photo: "" })),
  });
}

// sanitizeCss — the 2004 paste-your-layout-code hack, made lawful. CSS ONLY, fail-closed:
// any breakout vector (element close, @import, expression, non-data/https url, behavior) →
// "" (the default skin), never a partial strip that might recombine. 32KB cap.
export function sanitizeCss(css) {
  const s = str(css);
  if (!s) return "";
  if (s.length > 32768) return "";
  if (/[<]|@import|expression\s*\(|behavior\s*:|javascript\s*:|url\(\s*['"]?\s*(?!data:|https:)[a-z]/i.test(s)) return "";
  return s;
}

export function identity(p = {}) {
  if (p && (p.v === 3 || p.headline !== undefined || p.blurbs !== undefined || p.interests !== undefined)) return identity3(p);
  const song = p.song && (p.song.title || p.song.query) ? {
    title: String(p.song.title || ""), artist: String(p.song.artist || ""),
    art: httpsOrEmpty(p.song.art), query: String(p.song.query || ""), preview: httpsOrEmpty(p.song.preview),
  } : null;
  const via = p.via && (hexOf(p.via.k) || p.via.name) ? { k: hexOf(p.via.k), name: String(p.via.name || "") } : null;
  return {
    v: 2,
    kind: "profile",
    name: String(p.name || ""),
    bio: String(p.bio || ""),
    avatar: String(p.avatar || ""),
    accent: /^#[0-9a-f]{3,8}$/i.test(p.accent || "") ? p.accent.toLowerCase() : "",
    mood: MOODS.includes(p.mood) ? p.mood : "",
    wallpaper: String(p.wallpaper || ""),
    song,
    top: (p.top || []).slice(0, TOP_MAX)
      .map((d) => ({ name: String((d && d.name) || ""), link: String((d && d.link) || "") }))
      .filter((d) => d.link),
    wall: String(p.wall || ""),
    via,
  };
}

const httpsOrEmpty = (s) => (/^https:\/\//i.test(s || "") ? String(s) : "");

// hexOf(any-κ-form) → 64-hex | "" — accept did:holo:blake3:<hex> | holo://<hex> | bare hex.
export function hexOf(s) {
  const m = String(s || "").match(/[0-9a-f]{64}/i);
  return m ? m[0].toLowerCase() : "";
}

// stableStringify — deterministic JSON (object keys sorted recursively). The bytes we hash.
function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

export function canonicalBytes(p) { return new TextEncoder().encode(stableStringify(identity(p))); }

// kappa(p) → "did:holo:blake3:<hex>" — the profile's single shareable content identity.
export async function kappa(p) { return PREFIX + (await blake3hex(canonicalBytes(p))); }

export async function verify(p, expectedKappa) {
  return (await blake3hex(canonicalBytes(p))) === hexOf(expectedKappa);
}

// verifyBytes — Law L5 over RAW link bytes (dual-read: blake3 canonical, sha256 legacy bridge).
export async function verifyBytes(bytes, expectedKappa) {
  const hex = hexOf(expectedKappa);
  if ((await blake3hex(bytes)) === hex) return true;
  try {
    const d = await subtle().digest("SHA-256", bytes);
    if ([...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("") === hex) return true;
  } catch (e) {}
  return false;
}

// ── the ONE link (self-contained, server-blind) ──────────────────────────────────────────
// Grammar: <base>#p=v2.<b64url(canonicalBytes)> — versioned like the room link (#room=v1.…).
// The κ is NOT carried: it re-derives from the decoded bytes, so the link cannot lie about
// what it contains — decode → identity() → the bytes ARE the profile (L5 by construction).
const b64urlEnc = (bytes) => btoaU(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDec = (s) => Uint8Array.from(atobU(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const btoaU = (s) => (typeof btoa === "function" ? btoa(s) : Buffer.from(s, "binary").toString("base64"));
const atobU = (s) => (typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary"));

export function encode(p) { return b64urlEnc(canonicalBytes(p)); }

// decode(payload) → identity profile | null (never throws on a mangled link — refuse, don't break).
export function decode(payload) {
  try {
    const p = JSON.parse(new TextDecoder().decode(b64urlDec(payload)));
    return p && (p.v === 2 || p.v === 3) && p.kind === "profile" ? identity(p) : null;
  } catch (e) { return null; }
}

export function link(p, base) {
  const b = String(base || (typeof location !== "undefined" ? location.origin + location.pathname : ""));
  const id = identity(p);
  return b + "#p=v" + id.v + "." + encode(id);
}

// parseLink(str) → payload | "" — accepts a full url, a bare fragment, or a bare payload (v2 or v3).
export function parseLink(str) {
  const m = String(str || "").match(/#p=v[23]\.([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  const bare = String(str || "").trim();
  return /^[A-Za-z0-9_-]{20,}$/.test(bare) && decode(bare) ? bare : "";
}

// ── fork — the viral gesture ("Make It Mine") ────────────────────────────────────────────
// One tap on someone else's space mints YOURS: you keep the look you fell in love with
// (wallpaper, accent, mood, song — MAYA: start from the familiar), your identity fields
// clear, lineage records who you forked ("via <name>"), and the parent becomes your first
// door — every fork adds a road BACK up the chain, so attention flows to creators.
export async function fork(parent, parentLink) {
  const id = upgrade(parent);                             // forks are always minted on the newest tuple
  const k = await kappa(identity(parent));                // lineage records the parent's REAL κ (its own version)
  const doorBack = { name: id.name || "a space", link: String(parentLink || ""), photo: id.avatar };
  return identity3({
    ...id,
    // the LOOK survives (accent · wallpaper · song · layout · customCss — MAYA: start from what you loved);
    // IDENTITY clears — these are yours to write.
    name: "", headline: "", avatar: "", wall: "",
    mood: { emo: "", word: "" }, demog: {}, interests: {}, details: {},
    blurbs: { aboutMe: "", meet: "" }, blog: [],
    via: { k: hexOf(k), name: id.name },
    top: [doorBack, ...id.top].filter((d) => d.link).slice(0, TOP_MAX),
  });
}

// withFields(p, patch) → a NEW profile (new κ). Every edit is a mint, never a mutation.
export function withFields(p, patch) { return identity({ ...identity(p), ...patch }); }

// addDoor / removeDoor — the Top 8.
export function addDoor(p, door) {
  const id = identity(p);
  return identity({ ...id, top: [...id.top, { name: String(door.name || ""), link: String(door.link || "") }].slice(0, TOP_MAX) });
}
export function removeDoor(p, index) {
  const id = identity(p);
  return identity({ ...id, top: id.top.filter((_, i) => i !== index) });
}
