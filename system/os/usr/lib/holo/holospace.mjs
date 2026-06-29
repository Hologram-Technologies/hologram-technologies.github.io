// holospace.mjs — every tab is a holospace, and a holospace is one verb: mount(κ).
//
// THE UNIFICATION. There is no "app vs machine vs desktop." A holospace is a self-describing, bootable
// environment addressed by a κ. Mounting one is the only operation. The ingenious move is that the *machine*
// is a κ too: a manifest is an (interpreter, program) pair — `machine` and `image` — both content-addressed.
//
//   mount(κ) → resolve(κ) [L5] → Machines.get(manifest.machine).realize(image, params, snapshot, surface)
//
// No branching on a `kind`. The open set of machines is a REGISTRY, not a switch:
//   web            realize(appκ)        → mount holo://<appκ>/ in its own origin (the browser IS the machine)
//   holospaces-x64 realize(rootfsκ, …)  → boot the holospaces wasm VM over an OPFS κ-disk (a dev container)
//   compositor     realize([childκ…])   → mount each child into a tile (compose is NOT special; nesting falls out)
//
// Adding riscv / a brand-new machine = registering one κ. Zero change to mount(), the tab, or the manifest.
// Config = re-addressing: the canonical manifest IS the κ IS the running thing (withFields → a different κ).

import { kappo, kappoVerify } from "./holo-kappa.mjs";

const TYPE = "holospace.v1";
const enc = (s) => new TextEncoder().encode(s);

// canonicalize(manifest) — deterministic JSON: keys sorted recursively, arrays in order. Identical fields →
// identical bytes → identical κ, regardless of insertion order. This is what makes config = identity.
export function canonicalize(value) {
  const walk = (v) => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] !== undefined) out[k] = walk(v[k]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

export const serialize = (manifest) => enc(canonicalize(manifest));        // the canonical bytes
export const kappaOf   = (manifest) => kappo(serialize(manifest));         // the holospace's κ (its identity)
export const verify    = (manifest, k) => kappoVerify(serialize(manifest), k);
export const parse     = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

// withFields(manifest, patch) — an immutable edit. Returns a NEW manifest (so a NEW κ). This is the whole of
// "configure": change cpus/ports/image → a different holospace. No build, no save, no deploy.
export const withFields = (manifest, patch) => ({ ...manifest, ...patch });

// isManifest — a minimal shape gate (we never trust a resolved object until verify() too).
export const isManifest = (m) =>
  !!m && typeof m === "object" && m["@type"] === TYPE && typeof m.machine === "string";

// makeResolver(fetchBytesByKappa) — production resolve: fetch the manifest bytes BY κ, verify-before-trust
// (Law L5 — a forged manifest never mounts), parse. Returns null on miss / tamper / bad shape (fail-closed).
export function makeResolver(fetchBytesByKappa) {
  return async function resolve(k) {
    const bytes = await fetchBytesByKappa(k);
    if (!bytes) return null;
    if (!kappoVerify(bytes, k)) return null;       // the gateway cannot lie
    const m = parse(bytes);
    return isManifest(m) ? m : null;
  };
}

// ── the machine registry: an open set, not a switch ──────────────────────────────────────
export function makeRegistry() {
  const reg = new Map();   // machineκ → adapter { realize(imageκ, params, snapshot, surface) → handle }
  return {
    register(machineKappa, adapter) {
      if (typeof adapter?.realize !== "function") throw new Error("holospace: adapter needs realize()");
      reg.set(machineKappa, adapter);
      return this;
    },
    get: (machineKappa) => reg.get(machineKappa) || null,
    has: (machineKappa) => reg.has(machineKappa),
    list: () => [...reg.keys()],
  };
}

// the default process-wide registry (machines register themselves at import time in the browser).
export const Machines = makeRegistry();

// mount(κ, surface, {resolve, machines}) — THE verb. The whole dispatcher; no branching on type.
// Returns { ok, machine, handle } on success, or { ok:false, reason } fail-closed (never a wrong mount).
export async function mount(spaceKappa, surface, { resolve, machines = Machines } = {}) {
  if (typeof resolve !== "function") throw new Error("holospace.mount: a resolve() is required");
  const m = await resolve(spaceKappa);
  if (!m) return { ok: false, reason: "unresolved" };               // miss / tamper / bad shape
  const adapter = machines.get(m.machine);
  if (!adapter) return { ok: false, reason: "no-machine:" + m.machine };
  const handle = await adapter.realize(m.image, m.params || {}, m.snapshot || null, surface);
  return { ok: true, machine: m.machine, name: m.name || null, handle };
}

export default {
  TYPE, canonicalize, serialize, kappaOf, verify, parse, withFields, isManifest,
  makeResolver, makeRegistry, Machines, mount,
};
