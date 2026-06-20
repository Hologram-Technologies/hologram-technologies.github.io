#!/usr/bin/env node
// holo-pretty-link-witness.mjs — PROVE the short/pretty external address bundle: a κ spelled as a
// CIDv1 (shorter + IPFS-interoperable), a clean /~<app>#k=<cid> route, and an Open Graph card with a
// content-derived κ-identicon — WITHOUT breaking decentralized interoperability (the name is a hint,
// the κ is the truth, and the bytes still re-derive). Parts:
//   A · the CID is a LOSSLESS, shorter, standard spelling of the κ (round-trips; valid CIDv1; the
//       identicon is deterministic from the same bytes) — pure, all sampled apps.
//   B · the pretty link, live in a COLD browser: /~notepad#k=<cid> opens + renders the app, runs on the
//       Holo Runtime worker, the CID in the link decodes to the app's real κ (self-verifying), and the
//       served page carries a per-app OG card (crawler-readable meta + a valid identicon SVG).
//   node tools/holo-pretty-link-witness.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const APPS = process.env.HOLO_APPS_DIR || join(here, "../../../holo-apps/apps");
const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };

const { kappaToCid, cidToKappa, isCid } = await import(pathToFileURL(join(OS, "usr/lib/holo/holo-cid.mjs")));
const { identiconSvg } = await import(pathToFileURL(join(OS, "usr/lib/holo/holo-identicon.mjs")));
const rootOf = (id) => JSON.parse(readFileSync(join(APPS, id, "holospace.lock.json"), "utf8")).root;

// ── PART A · the CID is a lossless, shorter, standard spelling of the κ (pure) ──
const SAMPLE = ["notepad", "files", "search", "wallet", "music", "git"];
let rt = 0, shorter = 0, validCid = 0; const lens = [];
for (const id of SAMPLE) {
  const k = rootOf(id); const cid = kappaToCid(k); // base32 canonical CIDv1
  if (cidToKappa(cid) === k) rt++;
  if (cid.length < k.length) shorter++;            // vs the full did:holo:sha256:… form
  if (/^bafkrei[a-z2-7]+$/.test(cid) && isCid(cid)) validCid++;
  lens.push(`${id}:${cid.length}c`);
}
rec("a κ round-trips losslessly through its CIDv1 (cid → κ === original) — the address is shorter, not different", rt === SAMPLE.length, `${rt}/${SAMPLE.length} · ${lens.join(" ")}`);
rec("the CIDv1 is shorter than the did:holo form AND a standard, IPFS-interoperable spelling (bafkrei…, multibase base32 · multicodec raw · sha2-256)", shorter === SAMPLE.length && validCid === SAMPLE.length, `did 80c → cid ${kappaToCid(rootOf("notepad")).length}c`);
let det = true, distinct = true; const a1 = identiconSvg(rootOf("notepad"));
if (identiconSvg(rootOf("notepad")) !== a1) det = false;
if (identiconSvg(rootOf("files")) === a1) distinct = false;
rec("the κ-identicon is DETERMINISTIC from the content address (same κ → same picture) and distinct per app — the picture IS the proof, prettier", det && distinct && a1.startsWith("<svg") && a1.trim().endsWith("</svg>"));

// ── PART B · the pretty link, live in a cold browser ──
const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
const cid = kappaToCid(rootOf("notepad"), "base32");
const prettyPath = `/~notepad`;
const prettyLink = `${base}${prettyPath}?sw=1#k=${cid}`;
console.log(`\n  PRETTY SHARE LINK:\n    ${base}${prettyPath}#k=${cid}\n  (was: ${base}/holospace.html?app=notepad#k=did:holo:sha256:${rootOf("notepad").split(":").pop()})\n`);

// the OG card is read by crawlers from the RAW HTML (no JS) — fetch it server-side.
const htmlRes = await fetch(`${base}${prettyPath}`);
const html = await htmlRes.text();
const ogTitle = (html.match(/og:title" content="([^"]+)"/) || [])[1] || "";
const ogImg = (html.match(/og:image" content="([^"]+)"/) || [])[1] || "";
rec("the pretty route serves a per-app OPEN GRAPH card the chat crawler can read (og:title · og:image · twitter card) — a beautiful preview, no JS", /Notepad/i.test(ogTitle) && /\/~notepad\/og\.svg/.test(ogImg) && /summary_large_image/.test(html), `og:title="${ogTitle}"`);
const svgRes = await fetch(`${base}${prettyPath}/og.svg`); const svg = await svgRes.text();
rec("the OG image is the content-derived identicon SVG (valid, deterministic, served image/svg+xml)", /svg\+xml/.test(svgRes.headers.get("content-type") || "") && svg.startsWith("<svg") && svg === identiconSvg(rootOf("notepad"), { size: 320, label: "Holo Notepad" }), `${svg.length} bytes`);

let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { rec("playwright available", false, "not installed: " + e.message); }
if (chromium) {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 740 } });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(prettyLink, { waitUntil: "load", timeout: 30000 });
    let rendered = false, bodyLen = 0;
    for (let i = 0; i < 100; i++) {
      const fr = page.frames().find((f) => /\/apps\/notepad\//.test(f.url()));
      if (fr) { try { bodyLen = await fr.evaluate(() => document.body ? document.body.innerText.length + document.querySelectorAll("textarea,[contenteditable],button,input").length : 0); } catch {} if (bodyLen > 0) { rendered = true; break; } }
      await page.waitForTimeout(150);
    }
    const coldMs = Date.now() - t0;
    const sw = await page.evaluate(async () => { for (let i = 0; i < 40 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100)); return navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : ""; });
    await page.screenshot({ path: join(here, "holo-pretty-link-witness.png") });
    rec("the clean /~app#k=<cid> link OPENS and RENDERS the app in a COLD browser (the short Telegram link)", rendered, `notepad · ${coldMs} ms · body ${bodyLen}`);
    rec("the shared app runs on the ONE Holo Runtime delivery worker (holo-fhs-sw.js)", /holo-fhs-sw\.js/.test(sw), sw.split("/").pop() || "none");
    rec("the CID in the link DECODES to the app's real κ — the short address is self-verifying, not a lookup (Law L1: name is a hint, κ is the truth)", cidToKappa(cid) === rootOf("notepad"), `${cid.slice(0, 16)}… → …${rootOf("notepad").slice(-8)}`);
    console.log(`\n  screenshot proof → tools/holo-pretty-link-witness.png`);
    await browser.close();
  } catch (e) { try { await browser.close(); } catch {} rec("browser run completed", false, String(e && e.message || e)); }
}
await close();

const witnessed = failed === 0 && passed >= 7;
console.log(`\n${witnessed ? "WITNESSED ✓" : "INCOMPLETE ✗"} — ${passed}/${passed + failed} · short + pretty + self-verifying external addresses`);
writeFileSync(join(here, "holo-pretty-link-witness.result.json"),
  JSON.stringify({ witnessed, passed, failed, sample: SAMPLE,
    covers: results.filter((r) => r.ok).map((r) => r.name.slice(0, 56)), results,
    spec: "An external share address is made shorter (κ spelled as a lossless, IPFS-interoperable CIDv1 — ~30% shorter than the did:holo form), cleaner (/~<app>#k=<cid> route), and prettier (a per-app Open Graph card with a deterministic, content-derived κ-identicon the chat crawler reads from static HTML) — without breaking decentralized interoperability: the path name is a hint, the #k= CID is a lossless spelling of the κ that re-derives to the app's content address, and the served app bytes are re-derived by the runtime worker (Law L5). NOTE: the dev server injects the per-app OG meta to prove the mechanism; a static host needs the build to pre-render per-app /~<app> pages (or host templating). The generic card + CID + clean route work on any host." }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
