#!/usr/bin/env node
// holo-own-mcp-witness.mjs — PROVE the Own layer (ADR-053) is usable by AI agents over MCP, so an
// agent is an owner/counterparty on the same substrate. Drives the canonical Hologram MCP server
// (os/usr/lib/holo/mcp/holo-mcp.mjs) over JSON-RPC: own_verify / own_settle / own_passport are
// advertised (tools/list, JSON-Schema'd); called on a REAL Title chain (built with holo-own + real
// WebCrypto identities) they return self-verifying results (Law L5) that re-derive; a tampered
// chain verifies false and settles nothing; results are deterministic. No browser — an agent
// verifies ownership, settles value, and reads a passport through verifiable tools. Pure Node.
//
//   node tools/holo-own-mcp-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeServer } from "../os/usr/lib/holo/mcp/holo-mcp.mjs";
import { verify as verifyObject } from "../os/usr/lib/holo/holo-object.mjs";
import { enroll } from "../os/usr/lib/holo/holo-identity.mjs";
import * as own from "../os/usr/lib/holo/holo-own.mjs";
import { kappaBlake3 } from "../os/usr/lib/holo/holo-blake3.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; let passed = 0, failed = 0;
const rec = (n, c, d = "") => { checks[n] = !!c; c ? passed++ : failed++; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const ref = (p) => p.kappa.replace(/^did:holo:/, "");

// a REAL ownership chain: Alice mints, transfers to Bob (real Ed25519/ECDSA signatures)
const alice = await enroll({ label: "alice", passphrase: "a" });
const bob = await enroll({ label: "bob", passphrase: "b" });
const owned = kappaBlake3(new TextEncoder().encode("org.hologram.MyAsset"));
const g = await own.mint({ owned }, alice);
const t1 = await own.transfer({ title: g, to: bob }, alice);
const chain = [g, t1];
const tampered = JSON.parse(JSON.stringify(chain)); tampered[1].owner = ref(alice);   // forge the owner

const srv = makeServer({ manifests: [] });
const call = (method, params) => srv.handle({ jsonrpc: "2.0", id: 1, method, params });
const payloadOf = (res) => JSON.parse(res.result.content[0].text);

// 1 · the three Own tools are advertised + JSON-Schema'd (discoverable by any MCP host)
const list = await call("tools/list", {});
const names = (list.result.tools || []).map((t) => t.name);
for (const n of ["own_verify", "own_settle", "own_passport"]) rec(`${n} advertised in tools/list`, names.includes(n));
const verifyTool = list.result.tools.find((t) => t.name === "own_verify");
rec("own_verify declares a JSON-Schema input (titles[])", !!(verifyTool && verifyTool.inputSchema && verifyTool.inputSchema.properties && verifyTool.inputSchema.properties.titles));

// 2 · own_verify on the real chain → owns by Bob, self-verifying result (Law L5)
const v = payloadOf(await call("tools/call", { name: "own_verify", arguments: { titles: chain } }));
rec("own_verify confirms ownership (owner = Bob, chain re-derives)", v.ok === true && v.owner === ref(bob) && v.ownerDid === "did:holo:" + ref(bob));
rec("own_verify result is a self-verifying UOR object (re-derive, Law L5)", verifyObject(v.result));
// 3 · deterministic — a second call re-derives the SAME result κ
const v2 = payloadOf(await call("tools/call", { name: "own_verify", arguments: { titles: chain } }));
rec("own_verify is deterministic (same result κ)", v.result.id === v2.result.id);
// 4 · a tampered chain verifies FALSE
const vBad = payloadOf(await call("tools/call", { name: "own_verify", arguments: { titles: tampered } }));
rec("own_verify rejects a tampered chain (ok=false)", vBad.ok === false);

// 5 · own_settle releases against the proven Title, NOTHING against the tampered one
const order = { subject: t1["@id"], amount: { value: 100, currency: "NP" } };
const s = payloadOf(await call("tools/call", { name: "own_settle", arguments: { order, titles: chain } }));
rec("own_settle releases a voucher to the proven owner", s.released === true && s.voucher && s.voucher.payee === ref(bob));
const sBad = payloadOf(await call("tools/call", { name: "own_settle", arguments: { order, titles: tampered } }));
rec("own_settle releases NOTHING on a tampered Title", sBad.released === false);

// 6 · own_passport summarises provable ownership as a self-verifying object
const pp = payloadOf(await call("tools/call", { name: "own_passport", arguments: { titles: chain } }));
rec("own_passport: owner Bob, history=2, self-verifying", pp.owner === ref(bob) && pp.history === 2 && verifyObject(pp.result));

const witnessed = failed === 0;
writeFileSync(join(here, "holo-own-mcp-witness.result.json"), JSON.stringify({
  spec: "The Own layer (ADR-053) is usable by AI agents over MCP — own_verify · own_settle · own_passport are advertised, schema'd tools returning self-verifying results (Law L5); an agent verifies ownership, settles value against proven title, and reads an ownership passport without trusting any server, and acquires ownership by signing a Title with its own self-sovereign key",
  authority: "W3C Model Context Protocol (2024-11-05) · W3C DID Core · Verifiable Credentials · UCAN · PROV-O · UOR-ADDR (κ = H(canonical_form)) · verify by re-derivation (Law L5)",
  witnessed,
  covers: ["own-mcp", "agents-as-owners", "verify-dont-trust", "self-verifying", "settlement", "law-l5"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-own-mcp-witness: ${passed} passed, ${failed} failed`);
process.exit(witnessed ? 0 : 1);
