// holo-fabric.mjs — the SUBSTRATE FABRIC boundary (Law L4: everything through ONE substrate, no parallel
// memory/storage/network/runtime). holo-resolver resolves a κ from ordered byte-SOURCES; this layer types
// those sources as DRIVERS — each declaring its capabilities (resolve · store · transform) and its
// substrate TIER (silicon · optical · photonic-net) — selects them by device ATTESTATION, and feeds the
// chosen ones straight into resolveByKappa. So the SAME content-address resolves, and the same linear
// transform computes, on whatever substrate is present, with ZERO change above the boundary. A photonic
// backend (optical compute, holographic store, photonic network route) is one more registrant here;
// nothing above the fabric knows which substrate ran.
//
// Why this is sound the day it ships, before any photonic hardware exists: correctness is substrate-
// INDEPENDENT by construction. Every byte re-derives to its κ (Law L5), so a result computed in light is
// admissible IFF it equals the result re-derived from its address — the silicon drivers already prove the
// abstraction holds (driver-swap is zero-diff). The fabric is value now (one selection point, one cache,
// serverless gate) that compounds the instant a photonic driver registers. See docs/02 (Law L4) and
// ADR-026 (Sovereign Delivery: cache → peers → origin, demoted). node-testable; the SW imports the same.

import { reDerive, hexOf, resolveByKappa } from "./holo-resolver.mjs";

// canon(obj) — RFC 8785-shaped stable key-sorted JSON; the canonical form a driver κ commits to.
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
const canon = (o) => JSON.stringify(sortKeys(o));

// driverKappa(d) → did:holo:sha256:… — the driver is itself content (Law L1/L2): its descriptor (label,
// tier, sorted caps, network) hashes to a stable address. Two structurally-identical drivers share a κ.
export async function driverKappa(d) {
  const desc = { label: d.label, tier: d.tier, caps: [...(d.caps || [])].sort(), network: d.network || null };
  return "did:holo:sha256:" + (await reDerive(new TextEncoder().encode(canon(desc))));
}

// siliconDriver(resolverOrSources, { label }) → the default DRIVER for today's hardware: it wraps the
// substrate's existing resolution — either a resolveByKappa-style resolver fn(κ)→bytes (which THROWS on
// miss) or an ordered array of sources — as one tier-"silicon" driver. This is what makes wiring the
// fabric into a live call site ZERO-DIFF: hand it the resolver the shell already injects and the fabric
// resolves byte-identically, but now an attested optical/photonic driver can be preferred ahead of it.
export function siliconDriver(resolverOrSources, { label = "silicon" } = {}) {
  const fn = Array.isArray(resolverOrSources) ? null : resolverOrSources;        // single resolver vs source list
  return {
    label, tier: "silicon", caps: ["resolve"],
    async resolve(kappa) {
      if (fn) { try { return await fn(kappa); } catch { return null; } }         // a thrown "unresolved" ⇒ null, so the fabric can try the next driver then throw its own
      const hex = hexOf(kappa);
      for (const s of resolverOrSources) {                                       // array form: preserve resolveByKappa's accept-contract (first κ-verified wins)
        let b; try { b = await s(kappa); } catch { b = null; }
        if (!b) continue;
        const u = b instanceof Uint8Array ? b : new Uint8Array(b);
        if (await reDerive(u) === hex) return u;
      }
      return null;
    },
  };
}

// the substrate-preference order: capability-rich tiers first when ATTESTED, silicon as the always-present
// floor. An unattested non-silicon tier is unreachable (filtered before ranking) — you cannot route work to
// a substrate the device has not proven it can run (RFC 9334: attestation gates capability).
const TIER_ORDER = ["optical", "photonic-net"]; // preference among attested non-silicon tiers
const SILICON_RANK = 100;                        // silicon sorts after any attested accelerator, before unknowns
const UNATTESTED = 1e6;

// makeFabric({ drivers, attest, policy }) → the projector.
//   drivers : [ { label, tier, caps:[…], network?, resolve(κ), store?(axis,bytes), transform?(opκ,inκ,env) } ]
//   attest  : [ tier, … ]  — substrate tiers the device has attested it can run (silicon is implicit)
//   policy  : { requireLocal? }  — requireLocal excludes networks-of-record (the 100%-offline/serverless gate)
export function makeFabric({ drivers = [], attest = [], policy = {} } = {}) {
  const reg = [...drivers];
  const attested = new Set(attest);
  const store = new Map();                                   // κ-hex → bytes: RAM is a cache of the address space (L3)

  const reachable = (d) => d.tier === "silicon" || attested.has(d.tier);     // silicon floor; others need attestation
  const localOk = (d) => !policy.requireLocal || !d.network;                 // serverless gate (Law L1, ADR-026)
  const tierRank = (t) => (t === "silicon" ? SILICON_RANK : attested.has(t) ? (TIER_ORDER.indexOf(t) + 1 || 50) : UNATTESTED);

  // select(need) → drivers with that capability, reachable + policy-allowed, ordered: attested accelerator
  // tiers first, silicon floor next, local before networked (ADR-026 demotion), then label (deterministic L5).
  function select(need) {
    return reg
      .filter((d) => (d.caps || []).includes(need) && reachable(d) && localOk(d))
      .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || (a.network ? 1 : 0) - (b.network ? 1 : 0) || String(a.label).localeCompare(String(b.label)));
  }

  // resolve(κ) → bytes — the SAME resolveByKappa as every other call site, fed the substrate-chosen sources.
  // This is the zero-diff property: switching substrates changes which driver serves, never what is served.
  async function resolve(kappa) {
    const sources = select("resolve").map((d) => async (k) => { try { return await d.resolve(k); } catch { return null; } });
    return resolveByKappa(kappa, sources, store);
  }

  // put(axis, bytes) → κ — store on the best store-capable substrate and seed the cache so the next read is local.
  async function put(axis, bytes) {
    const [d] = select("store");
    if (!d) throw new Error("no store-capable substrate registered");
    const kappa = await d.store(axis, bytes);
    store.set(hexOf(kappa), bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    return kappa;
  }

  // transform(opκ, inκ) → { kappa, bytes, ranOn } — run a κ-addressed linear operator over κ-addressed input
  // on the best transform-capable substrate (light when attested), fall back to silicon (never blocks), and
  // ADMIT the result by content (Law L5): the output κ is independent of which substrate computed it.
  async function transform(opKappa, inKappa, env = {}) {
    const [runner] = select("transform");
    if (!runner) throw new Error("no transform-capable substrate registered");
    const raw = await runner.transform(opKappa, inKappa, { resolve, ...env });
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw && raw.bytes != null ? raw.bytes : raw);
    const kappa = "did:holo:sha256:" + (await reDerive(bytes));
    store.set(hexOf(kappa), bytes);
    return { kappa, bytes, ranOn: runner.tier };
  }

  return {
    register: (d) => reg.push(d),
    drivers: () => reg.slice(),
    select,
    resolve,
    put,
    transform,
    store,
  };
}
