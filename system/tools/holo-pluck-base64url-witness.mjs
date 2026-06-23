#!/usr/bin/env node
// holo-pluck-base64url-witness.mjs — the ton-core Buffer/base64url landmine, fixed (N1).
//
// holo-pluck.encodePayload used `Buffer.from(json).toString("base64url")` guarded only by
// `typeof Buffer !== "undefined"`. The vendored wallet/TON bundle installs a global Buffer polyfill
// that lacks the "base64url" encoding, so once it loads, every pluck mint threw page-wide. The fix
// feature-detects real base64url support (Buffer.isEncoding) and falls back to the btoa/atob path.
// This witness proves the fix by POISONING the global Buffer the way ton-core does.
//
//   REAL     — with Node's real Buffer, encode/decode round-trips (and uses the fast path)
//   POISONED — with a Buffer that throws on base64url, encode/decode STILL round-trips (fallback)
//   CROSS    — a token from one path decodes under the other (the two encodings are identical)
//   MINT     — mint() no longer throws under a poisoned Buffer (the actual bug, gone)
//
//   node tools/holo-pluck-base64url-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { encodePayload, decodePayload, sharePayload, mint } from "../os/usr/lib/holo/holo-pluck.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const realBuffer = globalThis.Buffer;
// a Buffer polyfill that does NOT know base64url (mirrors ton-core.bundle.mjs behaviour)
const poison = () => { globalThis.Buffer = { from() { throw new Error("Unknown encoding: base64url"); }, isEncoding() { return false; } }; };
const restore = () => { globalThis.Buffer = realBuffer; };

const P = { kappa: "did:holo:sha256:" + "a".repeat(64), object: { "@type": "schema:Message", "schema:text": "hello ünîçödé 🚀 — the future is light", "schema:sender": "Ilya" } };

// ── 1 · REAL — round-trip with Node's real Buffer (fast path) ──
ok("real-buffer-round-trips", eq(decodePayload(encodePayload(P)), P), "real Buffer");

// ── 2 · POISONED — round-trip with a base64url-less Buffer (the fallback path) ──
poison();
let poisonedRT = false, threw = null;
try { poisonedRT = eq(decodePayload(encodePayload(P)), P); } catch (e) { threw = e.message; }
restore();
ok("poisoned-buffer-still-round-trips", poisonedRT && !threw, threw || "ok");

// ── 3 · CROSS — encode under real, decode under poisoned (and vice versa): same encoding ──
const tokReal = encodePayload(P);
poison(); const decUnderPoison = (() => { try { return decodePayload(tokReal); } catch { return null; } })();
const tokPoison = (() => { try { return encodePayload(P); } catch { return null; } })();
restore();
const decUnderReal = tokPoison ? decodePayload(tokPoison) : null;
ok("encodings-cross-compatible", eq(decUnderPoison, P) && eq(decUnderReal, P) && tokReal === tokPoison, "real↔poisoned identical");

// ── 4 · MINT — the actual bug: mint() throws under a poisoned Buffer (it must not, now) ──
poison();
let m = null, mintThrew = null;
try { m = mint({ text: "x", sender: "a", sentAt: "08:31", chat: "c", source: "s" }); } catch (e) { mintThrew = e.message; }
restore();
ok("mint-survives-poisoned-buffer",
  !mintThrew && m && /^did:holo:sha256:[0-9a-f]{64}$/.test(m.kappa) && m.shareLink.includes("#m=") &&
  decodePayload(m.shareLink.split("#m=")[1]) && eq(decodePayload(m.shareLink.split("#m=")[1]), sharePayload(m.object)),
  mintThrew || m.kappa.slice(-8));

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "REAL — with Node's real Buffer, encodePayload/decodePayload round-trips (fast base64url path)",
    "POISONED — with a Buffer polyfill that lacks base64url (as ton-core installs), encode/decode STILL round-trips via the btoa/atob fallback",
    "CROSS — a token produced on either path decodes on the other; the two encodings are byte-identical",
    "MINT — mint() no longer throws under a poisoned global Buffer (the page-wide break is fixed)",
  ],
  checks, failed: fail,
  authority: "holo-pluck.encodePayload base64url capability detection · RFC 4648 base64url",
};
writeFileSync(join(here, "holo-pluck-base64url-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Pluck base64url witness — the ton-core Buffer landmine, fixed\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
