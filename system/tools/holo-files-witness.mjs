#!/usr/bin/env node
// holo-files-witness.mjs — PROVE the Holo Files explorer works as a real, interactive holospace
// (ADR-0058). Boots apps/files/index.html in REAL Chromium (Playwright) over the κ-route serving
// layer and drives the actual UI the way a person would:
//   • it auto-detects the host OS and wears its native chrome (data-os set; skin label shown);
//   • CLICK INTO HOLOSPACES → drill into a holospace → into its _shared closure → a real file row;
//   • VERIFY A κ → the Verify button re-derives the bytes and the content address matches (Law L5);
//   • a TAMPERED κ is REFUSED (re-derive with a wrong expected hash ⇒ ok:false) — trust by re-derivation;
//   • WRITE TO HOME → a new folder + a file land in the OPFS namespace and the listing reflects it
//     (read-back round-trips), proving Home is genuinely writable while the substrate stays immutable.
// Browser tier (committed result, like boot / qml-render / own-world); the pure engine is holo-files.js.
//
//   node tools/holo-files-witness.mjs

import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const results = []; let passed = 0, failed = 0;
const rec = (name, okv, detail = "") => { results.push({ name, ok: !!okv, detail }); okv ? passed++ : failed++; console.log(`${okv ? "PASS" : "FAIL"} — ${name}${detail ? "  (" + detail + ")" : ""}`); };
const writeResult = (extra = {}) => writeFileSync(join(here, "holo-files-witness.result.json"), JSON.stringify({
  spec: "Holo Files (ADR-0058) — the native, substrate-native file explorer: one window onto the OS's content-addressed object universe + a writable OPFS Home. It auto-detects the host OS and wears its native chrome (Finder/Explorer/Files/Nautilus); every object carries its did:holo κ and re-derives on demand (Law L5 — a tampered byte is refused); Home is read/WRITE while the substrate is read-only; a core part of the World shell. SEAMLESSLY integrates Holo Search (a unified omnibox: recursive local search + paste-a-κ/identifier resolve + open-web answer) and Holo Cloud (it mounts the SAME content-addressed OPFS κ-store the Cloud app uses, so a file sent from Files appears in Holo Cloud — one substrate, not a bridge).",
  authority: "W3C File System Access / OPFS (navigator.storage.getDirectory) · W3C Web Cryptography (SHA-256 re-derivation) · WHATWG Fetch + DOM · W3C UA Client Hints (host detection, holo-platform) · Nextcloud WebDAV (holo-webdav, Holo Cloud) · the unified-window resolve/federate/answer pipeline (Holo Search, no AI) · UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1/L3/L4/L5 · files-community/Files UX (reproduced) · real Chromium via Playwright",
  witnessed: failed === 0 && passed > 0,
  covers: ["files-explorer", "substrate-vfs", "click-navigation", "law-l5-verify", "tamper-refused", "opfs-home-write", "os-adaptive", "core-of-the-shell", "unified-search", "kappa-resolve", "holo-cloud-mount", "cloud-roundtrip-verified", "tabs", "multi-select", "drag-and-drop", "drag-out-as-kappa", "drop-to-materialize", "file-tags", "dual-pane", "sort-group", "status-column", "archives-zip"],
  results, passed, failed, ...extra,
}, null, 2) + "\n");

const { port, close } = await startServer(); const base = `http://127.0.0.1:${port}`;
let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { rec("playwright available", false, e.message); writeResult({ note: "playwright unavailable — browser tier not run" }); close(); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 760 } });
  const page = await ctx.newPage();
  const errs = []; page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); }); page.on("pageerror", (e) => errs.push(String(e)));
  let dialogValue = ""; page.on("dialog", (d) => d.accept(dialogValue));

  // ── boot the explorer directly (top-level, the strongest drive surface) ──────────────
  await page.goto(`${base}/apps/files/index.html`, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#homepg", { timeout: 20000 });
  rec("the explorer boots and paints its Home landing page", true);

  // ── auto-detects the host OS and adapts the chrome ───────────────────────────────────
  const osInfo = await page.evaluate(() => ({ os: document.documentElement.getAttribute("data-os"), accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() }));
  rec("auto-detects the host OS and wears its native chrome (implicit, not stated in the window)", ["windows", "macos", "ios", "ipados", "android", "chromeos", "linux"].includes(osInfo.os) && !!osInfo.accent, `${osInfo.os} · accent ${osInfo.accent}`);

  // ── CLICK INTO HOLOSPACES (the sidebar location) ─────────────────────────────────────
  await page.locator('#side .sitem[data-loc="2"]').first().click();
  await page.waitForSelector("#list [data-i]", { timeout: 15000 });
  const appCount = await page.evaluate(() => document.querySelectorAll("#list [data-i]").length);
  rec("clicking Holospaces lists every app from the catalog", appCount > 5, `${appCount} holospaces`);

  // ── drill into a holospace → its _shared closure → a real file (each a κ-object) ──────
  const appIdx = await page.evaluate(() => { const r = [...document.querySelectorAll("#list [data-i]")].find((x) => x.textContent.includes("Holo Files")); return r ? +r.dataset.i : 0; });
  await page.locator(`#list [data-i="${appIdx}"]`).dblclick();
  await page.waitForFunction(() => document.querySelectorAll("#crumbs .crumb").length === 2, { timeout: 10000 });
  await page.waitForFunction(() => [...document.querySelectorAll("#list [data-i]")].some((x) => /_shared/.test(x.textContent)), { timeout: 10000 }).catch(() => {});
  const sharedIdx = await page.evaluate(() => { const r = [...document.querySelectorAll("#list [data-i]")].find((x) => /_shared/.test(x.textContent)); return r ? +r.dataset.i : -1; });
  rec("a holospace opens to its sealed closure (the _shared runtime folder is present)", sharedIdx >= 0);
  await page.locator(`#list [data-i="${sharedIdx}"]`).dblclick();
  await page.waitForFunction(() => document.querySelectorAll("#crumbs .crumb").length === 3, { timeout: 10000 });
  await page.waitForSelector("#list [data-i]", { timeout: 10000 });

  // select a real file row → the details pane shows its content address
  await page.locator('#list [data-i="0"]').click();
  await page.waitForSelector("#details.on", { timeout: 8000 });
  const k = await page.evaluate(() => { const el = document.querySelector("#details .drow .v.k"); return el ? el.textContent : ""; });
  rec("selecting a file shows its content address (did:holo κ) in the details pane", /did:holo:sha256:[0-9a-f]{8}/.test(k), k.slice(0, 34) + "…");

  // ── VERIFY A κ — re-derive the bytes; the address must match (Law L5) ────────────────
  await page.locator("#verify").click();
  await page.waitForSelector("#verify.ok", { timeout: 12000 });
  rec("Verify re-derives the file and its content address matches (Law L5)", true);
  await page.screenshot({ path: join(here, "holo-files-witness.png") });

  // ── drag-out-as-κ — dragging a file carries its holo://κ (paste anywhere; the bytes go to the desktop) ─
  const dragLink = await page.evaluate(() => {
    const row = document.querySelector('#list [data-i="0"]'); if (!row) return "";
    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true }));
    return (dt.getData("text/uri-list") || dt.getData("text/plain") || "").trim();
  });
  rec("dragging a file out carries its holo://κ content address", /^holo:\/\/[0-9a-f]{8}/.test(dragLink), dragLink.slice(0, 28));

  // ── a TAMPERED κ is REFUSED (re-derive against a wrong expected hash ⇒ ok:false) ─────
  const tamper = await page.evaluate(async () => {
    const fake = "did:holo:sha256:" + "0".repeat(64);
    const r = await window.HoloFiles.verify({ source: "closure", path: "holospace:_shared/holo-files.js", _realPath: "/_shared/holo-files.js", did: fake, name: "holo-files.js" });
    return r && r.ok === false;
  });
  rec("a tampered content address is REFUSED — the bytes do not re-derive to it", tamper);

  // ── WRITE TO HOME — OPFS namespace is genuinely writable; the UI reflects it ──────────
  dialogValue = "witness-folder";
  await page.locator('#side .sitem[data-loc="0"]').first().click();
  await page.waitForFunction(() => document.querySelectorAll("#crumbs .crumb").length === 1 && document.querySelector("#newfolder"), { timeout: 8000 });
  await page.locator("#newfolder").click();
  const folderShown = await page.waitForFunction(() => /witness-folder/.test((document.querySelector("#list") || {}).textContent || ""), { timeout: 8000 }).then(() => true).catch(() => false);
  rec("New folder writes into the OPFS Home and the listing reflects it", folderShown);

  // a file write + read-back round-trip through the engine (the writable plane is real)
  const roundtrip = await page.evaluate(async () => {
    await window.HoloFiles.createFile("/home/user", "witness.txt", "hologram-os");
    const r = await window.HoloFiles.read({ source: "opfs", path: "/home/user/witness.txt", name: "witness.txt" });
    return new TextDecoder().decode(r.bytes) === "hologram-os";
  });
  rec("a file written to Home reads back byte-identical (read/WRITE substrate)", roundtrip);

  // ── Tabs — open · switch · close (multi-tab browsing) ──────────────────────────────────
  const tab0 = await page.locator("#tabstrip .tab").count();
  await page.locator("#tabadd").click();
  await page.waitForFunction(() => document.querySelectorAll("#tabstrip .tab").length === 2, { timeout: 6000 }).catch(() => {});
  const opened = await page.locator("#tabstrip .tab").count();
  rec("a new tab opens (multi-tab browsing)", opened === 2, `${tab0} → ${opened} tabs`);
  await page.screenshot({ path: join(here, "holo-files-tabs.png") });
  await page.locator('#tabstrip .tab[data-i="0"]').click();
  const switched = await page.evaluate(() => { const t = document.querySelector('#tabstrip .tab[data-i="0"]'); return !!(t && t.classList.contains("on")); });
  rec("switching tabs activates the clicked tab", switched);
  await page.locator('#tabstrip .tab[data-i="1"] .tx').click();
  const closed = await page.locator("#tabstrip .tab").count();
  rec("closing a tab returns to a single tab", closed === 1, `→ ${closed} tab`);

  // ── Multi-select — Ctrl-click extends the selection ────────────────────────────────────
  await page.locator('#side .sitem[data-loc="0"]').first().click();
  await page.locator("#refresh").click();
  await page.waitForSelector("#list [data-i]", { timeout: 6000 });
  const rowCount = await page.locator("#list [data-i]").count();
  if (rowCount >= 2) {
    await page.locator('#list [data-i="0"]').click();
    await page.locator('#list [data-i="1"]').click({ modifiers: ["Control"] });
    const multi = await page.evaluate(() => document.querySelectorAll("#list .sel").length);
    rec("Ctrl-click extends a multi-selection", multi >= 2, `${multi} rows selected`);
  } else rec("Ctrl-click extends a multi-selection", false, `only ${rowCount} rows`);

  // ── Drag-and-drop — rows are draggable; the move primitive relocates a file into a folder ─
  const draggable = await page.evaluate(() => { const r = document.querySelector("#list [data-i]"); return r && r.getAttribute("draggable") === "true"; });
  rec("Home entries are draggable (drag-and-drop enabled)", !!draggable);
  const moved = await page.evaluate(async () => {
    try {
      await window.HoloFiles.createFile("/home/user", "move-me.txt", "x");
      await window.HoloFiles.moveHome("/home/user/move-me.txt", "/home/user/witness-folder");
      const inside = await window.HoloFiles.list({ source: "opfs", path: "/home/user/witness-folder", kind: "dir" });
      return inside.some((n) => n.name === "move-me.txt");
    } catch { return false; }
  });
  rec("a file moves into a folder (the drag-to-move primitive)", moved);

  // ── File tags — assign a colored tag; it persists + surfaces in the sidebar ─────────────
  await page.locator('#side .sitem[data-loc="0"]').first().click();
  await page.locator("#refresh").click();
  await page.waitForSelector("#list [data-i]", { timeout: 6000 });
  const fileIdx = await page.evaluate(() => { const rows = [...document.querySelectorAll("#list [data-i]")]; const r = rows.find((x) => /witness\.txt/.test(x.textContent)) || rows[0]; return r ? +r.dataset.i : 0; });
  await page.locator(`#list [data-i="${fileIdx}"]`).click({ button: "right" });
  await page.waitForSelector("#ctx.on .ctd", { timeout: 4000 });
  await page.locator('#ctx .ctd[data-tag="blue"]').click();
  const tagged = await page.evaluate(() => { try { const s = JSON.parse(localStorage.getItem("holo.files.tags") || "{}"); return Object.values(s).some((a) => a.includes("blue")); } catch { return false; } });
  rec("a colored tag is assigned to a file and persists", tagged);
  await page.evaluate(() => document.getElementById("ctx").classList.remove("on"));
  const sideTag = await page.evaluate(() => !!document.querySelector('#side .tagitem[data-tag="blue"]'));
  rec("the tag surfaces in the sidebar Tags section (filterable)", sideTag);

  // ── Dual-pane — a second, independent pane ─────────────────────────────────────────────
  await page.locator("#dualToggle").click();
  const dualOpen = await page.waitForFunction(() => document.body.classList.contains("dual"), { timeout: 6000 }).then(() => true).catch(() => false);
  rec("dual-pane opens a second, independent pane", dualOpen);
  await page.waitForFunction(() => [...document.querySelectorAll("#p2list [data-i]")].some((x) => /witness-folder/.test(x.textContent)), { timeout: 6000 }).catch(() => {});
  const fi = await page.evaluate(() => { const r = [...document.querySelectorAll("#p2list [data-i]")].find((x) => /witness-folder/.test(x.textContent)); return r ? +r.dataset.i : -1; });
  if (fi >= 0) {
    await page.locator(`#p2list [data-i="${fi}"]`).dblclick();
    const depth = await page.evaluate(() => document.querySelectorAll("#p2crumbs .crumb").length);
    rec("the second pane navigates independently of the first", depth >= 2, `${depth} crumbs`);
  } else rec("the second pane navigates independently of the first", false, "no folder to drill");
  await page.screenshot({ path: join(here, "holo-files-dual-tags.png") });
  await page.locator("#p2close").click();

  // ── Sort & group menu ──────────────────────────────────────────────────────────────────
  await page.locator('#views .vbtn[data-v="details"]').click();
  await page.locator("#sortBtn").click();
  await page.waitForSelector("#sortmenu.on", { timeout: 4000 });
  await page.locator('#sortmenu .mi[data-gb="kind"]').click();
  const grouped = await page.evaluate(() => document.querySelectorAll("#list .grouphdr").length > 0);
  rec("the sort/group menu groups the listing (group headers render)", grouped);

  // ── Status column — the content-addressed analog of git status (sealed vs local) ───────
  const statusCol = await page.evaluate(() => { const th = [...document.querySelectorAll("#list table.det thead th")].some((t) => /Status/.test(t.textContent)); const local = !!document.querySelector("#list .gstat.st-local"); return th && local; });
  rec("a Status column distinguishes local (working copy) from sealed (κ-pinned)", statusCol);
  await page.locator("#sortBtn").click(); await page.waitForSelector("#sortmenu.on", { timeout: 4000 }); await page.locator('#sortmenu .mi[data-gb="none"]').click();

  // ── Archives (.zip) — compress + extract round-trip (real DEFLATE, no CDN) ──────────────
  const zipRoundtrip = await page.evaluate(async () => {
    const payload = "deflate-me-" + "x".repeat(500);
    await window.HoloFiles.createFile("/home/user", "zsrc.txt", payload);
    await window.HoloFiles.compressToZip([{ source: "opfs", path: "/home/user/zsrc.txt", name: "zsrc.txt", kind: "file" }], "/home/user", "z.zip");
    await window.HoloFiles.extractZip({ source: "opfs", path: "/home/user/z.zip", name: "z.zip", kind: "file" }, "/home/user");
    const out = await window.HoloFiles.read({ source: "opfs", path: "/home/user/z/zsrc.txt", name: "zsrc.txt" });
    return new TextDecoder().decode(out.bytes) === payload;
  });
  rec("a .zip compresses and extracts byte-identically (real DEFLATE via Compression Streams)", zipRoundtrip);

  // ── Holo Search — the unified omnibox finds objects across the whole substrate ─────────
  await page.fill("#q", "witness");
  const searchHit = await page.waitForSelector("#list .srhead", { timeout: 8000 }).then(() => page.evaluate(() => /witness/i.test(document.querySelector("#list").textContent))).catch(() => false);
  rec("the unified search box finds objects across the substrate (Holo Search · local plane)", searchHit);
  await page.screenshot({ path: join(here, "holo-files-search.png") });
  await page.fill("#q", "");

  // ── identifier resolve — a pasted content address resolves to its object (omnibox-as-window) ─
  const resolved = await page.evaluate(async () => {
    const oc = await fetch("/etc/os-closure.json").then((r) => r.json()).catch(() => null);
    const cl = oc && oc.closure; if (!cl) return false;
    const v = cl[Object.keys(cl)[0]]; const k = typeof v === "object" ? (v.kappa || v.did) : v;   // a real κ from the OS closure
    const r = await window.HoloFiles.resolveInput(k); return !!(r && r.kind === "node" && r.node);
  });
  rec("a pasted content address (κ) resolves to its object locally — the omnibox is a window onto every object", resolved);

  // ── drop-to-materialize — a dropped κ link materializes its object into Home ────────────
  const materialized = await page.evaluate(async () => {
    const oc = await fetch("/etc/os-closure.json").then((r) => r.json()).catch(() => null);
    const cl = oc && oc.closure; if (!cl) return false;
    const key = Object.keys(cl).find((k) => k.startsWith("_shared/") && /\.js$/.test(k)) || Object.keys(cl).find((k) => /\.(js|css)$/.test(k)) || Object.keys(cl)[0];
    const v = cl[key]; const k = typeof v === "object" ? (v.kappa || v.did) : v;
    const r = await window.HoloFiles.materialize("holo://" + String(k).split(":").pop(), "/home/user");
    const home = await window.HoloFiles.list({ source: "opfs", path: "/home/user", kind: "location" });
    return !!(r && r.name && home.some((n) => n.name === r.name));
  });
  rec("dropping a κ link in materializes its object into Home (drop-to-materialize)", materialized);

  // ── Holo Cloud — send a Home file into the SAME OPFS κ-store the Cloud app uses ─────────
  const sent = await page.evaluate(async () => {
    const r = await window.HoloFiles.sendToCloud({ source: "opfs", path: "/home/user/witness.txt", name: "witness.txt", kind: "file" });
    return !!(r && r.did && /^did:holo:sha256:[0-9a-f]{8}/.test(r.did));
  });
  rec("Send to Holo Cloud chunks + content-addresses the file into the shared κ-store", sent);
  await page.locator('#side .sitem[data-loc="4"]').first().click();
  const inCloud = await page.waitForFunction(() => /witness\.txt/.test((document.querySelector("#list") || {}).textContent || ""), { timeout: 8000 }).then(() => true).catch(() => false);
  rec("the file appears in the Holo Cloud location — seamless, one substrate (not a bridge)", inCloud);
  const cidx = await page.evaluate(() => { const r = [...document.querySelectorAll("#list [data-i]")].find((x) => x.textContent.includes("witness.txt")); return r ? +r.dataset.i : -1; });
  let cloudVerified = false;
  if (cidx >= 0) {
    await page.locator(`#list [data-i="${cidx}"]`).click();
    cloudVerified = await page.waitForSelector("#verify", { timeout: 6000 }).then(() => page.locator("#verify").click()).then(() => page.waitForSelector("#verify.ok", { timeout: 10000 })).then(() => true).catch(() => false);
  }
  rec("the cloud copy re-derives to its content address (Law L5 over the cloud κ-store)", cloudVerified);
  await page.screenshot({ path: join(here, "holo-files-witness.png") });

  const fatal = errs.filter((e) => !/favicon|manifest|sw\.js|ServiceWorker|404|Failed to load resource/i.test(e));
  rec("no fatal console errors across the whole flow", fatal.length === 0, fatal.slice(0, 2).join(" | "));
} finally { await browser.close(); close(); }
writeResult();
console.log(`\nholo-files-witness: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
