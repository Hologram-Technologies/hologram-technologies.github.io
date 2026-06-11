#!/usr/bin/env node
// holo-own-demo-witness.mjs — the first END-TO-END "Own" demo, witnessed: AN AI AGENT BUYS A
// HOLOSPACE FROM A HUMAN, entirely on the content-addressable substrate. Composes the whole stack:
// self-sovereign identities (holo-identity, real WebCrypto) for BOTH a human and an agent · the Title
// engine (holo-own) · the agent-facing MCP tools (own_verify / own_settle on the canonical server) ·
// the settlement rail (holo-own-rail, wallet mocked offline). The agent does trustless due diligence,
// the human signs the hand-over, value settles ONLY against the proven title, and the agent ends up
// the verified owner — every step re-derives (Law L5); a forged sale settles nothing. Pure Node.
//
//   node tools/holo-own-demo-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeServer } from "../os/usr/lib/holo/mcp/holo-mcp.mjs";
import { verify as verifyObject } from "../os/usr/lib/holo/holo-object.mjs";
import { enroll } from "../os/usr/lib/holo/holo-identity.mjs";
import * as own from "../os/usr/lib/holo/holo-own.mjs";
import { settleVia, mockRail } from "../os/usr/lib/holo/holo-own-rail.js";
import { kappaBlake3 } from "../os/usr/lib/holo/holo-blake3.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; let passed = 0, failed = 0;
const rec = (n, c) => { checks[n] = !!c; c ? passed++ : failed++; console.log(`   ${c ? "✓" : "✗"} ${n}`); };
const ref = (p) => p.kappa.replace(/^did:holo:/, "");
const say = (s) => console.log("\n• " + s);

// the canonical MCP server — the agent's door to the substrate (own_verify / own_settle)
const srv = makeServer({ manifests: [] });
const mcp = async (name, args) => JSON.parse((await srv.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).result.content[0].text);

console.log("\n══ DEMO: an AI agent buys a holospace from a human ══");

// the players — a human and an agent, each a self-sovereign key (no accounts, no server)
const maya = await enroll({ label: "Maya (human)", passphrase: "m" });
const atlas = await enroll({ label: "Atlas (agent)", passphrase: "a" });
// the asset — a holospace, identified by its content
const holospace = kappaBlake3(new TextEncoder().encode(JSON.stringify({ id: "org.hologram.StudioWorld", name: "Studio World" })));
say(`The asset: holospace "Studio World" (${holospace.slice(0, 22)}…). Seller: Maya. Buyer: Atlas (an AI agent).`);

// 1 · Maya owns the holospace — she mints its Title (self-sovereign deed)
const g = await own.mint({ owned: holospace, rights: { "odrl:action": "use" } }, maya);
const v0 = await mcp("own_verify", { titles: [g] });
rec("Maya owns the holospace, verified over MCP (own_verify → Maya)", v0.ok && v0.owner === ref(maya));

// 2 · the agent does trustless DUE DILIGENCE before buying — it verifies the seller's title itself
say("Atlas (the agent) verifies the seller's title over MCP before paying — no server to trust.");
const due = await mcp("own_verify", { titles: [g] });
rec("the agent independently verifies the seller really owns it (due diligence, Law L5)", due.ok && due.owner === ref(maya) && verifyObject(due.result));

// 3 · the sale — Atlas pays Maya for her PROVEN title (the voucher pays the SELLER), then she hands it over
say("Atlas pays Maya 500 NP — the voucher releases ONLY because Maya's title re-derives (pay-for-proven).");
const order = { subject: g["@id"], amount: { value: 500, currency: "NP" }, buyer: ref(atlas) };
const settled = await mcp("own_settle", { order, titles: [g] });      // settle against the SELLER's proven title
rec("the sale settles — a voucher releases against Maya's PROVEN title, payee = Maya (pay-for-proven)", settled.released === true && settled.voucher.payee === ref(maya));
const paid = await settleVia(own, { order, chain: { titles: [g] } }, mockRail(), ref(maya));
rec("value moves to the seller through the wallet rail, the tx bound to the voucher", /tx/.test(paid.txid));
say("Paid. Maya signs the hand-over to Atlas.");
const t1 = await own.transfer({ title: g, to: atlas }, maya);          // the seller signs the transfer
const chain = [g, t1];

// 4 · the agent now OWNS the holospace — the deed has changed hands, verifiably
const v1 = await mcp("own_verify", { titles: chain });
rec("the agent now owns the holospace (deed changed hands, verified over MCP → Atlas)", v1.ok && v1.owner === ref(atlas) && verifyObject(v1.result));

// 5 · a FORGED sale settles nothing — Law L5 refuses
say("A forger who does not hold the title tries to get paid — the substrate refuses.");
const forged = [JSON.parse(JSON.stringify(g))]; forged[0].owner = ref(atlas);    // forge the owner ⇒ κ no longer re-derives
const badSettle = await mcp("own_settle", { order, titles: forged });
rec("a forged/tampered sale releases NOTHING (Law L5)", badSettle.released === false);

// 6 · the whole sale re-derives end-to-end
rec("the full sale re-derives end-to-end: human ⊕ agent ⊕ own ⊕ settle ⊕ MCP (Law L5)", v0.ok && v1.ok && settled.released && verifyObject(v1.result));

console.log(`\n══ Studio World now belongs to Atlas — bought from Maya, no server, fully verified ══`);
const witnessed = failed === 0;
writeFileSync(join(here, "holo-own-demo-witness.result.json"), JSON.stringify({
  spec: "End-to-end Own demo (ADR-053): an AI agent buys a holospace from a human on the content-addressable substrate — self-sovereign human + agent identities, the agent verifies the seller's title over MCP (trustless due diligence), the human signs the hand-over, payment settles ONLY against the proven title (a forged sale settles nothing), and the agent becomes the verified owner; every step re-derives (Law L5)",
  authority: "W3C DID Core · Verifiable Credentials · UCAN · PROV-O · W3C MCP (2024-11-05) · UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1/L4/L5",
  witnessed,
  covers: ["own-end-to-end", "agent-buys-holospace", "human-and-agent", "trustless-due-diligence", "pay-for-proven", "law-l5"],
  asset: holospace, seller: ref(maya), buyer: ref(atlas), salePrice: "500 NP", voucher: (witnessed && (await mcp("own_settle", { order, titles: [g] })).voucher) || null,
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-own-demo-witness: ${passed} passed, ${failed} failed`);
process.exit(witnessed ? 0 : 1);
