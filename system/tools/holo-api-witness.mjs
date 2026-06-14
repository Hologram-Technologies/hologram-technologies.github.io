#!/usr/bin/env node
// holo-api-witness.mjs — PROVE the UNIFIED REST API: every holospace exposes /~<app>/api as a single,
// standardized, content-addressed κ-stream surface — INGRESS (import) and EGRESS (export) of
// self-verifying UOR objects to/from any external API-gated app, human, or agent — with HTTP 402
// pay-per-κ-stream monetisation. Same κ-store/registry as MCP (no parallel infra). Isomorphic by
// construction (node-free engine → runs in the Service Worker too) + mounted on every tier.
// Authority: W3C MCP-adjacent · OpenAPI 3.1 · schema.org/JSON-LD · HTTP 402 (x402/L402 family) · Law L1/L2/L5.
//
//   node tools/holo-api-witness.mjs

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeApiServer, collectNdjson, verifyEntitlement, verifyPermit } from "../os/usr/lib/holo/api/holo-api-core.mjs";
import { fetchPaid, payFor402 } from "../os/usr/lib/holo/api/holo-api-pay.js";
import { makeObject, verify, jcs } from "../os/usr/lib/holo/holo-object.mjs";
import { ed25519 } from "../os/usr/lib/holo/wdk-crypto/wdk-crypto.bundle.mjs";

// a payer keypair + a helper to SIGN a κ-bound permit (ed25519 over jcs(permit minus sig))
const _hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const _sk = ed25519.utils.randomSecretKey(), _pk = ed25519.getPublicKey(_sk);
const signPermit = (p) => { const body = { "@type": "holo:PaymentPermit", payer: _hex(_pk), ...p }; return { ...body, sig: _hex(ed25519.sign(new TextEncoder().encode(jcs(body)), _sk)) }; };

const here = dirname(fileURLToPath(import.meta.url));
const OS2 = join(here, "../os");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); };
const src = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

// 0 · ISOMORPHIC BY CONSTRUCTION — the REST engine imports no node:* / require() / SDK
const apiSrc = src(join(OS2, "usr/lib/holo/api/holo-api-core.mjs"));
ok("api-core-node-free", apiSrc.length > 0 && !/from\s+["']node:/.test(apiSrc) && !/\brequire\s*\(/.test(apiSrc) && !/@modelcontextprotocol/.test(apiSrc));

// a feed app with published resources + a price (HTTP 402)
const store = new Map();
const i1 = makeObject(new Map(), { type: ["schema:Dataset"], "schema:name": "feed 1" });
const i2 = makeObject(new Map(), { type: ["schema:Dataset"], "schema:name": "feed 2" });
store.set(i1.id, i1); store.set(i2.id, i2);
const registry = { server: { name: "hologram-os/feed", title: "Holo Feed" }, resources: [{ uri: i1.id, name: "i1" }, { uri: i2.id, name: "i2" }], tools: [] };
const price = { amount: 0.01, unit: "HOLO", per: "stream" };
const resolve = async (k) => store.get(k) || null;
const srv = makeApiServer({ appId: "feed", registry, resolve, store, price, now: 1000 });
const R = (method, path, extra = {}) => srv.handle({ method, path, headers: {}, ...extra });

// 1 · the standardized descriptor — OpenAPI 3.1 ⊕ JSON-LD (the REST twin of holo_describe)
const desc = JSON.parse((await R("GET", "/")).body);
ok("descriptor-openapi-jsonld", (desc["@type"] || []).includes("schema:WebAPI") && desc.openapi && desc.openapi.openapi === "3.1.0" && !!desc["holo:price"]);
ok("descriptor-ingress-egress-actions", (desc["schema:potentialAction"] || []).some((a) => a["holo:rel"] === "egress-stream") && (desc["schema:potentialAction"] || []).some((a) => a["holo:rel"] === "ingress-object"));

// 2 · INGRESS → κ, then EGRESS by κ — round-trip, self-verifying (Law L2/L5)
const ing = await R("POST", "/o", { body: { "schema:name": "hello", value: 42 } });
const k = JSON.parse(ing.body).id;
ok("ingress-returns-kappa", ing.status === 201 && /^did:holo:/.test(k));

// 3 · EGRESS is GATED (HTTP 402 + a standardized challenge) without an entitlement
const locked = await R("GET", "/o/" + encodeURIComponent(k));
const ch = JSON.parse(locked.body);
ok("egress-402-challenge", locked.status === 402 && ch.error === "payment_required" && !!ch.settle && Array.isArray(ch.accepts));

// 4 · SETTLE with a κ-BOUND SIGNED PERMIT (verified LOCALLY by ed25519 — no node, no chain) →
//     a self-verifying ENTITLEMENT, and the permit is CONSUMED single-use in the spend ledger.
const permit = signPermit({ app: "feed", resource: "*", amount: 1, unit: "HOLO", nonce: "n-settle-1", deadline: 9e15 });
ok("permit-verifies-locally", (await verifyPermit(permit, { app: "feed", resource: k, price, now: 2000 })) === true);
const settled = await R("POST", "/settle", { body: { payment: { permit } } });
const ent = JSON.parse(settled.body).entitlement;
ok("settle-mints-self-verifying-entitlement", settled.status === 200 && verify(ent) === true && ent.app === "feed" && ent.paid && ent.paid.rail === "token");
ok("entitlement-verifies-pure", verifyEntitlement(ent, { app: "feed", resource: k, now: 2000 }) === true);

// 4a · a TAMPERED permit (amount inflated after signing) FAILS the signature → refused (no trusted amount)
const forged = { ...permit, amount: 999999 };
ok("forged-permit-refused", (await verifyPermit(forged, { app: "feed", resource: k, price, now: 2000 })) === false);
const forgedSettle = await R("POST", "/settle", { body: { payment: { permit: forged } } });
ok("forged-settle-402", forgedSettle.status === 402);

// 4b · REPLAY — settling the SAME permit again is refused by the content-addressed spend ledger
const replay = await R("POST", "/settle", { body: { payment: { permit } } });
ok("replay-permit-already-spent", replay.status === 402 && JSON.parse(replay.body).error === "already_spent");

// 5 · EGRESS UNLOCKED with the entitlement → 200 + the object
const unlocked = await srv.handle({ method: "GET", path: "/o/" + encodeURIComponent(k), headers: { authorization: "Holo " + jcs(ent) } });
ok("egress-unlocked", unlocked.status === 200 && JSON.parse(unlocked.body).value === 42);

// 6 · EGRESS STREAM (gated) with entitlement → NDJSON of SELF-VERIFYING κ-objects (pay-per-κ-stream)
const sres = await srv.handle({ method: "GET", path: "/stream", headers: { authorization: "Holo " + jcs(ent) } });
const objs = (await collectNdjson(sres.iterator)).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
ok("egress-stream-self-verifying", sres.status === 200 && objs.length === 2 && objs.every(verify));

// 7 · INGRESS STREAM (NDJSON body) → κ's
const isr = await R("POST", "/stream", { body: [{ "schema:name": "a" }, { "schema:name": "b" }].map((o) => JSON.stringify(o)).join("\n") });
ok("ingress-stream", JSON.parse(isr.body).count === 2);

// 8 · refusal: a TAMPERED entitlement (mutated after sealing) fails Law L5 → still 402
const tampered = { ...ent, expires: ent.expires + 9e9 };
ok("tampered-entitlement-refused", verifyEntitlement(tampered, { app: "feed", resource: k, now: 2000 }) === false);

// 8a · LITERAL pay-per-κ: present a single-use signed permit DIRECTLY on a gated GET → 200 once,
//      then the SAME permit replays → 402 already_spent (consumed in the spend ledger).
const p2 = signPermit({ app: "feed", resource: "*", amount: 1, unit: "HOLO", nonce: "n-direct-1", deadline: 9e15 });
const once = await srv.handle({ method: "GET", path: "/o/" + encodeURIComponent(k), headers: { authorization: "Holo " + jcs(p2) } });
const twice = await srv.handle({ method: "GET", path: "/o/" + encodeURIComponent(k), headers: { authorization: "Holo " + jcs(p2) } });
ok("direct-permit-pay-per-kappa", once.status === 200 && twice.status === 402 && JSON.parse(twice.body).error === "already_spent");

// 9 · MOUNTED on every tier — dev server (raw HTTP) + the serverless Service Worker
ok("mounted-dev-server", /appApi\(/.test(src(join(here, "holo-serve-fhs.mjs"))) && /\/~.*\/api/.test(src(join(here, "holo-serve-fhs.mjs"))));
ok("mounted-service-worker-serverless", /handleHoloApi|holo-api-core/.test(src(join(OS2, "holo-fhs-sw.js"))) && /MCP_API/.test(src(join(OS2, "holo-fhs-sw.js"))));

// 10 · WIRED TO HOLO WALLET + THE PLASMA STABLECOIN RAIL — a priced app with a payout address; a 402
//      names the exact Plasma USD₮0 transfer; fetchPaid drives a (fake) wallet to pay + retries → 200.
const payee = "0x000000000000000000000000000000000000beef";
const pstore = new Map(); const pitem = makeObject(new Map(), { type: ["schema:Dataset"], "schema:name": "premium κ" }); pstore.set(pitem.id, pitem);
const pprice = { amount: 300, unit: "USD₮0", payee };                     // 300 minor = 0.0003 USD₮0
const psrv = makeApiServer({ appId: "feed", registry: { server: { name: "hologram-os/feed", title: "Holo Feed" }, resources: [{ uri: pitem.id }], tools: [] }, resolve: async (kk) => pstore.get(kk) || null, store: pstore, price: pprice, now: 1000 });
let txn = 0; const wallet = { requestAddress: async () => ({ address: "0x00000000000000000000000000000000000face0" }),
  requestSend: async (chain, to, amount, opts) => ({ hash: "0xTX" + (++txn) + "_" + to.slice(-4) + "_" + amount }) };   // unique tx per call
const transport = async (url, init = {}) => { const path = url.replace(/^.*\/api/, "") || "/"; const out = await psrv.handle({ method: init.method || "GET", path, headers: init.headers || {}, body: init.body }); return { status: out.status, _b: out.body, async json() { return JSON.parse(out.body); }, clone() { return this; } }; };
const r402 = await transport("/api/o/" + encodeURIComponent(pitem.id)); const ch402 = await r402.json();
ok("402-names-plasma-stablecoin", r402.status === 402 && ch402.pay && ch402.pay.rail === "plasma" && ch402.pay.to === payee && ch402.pay.currency === "USD₮0");
const paidRes = await fetchPaid("/api/o/" + encodeURIComponent(pitem.id), {}, { wallet, transport });
ok("fetchPaid-seamless-unlock", paidRes.status === 200 && verify(await paidRes.json()) === true);
// pay once (fresh tx), present twice → 200 then 402 already_spent (a Plasma tx pays once)
const { proof } = await payFor402(ch402, { wallet });
const pa = await transport("/api/o/" + encodeURIComponent(pitem.id), { headers: { authorization: "Holo " + jcs(proof) } });
const pb = await transport("/api/o/" + encodeURIComponent(pitem.id), { headers: { authorization: "Holo " + jcs(proof) } });
ok("plasma-tx-single-use", pa.status === 200 && pb.status === 402 && (await pb.json()).error === "already_spent");
const wrong = await transport("/api/o/" + encodeURIComponent(pitem.id), { headers: { authorization: "Holo " + jcs({ ...proof, to: "0xWRONG", txHash: "0xZZ" }) } });
ok("plasma-wrong-payee-refused", wrong.status === 402);
ok("pay-seam-node-free", !/from\s+["']node:/.test(src(join(OS2, "usr/lib/holo/api/holo-api-pay.js"))) && /holo-wallet-bridge/.test(src(join(OS2, "usr/lib/holo/api/holo-api-pay.js"))));

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "every holospace exposes a SINGLE UNIFIED REST API at /~<app>/api — a standardized, content-addressed κ-stream surface for the open web (humans · external API-gated apps · agents), over the same κ-store/registry as MCP (no parallel infra)",
    "INGRESS (POST /o, POST /stream) imports objects → their κ (the server re-derives the address, Law L2); EGRESS (GET /o/<κ>, GET /stream as NDJSON/SSE) exports SELF-VERIFYING κ-objects (re-derive to verify, Law L5)",
    "the descriptor is OpenAPI 3.1 ⊕ JSON-LD (schema.org) — the REST twin of the MCP capability card; the rendered open semantic web",
    "HTTP 402 pay-per-κ-object-stream monetisation with a REAL token rail: the payer signs a κ-bound PERMIT (binding app + resource + amount + nonce + deadline) that is verified LOCALLY by ed25519 (no node, no chain) — no trusted-amount field, a forged/inflated permit fails the signature; the permit is CONSUMED single-use in a content-addressed spend ledger (replay → already_spent); present it directly for pay-per-κ, or POST it to /settle for a time-boxed self-verifying entitlement; fiat is a pluggable adapter",
    "isomorphic by construction (node-free engine) and mounted on every tier — the dev server AND the serverless Service Worker (no origin server)",
    "WIRED TO HOLO WALLET + THE PLASMA STABLECOIN RAIL — a 402 names the exact gas-abstracted USD₮0 (or any token) transfer; fetchPaid drives the wallet's default-deny human-approval seam to pay it and retries → 200; the Plasma tx is single-use (replay refused), bound to the app's payout address + the resource κ; on-chain finality is a pluggable confirm adapter",
  ],
  sample: { ingestedKappa: k, entitlement: ent.id, price },
  checks, failed: fail,
  authority: "OpenAPI 3.1 · schema.org + W3C JSON-LD + PROV-O · HTTP 402 Payment Required (x402/L402 family) · W3C Service Workers · UOR content-addressing (Law L1/L2/L5)",
};
writeFileSync(join(here, "holo-api-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo API witness — the unified κ-stream REST API (ingress · egress · 402 monetisation)\n");
for (const [k2, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k2}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
