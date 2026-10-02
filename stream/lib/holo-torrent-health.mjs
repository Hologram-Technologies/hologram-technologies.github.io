// holo-torrent-health.mjs — L4 of HOLO-TORRENT-TV: Q owns the library's health.
//
// Q reports how the library is doing — origins alive, quality reach, refusals healed — in its own voice,
// and follows the notice discipline (holo-q-notices): GROUNDED + cited, or SILENT. It never invents a
// title or a quality it can't point to in the data, never spams, and never ACTS on its own — anything
// actionable is a proposal that needs your tap (holo-q-consent). Torrent-supplied text (titles) is DATA,
// never an instruction: it is sanitized and only ever quoted, so a title that says "SYSTEM: do X" is just
// a string Q shows you. Pure + node/SW/DOM safe.

// titles come from untrusted torrent metadata — strip control chars, collapse space, cap length, never interpret.
const CTRL = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + String.fromCharCode(127) + "]+", "g");
const sane = (t) => String(t == null ? "" : t).replace(CTRL, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const qlabel = (h) => (h >= 4320 ? "8K" : h >= 2160 ? "4K" : h >= 1440 ? "1440p" : h >= 1080 ? "1080p" : h >= 720 ? "720p" : h > 0 ? h + "p" : "SD");

// libraryHealth(index, { events }) → a grounded summary computed ONLY from the index + observed events.
export function libraryHealth(index, { events = [] } = {}) {
  const ents = index.entries();
  let origins = 0; const byHeight = {};
  for (const [, os] of ents) { origins += os.length; for (const o of os) { const h = (o.quality && o.quality.height) || 0; byHeight[h] = (byHeight[h] || 0) + 1; } }
  const count = (t) => events.filter((e) => e.type === t).length;
  const streams = count("stream"), refusals = count("refuse") + count("tamper"), heals = count("heal");
  return {
    titles: ents.length, origins, byHeight,
    maxHeight: Math.max(0, ...Object.keys(byHeight).map(Number)),
    streams, refusals, heals,
    refusalRate: streams ? refusals / streams : 0,
  };
}

// narrate(events) → grounded Q lines, each CITING the event it stands on. [] = silent (nothing to say).
// Never references a title/quality not present in `events`. Statements only — no side effects.
export function narrate(events = []) {
  const out = [];
  for (const e of events) {
    if (e.type === "heal" && e.title) out.push({ text: `Kept "${sane(e.title)}" safe — a bad source was dropped and it healed from another.`, cite: { event: "heal", title: e.title } });
    else if (e.type === "upgrade" && e.title && e.height) out.push({ text: `"${sane(e.title)}" now streams in ${qlabel(e.height)}, verified.`, cite: { event: "upgrade", title: e.title, height: e.height } });
    else if (e.type === "refuse" && e.title) out.push({ text: `Refused an unverified copy of "${sane(e.title)}" — it will not play until it checks out.`, cite: { event: "refuse", title: e.title } });
  }
  return out;
}

// propose(health) → an OPTIONAL suggestion the user must approve; never auto-acts (needsConsent always true).
export function propose(health) {
  if (health && health.titles > 0 && health.maxHeight > 0 && health.maxHeight < 2160)
    return { text: `Want me to look for a 4K source for titles that top out at ${qlabel(health.maxHeight)}?`, action: "find-better-quality", needsConsent: true, cite: { maxHeight: health.maxHeight } };
  return null;
}

// summary(health) → a one-line, plain, grounded status (for Q.health() / window.HoloSysHealth).
export function summary(health) {
  if (!health || !health.titles) return "Library is empty.";
  return `${health.titles} titles, ${health.origins} verified sources, up to ${qlabel(health.maxHeight)}` +
    (health.streams ? ` (${health.heals} healed, ${health.refusals} unverified refused of ${health.streams} played)` : "");
}

export default { libraryHealth, narrate, propose, summary };
