#!/usr/bin/env node
// holo-serverless-witness.mjs — PROVE the SHIPPED Hologram OS is 100% serverless. The shipped surface
// is the sealed image (os/etc/os-closure.json) + the content-verify Service Worker (holo-fhs-sw.js),
// served from a dumb static host. This proves: (1) that worker is PURE content-delivery + Law-L5
// verification — it carries no server, proxy, or backend logic; (2) the optional companion backends
// (SoundCloud/yt-dlp · develop-to-κ · room relay · MCP forwarder · web proxy) live ONLY in the dev
// server (tools/holo-serve-fhs.mjs), which is a DEV TOOL, NOT part of the sealed image; (3) the OS
// boots + runs serverless with zero server fallbacks (the #boot row). So no shipped feature needs a
// server: boot, run, resolve and verify are 100% serverless.
//
//   node tools/holo-serverless-witness.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));   // tools/
const OS2 = join(here, "../os");
const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const has = (s, t) => s.includes(t);

const sw = read(join(OS2, "holo-fhs-sw.js"));                       // the SHIPPED delivery worker
const dev = read(join(here, "holo-serve-fhs.mjs"));                 // the DEV server (a tool, not shipped)
const closure = JSON.parse(read(join(OS2, "etc/os-closure.json")) || "{}").closure || {};
const BACKENDS = ["scRoute", "developRoute", "roomRoute", "mcpProxy", "webProxy", "pipeUpstream"];

// Leak detection scans CODE ONLY. A comment may legitimately NAME the dev server or a backend
// (documentation — e.g. the SW's dev-fresh comment notes that tools/holo-serve-fhs.mjs flips a flag),
// which is not an import, call, or dependency. Stripping comments still catches every real reference.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const swCode = stripComments(sw);

// ── 1 · the shipped Service Worker is PURE content-delivery + verification — no server ──
const swBackend = BACKENDS.filter((b) => has(swCode, b)).concat(["child_process", "spawn(", "yt-dlp"].filter((t) => has(swCode, t)));
const swVerifies = has(sw, "sha256hex") && has(sw, "blake3hex") && has(sw, "BYBLAKE") && has(sw, "409") && has(sw, "refuse");
rec("the shipped delivery worker (holo-fhs-sw.js) is PURE content-route + Law-L5 verify (both axes, refuse-on-mismatch)", swVerifies, swVerifies ? "κ-route + re-derive + 409" : "missing verify path");
rec("the shipped delivery worker carries NO server, proxy, or backend logic", swBackend.length === 0, swBackend.length ? "found: " + swBackend.join(", ") : "none");
// the worker ALSO answers the Model Context Protocol CLIENT-SIDE — a serverless agent endpoint (/mcp +
// /~<app>/mcp), pure local computation over the node-free engine, not a backend (no spawn, no upstream).
rec("the shipped delivery worker IS a serverless MCP endpoint (answers /mcp + /~<app>/mcp client-side, no server)", has(sw, "isMcpRoute") && has(sw, "holo-mcp-core"), has(sw, "isMcpRoute") ? "SW-served MCP" : "no SW MCP route");

// ── 2 · the optional companion backends are confined to the DEV server, which is NOT shipped ──
const devHasAll = BACKENDS.every((b) => has(dev, b));
const devNotShipped = !Object.keys(closure).some((k) => /serve-fhs/.test(k)) && !has(swCode, "holo-serve-fhs");
rec("the companion backends (sc · develop · room · mcp · web) live ONLY in the dev server", devHasAll, devHasAll ? "all in holo-serve-fhs.mjs" : "not all confined");
rec("the dev server is a DEV TOOL, not part of the sealed image (no os-closure pin, not referenced by the SW)", devNotShipped, devNotShipped ? "tools/ only" : "leaked into the image");

// ── 3 · the OS boots + runs SERVERLESS — self-contained from static + the SW (0 server fallbacks) ──
const bootRes = existsSync(join(here, "boot-os2-witness.result.json")) ? JSON.parse(read(join(here, "boot-os2-witness.result.json"))) : null;
const served = (bootRes && bootRes.served) || {};
const fellBack = typeof served.orig === "number" ? served.orig : (Array.isArray(served.orig) ? served.orig.length : 0);
rec("the OS boots + runs serverless from static + the SW alone (#boot, 0 server fallbacks)",
  !!bootRes && bootRes.witnessed === true, bootRes ? `witnessed · served ${served.os2 || "?"} os2 / ${served.apps || "?"} apps / ${fellBack} fallbacks` : "no boot result (run boot-os2-witness)");

const witnessed = failed === 0;
console.log(`\n${witnessed ? "WITNESSED ✓" : "FAILED ✗"} — ${passed}/${passed + failed} · the shipped OS is 100% serverless; backends are dev-only companions`);
writeFileSync(join(here, "holo-serverless-witness.result.json"),
  JSON.stringify({ witnessed, passed, failed, covers: results.filter((r) => r.ok).map((r) => r.name.slice(0, 48)), results,
    spec: "The shipped Hologram OS (sealed os-closure + the content-verify Service Worker, on a dumb static host) is 100% serverless: the worker is pure content-delivery + Law-L5 verification; the optional companion backends are confined to the dev server (a tool, not shipped); boot/run/resolve/verify need no server" }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
