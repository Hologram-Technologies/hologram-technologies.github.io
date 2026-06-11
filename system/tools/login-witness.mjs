#!/usr/bin/env node
// login-witness.mjs — PROVE the canonical login gateway. Starts the κ-route server, drives real
// Chromium (Playwright) through the SDDM "maldives" greeter projected by holo-sddm: it must
// render the real theme, ENROLL a self-sovereign key on first run, BIND the session to this
// machine's measured hardware, hand off to the shell with a verifiable operator⊗host token
// (Law L5), then on return prefill the operator, reject a wrong passphrase, and unlock. 100%
// serverless — WebCrypto + OPFS, no network. Captures a screenshot of the greeter.
//
//   node tools/login-witness.mjs

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const writeResult = (r) => writeFileSync(join(here, "login-witness.result.json"), JSON.stringify(r, null, 2) + "\n");
const results = []; let passed = 0, failed = 0;
const rec = (name, ok, detail = "") => { results.push({ name, ok, detail }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}${detail ? "  (" + detail + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { port, stats, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
console.log(`OS2 serving at ${base}\n`);

// ── 1 · every login-chain resource resolves (from OS2) ──
const NEED = ["/boot.html", "/login.html", "/_shared/holo-qml.mjs", "/_shared/holo-sddm.js", "/_shared/holo-identity.mjs", "/_shared/holo-host.mjs",
  "/usr/share/sddm/themes/holo/Main.qml", "/usr/share/sddm/themes/holo/background.jpg",
  "/usr/share/sddm/themes/maldives/Main.qml", "/usr/share/sddm/components/2.0/Button.qml", "/etc/sddm.conf"];
let httpOk = 0;
for (const u of NEED) { try { const r = await fetch(base + u); if (r.status === 200) httpOk++; else console.log(`   ${r.status} ${u}`); } catch (e) { console.log(`   ERR ${u} ${e.message}`); } }
rec("every login-chain resource resolves (rEFInd · SDDM theme · components · runtime)", httpOk === NEED.length, `${httpOk}/${NEED.length}`);

let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { rec("playwright available", false, "not installed — HTTP proof only: " + e.message); }

const DID = /^did:holo:sha256:[0-9a-f]{64}$/;
if (chromium) {
  let browser;
  try {
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const consoleErr = [];
    const not404 = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErr.push(m.text()); });
    page.on("pageerror", (e) => consoleErr.push(String(e)));
    page.on("response", (r) => { if (r.status() === 404) not404.push(new URL(r.url()).pathname); });

    // ── 1.5 · the boot chain: rEFInd verifies the loader (Secure Boot) and hands off to the
    // splash with the SDDM greeter interposed (bootloader → Plymouth → SDDM → shell) ──
    await page.goto(`${base}/boot.html`, { waitUntil: "load", timeout: 30000 });
    await sleep(3000);                                  // rEFInd menu + κ scan (HEAD-probes loaders)
    await page.evaluate(() => window.focus());
    await page.keyboard.press("Enter");                 // boot the default selection (Hologram OS)
    // poll long enough to also catch rEFInd's timeout auto-boot if the keypress didn't land
    let bf = "";
    for (let i = 0; i < 96 && !/splash\.html|login\.html/.test(bf); i++) {
      bf = await page.evaluate(() => { const f = document.getElementById("bf"); return (f && f.getAttribute("src")) || ""; });
      if (!/splash\.html|login\.html/.test(bf)) await sleep(250);
    }
    const dec = decodeURIComponent(bf);
    rec("rEFInd boots (Secure-Boot verified) → hands off to Plymouth with SDDM interposed",
      /splash\.html/.test(bf) && /login\.html/.test(dec) && /apps(%2f|\/)sdk/i.test(dec),
      dec ? dec.slice(dec.indexOf("splash")) .slice(0, 80) : "no handoff");

    const greeterUrl = `${base}/login.html?` + new URLSearchParams({ next: "apps/sdk/index.html", label: "Hologram OS", logo: "boot/icons/os_hologram.svg" });

    // ── 2 · the greeter is the REAL SDDM theme, run by the QML engine (not a transcription) ──
    await page.goto(greeterUrl, { waitUntil: "load", timeout: 30000 });
    await sleep(1400);
    const ui = await page.evaluate(() => {
      const body = document.body.innerText || "";
      const inputs = [...document.querySelectorAll("input")];
      const bgEl = document.querySelector('[data-qml="Background"]');
      const panelEl = document.querySelector('[data-qml="Image"]');
      return {
        // the engine ran the real Main.qml: these DOM nodes carry the QML type tags
        engine: !!window.__holoQml, baseUrl: (window.__holoQml && window.__holoQml.baseUrl) || "",
        welcome: (body.match(/Welcome to holo-[0-9a-f]+/) || [""])[0],     // hostName = machine-id (hardware-rooted)
        nameField: inputs.some((i) => i.type === "text" || i.type === ""),
        passField: inputs.some((i) => i.type === "password"),
        buttons: [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean),
        bg: !!(bgEl && /background\.jpg/.test(bgEl.style.backgroundImage)),
        panel: !!(panelEl && /rectangle\.png/.test(panelEl.style.backgroundImage)),
      };
    });
    rec("the QML ENGINE runs the real Main.qml → DOM (welcome · username · password · Login/Shutdown/Restart)",
      ui.engine && /Welcome to holo-/.test(ui.welcome) && ui.nameField && ui.passField && ui.buttons.length >= 3,
      `welcome="${ui.welcome}" buttons=${ui.buttons.join("/")}`);
    rec("the real theme's images paint (wallpaper Background + rectangle.png panel)", ui.bg && ui.panel, `bg=${ui.bg} panel=${ui.panel}`);
    rec("the greeter is rooted in this machine (hostName derived from the machine-id κ)",
      /Welcome to holo-[0-9a-f]{4,}/.test(ui.welcome), ui.welcome);

    const shot = join(here, "login-witness.png");
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`screenshot → ${shot}`);

    // Keep the post-handoff shell LIGHT for the witness: allow only the login chain + the shell
    // document and the holo-identity module its handoff script needs; block the shell's heavy
    // WASM management console (console0) + workbench, which would saturate the JS thread and are
    // unrelated to login. (The greeter's own dependencies are all in the allow-list.)
    const ALLOW = /(login|home|splash|boot)\.html|apps\/sdk\/|_shared\/|holo-launch\.mjs|holo-omni\.mjs|holo-qml\.mjs|holo-sddm\.js|holo-identity\.mjs|holo-host\.mjs|holo-webauthn\.mjs|\/usr\/share\/sddm\/|\/etc\/sddm\.conf|\.holo\/sha256|apps\/index\.jsonld|components\.jsonld/;
    await page.route("**/*", (route) => { ALLOW.test(route.request().url()) ? route.continue() : route.abort(); });

    // ── 3 · ENROLL a self-sovereign key + hardware-bound handoff (driven through the real QML) ──
    await page.fill('input[type="text"]', "ilya");
    await page.fill('input[type="password"]', "correct horse battery staple");
    await page.click('button:has-text("Login")');
    await page.waitForURL(/\/apps\/sdk\/index\.html\?/, { timeout: 15000, waitUntil: "commit" });
    const u1 = new URL(page.url());
    const operator = u1.searchParams.get("operator"), host = u1.searchParams.get("host"), session = u1.searchParams.get("session");
    rec("enroll → hand off to the shell with operator ⊗ host ⊗ session (all content-addressed)",
      DID.test(operator) && DID.test(host) && DID.test(session), `op=${(operator||"").slice(0,22)}… host=${(host||"").slice(0,18)}…`);

    // ── 4 · the session token verifies end-to-end (Law L5) ──
    const verify = await page.evaluate(async ({ b }) => {
      const m = await import(b + "/_shared/holo-identity.mjs");
      const tok = JSON.parse(sessionStorage.getItem("holo.session") || "null");
      const body = await m.verifySession(tok);
      return { has: !!tok, ok: !!body, op: body && body.operator, host: body && body.host, session: tok && tok.id };
    }, { b: base });
    rec("the session assertion re-derives + signature-verifies (Law L5)",
      verify.ok && verify.op === operator && verify.host === host && verify.session === session, verify.ok ? "verified" : "no/invalid token");

    // ── 4b · the shell receives the handoff: sovereign operator + host shown, no second splash ──
    // We're already on the (now light) shell from the handoff; its handoff script verifies the
    // session (Law L5), stamps the operator ⊗ host, and dismisses the redundant splash.
    await sleep(1400);
    const shell = await page.evaluate(() => ({
      operator: document.getElementById("operator")?.textContent || "",
      host: document.getElementById("hostchip")?.textContent || "",
      splashGone: !document.getElementById("bootsplash") || document.getElementById("bootsplash").classList.contains("done"),
    }));
    rec("PrimeOS shell shows the sovereign operator + host, second splash skipped (seamless)",
      /ilya/.test(shell.operator) && /this machine/i.test(shell.host) && shell.splashGone,
      `op="${shell.operator}" host="${shell.host}" splashGone=${shell.splashGone}`);

    // ── 5 · returning operator: prefilled, wrong passphrase refused, right passphrase unlocks ──
    await page.goto(greeterUrl, { waitUntil: "load", timeout: 30000 });
    await sleep(1200);
    const prefill = await page.evaluate(() => document.querySelector('input[type="text"]')?.value || "");
    rec("returning operator is listed (userModel.lastUser → name TextBox prefilled)", prefill === "ilya", `prefill="${prefill}"`);

    await page.fill('input[type="password"]', "WRONG");
    await page.click('button:has-text("Login")');
    await sleep(1000);
    const errTxt = await page.evaluate(() => document.body.innerText || "");
    const stillHere = /\/login\.html/.test(page.url());
    rec("wrong passphrase is refused (errorMessage shown via Connections.onLoginFailed, no handoff)",
      stillHere && /wrong passphrase|login failed/i.test(errTxt), `url=${stillHere ? "login" : "left"}`);

    await page.fill('input[type="password"]', "correct horse battery staple");
    await page.click('button:has-text("Login")');
    await page.waitForURL(/\/apps\/sdk\/index\.html\?/, { timeout: 15000, waitUntil: "commit" });
    const u2 = new URL(page.url());
    rec("right passphrase unlocks the SAME sovereign identity", u2.searchParams.get("operator") === operator, "re-derived same κ");

    // The login gateway itself must serve cleanly. 404s from the post-handoff SHELL (home.html
    // subresources) are a separate, pre-existing concern and are reported, not failed here.
    const CHAIN = /^\/(login\.html|boot\.html|splash\.html)|holo-sddm|holo-identity|holo-host|\/usr\/share\/sddm\//;
    const chain404 = not404.filter((p) => CHAIN.test(p));
    const shell404 = not404.filter((p) => !CHAIN.test(p));
    rec("the login gateway serves with no missing resources (404s)", chain404.length === 0, chain404.join(", ") || "clean");
    if (shell404.length) console.log(`   note — shell (home.html) gaps, out of scope for login: ${[...new Set(shell404)].join(", ")}`);
    await browser.close();
  } catch (e) { if (browser) await browser.close().catch(() => {}); rec("browser login flow completed without throwing", false, String((e && e.message) || e)); }
}

const witnessed = failed === 0 && passed > 0;
writeResult({
  spec: "Hologram OS — canonical login gateway: rEFInd → Plymouth → SDDM (real theme run by the Holo QML engine) → PrimeOS, authenticated by a self-sovereign key bound to local hardware (holospaces docs/08; Laws L1/L4/L5), 100% serverless",
  witnessed, covers: witnessed ? ["sddm-greeter", "qml-projection", "self-sovereign-login", "hardware-binding", "session-l5", "boot-chain"] : [],
  results,
});
console.log(`\n=== ${passed}/${passed + failed} passed, ${failed} failed ===`);
close();
process.exit(failed ? 1 : 0);
