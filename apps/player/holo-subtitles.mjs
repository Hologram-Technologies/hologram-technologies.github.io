// holo-subtitles.mjs — a subtitle track as a κ-object bound to a title (Bazarr's job, κ-native). Fetch or
// author once (SRT/VTT), content-address the canonical WebVTT, serve O(1) + offline + verifiable. The player
// hands the κ-served VTT to the video engine as a <track>.
//
// Pure ESM — Node witnesses parse + seal + verify.

function jcs(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
}
async function sha256hex(s) {
  if (typeof crypto !== "undefined" && crypto.subtle) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
  const { createHash } = await import("node:crypto"); return createHash("sha256").update(s).digest("hex");
}

// parseSRT(text) → [{ start, end, text }] in seconds. Tolerant of CRLF + blank-line blocks.
export function parseSRT(text) {
  const cues = [];
  const blocks = String(text || "").replace(/\r/g, "").trim().split(/\n\n+/);
  const ts = (t) => { const m = t.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : null; };
  for (const b of blocks) {
    const lines = b.split("\n");
    const tl = lines.find((l) => l.includes("-->"));
    if (!tl) continue;
    const [a, c] = tl.split("-->");
    const start = ts(a), end = ts(c);
    if (start == null || end == null) continue;
    const txt = lines.slice(lines.indexOf(tl) + 1).join("\n").trim();
    if (txt) cues.push({ start, end, text: txt });
  }
  return cues;
}

const vt = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(3, "0")}`; };
// toVTT(cues | srtText) → a canonical WebVTT string.
export function toVTT(input) {
  const cues = typeof input === "string" ? parseSRT(input) : input || [];
  return "WEBVTT\n\n" + cues.map((c, i) => `${i + 1}\n${vt(c.start)} --> ${vt(c.end)}\n${c.text}`).join("\n\n") + "\n";
}

// sealTrack(titleKappa, lang, srtOrVtt) → a κ-addressed subtitle track ({ id, titleKappa, lang, vtt }).
export async function sealTrack(titleKappa, lang, srtOrVtt) {
  const vtt = /^WEBVTT/.test(String(srtOrVtt || "").trim()) ? String(srtOrVtt) : toVTT(srtOrVtt);
  const body = { titleKappa: titleKappa || "", lang: lang || "en", vtt };
  return { id: "sha256:" + (await sha256hex(jcs(body))), ...body };
}
export async function verifyTrack(t) {
  if (!t || typeof t.vtt !== "string") return false;
  const re = await sealTrack(t.titleKappa, t.lang, t.vtt);
  return re.id === t.id;
}
// a data: URL the video engine can attach as a <track src> (no network once κ holds it).
export const vttDataUrl = (t) => "data:text/vtt;charset=utf-8," + encodeURIComponent(t.vtt);

export default { parseSRT, toVTT, sealTrack, verifyTrack, vttDataUrl };
if (typeof window !== "undefined") window.HoloSubtitles = { parseSRT, toVTT, sealTrack, verifyTrack, vttDataUrl };
