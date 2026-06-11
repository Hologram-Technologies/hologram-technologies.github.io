#!/usr/bin/env node
// throwaway probe — verify the SDK desktop's greeter HANDOFF (the code I added): mint a real session
// exactly as holo-sddm establish() does (enroll → openSession), then load the SDK desktop with it and
// confirm it re-derives the session (L5) and stamps the operator ⊗ host into the HUD.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
const require = createRequire(pathToFileURL(join(ORIG, "package.json")));
const { chromium } = require("playwright");
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
try {
  // be on-origin first, then mint a session the way the greeter does (same modules)
  await page.goto(base + "/login.html?next=apps/sdk/index.html", { waitUntil: "load", timeout: 30000 });
  const sess = await page.evaluate(async (b) => {
    const id = await import(b + "/_shared/holo-identity.mjs");
    const host = await import(b + "/_shared/holo-host.mjs");
    const h = await host.measure().catch(() => null);
    const principal = await id.enroll({ label: "ilya", passphrase: "correct horse battery staple" });
    const token = await id.openSession(principal, { session: "primeos", next: "apps/sdk/index.html", host: h ? h.hostKappa : "" });
    sessionStorage.setItem("holo.session", JSON.stringify(token));
    return { operator: principal.kappa, host: h ? h.hostKappa : "", session: token.id };
  }, base);
  console.log("minted session  op:", sess.operator.slice(0, 30) + "…  host:", (sess.host || "").slice(0, 22) + "…");

  // now load the ONE shell exactly as the greeter hands off to it
  const url = `${base}/apps/sdk/index.html?` + new URLSearchParams({ operator: sess.operator, host: sess.host, session: sess.session });
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await sleep(3000);
  const r = await page.evaluate(() => ({
    operator: document.getElementById("operator")?.textContent || "",
    operatorVisible: !document.getElementById("operator")?.hidden,
    host: document.getElementById("hostchip")?.textContent || "",
    peers: document.getElementById("peers")?.textContent || "",
    worldReady: !!window.__worldReady,
    empty: !!document.getElementById("empty"),
    dock: !!document.getElementById("dock") || !!document.getElementById("holo-dock"),
  }));
  console.log("SDK desktop after handoff:", JSON.stringify(r, null, 2));
  console.log("pageerrors:", errs.slice(0, 3).join(" | ") || "none");
  console.log(/ilya/.test(r.operator) && /this machine/i.test(r.host) && r.worldReady
    ? "\nRESULT: PASS — login session re-derives (L5) + the ONE shell stamps operator⊗host, desktop ready"
    : "\nRESULT: FAIL");
} finally { await browser.close(); close(); }
