#!/usr/bin/env node
// holo-served-enforce-witness.mjs — PROVE in a REAL browser, in PROD mode, that the served-set closure
// (os-served.json) makes Law L5 cover files OUTSIDE the boot closure. The companion pure-Node witness
// (holo-served-coverage-witness) proves coverage + parity + no-false-refusal; this proves the SW actually
// FOLDS os-served at runtime and routes a non-boot served file through the verify+cache branch — the path
// that, pre-change, those bytes skipped (unpinned passthrough). Prod mode is forced without a deploy via an
// HTTPS proxy on a NON-localhost host (holo.test), so the SW's dev-fresh bypass is OFF (DEV=false), exactly
// like a GitHub-Pages deploy. The refuse-on-mismatch mechanism itself is the SAME code os-closure files
// already exercise (witnessed by W1 / dev-fresh-gate), here extended to the whole served tree.
//   node tools/holo-served-enforce-witness.mjs
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer as createHttps } from "node:https";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startServer } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CERT = join(here, "_certs");
if (!existsSync(join(CERT, "cert.pem"))) {
  try {
    mkdirSync(CERT, { recursive: true });
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", join(CERT, "key.pem"), "-out", join(CERT, "cert.pem"), "-days", "2", "-nodes", "-subj", "/CN=holo.test", "-addext", "subjectAltName=DNS:holo.test"], { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  } catch (e) { console.log("cannot generate cert (openssl required): " + e.message); process.exit(2); }
}
const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };

let chromium; try { ({ chromium } = await import("playwright")); } catch { console.log("playwright not installed"); process.exit(2); }

// pick a served file OUTSIDE the boot closure but pinned by os-served (the bytes my change newly verifies)
const osClosure = JSON.parse(readFileSync(join(here, "../os/etc/os-closure.json"), "utf8")).closure || {};
const osServed = JSON.parse(readFileSync(join(here, "../os/etc/os-served.json"), "utf8")).closure || {};
const boot = new Set(Object.keys(osClosure));
const PICK = Object.keys(osServed).find((k) => /^usr\/lib\/holo\/[a-z0-9-]+\.(js|mjs)$/.test(k) && !boot.has(k) && !boot.has("_shared/" + k.split("/").pop()));
if (!PICK) { console.log("no non-boot served file found — regenerate os-served"); process.exit(2); }
const PIN = String(osServed[PICK]).split(":").pop();

const { port: httpPort, close } = await startServer();
const HOST = "holo.test";
const proxy = createHttps({ key: readFileSync(join(CERT, "key.pem")), cert: readFileSync(join(CERT, "cert.pem")) }, (creq, cres) => {
  const preq = httpRequest({ host: "127.0.0.1", port: httpPort, method: creq.method, path: creq.url, headers: { ...creq.headers, host: `127.0.0.1:${httpPort}` } }, (pres) => { cres.writeHead(pres.statusCode, pres.headers); pres.pipe(cres); });
  preq.on("error", (e) => { cres.writeHead(502); cres.end(String(e)); });
  creq.pipe(preq);
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const origin = `https://${HOST}:${proxy.address().port}`;
console.log(`http 127.0.0.1:${httpPort} → https ${origin} (prod mode)  ·  target: ${PICK}\n`);

const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`, "--ignore-certificate-errors"] });
try {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const perr = []; page.on("pageerror", (e) => perr.push(String(e)));

  await page.goto(`${origin}/shell.html`, { waitUntil: "load", timeout: 40000 });
  const reg = await page.evaluate(async () => {
    try { await navigator.serviceWorker.register("/holo-fhs-sw.js", { type: "module" }); await navigator.serviceWorker.ready; } catch (e) { return { err: String(e).slice(0, 100) }; }
    for (let i = 0; i < 120 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
    return { secure: isSecureContext, controlled: !!navigator.serviceWorker.controller, host: location.hostname };
  });
  rec("prod secure context + the EDITED SW installs and controls (no boot regression)", reg.secure && reg.controlled && reg.host === HOST, JSON.stringify(reg));

  const r = await page.evaluate(async ({ pick, pin }) => {
    // crypto sha256 hex helper (the page is a secure context)
    const sha = async (buf) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const f1 = await fetch("/" + pick, { cache: "no-store" });
    const c1 = f1.headers.get("x-holo-cache"); const buf = await f1.arrayBuffer();
    const matches = (await sha(buf)) === pin;
    const f2 = await fetch("/" + pick, { cache: "no-store" }); const c2 = f2.headers.get("x-holo-cache");
    // negative control: a κ-route for an unknown hex is not in the closure index → 404 (never silently served)
    const f404 = await fetch("/.holo/sha256/" + "0".repeat(64), { cache: "no-store" });
    return { c1, c2, matches, bytes: buf.byteLength, status404: f404.status };
  }, { pick: PICK, pin: PIN });

  rec("a NON-boot served file flows through the VERIFY branch (x-holo-cache set ⇒ os-served fold active, not unpinned passthrough)", r.c1 === "miss" || r.c1 === "hit" || r.c1 === "opfs", `x-holo-cache:${r.c1} · ${r.bytes} bytes`);
  rec("its bytes re-derive to the pinned κ (Law L5 verified the file the boot closure never pinned)", r.matches === true, `sha256 == os-served pin (${PIN.slice(0, 12)}…)`);
  rec("re-fetch served from the κ cache as VERIFIED (cached only because it passed L5)", r.c2 === "hit" || r.c2 === "opfs", `x-holo-cache:${r.c2}`);
  rec("an unknown κ-route is refused with 404 (never silently served)", r.status404 === 404, `status:${r.status404}`);
  rec("no fatal page errors during boot + fetches", perr.length === 0, perr.slice(0, 2).join(" | ") || "clean");
  await browser.close();
} catch (e) { await browser.close().catch(() => {}); rec("witness completed without throwing", false, String((e && e.message) || e)); }
await close(); proxy.close();

const witnessed = failed === 0 && passed >= 5;
console.log(`\n${witnessed ? "WITNESSED ✓ — os-served extends L5 to the whole served OS in a real prod-mode browser" : "NOT WITNESSED ✗ — see failing rows"} · ${passed}/${passed + failed}`);
writeFileSync(join(here, "holo-served-enforce-witness.result.json"),
  JSON.stringify({ witnessed, passed, failed, target: PICK, pin: PIN, covers: results.filter((x) => x.ok).map((x) => x.name.slice(0, 72)), results,
    spec: "In real Chromium, prod cache-first mode (non-localhost host ⇒ DEV=false), the EDITED holo-fhs-sw.js folds os-served.json and routes a file OUTSIDE the boot closure through the verify+cache branch (x-holo-cache set), its bytes re-deriving to the pinned κ — so Law L5 covers the whole served OS, not just the ~500-file boot closure. The refuse-on-mismatch mechanism is the same path os-closure files exercise (witnessed by holo-w1 / holo-dev-fresh-gate)." }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
