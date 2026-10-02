// holo-runtime.mjs — the upstream holospace runtime, resolved BY ITS κ (never by a path).
//
// Law L4 (everything through the substrate): the runtime that verifies content must itself arrive as
// verified content. Until now the wasm runtime (holospaces_web glue + wasm) was imported by PATH and
// executed unverified — the one component the resolver trusted on location. This module closes that:
//
//   holo-runtime.json (root)  =  ONE Ed25519-SIGNED POINTER  { name, channel, seq, assets{glue,wasm} }
//                                 each asset = { blake3, sha256, bytes, hint }  — κ is the truth,
//                                 the hint path is only a place to look (SEC-6: verify against the κ,
//                                 never trust the reference).
//
//   loadRuntime()             =  pointer → verify signature → resolve each asset (CacheStorage κ-tier
//                                 first — L3, the store is the memory — then the hint path) → RE-DERIVE
//                                 blake3 before a single byte executes (L5/SEC-1) → import the glue from
//                                 a blob URL → init the wasm FROM THE VERIFIED BYTES (wasm-bindgen
//                                 module_or_path accepts BufferSource — the glue never fetches on its own).
//
// Bumping the runtime = re-signing the pointer at a new seq with new κs. No consumer changes, no app
// re-seal, no Q re-bundle: every surface that resolves the runtime through here picks the new engine up
// on its next load. That is "downstream dependency" made literal (SEC-3: one runtime, resolved once,
// shared — the per-copy skew this replaces had three different builds in one tree).
//
// Fail-closed: bad signature, missing asset, or κ mismatch → throw (callers fall back to the pure-JS
// hasher ladder exactly as before — the runtime is an upgrade, never a dependency for correctness).

import { jcs } from "./holo-object.mjs";
import { blake3hex } from "./holo-blake3.mjs";

const te = new TextEncoder();
const CACHE = "holo-runtime-v1";                      // CacheStorage bucket: κ-keyed, immutable entries
const PTR_LS = "holo-runtime/pointer";                // last verified pointer (offline fallback)
const ADOPTED_LS = "holo-runtime/adopted";            // an upstream pointer this device adopted (newer, verified + conformant)

// The upstream holospace runtime channel — holospaces publishes here; a downstream consumer FOLLOWS it
// so an engine release reaches this device with no Q re-ship (L4). Consulted in the BACKGROUND only,
// NEVER on the boot/critical path: the local pinned pointer always boots first.
const CHANNEL = "https://hologram-technologies.github.io/holospaces/runtime/holo-runtime.json";
// verifyPointer proves a pointer is self-consistent; AUTHORITY over a cross-origin (followed) pointer is
// this ONE pinned key — a followed pointer signed by any other key is refused. (The LOCAL pointer needs
// no pin: it is protected by Q's signed release strand.)
const TRUSTED_PUB = "snYY6y35gdZ1ngOE5E+G1BGFjlTo2MfpfP8h6yc7r+M=";

const b64u8 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hexOf = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ── the pointer ────────────────────────────────────────────────────────────────────────────────────────

async function verifyPointer(doc) {
  if (!doc || !doc.payload || !doc.sig || !doc.pub || doc.alg !== "Ed25519") throw new Error("runtime-pointer: malformed");
  const key = await crypto.subtle.importKey("raw", b64u8(doc.pub), { name: "Ed25519" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, b64u8(doc.sig), te.encode(jcs(doc.payload)));
  if (!ok) throw new Error("runtime-pointer: signature does not verify");
  const p = doc.payload;
  for (const k of ["glue", "wasm"]) {
    const a = p.assets && p.assets[k];
    if (!a || !/^[0-9a-f]{64}$/.test(a.blake3 || "") || !a.hint) throw new Error(`runtime-pointer: asset ${k} malformed`);
  }
  return p;
}

export async function fetchPointer({ base, fetchFn = null } = {}) {
  const f = fetchFn || fetch.bind(globalThis);
  const url = new URL("holo-runtime.json", base).href;
  let local = null;
  try {
    const r = await f(url, { cache: "no-cache" });                       // a pointer is MUTABLE: revalidate
    if (!r.ok) throw new Error(`pointer http ${r.status}`);
    const doc = await r.json();
    local = await verifyPointer(doc);
    lsSet(PTR_LS, doc);
  } catch (e) {
    // offline / rung down → the LAST VERIFIED pointer still opens the runtime (verified again here)
    const saved = lsGet(PTR_LS);
    if (saved) { try { local = await verifyPointer(saved); } catch {} }
  }
  // A background-ADOPTED upstream pointer (authority-pinned + L5-verified + conformance-checked in
  // followChannel) SUPERSEDES the local one when strictly newer — this is how an upstream engine release
  // reaches this device with no Q re-ship. Anything short of a valid, newer, pinned pointer → the local one.
  try {
    const a = lsGet(ADOPTED_LS);
    if (a && a.pub === TRUSTED_PUB) {
      const av = await verifyPointer(a);
      if (!local || (av.seq | 0) > (local.seq | 0)) return av;
    }
  } catch {}
  if (local) return local;
  throw new Error("runtime-pointer: no verified pointer available (local + adopted both absent)");
}

// ── κ-resolve one asset: store tier, then the hint — every byte re-derives (L5) ───────────────────────

async function resolveAsset(a, { base, fetchFn }) {
  const f = fetchFn || fetch.bind(globalThis);
  const key = `/.holo/blake3/${a.blake3}`;                               // the store speaks κ, not paths
  let store = null;
  try { store = await caches.open(CACHE); } catch {}                     // no CacheStorage (node/private) → network only
  if (store) {
    const hit = await store.match(key);
    if (hit) return new Uint8Array(await hit.arrayBuffer());             // admitted-verified once (L3)
  }
  const r = await f(new URL(a.hint, base).href);
  if (!r.ok) throw new Error(`runtime asset ${a.blake3.slice(0, 12)}…: hint http ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const got = await blake3hex(bytes);
  if (got !== a.blake3) throw new Error(`runtime asset REFUSED: re-derived ${got.slice(0, 12)}… ≠ pinned ${a.blake3.slice(0, 12)}… (L5)`);
  if (store) { try { await store.put(key, new Response(bytes, { headers: { "x-holo-kappa": `blake3:${a.blake3}` } })); } catch {} }
  return bytes;
}

// ── load: pointer → verified bytes → module (one flight per document — SEC-3) ─────────────────────────

// Import the VERIFIED glue bytes as a module — blob: URL in the browser; data: where blob imports are
// refused (strict CSP, or node witnesses). Either way the module graph never touches the hint path.
async function importGlue(glue) {
  let url = null;
  try { url = URL.createObjectURL(new Blob([glue], { type: "text/javascript" })); return await import(/* @vite-ignore */ url); }
  catch {
    let b64; try { b64 = Buffer.from(glue).toString("base64"); }
    catch { let s = ""; for (let i = 0; i < glue.length; i += 0x8000) s += String.fromCharCode.apply(null, glue.subarray(i, i + 0x8000)); b64 = btoa(s); }
    return await import(/* @vite-ignore */ "data:text/javascript;base64," + b64);
  } finally { if (url) URL.revokeObjectURL(url); }
}

// ── background follow: adopt a NEWER upstream engine, airtight ────────────────────────────────────────
// NEVER on the boot/critical path (fired fire-and-forget from loadRuntime, once per document). Adopts a
// channel pointer IFF, in order: signed by the PINNED authority key · strictly newer than what we run ·
// every asset RE-DERIVES to its κ (L5) · the wasm computes the SAME κ as the pure-JS reference on test
// vectors (conformance vs external ground truth). Any miss → it does nothing and the current runtime (or
// the pure-JS hasher fallback) stands. On success the κ-bytes are cached and the pointer stored, so the
// NEXT loadRuntime runs the new engine — an upstream release, applied with no Q re-ship.
let _followed = false;
export async function followChannel({ fetchFn = null } = {}) {
  if (_followed) return; _followed = true;
  try {
    const f = fetchFn || fetch.bind(globalThis);
    const r = await f(CHANNEL, { cache: "no-cache" });
    if (!r.ok) return;
    const doc = await r.json();
    if (doc.pub !== TRUSTED_PUB) return;                                  // AUTHORITY: only the pinned signer
    const p = await verifyPointer(doc);                                  // signature valid for that key
    const running = Math.max((lsGet(ADOPTED_LS) || {})?.payload?.seq | 0, (lsGet(PTR_LS) || {})?.payload?.seq | 0);
    if ((p.seq | 0) <= running) return;                                  // not newer → nothing to do
    const base = new URL(".", CHANNEL).href;
    const glue = await resolveAsset(p.assets.glue, { base, fetchFn });   // L5 re-derive (also primes the κ-cache)
    const wasm = await resolveAsset(p.assets.wasm, { base, fetchFn });
    // CONFORMANCE: the new wasm must compute the SAME κ as the pure-JS reference — else refuse it.
    const mod = await importGlue(glue);
    if (mod.default) await mod.default({ module_or_path: wasm });
    if (typeof mod.kappa !== "function") return;
    for (const v of [new Uint8Array(0), te.encode("hologram"), new Uint8Array(99991).map((_, i) => i & 255)])
      if (String(mod.kappa(v)).replace(/^blake3:/, "") !== await blake3hex(v)) return;   // NON-conformant → refuse
    lsSet(ADOPTED_LS, doc);                                              // adopt (bytes already κ-cached by resolveAsset)
  } catch {}
}

let _flight = null;

export function loadRuntime({ base, fetchFn = null } = {}) {
  followChannel({ fetchFn }).catch(() => {});                            // background: check upstream (never blocks)
  return (_flight ||= (async () => {
    const p = await fetchPointer({ base, fetchFn });
    const [glue, wasm] = await Promise.all([
      resolveAsset(p.assets.glue, { base, fetchFn }),
      resolveAsset(p.assets.wasm, { base, fetchFn }),
    ]);
    const mod = await importGlue(glue);                                 // VERIFIED glue → module (hint never re-touched)
    if (mod.default) await mod.default({ module_or_path: wasm });        // wasm from OUR verified bytes
    return { module: mod, meta: { name: p.name, channel: p.channel, seq: p.seq, glue: p.assets.glue.blake3, wasm: p.assets.wasm.blake3 } };
  })().catch((e) => { _flight = null; throw e; }));                      // a failed flight never sticks
}

// The shape holo-names-host's wasmGlue option wants: an async () => module with kappa()/verify_kappa().
export const runtimeModule = (opts) => loadRuntime(opts).then((r) => r.module);
