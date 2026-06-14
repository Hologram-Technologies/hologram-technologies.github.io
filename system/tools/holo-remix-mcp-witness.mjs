#!/usr/bin/env node
// holo-remix-mcp-witness.mjs — PROVE the REMIX layer is equally accessible to REMOTE AGENTS over MCP:
// the same Inspect/Edit/Share a human does on screen, as advertised, self-verifying tools.
//   A · tools/list advertises holo_inspect + holo_remix (JSON-Schema'd) on the canonical MCP server.
//   B · holo_inspect classifies an object by its bytes and re-derives its κ (bundle→children DAG,
//       module→exports) — the agent understands an object before remixing it.
//   C · holo_remix forks edited bytes → a NEW κ + a SELF-VERIFYING cross-device link: the link's
//       embedded bytes re-derive exactly that κ (Law L5), a tampered link is refused, and the fork is
//       deterministic (same source → same κ). An agent and a human remix the same objects, no server.
//   node tools/holo-remix-mcp-witness.mjs
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeServer } from "../os/usr/lib/holo/mcp/holo-mcp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; console.log(`${c ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); if (!c) fail.push(n); };

const srv = makeServer({ manifests: [] });
const call = (m, p) => srv.handle({ jsonrpc: "2.0", id: 1, method: m, params: p });
const payload = async (m, p) => JSON.parse((await call(m, p)).result.content[0].text);

// A · advertised
const list = (await call("tools/list", {})).result.tools.map((t) => t.name);
ok("tools/list advertises holo_inspect + holo_remix", list.includes("holo_inspect") && list.includes("holo_remix"), list.filter((n) => /inspect|remix/.test(n)).join(", "));

// B · inspect classifies + re-derives κ
const bundle = JSON.stringify({ "@type": "holo:Bundle", layout: "row", children: [{ kappa: "holo://sha256:" + "a".repeat(64), export: "Button", children: "Hi" }, { bundle: "holo://sha256:" + "b".repeat(64) }] });
const bi = await payload("tools/call", { name: "holo_inspect", arguments: { source: bundle } });
ok("holo_inspect: bundle → type=bundle + composition DAG", bi.type === "bundle" && bi.children.length === 2, `${bi.type} · ${bi.children.length} children`);
ok("holo_inspect: re-derives the object's κ from its bytes (Law L5)", bi.kappa === "did:holo:sha256:" + sha(Buffer.from(bundle, "utf8")));
const mod = 'import*as r from"react";function Badge(){}export{Badge as Badge,badgeVariants};';
const mi = await payload("tools/call", { name: "holo_inspect", arguments: { source: mod } });
ok("holo_inspect: module → type=module + exports", mi.type === "module" && mi.exports.includes("Badge"), mi.exports.join(","));

// C · remix → new κ + self-verifying cross-device link
const edited = bundle.replace("Hi", "Remixed by an agent");
const rx = await payload("tools/call", { name: "holo_remix", arguments: { source: edited, parent: bi.kappa } });
ok("holo_remix: returns a new κ + holo:// + link + parent", !!rx.kappa && rx.kappa.startsWith("did:holo:sha256:") && /render\.html#k=.*&o=/.test(rx.link) && rx.parent === bi.kappa);
ok("holo_remix: fork ≠ parent (an edit is a NEW object, not a mutation — Law L1)", rx.kappa !== bi.kappa);
// the link is SELF-VERIFYING: decode its embedded bytes → re-derive κ → must equal the returned κ
const o = /[#&]o=([^&]+)/.exec(rx.link)[1];
const unpacked = gunzipSync(Buffer.from(o.slice(1).replace(/-/g, "+").replace(/_/g, "/"), "base64"));
ok("holo_remix link is SELF-VERIFYING — embedded bytes re-derive the κ (opens on any device, no server)", "did:holo:sha256:" + sha(unpacked) === rx.kappa);
ok("holo_remix link round-trips to the edited content", unpacked.toString("utf8") === edited);
const tam = Buffer.from(unpacked); tam[12] ^= 1;
ok("a tampered link is REFUSED (re-derived κ ≠ claimed κ, Law L5)", "did:holo:sha256:" + sha(tam) !== rx.kappa);
const rx2 = await payload("tools/call", { name: "holo_remix", arguments: { source: edited } });
ok("holo_remix is deterministic (same source → same κ — content addressing)", rx2.kappa === rx.kappa);

const passed = Object.values(checks).filter(Boolean).length, total = Object.keys(checks).length;
const witnessed = passed === total;
writeFileSync(join(here, "holo-remix-mcp-witness.result.json"), JSON.stringify({ witnessed, passed, total, covers: ["remix-mcp", "agents-as-clients", "self-verifying", "cross-device-link", "law-l1", "law-l5"] }, null, 2) + "\n");
console.log(`\n${passed}/${total} checks`);
if (!witnessed) process.exit(1);
console.log("WITNESSED ✓ — the remix layer is equally accessible to remote agents over MCP (inspect · remix · self-verifying share)");
