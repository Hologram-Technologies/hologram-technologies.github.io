// holo-chapters.mjs — "Skip Intro / Skip Credits" as chapter markers bound to a title κ (Intro-Skipper's
// job, κ-native). A chapter set is content-addressed: detect once, seal under the title's κ, reuse forever
// across devices (Law-L5 verifiable). The player asks activeSkip(position) every status tick and shows one
// button when the playhead is inside a skippable window.
//
// Pure ESM — Node witnesses the geometry exactly.

function jcs(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
}
async function sha256hex(s) {
  if (typeof crypto !== "undefined" && crypto.subtle) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
  const { createHash } = await import("node:crypto"); return createHash("sha256").update(s).digest("hex");
}

const LABEL = { intro: "Skip Intro", recap: "Skip Recap", credits: "Skip Credits" };

// sealChapters(titleKappa, chapters) → a κ-addressed chapter object. chapters: [{kind,start,end}] (seconds).
export async function sealChapters(titleKappa, chapters) {
  const clean = (chapters || []).filter((c) => c && c.end > c.start).map((c) => ({ kind: c.kind, start: +c.start, end: +c.end })).sort((a, b) => a.start - b.start);
  const body = { titleKappa: titleKappa || "", chapters: clean };
  return { id: "sha256:" + (await sha256hex(jcs(body))), ...body };
}
export async function verifyChapters(obj) {
  if (!obj || !Array.isArray(obj.chapters)) return false;
  const re = await sealChapters(obj.titleKappa, obj.chapters);
  return re.id === obj.id;
}

// activeSkip(position, chapters) → { label, target } when the playhead is inside a skippable window, else
// null. Intro/recap skip to the window end; credits skip to its end (next-episode/up-next takes over there).
export function activeSkip(position, chapters) {
  for (const c of chapters || []) {
    if (position >= c.start && position < c.end - 0.3) return { label: LABEL[c.kind] || "Skip", target: c.end, kind: c.kind };
  }
  return null;
}

export default { sealChapters, verifyChapters, activeSkip };
if (typeof window !== "undefined") window.HoloChapters = { sealChapters, verifyChapters, activeSkip };
