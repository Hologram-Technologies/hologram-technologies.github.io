// holo-spaces-plan.mjs — intent → a Space. The crown jewel of Holo Spaces' "one voice":
// "make this a cozy reading room with music" becomes a real composition (apps + layout +
// accent + mood), which the surface forks to a new κ. Spine #5.
//
// Two tiers, one seam (the house pattern: baseline is witnessed, Q is a silent upgrade):
//   • baseline — a pure, deterministic planner over the live catalog. Works offline, today,
//     and the witness runs these exact bytes. No model, no network.
//   • Q — if a grounded window.Q is present, it proposes the plan; we VALIDATE its picks against
//     the catalog and fail back to the baseline for anything it gets wrong. Q never bypasses
//     content-addressing: every member it names must resolve to a real app κ or it is dropped.
//
// A "catalog app" here is { root: <64-hex>, name, desc, id } — derived from /apps/index.jsonld.

import { LAYOUTS } from "./holo-spaces.mjs";

// ── mood → accent + the words that evoke it. Order matters: first match wins. ──────────────
const MOODS = [
  { mood: "calm",     accent: "#c77bff", words: ["cozy", "calm", "quiet", "relax", "reading", "read", "zen", "rest", "soft", "gentle", "lounge"] },
  { mood: "focused",  accent: "#5b8cff", words: ["focus", "work", "deep", "study", "concentrate", "productive", "writing", "code", "dev"] },
  { mood: "market",   accent: "#f2c14e", words: ["trade", "trading", "crypto", "finance", "money", "market", "web3", "chain", "wallet", "defi"] },
  { mood: "creative", accent: "#ff3b6b", words: ["create", "creative", "studio", "make", "stream", "live", "channel", "art", "music", "video", "record"] },
  { mood: "curious",  accent: "#2bd4ff", words: ["ai", "think", "learn", "research", "explore", "lab", "experiment", "model"] },
];
const DEFAULT_MOOD = { mood: "open", accent: "#2dd4bf" };

// ── intent words → app-identifier hints (a small, honest synonym bridge). Each hint is matched
//    against catalog app ids/names by suffix/substring; this is what turns "music" into HoloMusic. ─
const HINTS = [
  { words: ["read", "reading", "book", "books", "library", "docs", "document", "documents", "write", "writing"], app: ["docs", "book", "notepad"] },
  { words: ["music", "song", "songs", "audio", "playlist", "vinyl", "amp", "listen"], app: ["music", "amp"] },
  { words: ["video", "videos", "watch", "tube", "youtube", "film", "movie", "play"], app: ["tube", "video", "player", "stream"] },
  { words: ["trade", "trading", "crypto", "swap", "defi", "web3", "token", "tokens", "market"], app: ["trade"] },
  { words: ["chain", "scan", "etherscan", "explorer", "onchain", "evm", "contract"], app: ["etherscan", "evm"] },
  { words: ["wallet", "money", "balance", "pay", "btc", "bitcoin"], app: ["btc", "evm"] },
  { words: ["code", "coding", "program", "dev", "ide", "edit", "notepad"], app: ["code", "notepad"] },
  { words: ["git", "version", "commit", "repo"], app: ["git"] },
  { words: ["build", "compile", "forge", "model", "models"], app: ["forge", "qvac"] },
  { words: ["ai", "think", "chat", "assistant", "q", "intelligence"], app: ["q", "qvac"] },
  { words: ["control", "monitor", "telemetry", "system", "signal"], app: ["control"] },
  { words: ["files", "file", "folder", "folders"], app: ["files"] },
  { words: ["stream", "live", "broadcast", "channel", "capture", "record"], app: ["stream", "capture"] },
  { words: ["terminal", "shell", "linux", "emulate", "emulator"], app: ["linux", "x86", "v86"] },
  { words: ["browse", "browser", "web", "internet"], app: ["browser"] },
  { words: ["meet", "call", "meeting"], app: ["meet"] },
  { words: ["search", "find"], app: ["search"] },
  { words: ["3d", "cosmos", "render", "render", "graphics"], app: ["cosmos", "3d"] },
  { words: ["jupyter", "notebook", "data", "science"], app: ["jupyter"] },
];

const STOP = new Set(["a", "an", "the", "my", "me", "with", "and", "of", "for", "to", "in", "on", "this", "that", "make", "build", "create", "want", "i", "into", "room", "space", "place", "some", "show"]);

export function tokens(intent) {
  return String(intent || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
}

// chooseMood(words) → { mood, accent } — first evocative word wins, else the open default.
export function chooseMood(words) {
  const set = new Set(words);
  for (const m of MOODS) if (m.words.some((w) => set.has(w))) return { mood: m.mood, accent: m.accent };
  return { ...DEFAULT_MOOD };
}

// chooseLayout(intent, n) — an explicit hint in the words wins; otherwise track the shell's
// own member-count → layout choice (single / split-h / primary-rail / grid-2x2 / stack).
export function chooseLayout(intent, n) {
  const s = String(intent || "").toLowerCase();
  if (/\bside by side\b|\bsplit\b|\bbeside\b/.test(s)) return "split-h";
  if (/\bstack(ed)?\b|\bfeed\b|\bscroll\b/.test(s)) return "stack";
  if (/\bgrid\b|\bquad\b|\bfour\b/.test(s)) return "grid-2x2";
  if (n <= 1) return "single";
  if (n === 2) return "split-h";
  if (n === 3) return "primary-rail";
  if (n === 4) return "grid-2x2";
  return "stack";
}

// scoreApp(app, words) — relevance of one catalog app to the intent. Direct name/desc keyword
// overlap counts most; a synonym HINT that points at this app adds a strong, deterministic boost.
function scoreApp(app, words, hintIds) {
  // Whole-word haystack — so "desk" never matches "Desktop" and "ai" never matches "chain".
  const hayWords = new Set((app.name + " " + (app.desc || "") + " " + app.id).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean));
  let s = 0;
  for (const w of words) if (w.length > 2 && hayWords.has(w)) s += 2;
  const idl = String(app.id || "").toLowerCase();
  const nameWords = new Set((app.name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean));
  if (hintIds.some((h) => idl.endsWith(h) || idl.includes("holo" + h) || nameWords.has(h))) s += 5;
  return s;
}

// hintIdsFor(words) → the app-id fragments the intent's synonyms point at (deduped, ordered).
function hintIdsFor(words) {
  const set = new Set(words);
  const ids = [];
  for (const h of HINTS) if (h.words.some((w) => set.has(w))) for (const a of h.app) if (!ids.includes(a)) ids.push(a);
  return ids;
}

// pickApps(intent, catalog, max) → the ordered, deduped catalog apps the intent calls for.
// Deterministic: sort by score desc, then by name (stable tie-break). Empty if nothing scores.
export function pickApps(intent, catalog, max = 4) {
  const words = tokens(intent);
  const hintIds = hintIdsFor(words);
  return (catalog || [])
    .map((a) => ({ a, s: scoreApp(a, words, hintIds) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || String(x.a.name).localeCompare(String(y.a.name)))
    .slice(0, max)
    .map((x) => x.a);
}

// titleFor(intent) → a short, human Space name distilled from the intent.
export function titleFor(intent) {
  const words = tokens(intent);
  if (!words.length) return "New Space";
  return words.slice(0, 4).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

// planSpace(intent, catalog, max) → a composition (the BASELINE). Pure, deterministic, offline.
export function planSpace(intent, catalog, max = 4) {
  const apps = pickApps(intent, catalog, max);
  const { mood, accent } = chooseMood(tokens(intent));
  const layout = chooseLayout(intent, apps.length);
  return {
    name: titleFor(intent),
    layout,
    accent,
    mood,
    members: apps.map((a, i) => ({ kind: "app", root: "did:holo:blake3:" + a.root, position: i })),
  };
}

// planWithQ(intent, catalog, q, max) → a composition, Q-grounded when possible, else baseline.
// q: an object with a `.generate(prompt)` (or `.ask`) that returns text. We ask it for a JSON list
// of app ids; we KEEP only ids that resolve to a real catalog app (content-addressing is not Q's to
// bypass), and fall back to the baseline if it returns nothing usable.
export async function planWithQ(intent, catalog, q, max = 4) {
  const base = planSpace(intent, catalog, max);
  const gen = q && (q.generate || q.ask);
  if (typeof gen !== "function") return base;
  let text;
  try {
    const menu = (catalog || []).map((a) => a.id + " — " + a.name).join("\n");
    text = await gen.call(q,
      "You arrange a room of apps for a person. From ONLY this catalog:\n" + menu +
      "\n\nIntent: \"" + String(intent) + "\"\nReturn a JSON array of up to " + max +
      " app ids (most relevant first), nothing else.");
  } catch { return base; }
  let ids = [];
  try { const m = String(text).match(/\[[^\]]*\]/); ids = m ? JSON.parse(m[0]) : []; } catch { ids = []; }
  const byId = new Map((catalog || []).map((a) => [String(a.id).toLowerCase(), a]));
  const picked = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const a = byId.get(String(id).toLowerCase()) || (catalog || []).find((x) => String(x.id).toLowerCase().endsWith(String(id).toLowerCase()));
    if (a && !picked.includes(a) && picked.length < max) picked.push(a);
  }
  if (!picked.length) return base;                              // Q gave nothing usable → trust the baseline
  const { mood, accent } = chooseMood(tokens(intent));
  return {
    name: titleFor(intent), layout: chooseLayout(intent, picked.length), accent, mood,
    members: picked.map((a, i) => ({ kind: "app", root: "did:holo:blake3:" + a.root, position: i })),
  };
}

// qPickIds(query, catalog, q) → validated κ-roots that Q says match the query, best-first.
// The Living Map's "ask" uses this as a SILENT upgrade over the deterministic ranker: Q's picks are
// kept only when they resolve to a real catalog app (a hallucinated id is dropped — content-addressing
// is never Q's to bypass), and an empty/absent result means "keep your baseline".
export async function qPickIds(query, catalog, q) {
  const gen = q && (q.generate || q.ask);
  if (typeof gen !== "function") return [];
  let text;
  try {
    const menu = (catalog || []).slice(0, 80).map((a) => a.id + " — " + a.name).join("\n");
    text = await gen.call(q, "From ONLY this catalog of apps:\n" + menu + "\n\nWhich apps best match: \"" + String(query) + "\"? Return a JSON array of app ids, most relevant first, nothing else.");
  } catch { return []; }
  let ids = [];
  try { const m = String(text).match(/\[[\s\S]*?\]/); ids = m ? JSON.parse(m[0]) : []; } catch { ids = []; }
  const byId = new Map((catalog || []).map((a) => [String(a.id).toLowerCase(), a]));
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const a = byId.get(String(id).toLowerCase()) || (catalog || []).find((x) => String(x.id).toLowerCase().endsWith(String(id).toLowerCase()));
    if (a && a.root && !out.includes(a.root)) out.push(a.root);   // root = the app's κ-hex
  }
  return out;
}

export { LAYOUTS };
