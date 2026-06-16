#!/usr/bin/env node
// holo-tor-host-witness.mjs — proves the MANAGED-Tor host provisions a Tor SOCKS proxy SAFELY and HONESTLY,
// so onion browsing is zero-install (the Brave model) without ever running an unverified binary. The decision
// + κ-verify + launch state machine is driven entirely with INJECTED fakes — no real download, no real Tor.
//
// Checks (all must hold):
//   1 reuseRunningTor   — if a Tor is already listening, it is reused (source "user-tor"); nothing is provisioned.
//   2 refuseNoPin       — with no pinned κ, provisioning REFUSES (never runs an unpinned executable).
//   3 refuseTampered    — a binary whose bytes do NOT re-derive to the pinned κ is REFUSED (Law L5), not launched.
//   4 launchVerified    — a binary that re-derives to its κ is launched; once Tor prints "Bootstrapped 100%", source "managed-tor".
//   5 bootstrapGate     — ensureTor does NOT return ready until the bootstrap line appears (a process that never bootstraps → honest failure).
//   6 staticNoSpawn     — a host that cannot spawn a process (pure static deploy) refuses with an honest reason, never pretends.
//   7 honestGrade       — a managed/user Tor is a REAL circuit (so directTor may be true) but anonymityGrade is "best-effort", never overstated.
//
// Authority: NIST FIPS-180-4 SHA-256 (binary re-derivation) · holospaces Laws L1/L5 (verify by re-derivation;
// a tampered object is refused) · the Tor bootstrap protocol ("Bootstrapped 100%"). Usage: node tools/holo-tor-host-witness.mjs

import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ensureTor, verifyTorBinary, resolveTorPin, isBootstrapped } from "../os/sbin/holo-tor-host.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-tor-host-witness.result.json"), JSON.stringify(r, null, 2) + "\n");
const sha256hex = async (u8) => createHash("sha256").update(u8).digest("hex");
const checks = {};

// a fake Tor binary + its true κ
const BIN = new TextEncoder().encode("ELF\x7f...pretend-tor-binary..." + "x".repeat(64));
const KAPPA = "sha256:" + createHash("sha256").update(BIN).digest("hex");

// a fake `net` whose 9050/9150 connect behaviour we control (listening ports → onConnect; else error)
const fakeNet = (listening) => ({ connect(opts, onConnect) { const s = new EventEmitter(); s.setTimeout = () => {}; s.destroy = () => {}; setImmediate(() => { if (listening.includes(opts.port)) onConnect(); else s.emit("error", new Error("ECONNREFUSED")); }); return s; } });

// a fake spawned Tor process: emits the bootstrap line (or never, if dud) on stdout
function fakeSpawn({ bootstrap = true } = {}) {
  return (_bin, _args) => { const p = new EventEmitter(); p.stdout = new EventEmitter(); p.kill = () => {}; if (bootstrap) setImmediate(() => p.stdout.emit("data", "Jun 16 00:00:00.000 [notice] Bootstrapped 100% (done): Done")); return p; };
}

// ── 1 · reuse an already-running Tor ─────────────────────────────────────────────────────────────────
{
  const r = await ensureTor({}, { net: fakeNet([9050]) });
  checks.reuseRunningTor = r.ok === true && r.source === "user-tor" && r.socksPort === 9050;
}

// ── 2 · no pin → refuse to provision (never run an unpinned executable) ──────────────────────────────
{
  const r = await ensureTor({}, { net: fakeNet([]), spawn: fakeSpawn(), readFile: async () => BIN, env: {}, platform: "linux", arch: "x64" });
  checks.refuseNoPin = r.ok === false && /no pinned Tor κ|unpinned/i.test(r.reason);
}

// ── 3 · pinned but TAMPERED binary → refused by re-derivation (Law L5) ───────────────────────────────
{
  const tampered = new TextEncoder().encode("MALICIOUS tor replacement");
  const r = await ensureTor({ binPath: "/x/tor" }, { net: fakeNet([]), spawn: fakeSpawn(), readFile: async () => tampered, exists: () => true, env: { HOLO_TOR_KAPPA: KAPPA }, platform: "linux", arch: "x64", sha256hex });
  const directVerify = await verifyTorBinary(tampered, KAPPA, { sha256hex });
  checks.refuseTampered = r.ok === false && /re-derivation|κ|refused/i.test(r.reason) && directVerify === false;
}

// ── 4 · pinned + matching binary → launched; bootstrap → source "managed-tor" ────────────────────────
let good;
{
  good = await ensureTor({ binPath: "/x/tor", socksPort: 9050 }, { net: fakeNet([]), spawn: fakeSpawn({ bootstrap: true }), readFile: async () => BIN, exists: () => true, env: { HOLO_TOR_KAPPA: KAPPA }, platform: "linux", arch: "x64", sha256hex });
  checks.launchVerified = good.ok === true && good.source === "managed-tor" && good.socksPort === 9050;
}

// ── 5 · a process that never bootstraps → honest failure, not a fake "ready" ─────────────────────────
{
  const r = await ensureTor({ binPath: "/x/tor", timeoutMs: 200 }, { net: fakeNet([]), spawn: fakeSpawn({ bootstrap: false }), readFile: async () => BIN, exists: () => true, env: { HOLO_TOR_KAPPA: KAPPA }, platform: "linux", arch: "x64", sha256hex });
  checks.bootstrapGate = r.ok === false && /bootstrap/i.test(r.reason);
}

// ── 6 · static deploy (no spawn capability) → honest refusal ─────────────────────────────────────────
{
  const r = await ensureTor({ binPath: "/x/tor" }, { net: fakeNet([]), /* no spawn */ readFile: async () => BIN, exists: () => true, env: { HOLO_TOR_KAPPA: KAPPA }, platform: "linux", arch: "x64", sha256hex });
  checks.staticNoSpawn = r.ok === false && /spawn|static|native/i.test(r.reason);
}

// ── 7 · honest grade — real circuit, but anonymity not overstated ────────────────────────────────────
{
  checks.honestGrade = good.anonymityGrade === "best-effort" && !!resolveTorPin({ env: { HOLO_TOR_KAPPA: KAPPA }, platform: "linux", arch: "x64" }) && isBootstrapped("Bootstrapped 100% (done): Done") === true;
}

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Holo's host provisions managed Tor for zero-install onion browsing (the Brave model) WITHOUT ever running an unverified binary: the Tor executable is re-derived against its pinned κ before launch (Law L5), an already-running Tor is reused, a tampered/unpinned/unspawnable case refuses honestly, and the receipt states a real circuit with anonymityGrade best-effort — never overstating anonymity",
  authority: "NIST FIPS-180-4 SHA-256 · holospaces Laws L1/L5 · the Tor bootstrap protocol",
  witnessed,
  covers: witnessed ? ["reuse-running-tor", "refuse-unpinned", "refuse-tampered-L5", "launch-verified", "bootstrap-gate", "static-no-spawn-honest", "honest-anonymity-grade"] : [],
  checks,
});
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ managed Tor is zero-install + L5-safe + honest about anonymity" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
