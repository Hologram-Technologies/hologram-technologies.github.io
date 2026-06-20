#!/usr/bin/env node
// holo-cid-activation-witness.mjs — PROVE the single-link activation is LIVE in a real browser
// (decentralized-boot delta A, wired). Open the OS at …/#<root-CID> in Chromium and assert the page
// self-verifies the booted root against the link's content-address: self.__holoRoot.verified === true
// for the correct CID, and === false for a wrong one (the magic "verified ✓" badge is honest, not cosmetic).
//
//   node tools/holo-cid-activation-witness.mjs
import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire as mkRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";
import { makeCIDv1, cidToString } from "../os/usr/lib/holo/holo-ipfs.js";

const here = dirname(fileURLToPath(import.meta.url));
const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fromHex = (h) => Uint8Array.from(Buffer.from(h, "hex"));

// the CID of the CURRENTLY-served boot root (dev serves os/etc/os-closure.json verbatim)
const rootBytes = readFileSync(join(here, "../os/etc/os-closure.json"));
const KAPPA = createHash("sha256").update(rootBytes).digest("hex");
const CID = cidToString(makeCIDv1(0x55, 0x12, fromHex(KAPPA)));
const WRONG = cidToString(makeCIDv1(0x55, 0x12, fromHex("0".repeat(64))));

const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
console.log(`link: ${base}/holospace.html?app=org.hologram.HoloSearch&bare=1&sw=0#${CID}\n`);

let chromium;
try { const require = mkRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { rec("playwright available", false, "not installed: " + e.message); }

async function holoRoot(hash) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 740 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/holospace.html?app=org.hologram.HoloSearch&bare=1&sw=0${hash}`, { waitUntil: "load", timeout: 30000 });
  let r = null;
  for (let i = 0; i < 60 && !r; i++) { r = await page.evaluate(() => self.__holoRoot || null).catch(() => null); if (!r) await sleep(150); }
  await ctx.close();
  return r;
}

let browser;
if (chromium) {
  browser = await chromium.launch();
  try {
    const ok = await holoRoot("#" + CID);
    rec("opening …/#<root-CID> exposes the verified root on self.__holoRoot", !!ok && ok.cid === KAPPA, ok ? `cid ${String(ok.cid).slice(0, 12)}… verified=${ok.verified}` : "no __holoRoot");
    rec("the booted root SELF-VERIFIES against the link's content-address (verified ✓)", !!ok && ok.verified === true);

    const bad = await holoRoot("#" + WRONG);
    rec("a WRONG CID self-verifies as FALSE (the badge is honest, not cosmetic)", !!bad && bad.verified === false, bad ? `verified=${bad.verified}` : "no __holoRoot");

    const none = await holoRoot("");
    rec("no fragment → no false claim (cid null, boots normally)", !!none && none.cid === null);
    await browser.close();
  } catch (e) { if (browser) await browser.close().catch(() => {}); rec("activation browser run completed", false, String((e && e.message) || e)); }
}

const witnessed = failed === 0 && passed > 0;
console.log(`\n${witnessed ? "WITNESSED ✓" : "NOT WITNESSED ✗"} — ${passed}/${passed + failed} · the single link …/#<root-CID> self-verifies the booted OS against its content-address, live in a real browser.`);
writeFileSync(join(here, "holo-cid-activation-witness.result.json"),
  JSON.stringify({ witnessed, passed, failed, rootKappa: KAPPA, cid: CID, covers: results.filter((r) => r.ok).map((r) => r.name.slice(0, 56)), results,
    spec: "delta A (wired) — opening the OS at the shareable link …/#<root-CID> in a real browser self-verifies the booted boot-root against the link's content-address (self.__holoRoot.verified). Correct CID ⇒ true; wrong CID ⇒ false; no fragment ⇒ no claim. The page-level loader reads the fragment (the SW cannot) and re-derives (Law L5)." }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
