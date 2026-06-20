#!/usr/bin/env node
// changelog-feed.mjs — turn the Keep a Changelog CHANGELOG.md into an Atom feed (feed.xml),
// so the changelog is subscribable. Pure Node, no deps. Released versions become entries;
// the [Unreleased] section is omitted (a feed carries shipped releases).
//
//   node system/tools/changelog-feed.mjs [CHANGELOG.md] [feed.xml]
import { readFileSync, writeFileSync } from "node:fs";

const SRC = process.argv[2] || "CHANGELOG.md";
const OUT = process.argv[3] || "feed.xml";
const HTML_OUT = process.argv[4] || "";   // optional: also emit a styled changelog.html (the gateway's Changelog door)
const SITE = process.env.HOLO_SITE || "https://hologram-technologies.github.io/hologram-os";
const REPO = process.env.HOLO_REPO || "https://github.com/Hologram-Technologies/hologram-os";
const SECTIONS = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

function parse(md) {
  const rels = []; let rel = null, sec = null;
  for (const ln of md.split(/\r?\n/)) {
    let m = ln.match(/^##\s+\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/);
    if (m) { rel = { version: m[1], date: m[2] || "", secs: {} }; rels.push(rel); sec = null; continue; }
    m = ln.match(/^###\s+(.+?)\s*$/);
    if (m && rel) { sec = m[1].trim(); rel.secs[sec] ||= []; continue; }
    m = ln.match(/^[-*]\s+(.+)$/);
    if (m && rel && sec) rel.secs[sec].push(m[1].trim());
  }
  return rels;
}

const md = readFileSync(SRC, "utf8");
const releases = parse(md).filter((r) => !/unreleased/i.test(r.version));
const updated = (releases[0]?.date ? releases[0].date + "T00:00:00Z" : new Date().toISOString());

const entries = releases.map((r) => {
  const id = `${REPO}/releases/tag/v${r.version}`;
  let html = "";
  for (const name of SECTIONS) {
    const items = r.secs[name]; if (!items?.length) continue;
    html += `<h3>${name}</h3><ul>` + items.map((i) => `<li>${xml(i)}</li>`).join("") + `</ul>`;
  }
  return `  <entry>
    <title>v${xml(r.version)}</title>
    <id>${xml(id)}</id>
    <link href="${xml(SITE)}/docs/changelog.html"/>
    <updated>${r.date ? r.date + "T00:00:00Z" : updated}</updated>
    <content type="html">${xml(html)}</content>
  </entry>`;
}).join("\n");

const feed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Hologram OS — Changelog</title>
  <subtitle>Notable changes, generated from the repository history.</subtitle>
  <id>${SITE}/docs/changelog.html</id>
  <link href="${SITE}/docs/changelog.html"/>
  <link rel="self" type="application/atom+xml" href="${SITE}/feed.xml"/>
  <updated>${updated}</updated>
  <author><name>Hologram OS</name></author>
${entries}
</feed>
`;

writeFileSync(OUT, feed);
console.log(`changelog-feed: wrote ${OUT} (${releases.length} release entr${releases.length === 1 ? "y" : "ies"})`);

// ── styled changelog.html — the gateway's "Changelog" door opens this in its framed doc-window.
// Self-contained (inline CSS), generated from the SAME parsed releases as the feed so it never drifts.
if (HTML_OUT) {
  const body = releases.map((r) => {
    let secs = "";
    for (const name of SECTIONS) {
      const items = r.secs[name]; if (!items?.length) continue;
      secs += `<h3>${name}</h3><ul>` + items.map((i) => `<li>${xml(i)}</li>`).join("") + `</ul>`;
    }
    return `<section class="rel"><h2>v${xml(r.version)}${r.date ? ` <time>${xml(r.date)}</time>` : ""}</h2>${secs}</section>`;
  }).join("\n");
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>Changelog — Hologram OS</title>
<link rel="alternate" type="application/atom+xml" href="${xml(SITE)}/feed.xml" title="Hologram OS — Changelog"/>
<style>
  :root{ --fg:#eaf0fb; --soft:#c6d2e6; --muted:#8b97ad; --line:#1b2433; --accent:#7defc9; }
  *{box-sizing:border-box} html,body{margin:0}
  body{ background:radial-gradient(120% 120% at 20% 0%, #1b2a4a 0%, #0d1117 58%, #05070c 100%) fixed; color:var(--fg);
    font:400 16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased; padding:clamp(20px,5vw,56px); }
  main{ max-width:760px; margin:0 auto; }
  h1{ font-size:clamp(26px,5vw,34px); letter-spacing:-.02em; margin:0 0 6px; color:#fff; }
  .sub{ color:var(--muted); margin:0 0 34px; }
  .sub a{ color:var(--accent); text-decoration:none; } .sub a:hover{ text-decoration:underline; }
  .rel{ border-top:1px solid var(--line); padding:22px 0; }
  .rel h2{ font-size:19px; margin:0 0 10px; color:#fff; display:flex; align-items:baseline; gap:12px; }
  .rel h2 time{ font:500 13px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; color:var(--muted); }
  h3{ font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); margin:16px 0 6px; }
  ul{ margin:0 0 4px; padding-left:20px; } li{ margin:4px 0; color:var(--soft); }
</style></head>
<body><main>
  <h1>Changelog</h1>
  <p class="sub">Notable changes, generated from the repository history · <a href="${xml(SITE)}/feed.xml">Atom feed</a></p>
  ${body || "<p class=\"sub\">No released versions yet.</p>"}
</main></body></html>`;
  writeFileSync(HTML_OUT, page);
  console.log(`changelog-feed: wrote ${HTML_OUT} (styled page)`);
}
