#!/usr/bin/env node
// holo-v86-catalog.mjs — derive the WHOLE Holo v86 catalog from v86's own profiles (data, not code).
//
// Fetches v86's src/browser/main.js, parses every OS profile, classifies its acquisition FORMAT
// (single-file · chunked(use_parts) · bzImage · 9pfs · +instant-state), and emits:
//   • holo-apps/apps/holo-v86/profiles.json  — normalized spec per id (the ingest/chunked adapters consume this)
//   • holo-apps/apps/holo-v86/catalog.json   — the launcher's list (one tile per OS, classified)
// So "integrate every emulation" becomes: regenerate the catalog, then precompile any id on demand.
//
//   node tools/holo-v86-catalog.mjs

import { writeFileSync } from "node:fs";

const MAIN = "https://raw.githubusercontent.com/copy/v86/master/src/browser/main.js";
const APP = "C:/Users/pavel/Desktop/HOLOGRAM/holo-apps/apps/holo-v86";
const HOST = "https://i.copy.sh/";

const src = await (await fetch(MAIN)).text();
let a = src.indexOf("const oses"); a = src.indexOf("[", a);
let depth = 0, end = a;
for (let i = a; i < src.length; i++) { const c = src[i]; if (c === "[") depth++; else if (c === "]") { depth--; if (depth === 0) { end = i; break; } } }
const block = src.slice(a + 1, end);
const entries = []; let d = 0, st = -1;
for (let i = 0; i < block.length; i++) { const c = block[i]; if (c === "{") { if (d === 0) st = i; d++; } else if (c === "}") { d--; if (d === 0) entries.push(block.slice(st, i + 1)); } }

const evalNum = (x) => { try { return Function("return " + x)(); } catch { return 0; } };
const str = (e, k) => (e.match(new RegExp(k + ':\\s*"([^"]*)"'))||[])[1] || "";
const has = (e, k) => new RegExp("\\b" + k + "\\s*:").test(e);
// pull a drive sub-object's url/size/fixed_chunk_size
function drive(e) {
  for (const k of ["fda", "cdrom", "hda", "hdb", "bzimage"]) {
    const m = e.match(new RegExp(k + "\\s*:\\s*\\{([\\s\\S]*?)\\}"));
    if (m) { const body = m[1];
      // url may be a ternary (ON_LOCALHOST ? host+"x" : "//cdn/x"); grab the host+"x" branch first.
      const url = (body.match(/host\s*\+\s*"([^"]+)"/)||[])[1] || (body.match(/"(\/\/[^"]+)"/)||[])[1] || (body.match(/url:\s*"([^"]+)"/)||[])[1] || "";
      const size = evalNum((body.match(/size:\s*([0-9*\s]+?)[,}]/)||[])[1] || "0");
      const chunk = evalNum((body.match(/fixed_chunk_size:\s*([0-9*\s]+?)[,}]/)||[])[1] || "0");
      const useParts = /use_parts\s*:\s*true/.test(body);
      return { kind: k, url, size, chunk, useParts };
    }
  }
  return null;
}
const familyOf = (n) => /BSD/.test(n) ? "BSD" : /Linux/.test(n) ? "Linux" : /DOS/.test(n) ? "DOS" : /Windows/.test(n) ? "Windows" : "Other";
const proprietary = (n) => /Windows|BeOS|MS-DOS|OS\/2|Mac|Chokanji|BSD\/OS|Android/.test(n);

const profiles = {}, byName = new Map();
for (const e of entries) {
  const id = str(e, "id"); const name = str(e, "name"); if (!id || !name) continue;
  const dr = drive(e);
  const is9p = has(e, "filesystem") && /basefs/.test(e);
  const hasState = /\bstate\s*:/.test(e);
  let format, drv = dr?.kind || "", url = dr?.url || "", size = dr?.size || 0, chunk = dr?.chunk || 0;
  const zst = (url || "").endsWith(".zst") || (str(e, "state").endsWith(".zst"));
  if (dr?.kind === "bzimage") format = "bzimage";
  else if (is9p) format = "9pfs";
  else if (dr?.useParts) format = "chunked";
  else if (dr) format = "single";
  else if (hasState) { format = "state"; }
  else continue;
  const memory = evalNum((e.match(/memory_size:\s*([0-9*\s]+?)[,}]/)||[])[1] || "0") || 128 * 1024 * 1024;
  const vga = evalNum((e.match(/vga_memory_size:\s*([0-9*\s]+?)[,}]/)||[])[1] || "0") || 8 * 1024 * 1024;
  const view = drv === "bzimage" ? "serial" : "vga";
  const basename = format === "chunked" ? url.slice(0, url.lastIndexOf("/") + 1) : "";
  const ext = format === "chunked" ? url.slice(url.lastIndexOf("/") + 1) : "";
  profiles[id] = { id, name, format, drive: drv, host: HOST, url, basename, ext, size, chunkSize: chunk, isZstd: zst, memory, vga, view, instant: hasState, family: familyOf(name), license: proprietary(name) ? "proprietary" : "open" };
  // dedupe for the menu: one tile per name (prefer a cold/boot, non-state variant)
  const prev = byName.get(name);
  if (!prev || (prev.instant && !hasState)) byName.set(name, profiles[id]);
}

const cmd = (p) => p.format === "chunked" ? `node tools/holo-v86-chunked.mjs ${p.id}`
  : p.format === "9pfs" ? `# 9pfs adapter pending (${p.id})`
  : p.format === "state" ? `# state adapter pending (${p.id})`
  : `node tools/holo-v86-ingest.mjs ${p.id}`;
const medium = (p) => ({ single: p.drive === "cdrom" ? "CD" : p.drive === "fda" ? "Floppy" : "HD", chunked: "HD · chunked", bzimage: "bzImage", "9pfs": "9pfs", state: "state" }[p.format] || p.format);

const os = [...byName.values()].sort((x, y) => x.name.localeCompare(y.name)).map((p) => ({
  id: p.id, name: p.name, family: p.family, arch: "x86", status: p.instant ? "Modern" : "Classic",
  medium: medium(p), notes: `${p.format}${p.license === "proprietary" ? " · user-supplied image" : ""}`,
  format: p.format, license: p.license, ingest: p.id, cmd: cmd(p),
}));

writeFileSync(APP + "/profiles.json", JSON.stringify(profiles, null, 2) + "\n");
writeFileSync(APP + "/catalog.json", JSON.stringify({
  $comment: "Generated by tools/holo-v86-catalog.mjs from v86's profiles. Readiness is probed at runtime (HEAD /apps/<id>/index.html); precompile an OS with its `cmd`.",
  host: HOST, os,
}, null, 2) + "\n");

const byFmt = os.reduce((m, o) => (m[o.format] = (m[o.format] || 0) + 1, m), {});
console.log(`holo-v86-catalog: ${Object.keys(profiles).length} profiles → ${os.length} menu tiles`);
console.log("  by format:", JSON.stringify(byFmt));
console.log("  wrote profiles.json + catalog.json");
