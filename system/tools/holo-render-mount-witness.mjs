#!/usr/bin/env node
// holo-render-mount-witness.mjs — the SUFFICIENT (browser) proof for the κ-pluggable renderer registry:
// in a real Chromium, a holo:Video κ-object actually MOUNTS a <video> through render(κ) via the registry,
// and the render path REFUSES a tampered κ (L5 verify-before-render). The Node registry witness proves the
// dispatch logic; this proves the pixels-to-DOM + L5 leg the Node lane cannot (no document/fetch there).
//
// Honest posture (W1 discipline): if Playwright is absent the browser lane is SKIPPED and reported
// witnessed:false (honest red, never a fabricated green).
//   node tools/holo-render-mount-witness.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startServer } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-render-mount-witness.result.json"), JSON.stringify(r, null, 2) + "\n");

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (e) {
  console.log(`• browser lane SKIPPED — playwright not installed (${e.message.split("\n")[0]}).`);
  write({ spec: "browser proof of registry mount + L5 refusal", witnessed: false, lane: "skipped", reason: "playwright absent" });
  process.exit(0);   // neutral skip (honest red recorded), never a fabricated green
}

const { port, close } = await startServer();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
let result = { witnessed: false };
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // a minimal same-origin page so `import "/_shared/holo-render.js"` is same-origin (no full OS boot needed)
  await page.route(`${base}/__rendertest__`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body></body></html>" }));
  await page.goto(`${base}/__rendertest__`, { waitUntil: "domcontentloaded", timeout: 60000 });

  const r = await page.evaluate(async (BASE) => {
    const out = {};
    const enc = (s) => new TextEncoder().encode(s);
    const HR = (await import(BASE + "/_shared/holo-render.js")).default;
    // configure exactly as the shell does (media auto-registers; κ-route for media src); standalone resolve.
    await HR.configure({ base: "/", route: (h) => BASE + "/.holo/sha256/" + h, stream: false });
    out.videoRegistered = HR.renderers().has("holo:Video");

    // ── A · a holo:Video κ MOUNTS a <video> through render() (registry dispatch, real DOM) ──
    const spec = { "@type": "holo:Video", src: "did:holo:sha256:" + "ab".repeat(32), controls: true };
    const k = await HR.stash(enc(JSON.stringify(spec)));     // resident + κ-addressed (ARENA-verified)
    const div = document.createElement("div"); document.body.appendChild(div);
    const res = await HR.render(div, k);
    const v = div.querySelector("video");
    out.mounted = !!v && res && res.kind === "holo:Video";
    out.srcIsKappaRoute = !!v && /\/\.holo\/sha256\/(ab){32}$/.test(v.getAttribute("src") || "");

    // ── B · the render path REFUSES a tampered κ (L5 verify-before-render) ──
    // a κ for bytesA, but the source serves bytesB → resolve() re-derives, mismatch, refuses.
    const kFake = await HR.kappaOfBytes(enc("the-real-bytes"));
    const wrong = enc("TAMPERED — different bytes");
    let b64 = ""; { let s = ""; for (const c of wrong) s += String.fromCharCode(c); b64 = btoa(s); }
    await HR.configure({ base: "/", route: () => "data:application/octet-stream;base64," + b64, stream: false });
    const div2 = document.createElement("div"); document.body.appendChild(div2);
    let refused = false;
    try { await HR.render(div2, kFake); } catch (e) { refused = /L5 REFUSED|not served/.test(String(e && e.message || e)); }
    out.tamperRefused = refused && !div2.querySelector("video") && div2.childNodes.length === 0;
    return out;
  }, base);

  const checks = {
    videoRegistered: r.videoRegistered === true,
    mounted: r.mounted === true,
    srcIsKappaRoute: r.srcIsKappaRoute === true,
    tamperRefused: r.tamperRefused === true,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
  const witnessed = Object.values(checks).every(Boolean);
  result = {
    spec: "Browser proof: a holo:Video κ mounts a <video> through the κ-render registry, its src resolves to the κ-route (content-addressed media), and a tampered κ is refused on the render path (L5 verify-before-render).",
    authority: "Chromium (Playwright) real DOM · the served _shared/holo-render.js + holo-render-media.mjs · holospaces Laws L4·L5",
    witnessed, lane: "browser", covers: ["render-registry", "media-mount", "content-addressed-media", "verify-before-render", "law-l5"], checks,
  };
  write(result);
  console.log(`\nholo-render-mount-witness: ${witnessed ? "WITNESSED ✓" : "NOT WITNESSED"}`);
} catch (e) {
  console.log("MEASUREMENT ERROR —", String((e && e.message) || e));
  write({ spec: "browser proof of registry mount + L5 refusal", witnessed: false, error: String((e && e.message) || e) });
} finally {
  await browser.close();
  await close();
}
process.exit(result.witnessed ? 0 : 1);
