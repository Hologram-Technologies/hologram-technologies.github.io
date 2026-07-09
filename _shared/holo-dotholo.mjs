// holo-dotholo.mjs — the .holo app package (HOLO-ANIMATE-PLATFORM, M3). An animated app is sealed as ONE
// content-addressed object: a manifest (source repo@commit + provider + tier + recipe κ + result κ + caps)
// bound to the compiled result bytes. Its identity IS its content (BLAKE3, §1.2), so the SAME repo@commit
// compiles to the SAME .holo κ on every machine → build ONCE per planet; everyone after streams the κ and
// verifies it before render (Law L5). Pure + isomorphic. This is the store's unit of distribution.

import { blake3hex } from "./holo-blake3.mjs";
import { verifyMembers as verifyClosure } from "./holo-l5.mjs";   // the ONE L5 re-derivation primitive
const enc = (s) => new TextEncoder().encode(s);
// RFC 8785 JCS (sorted keys) — one κ across every engine (identical to holo-import/holo-forge).
export const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);
const b3 = (bytesOrStr) => "did:holo:blake3:" + blake3hex(typeof bytesOrStr === "string" ? enc(bytesOrStr) : bytesOrStr);

export const VERSION = "holo-dotholo/0.1.0";

// holoManifest(...) → the sealed descriptor (no bytes; the result is referenced by resultKappa). ───────────
export function holoManifest({ repo, commit = null, provider, tier, recipeKappa = null, resultKappa, name = null, contentType = "text/html", deps = null, capabilities = null }) {
  return {
    "@type": "holo:App", "holo:version": 1,
    "holo:source": repo ? (repo.replace(/^https?:\/\//, "") + (commit ? "@" + commit : "")) : null,
    "holo:provider": provider, "holo:tier": tier,
    ...(recipeKappa ? { "holo:recipe": recipeKappa } : {}),
    "holo:result": resultKappa, "holo:contentType": contentType,
    ...(name ? { "schema:name": name } : {}),
    ...(deps && deps.length ? { "holo:deps": deps } : {}),
    ...(capabilities ? { "holo:capabilities": capabilities } : {}),
  };
}

// sealHolo({ repo, commit, provider, tier, recipeKappa, result, ... }) → { kappa, manifest, resultKappa, result }.
// `result` = the compiled app bytes/string (R0/R1: one self-contained HTML). kappa = κ of the manifest;
// resultKappa = κ of the bytes. Same source → same κ (Law L5 content-convergence).
export function sealHolo({ repo, commit = null, provider, tier, recipeKappa = null, result, name = null, contentType = "text/html", deps = null, capabilities = null }) {
  if (result == null) throw new Error("sealHolo needs the compiled result bytes");
  const resultKappa = b3(result);
  const manifest = holoManifest({ repo, commit, provider, tier, recipeKappa, resultKappa, name, contentType, deps, capabilities });
  const kappa = b3(jcs(manifest));
  return { kappa, manifest, resultKappa, result };
}

// ── machine .holo (R3): the result is a FROZEN MACHINE (disk κ ⊕ device-state κ + boot meta), not bytes to
//    render. Open = RESUME, not reboot. Sealed + verified exactly like a content .holo (its result is the JCS
//    of the snapshot descriptor), so one cache + one open path serve both kinds. ─────────────────────────────
// snapshot = { disk, dev, engine, mem, smp } — the descriptor holo-vm.vmSnapshot writes (disk manifest κ +
// device-state κ + boot meta). port = the app's forwarded/guest port so the resumed machine re-projects.
export function sealMachineHolo({ repo, commit = null, provider, tier = "R3", recipeKappa = null, snapshot, name = null, port = 0, capabilities = null }) {
  if (!snapshot || !snapshot.dev) throw new Error("sealMachineHolo needs a snapshot descriptor { disk, dev, ... }");
  const result = jcs(snapshot);                      // the machine descriptor IS the result bytes
  const resultKappa = b3(result);
  const manifest = { ...holoManifest({ repo, commit, provider, tier, recipeKappa, resultKappa, name, contentType: "application/holo-machine", capabilities }), "holo:kind": "machine", "holo:port": port };
  const kappa = b3(jcs(manifest));
  return { kappa, manifest, resultKappa, result, snapshot };
}
// openMachineHolo({ kappa?, manifest, result }) → { ok, snapshot?, port?, error? }. VERIFY BEFORE RESUME (L5):
// the descriptor bytes must hash to resultKappa (and manifest to kappa) — a tampered machine κ is refused
// before the guest is resumed. Returns the snapshot descriptor for holo-vm.vmResume.
export function openMachineHolo({ kappa = null, manifest, result }) {
  if (!manifest || result == null) return { ok: false, error: "incomplete machine .holo" };
  if (manifest["holo:kind"] !== "machine") return { ok: false, error: "not a machine .holo (use openHolo)" };
  if (kappa && !verifyHolo(kappa, manifest)) return { ok: false, error: "manifest-mismatch (tampered machine κ)" };
  if (b3(result) !== manifest["holo:result"]) return { ok: false, error: "snapshot-mismatch (tampered machine, L5 refused)" };
  return { ok: true, snapshot: JSON.parse(typeof result === "string" ? result : new TextDecoder().decode(result)), port: manifest["holo:port"] || 0, manifest };
}
// isMachine(manifest) — the store branches open→resume vs open→render on this. ─────────────────────────────
export const isMachine = (manifest) => !!(manifest && manifest["holo:kind"] === "machine");

// ── closure .holo (κ-Portal, P0): ONE κ that transitively names an ENTIRE runtime — the entry document + every
//    subresource + the delivery Service Worker — as a Merkle root. This is the single self-verifying κ that is
//    "sufficient to stream the whole experience anywhere": a cold, foreign browser fetches this one .holo, opens
//    it (L5), then streams each member by κ (content-blind transport) and refuses any byte that does not
//    re-derive. Unifies today's scattered holospace.lock.json `closure` + os-closure.json under one sealed κ.
//    members: { "path": "did:holo:<algo>:<hex>" | { kappa } } — the closure map (path→κ). The SORTED map's JCS
//    IS the result bytes (same trick as sealMachineHolo), so one cache + one verify path serve every kind. ─────
const kappaOf = (v) => (typeof v === "string" ? v : v && v.kappa);
const algoHexOf = (kappa) => { const m = /^did:holo:([a-z0-9]+):([0-9a-f]+)$/.exec(kappa || ""); return m ? { algo: m[1], hex: m[2] } : null; };

export function sealClosureHolo({ repo, commit = null, provider = "closure", tier = "R1", entry, members, worker = null, name = null, capabilities = null, deps = null }) {
  if (!entry || !members || typeof members !== "object") throw new Error("sealClosureHolo needs { entry, members }");
  if (!members[entry]) throw new Error("sealClosureHolo: entry must be a member of the closure");
  const map = {};                                    // path → κ, sorted → deterministic (build once per planet)
  for (const p of Object.keys(members).sort()) { const k = kappaOf(members[p]); if (!algoHexOf(k)) throw new Error("sealClosureHolo: member '" + p + "' has no κ"); map[p] = k; }
  const wk = worker ? kappaOf(worker) : null;
  if (worker && !algoHexOf(wk)) throw new Error("sealClosureHolo: worker κ malformed");
  const result = jcs(map);                           // the closure map IS the result bytes
  const resultKappa = b3(result);
  const manifest = {
    ...holoManifest({ repo, commit, provider, tier, resultKappa, name, contentType: "application/holo-closure", deps, capabilities }),
    "holo:kind": "closure", "holo:entry": entry, ...(wk ? { "holo:worker": wk } : {}), "holo:files": Object.keys(map).length,
  };
  const kappa = b3(jcs(manifest));
  return { kappa, manifest, resultKappa, result, members: map };
}
export const isClosure = (manifest) => !!(manifest && manifest["holo:kind"] === "closure");

// openClosureHolo({ kappa?, manifest, result }) → { ok, entry?, worker?, members?, error? }. STRUCTURAL L5:
// manifest re-derives to κ, the closure-map bytes re-derive to resultKappa, and the entry is a listed member.
// (Byte-completeness of the members is a separate async pass — verifyClosure — since it needs the bytes.)
export function openClosureHolo({ kappa = null, manifest, result }) {
  if (!manifest || result == null) return { ok: false, error: "incomplete closure .holo" };
  if (manifest["holo:kind"] !== "closure") return { ok: false, error: "not a closure .holo (use openHolo/openMachineHolo)" };
  if (kappa && !verifyHolo(kappa, manifest)) return { ok: false, error: "manifest-mismatch (tampered closure κ)" };
  if (b3(result) !== manifest["holo:result"]) return { ok: false, error: "closure-mismatch (tampered map, L5 refused)" };
  let members; try { members = JSON.parse(typeof result === "string" ? result : new TextDecoder().decode(result)); } catch { return { ok: false, error: "closure map is not JSON" }; }
  const entry = manifest["holo:entry"];
  if (!members[entry]) return { ok: false, error: "entry '" + entry + "' not in closure (L5 refused)" };
  return { ok: true, entry, worker: manifest["holo:worker"] || null, members, manifest };
}

// verifyClosure — the closure COMPLETENESS gate. It IS the ONE L5 primitive (holo-l5.verifyMembers, imported at
// top as verifyClosure) so the re-derivation rule lives in a single place (shared with the delivery Service
// Worker). Re-derive EVERY member or refuse (missing / tampered / unverifiable). Same signature + result as before.
export { verifyClosure };

// verifyHolo(kappa, manifest) → the manifest re-derives to the .holo κ (identity intact). ──────────────────
export function verifyHolo(kappa, manifest) { return b3(jcs(manifest)) === kappa; }

// openHolo({ kappa?, manifest, result }) → { ok, html?, error? }. VERIFY BEFORE RENDER (L5): the bytes must
// hash to the manifest's resultKappa, and (if kappa given) the manifest must hash to it — tamper → refused.
export function openHolo({ kappa = null, manifest, result }) {
  if (!manifest || result == null) return { ok: false, error: "incomplete .holo (manifest + result required)" };
  if (manifest["holo:kind"] === "machine") return { ok: false, error: "machine .holo (use openMachineHolo)" };
  if (manifest["holo:kind"] === "closure") return { ok: false, error: "closure .holo (use openClosureHolo)" };
  if (kappa && !verifyHolo(kappa, manifest)) return { ok: false, error: "manifest-mismatch (tampered .holo κ)" };
  if (b3(result) !== manifest["holo:result"]) return { ok: false, error: "result-mismatch (tampered bytes, L5 refused)" };
  return { ok: true, html: typeof result === "string" ? result : new TextDecoder().decode(result), manifest };
}

// packHolo(sealed) / unpackHolo(bytes) → a single self-describing wire blob (manifest + result) for the
// κ-cache / fabric to store + stream as one object. JSON envelope (result base64) — simple + verifiable.
// ISOMORPHIC base64 (SS-P0): `Buffer` is a Node global — in the browser/service-worker the .holo must pack
// and unpack identically (OPFS warm tier, static κ-registry), so base64 goes via btoa/atob there. Chunked:
// String.fromCharCode.apply blows the arg limit on multi-MB results.
export const b64encode = (bytes) => {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
};
export const b64decode = (b64) => {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const s = atob(b64); const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
};
export function packHolo({ kappa, manifest, result }) {
  const b64 = b64encode(typeof result === "string" ? enc(result) : result);
  return JSON.stringify({ kappa, manifest, result_b64: b64 });
}
export function unpackHolo(bytes) {
  const o = JSON.parse(typeof bytes === "string" ? bytes : new TextDecoder().decode(bytes));
  const result = new TextDecoder().decode(b64decode(o.result_b64));
  return { kappa: o.kappa, manifest: o.manifest, result };
}

export function describeDotHolo() {
  return { is: "the .holo app package — a content-addressed app (manifest ⊕ compiled result), the store's unit of distribution",
    once: "same repo@commit → same .holo κ everywhere → build once per planet; re-open streams the κ (0 rebuild)",
    l5: "verify before render — bytes must hash to resultKappa, manifest to the .holo κ; tamper → refused" };
}

export default { VERSION, holoManifest, sealHolo, sealMachineHolo, openMachineHolo, isMachine, sealClosureHolo, openClosureHolo, verifyClosure, isClosure, verifyHolo, openHolo, packHolo, unpackHolo, jcs, describeDotHolo };
