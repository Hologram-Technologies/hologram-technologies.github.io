#!/usr/bin/env node
// holo-transport-witness.mjs — the MOVE verb as ONE registry (the sibling of holo-language/WRAP). Proves the
// many movers resolve through one {send, subscribe} contract; a κ-message is delivered BYTE-IDENTICAL (the
// transport is hash-agnostic — it never touches the κ); the registry resolves by name and capability; and a
// mover carrying its own hasher is refused (Law: hash-agnostic transport).
// Authority: holospaces hash-agnostic transport law · the grammar's MOVE verb. node tools/holo-transport-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeTransports, defineTransport, memoryBus, TRANSPORT_CAPS } from "../os/usr/lib/holo/holo-transport.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const KMSG = { t: "post", kappa: "did:holo:sha256:abc123", body: "hello over the wire" };

const movers = makeTransports();
movers.register(memoryBus("local", { local: true, broadcast: true }));
// a point-to-point mover: a single-subscriber queue (same contract, different capability)
let p2pSub = null;
movers.register(defineTransport({ name: "direct", capabilities: { p2p: true }, send: (m) => p2pSub && p2pSub(m), subscribe: (h) => { p2pSub = h; return () => { p2pSub = null; }; } }));
// a relay mover (broadcast + relay caps) to span the taxonomy
movers.register(memoryBus("relay", { relay: true, wan: true }));

// ── 1 · the many movers resolve through ONE interface ─────────────────────────────────────────────────
ok("manyMoversOneInterface", movers.size() === 3 && movers.names().every((n) => typeof movers.byName(n).send === "function"), movers.names().join(","));

// ── 2 · a κ-message is delivered BYTE-IDENTICAL (hash-agnostic: the transport never touches the κ) ──────
const got = [];
movers.subscribe("local", (m) => got.push(m));
movers.subscribe("local", (m) => got.push(m));   // a 2nd subscriber → broadcast fan-out
movers.send("local", KMSG);
const identical = got.length === 2 && got.every((m) => JSON.stringify(m) === JSON.stringify(KMSG) && m.kappa === KMSG.kappa);
ok("deliversByteIdentical", identical, `got ${got.length}, identical=${identical}`);

// ── 3 · the registry resolves by capability (broadcast / p2p / relay) ─────────────────────────────────
const cap = (c) => movers.byCapability(c).map((T) => T.name);
ok("resolvesByCapability", cap("broadcast").includes("local") && cap("p2p").includes("direct") && cap("relay").includes("relay"), JSON.stringify({ broadcast: cap("broadcast"), p2p: cap("p2p"), relay: cap("relay") }));

// ── 4 · point-to-point delivery works through the same contract ───────────────────────────────────────
let d = null; movers.subscribe("direct", (m) => { d = m; }); movers.send("direct", KMSG);
ok("p2pSameContract", d && d.kappa === KMSG.kappa, "direct delivered");

// ── 5 · a Transport carrying its OWN hasher is refused (Law: hash-agnostic) ───────────────────────────
let lawHeld = false;
try { defineTransport({ name: "rogue", hasher: () => "nope", send: () => {}, subscribe: () => () => {} }); } catch { lawHeld = true; }
ok("hashAgnosticLaw", lawHeld, "a mover with its own hasher must throw");

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-transport (the MOVE verb) — the many movers (wan/swarm/gossip/rtc/broadcast/relay) as ONE registry behind a {send, subscribe} contract. A κ-message is delivered byte-identical (hash-agnostic); the registry resolves by name and capability; a mover carrying its own hasher is refused. The MOVE sibling of holo-language (WRAP) — same defineX + makeXRegistry pattern, a different grammar verb.",
  authority: "holospaces hash-agnostic transport law · the grammar's MOVE verb",
  witnessed, checks, failed: fail,
};
writeFileSync(join(here, "holo-transport-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-transport — the MOVE verb as ONE registry (hash-agnostic)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — movers unified behind {send, subscribe}` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
