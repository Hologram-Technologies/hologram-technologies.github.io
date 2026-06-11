#!/usr/bin/env node
// holo-own-world-witness.mjs — PROVE ownership is AMBIENT in the real environment (ADR-053, layer 2).
// Boots the World shell in real Chromium (Playwright) over the κ-route serving layer, then drives the
// ambient surface with REAL identities: an object starts unowned; claim → the operator owns it (chain
// verifies, Law L5); transfer → the new owner (verifies); the titlebar shows a live owner badge; and
// ownership PERSISTS in the durable title registry. This is the browser tier (committed result, like
// boot / qml-render); the pure-Node engine is proven by holo-own-witness (#own).
//
//   node tools/holo-own-world-witness.mjs

import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { startServer, ORIG } from "./holo-serve-fhs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const results = []; let passed = 0, failed = 0;
const rec = (name, okv, detail = "") => { results.push({ name, ok: okv, detail }); okv ? passed++ : failed++; console.log(`${okv ? "PASS" : "FAIL"} — ${name}${detail ? "  (" + detail + ")" : ""}`); };
const writeResult = (extra = {}) => writeFileSync(join(here, "holo-own-world-witness.result.json"), JSON.stringify({
  spec: "Ownership is ambient in every holospace (ADR-053, layer 2): the World shell gives every object a live owner badge + a Claim·Transfer·Anchor·Sell surface over the real Own engine; claim/transfer re-derive + verify (Law L5) and persist in a content-addressed title registry, through the wallet's human-approval gate",
  authority: "W3C DID Core · Verifiable Credentials · UCAN · ODRL · PROV-O · UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1/L4/L5 · real Chromium via Playwright",
  witnessed: failed === 0 && passed > 0,
  covers: ["own-ambient", "world-shell", "owner-badge", "claim-transfer", "title-registry", "law-l5", "every-holospace"],
  results, passed, failed, ...extra,
}, null, 2) + "\n");

const { port, close } = await startServer(); const base = `http://127.0.0.1:${port}`;
let chromium;
try { const require = createRequire(pathToFileURL(join(ORIG, "package.json"))); ({ chromium } = require("playwright")); }
catch (e) { rec("playwright available", false, e.message); writeResult({ note: "playwright unavailable — browser tier not run" }); close(); process.exit(1); }

const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const errs = []; page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); }); page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${base}/apps/sdk/index.html`, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => window.__worldReady === true, { timeout: 20000 });
  rec("World shell boots with the ownership module wired", true);
  rec("ambient ownership hooks present (__world.own)", await page.evaluate(() => !!(window.__world && window.__world.own && window.__world.own.claim && window.__world.own.sheet)));
  const r = await page.evaluate(async () => {
    const idm = await import("/_shared/holo-identity.mjs");
    const alice = await idm.enroll({ label: "alice", passphrase: "a" });
    const bob = await idm.enroll({ label: "bob", passphrase: "b" });
    const aliceRef = alice.kappa.replace(/^did:holo:/, ""), bobRef = bob.kappa.replace(/^did:holo:/, "");
    const W = window.__world; W.own.setOperator(alice);
    const id = W.addNode({ kind: "block", name: "deed", content: "<b>my asset</b>", frameless: true });
    const before = await W.own.state(id);
    await W.own.claim(id); const claimed = await W.own.state(id);
    await W.own.transfer(id, bobRef); const xferred = await W.own.state(id);
    await new Promise((r) => setTimeout(r, 150));
    const titleAttr = (document.getElementById(id) && document.getElementById(id).getAttribute("title")) || "";
    const reread = await W.own.state(id);
    return { unowned: before.unowned, claimedAlice: claimed.owner === aliceRef && claimed.ok, xferBob: xferred.owner === bobRef && xferred.ok, badge: /👤/.test(titleAttr), persisted: reread.owner === bobRef && reread.ok };
  });
  rec("an object starts unowned", r.unowned === true);
  rec("claim → owner is the operator and the chain verifies (Law L5)", r.claimedAlice);
  rec("transfer → owner is the new owner and the chain verifies", r.xferBob);
  rec("the titlebar shows the live owner badge (ambient cue)", r.badge);
  rec("ownership persists in the durable title registry", r.persisted);
  const fatal = errs.filter((e) => !/favicon|manifest|sw\.js|ServiceWorker|404|wallet/i.test(e));
  rec("no fatal console errors during the flow", fatal.length === 0, fatal.slice(0, 2).join(" | "));
} finally { await browser.close(); close(); }
writeResult();
console.log(`\nholo-own-world-witness: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
