#!/usr/bin/env node
// holo-fabric-witness.mjs — PROVE the substrate FABRIC boundary (Law L4: everything through ONE
// substrate, no parallel memory/storage/network/runtime). holo-resolver resolves a κ from ordered
// byte-SOURCES; holo-fabric types those sources as DRIVERS with capabilities (resolve · store ·
// transform) and a substrate TIER (silicon · optical · photonic-net), selects them by device
// ATTESTATION, and feeds the chosen ones straight into resolveByKappa. The thesis under test: the SAME
// content-address resolves — and the same linear transform computes — on whatever substrate is present,
// with ZERO app change, and a result computed "in light" is admissible IFF it re-derives to its κ
// (Law L5). This is the software insertion point a photonic backend (optical compute / holographic
// store / photonic network route) plugs into — silicon today, light when attested.
//
// Checks (all must hold):
//   1 driverIsKappaAddressed   — a driver's canonical descriptor commits to a stable κ; identical drivers
//                                share it, a different one differs (Law L1/L2 — the driver itself is content).
//   2 resolveThroughFabric     — bytes put through the fabric resolve back and re-derive to their κ (L5).
//   3 tamperRefusedAcrossTier  — a driver serving wrong bytes is refused; another tier heals the κ; a κ no
//                                substrate serves throws (origin-agnostic, fail-closed — L5).
//   4 swapZeroDiff             — the SAME κ resolves byte-identical via silicon vs simulated-photonic
//                                (the abstraction holds: a driver swap changes nothing above the boundary).
//   5 attestSelectsSubstrate   — with an optical attestation the fabric selects the optical tier first;
//                                without it, silicon; the choice is deterministic (same inputs → same pick).
//   6 transformParity          — transform(op,in) on the optical substrate equals the silicon result at the
//                                κ level: light does the linear algebra, the answer re-derives identically.
//   7 serverlessGate           — under requireLocal a network-of-record driver is EXCLUDED and resolution
//                                still succeeds locally; otherwise it is demoted last (ADR-026 · Law L1).
//   8 fallbackNeverBlocks      — with no attested compute substrate, transform falls back to silicon and
//                                still runs (the resolveModel "main brain never blocks" invariant).
//
// Authority (external): holospaces Laws L1/L2/L3/L4/L5 · ADR-026 Sovereign Delivery (cache → peers →
// origin, demoted) · RFC 9334 RATS (attestation gates capability) · W3C DID Core · IETF RFC 8785 (JCS).
// Usage: node tools/holo-fabric-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFabric, driverKappa } from "../os/sbin/holo-fabric.mjs";
import { reDerive, hexOf } from "../os/sbin/holo-resolver.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const enc = (s) => new TextEncoder().encode(s);
const kOf = async (b) => "did:holo:sha256:" + (await reDerive(b));
const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

// a pure "linear transform": out[i] = (in[i] + op[i % |op|]) mod 256 — the same math whether a silicon ALU
// or a diffractive element runs it; substrate-independence means identical bytes ⇒ identical κ.
const apply = (op, inb) => { const o = new Uint8Array(inb.length); for (let i = 0; i < inb.length; i++) o[i] = (inb[i] + op[i % op.length]) & 255; return o; };

// a content-addressed in-memory driver (the witness's stand-in for a real backend). resolve() need NOT
// verify — the fabric re-derives every byte (L5). withTransform adds the optical "compute" capability;
// lies makes it serve tampered bytes (to prove cross-tier healing).
function memDriver({ label, tier, network = null, withTransform = false, lies = false }) {
  const m = new Map();
  const d = {
    label, tier, network,
    caps: ["resolve", "store", ...(withTransform ? ["transform"] : [])],
    async resolve(k) { const u = m.get(hexOf(k)); if (!u) return null; return lies ? enc("TAMPERED — does not re-derive") : u; },
    async store(axis, bytes) { const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const hex = await reDerive(u); m.set(hex, u); return "did:holo:sha256:" + hex; },
    _seed: async (bytes) => { const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); m.set(await reDerive(u), u); },
  };
  if (withTransform) d.transform = async (opK, inK, { resolve }) => apply(await resolve(opK), await resolve(inK));
  return d;
}

const checks = {};
const A = enc("object-A · real bytes through the fabric");
const OP = enc("op-key");
const IN = enc("input-vector-to-transform");

// ── 1 · the driver is itself content-addressed (Law L1/L2) ───────────────────────────────────────
{
  const a = { label: "silicon-opfs", tier: "silicon", caps: ["resolve", "store"], network: null };
  const b = { label: "silicon-opfs", tier: "silicon", caps: ["store", "resolve"], network: null }; // caps order differs
  const c = { label: "photonic-store", tier: "optical", caps: ["resolve", "store"], network: null };
  const [ka, kb, kc] = await Promise.all([driverKappa(a), driverKappa(b), driverKappa(c)]);
  checks.driverIsKappaAddressed = ka === kb && ka !== kc && ka.startsWith("did:holo:sha256:");
}

// ── 2 · bytes put through the fabric resolve back and re-derive (L5) ──────────────────────────────
{
  const fab = makeFabric({ drivers: [memDriver({ label: "silicon", tier: "silicon", withTransform: true })] });
  const k = await fab.put("sha256", A);
  const got = await fab.resolve(k);
  checks.resolveThroughFabric = (await reDerive(got)) === hexOf(k) && same(got, A);
}

// ── 3 · wrong bytes refused; another tier heals; unknown κ throws (L5, origin-agnostic) ───────────
{
  const liar = memDriver({ label: "bad-optical", tier: "optical", lies: true });
  const good = memDriver({ label: "silicon", tier: "silicon" });
  await liar._seed(A); await good._seed(A);
  const fab = makeFabric({ drivers: [liar, good], attest: ["optical"] }); // optical tried FIRST, but it lies
  const got = await fab.resolve(await kOf(A));
  let threw = false; try { await fab.resolve(await kOf(enc("nobody serves this"))); } catch { threw = true; }
  checks.tamperRefusedAcrossTier = same(got, A) && threw;
}

// ── 4 · driver swap is zero-diff above the boundary (differential oracle) ─────────────────────────
{
  const si = memDriver({ label: "silicon", tier: "silicon" });
  const ph = memDriver({ label: "photonic-store", tier: "optical" });
  await si._seed(A); await ph._seed(A);
  const onSilicon = await makeFabric({ drivers: [si, ph], attest: [] }).resolve(await kOf(A));
  const onPhotonic = await makeFabric({ drivers: [si, ph], attest: ["optical"] }).resolve(await kOf(A));
  checks.swapZeroDiff = same(onSilicon, onPhotonic) && same(onSilicon, A);
}

// ── 5 · attestation selects the substrate; the choice is deterministic ────────────────────────────
{
  const si = memDriver({ label: "silicon", tier: "silicon", withTransform: true });
  const ph = memDriver({ label: "photonic-compute", tier: "optical", withTransform: true });
  const withOptical = makeFabric({ drivers: [si, ph], attest: ["optical"] });
  const without = makeFabric({ drivers: [si, ph], attest: [] });
  const pick1 = withOptical.select("transform")[0].tier;
  const pick2 = withOptical.select("transform")[0].tier; // again — must be identical (deterministic)
  checks.attestSelectsSubstrate = pick1 === "optical" && pick2 === "optical" && without.select("transform")[0].tier === "silicon";
}

// ── 6 · transform parity: light's answer re-derives to the SAME κ as silicon's ────────────────────
{
  const si = memDriver({ label: "silicon", tier: "silicon", withTransform: true });
  const ph = memDriver({ label: "photonic-compute", tier: "optical", withTransform: true });
  // op + in live on BOTH substrates (a real κ is servable from anywhere); each fabric resolves locally
  await si._seed(OP); await si._seed(IN); await ph._seed(OP); await ph._seed(IN);
  const opK = await kOf(OP), inK = await kOf(IN);
  const onLight = await makeFabric({ drivers: [si, ph], attest: ["optical"] }).transform(opK, inK);
  const onSilicon = await makeFabric({ drivers: [si, ph], attest: [] }).transform(opK, inK);
  checks.transformParity = onLight.kappa === onSilicon.kappa && onLight.ranOn === "optical" && onSilicon.ranOn === "silicon" && same(onLight.bytes, apply(OP, IN));
}

// ── 7 · serverless gate: a network-of-record driver is excluded under requireLocal; demoted otherwise ─
{
  const local = memDriver({ label: "local", tier: "silicon" });
  const origin = memDriver({ label: "origin-cdn", tier: "silicon", network: "origin" });
  await local._seed(A); await origin._seed(A);
  const strict = makeFabric({ drivers: [origin, local], attest: [], policy: { requireLocal: true } });
  const lax = makeFabric({ drivers: [origin, local], attest: [] });
  const strictSel = strict.select("resolve");
  const laxSel = lax.select("resolve");
  const kA = await kOf(A);
  const excluded = strictSel.every((d) => !d.network) && (await reDerive(await strict.resolve(kA))) === hexOf(kA);
  const demoted = laxSel.length === 2 && laxSel[laxSel.length - 1].network === "origin";
  checks.serverlessGate = excluded && demoted;
}

// ── 8 · fallback never blocks: no attested compute substrate ⇒ runs on silicon ─────────────────────
{
  const si = memDriver({ label: "silicon", tier: "silicon", withTransform: true });
  const ph = memDriver({ label: "photonic-compute", tier: "optical", withTransform: true });
  const fab = makeFabric({ drivers: [si, ph], attest: [] }); // optical present but NOT attested
  const opK = await fab.put("sha256", OP), inK = await fab.put("sha256", IN);
  const out = await fab.transform(opK, inK);
  checks.fallbackNeverBlocks = out.ranOn === "silicon" && same(out.bytes, apply(OP, IN));
}

const witnessed = Object.values(checks).every(Boolean);
writeFileSync(join(here, "holo-fabric-witness.result.json"), JSON.stringify({
  spec: "The substrate FABRIC boundary (Law L4): holo-resolver's byte-sources typed as DRIVERS with capabilities (resolve·store·transform) and a tier (silicon·optical·photonic-net), selected by attestation, fed into resolveByKappa — so the same κ resolves and the same transform computes on whatever substrate is present, ZERO app change, every result re-derived to its κ (Law L5). The insertion point a photonic backend plugs into.",
  authority: "holospaces Laws L1/L2/L3/L4/L5 · ADR-026 Sovereign Delivery (cache → peers → origin, demoted) · RFC 9334 RATS · W3C DID Core · IETF RFC 8785 (JCS)",
  witnessed,
  covers: witnessed ? ["substrate-fabric", "driver-kappa", "attested-selection", "driver-swap-zero-diff", "transform-parity", "serverless-gate", "fallback-never-blocks", "law-l4", "law-l5"] : [],
  checks,
}, null, 2) + "\n");

for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ one fabric boundary — silicon today, photonic when attested, same κ, same result, zero app change" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
