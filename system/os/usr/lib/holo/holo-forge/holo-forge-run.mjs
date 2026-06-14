// holo-forge-run.mjs — verified EXECUTION for Holo Forge (ADR-0074, extends ADR-0051). Pure,
// isomorphic, ZERO-dependency (no crypto here — Law L2: canonicalize once, hash elsewhere), runs
// IDENTICALLY in the browser and in Node, 100% serverless. This is the second half of Holo Forge:
// ADR-0051 made the BUILD a re-derivable κ-transform —  κ(source) ⊕ κ(compiler) ⊕ κ(flags) → κ(artifact).
// This module makes the EXECUTION one too —  κ(module) ⊕ κ(input) → κ(output)  — so a COMPUTATION,
// not just a file, becomes a self-verifying object on the κ-graph (Law L5). "Verified bytes" → "verified
// computation": any peer re-runs the module on the input and re-derives the output κ, with no server to trust.
//
// HOW it stays trustless WITHOUT a VM (so it works in any browser): the substrate's general compute form
// is a κ-addressed Wasm code module (holospaces, "Two compute forms" / "The execution surface"), and the
// WebAssembly Core 2.0 instruction set is DETERMINISTIC — identical module bytes on identical input bytes
// yield identical output bytes on every conformant engine (Law L4: we add no runtime; we run the existing
// compute form on the engine already in every browser). The ONLY ways nondeterminism enters Wasm are
// host imports and a few float NaN-bit / SIMD details. So verified execution admits exactly CLOSED modules:
// no imports (a Holo-C / Forge artifact defines and exports its OWN memory — it imports nothing), run under
// an EMPTY import object. A module that needs a host is REFUSED here — its execution is, by definition, not
// re-derivable. (Imports that are themselves κ-pinned deterministic modules are the Holo Link path, ADR-0060;
// the linker pre-resolves them into one closed module before it reaches here.)
//
// The optional ATTESTED tier (a vendored mvm microVM that attests an expensive or private-input run on a
// host) is NOT this module and never on the browser path: this path is the trustless, re-derivable one.
//
// Authorities: W3C WebAssembly Core Specification 2.0 (deterministic execution) · IETF RFC 8785 (JCS) ·
// W3C PROV-O / DID Core (the execution receipt) · UOR-ADDR (κ-label = H(canonical_form)) · holospaces
// Laws L1/L4/L5 + Q4/Q6 (the same κ runs on any peer and re-derives to verify).

export const RUN_VERSION = "holo-forge-run/1.0.0 · wasm-core-2.0 deterministic executor";
export const ENGINE = { "schema:name": "WebAssembly", "schema:softwareVersion": "core-2.0" };

export class ExecError extends Error {
  constructor(message) { super(message); this.name = "ExecError"; }
}

// ───────────────────────────── the determinism guard (closed-module) ────────────────────────────
// importCount(wasm) — structurally counts the Wasm import section (id 2) entries WITHOUT executing.
// A re-derivable computation must be self-contained: imports are the door host nondeterminism walks
// through, so we admit only closed modules (count 0). Pure section scan, browser-safe.
function importCount(wasm) {
  const b = wasm instanceof Uint8Array ? wasm : new Uint8Array(wasm);
  if (b.length < 8 || b[0] !== 0x00 || b[1] !== 0x61 || b[2] !== 0x73 || b[3] !== 0x6d) throw new ExecError("not a WebAssembly module");
  let i = 8;                                            // skip magic (4) + version (4)
  const uleb = () => { let r = 0, s = 0, byte; do { byte = b[i++]; r |= (byte & 0x7f) << s; s += 7; } while (byte & 0x80); return r >>> 0; };
  while (i < b.length) {
    const id = b[i++];
    const len = uleb();
    if (id === 2) return uleb();                        // first thing in an import section is its vec count
    i += len;                                           // skip this section's payload
  }
  return 0;                                             // no import section ⇒ closed
}

// admits(wasm) → true iff the module is closed (re-derivable). Exposed so callers can refuse early.
export function admits(wasm) { try { return importCount(wasm) === 0; } catch { return false; } }

// ──────────────────────────────────────── the executor ──────────────────────────────────────────
// instantiateClosed(wasm) → instance.exports, refusing any non-closed module. Empty imports: a host
// cannot inject nondeterminism because there is nowhere to inject it.
async function instantiateClosed(wasm) {
  const n = importCount(wasm);
  if (n !== 0) throw new ExecError(`module is not closed: ${n} import(s) — execution would not be re-derivable (use the Holo Link linker first)`);
  const bytes = wasm instanceof Uint8Array ? wasm : new Uint8Array(wasm);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports;
}

// runScalar(wasm, entry, args) → { result } — call an exported i32 function with i32 args. Deterministic.
// This is the lean, low-latency path (a Wasm call is nanoseconds): verified pure-function evaluation.
export async function runScalar(wasm, entry, args = []) {
  const X = await instantiateClosed(wasm);
  const fn = X[entry];
  if (typeof fn !== "function") throw new ExecError(`no exported function '${entry}'`);
  const result = fn(...args.map((a) => a | 0)) | 0;
  return { result, entry, args: args.map((a) => a | 0), mode: "scalar" };
}

// runBuffer(wasm, entry, input, opts) → { output: Uint8Array } — GENERAL-PURPOSE byte→byte transform.
// ABI (the Holo Link memory model): the module exports `memory` and `entry(inPtr, inLen, outPtr) → outLen`;
// we write the input bytes at inPtr, call, and read outLen bytes at outPtr. Same input bytes ⇒ same output
// bytes, so the output is content-addressable and re-derivable. This is the shape verified inference /
// "develop-to-κ" rides on: an opaque transform whose output you can re-derive instead of trust.
export async function runBuffer(wasm, entry, input, opts = {}) {
  const inBytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  const inPtr = opts.inPtr ?? 1024;
  const outPtr = opts.outPtr ?? 1 << 15;               // 32 KiB — clear of the input region within the module's 2-page memory
  const X = await instantiateClosed(wasm);
  const fn = X[entry];
  if (typeof fn !== "function") throw new ExecError(`no exported function '${entry}'`);
  if (!X.memory || !(X.memory.buffer instanceof ArrayBuffer)) throw new ExecError("module exports no linear memory — buffer mode needs an exported `memory`");
  const mem = new Uint8Array(X.memory.buffer);
  if (outPtr + inBytes.length > mem.length) throw new ExecError("input too large for the module's linear memory");
  mem.set(inBytes, inPtr);
  const outLen = fn(inPtr, inBytes.length, outPtr) | 0;
  if (outLen < 0 || outPtr + outLen > mem.length) throw new ExecError("transform returned an out-of-bounds output length");
  const output = mem.slice(outPtr, outPtr + outLen);   // copy out (detaches from the instance's memory)
  return { output, entry, mode: "buffer", inLen: inBytes.length, outLen };
}

// ───────────────────────────── the κ-transform execution receipt (pure) ─────────────────────────
// execReceipt(fields) → the canonical receipt object (WITHOUT its `id`), a PROV-O Activity that links
// the (verified) module κ + input κ → the output κ, via the deterministic Wasm engine. Identical inputs
// ⇒ identical object ⇒ identical address on every platform; the caller seals it (hashes jcs() bytes) with
// its platform crypto — holo-object.address() in Node, WebCrypto in the browser. prov:used is sorted by
// @id so the bytes (hence the did:holo) are platform-stable, exactly like forgeReceipt / linkReceipt.
//
// The receipt COMPOSES with the build receipt by content: this execution's `moduleKappa` is a Forge build
// receipt's `prov:generated` artifact κ. Build proves the bytes; execution proves the computation — one
// chain, so a verified compile→run slots straight into a work receipt (ADR-045) and is payable (ADR-048).
export function execReceipt({ moduleKappa, inputKappa, outputKappa, entry, mode = "scalar", flagsKappa = null, lang = "wasm-core-2.0" }) {
  const used = [
    { "@id": moduleKappa, "@type": ["prov:Entity", "schema:SoftwareApplication"], "schema:encodingFormat": "application/wasm", "hosc:role": "code" },
    { "@id": inputKappa, "@type": ["prov:Entity"], "hosc:role": "input" },
  ].sort((a, b) => (a["@id"] < b["@id"] ? -1 : a["@id"] > b["@id"] ? 1 : 0));
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", hosc: "https://hologram.os/ns/conformance#" },
    ],
    "@type": ["prov:Activity", "hosc:Execution", "schema:CreateAction"],
    "schema:name": "Holo Forge execution",
    "hosc:lang": lang,
    "hosc:engine": ENGINE,
    "hosc:entry": entry,
    "hosc:mode": mode,
    ...(flagsKappa ? { "hosc:flags": flagsKappa } : {}),
    "prov:used": used,
    "prov:generated": { "@id": outputKappa, "@type": ["prov:Entity"], "hosc:role": "output" },
  };
}

// jcs — RFC 8785 JSON Canonicalization Scheme, kept byte-identical to holo-forge.mjs / holo-uor.mjs so a
// receipt addresses the same way everywhere. Pure; no crypto (Law L2).
export const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);
