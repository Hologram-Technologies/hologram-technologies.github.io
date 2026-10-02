// holo-dag-io.mjs — the κ-DAG meets the κ-store (HOLO-PLAYGROUND Y2.5, ATOMIC). An app-dag store maps
// κhex → descriptor, where the descriptor IS the node's attributes and its κ IS blake3(jcs(attributes))
// — everything is an object addressed by its attributes. This module streams those atoms to and from a
// KappaStore: writeDelta persists ONLY the named nodes (an edit touches O(depth) tiny descriptors, a
// few hundred bytes each — never the whole document), and materialize re-derives the full byte-stream
// from its atoms (loads the reachable closure, verifies EVERY descriptor re-derives to its κ — Law L5
// at the atom — then recomposes byte-identically). Pure over an injected store {getByKey, putVerified},
// so it runs in the page, the service worker, and Node witnesses unchanged.
//
//   writeDelta(ks, store, keys)     -> { written, bytes }      // persist named descriptors (idempotent)
//   loadClosure(ks, rootHex)        -> store                   // fetch reachable atoms, verify each (L5)
//   materialize(ks, rootHex)        -> html string             // loadClosure + recompose
//   deltaKeys(before, store)        -> string[]                // store keys added since snapshot `before`
//   snapshot(store)                 -> Set                     // key-set snapshot (pair with deltaKeys)

import { recompose } from "./q/holo-q-app-dag.mjs";
import { jcs } from "./holo-uor.mjs";
import { blake3hex } from "./holo-blake3.mjs";

const enc = new TextEncoder(), dec = new TextDecoder();

export const snapshot = (store) => new Set(Object.keys(store));
export const deltaKeys = (before, store) => Object.keys(store).filter((k) => !before.has(k));

// persist the named descriptors as κ-objects. Each object's bytes are jcs(descriptor) — re-deriving
// them yields the key itself, so the store's put IS the L5 boundary (same trust model as the SW).
export async function writeDelta(ks, store, keys) {
  let written = 0, bytes = 0;
  await Promise.all(keys.map(async (k) => {
    const d = store[k];
    if (!d) return;
    const u8 = enc.encode(jcs(d));
    await ks.putVerified("blake3", k, u8);
    written++; bytes += u8.length;
  }));
  return { written, bytes };
}

// load the reachable closure of rootHex from the store, VERIFYING each atom re-derives (L5). A missing
// or tampered atom throws — the caller falls closed to the base experience, never a torn document.
export async function loadClosure(ks, rootHex) {
  const store = {};
  async function pull(k) {
    if (store[k]) return;
    const u8 = await ks.getByKey("blake3", k);
    if (!u8) throw new Error("dag atom missing: " + k);
    if (blake3hex(u8) !== k) throw new Error("dag atom does not re-derive: " + k);
    const d = JSON.parse(dec.decode(u8));
    store[k] = d;
    if (d.k) await Promise.all(d.k.map(pull));
  }
  await pull(rootHex);
  return store;
}

export async function materialize(ks, rootHex) {
  return recompose(rootHex, await loadClosure(ks, rootHex));
}

// mint a CONCAT tree: parts (strings) become raw atoms under one frag root — nothing here is
// HTML-specific, a DAG node is a byte-preserving concat tree. This is how a stylesheet override
// works on the live token prism: frag[ raw(baseCss), raw(":root{--holo-…}") ] — the 194 KB base is
// ONE atom seeded once; every token edit after that persists 2 tiny atoms (override + new root).
export async function mintConcat(ks, parts) {
  const store = {};
  const putD = (d) => { const k = blake3hex(enc.encode(jcs(d))); store[k] = d; return k; };
  const kids = parts.map((v) => putD({ t: "raw", v: String(v) }));
  const root = putD({ t: "frag", k: kids });
  const d = await writeDelta(ks, store, Object.keys(store));
  return { root, ...d };
}

export default { snapshot, deltaKeys, writeDelta, loadClosure, materialize };
