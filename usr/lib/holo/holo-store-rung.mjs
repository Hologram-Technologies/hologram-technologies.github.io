// holo-store-rung.mjs — O2 of HOLO-SOVEREIGN-OFFLINE: the device κ-store as a VERIFIED serving rung.
//
// One module, two callers: the root service worker (κ-route + evicted rescue, store-first) and the
// page-side resolver (holo-names-host TIER 0). Backed by the IndexedDB κ-store (holo-kstore — shared
// page+SW by design: the DB either context fills is the DB the other serves from).
//
// STATIC imports only — dynamic import() is DISALLOWED in service workers (spec), and static module-SW
// imports are cached WITH the registration, so this whole rung loads with the radio dead. (This is the
// exact failure mode that made the first lazy draft serve nothing offline.)
//
// LAWS (holospaces, restated):
//   · Warm ≠ trusted: every read RE-DERIVES the bytes on the requested axis before serving (L5).
//     sha256 = WebCrypto (~GB/s); blake3 = pure JS (sub-ms at asset sizes, O0 bench). The verify tax
//     is off the boot hot path (that stays pure caches.match) and negligible here.
//   · Tamper → refuse + PURGE + WITNESS: a stored byte that no longer re-derives is deleted (the
//     store cannot stay poisoned) and the refusal lands in the "holo-witness" cache, inspectable.
//   · Fail-soft: any store trouble (IDB gone, private mode, quota) → null/no-op — callers fall
//     through to the network and the OS behaves exactly as before this rung existed.
//
// DUAL-AXIS, one keyspace: bytes live under the hex they were stored by; an ALIAS entry (a tiny JSON
// marker) lets the same bytes answer on the other axis without doubling storage. Following an alias is
// safe by construction: the result is re-derived against the REQUESTED hex, so a real object that
// merely looks like a marker can never serve wrong bytes — worst case is a store miss.

import { kget, kput, kdel, khas } from "./holo-forge/holo-kstore.mjs";
import { blake3hex } from "./holo-blake3.mjs";

const ALIAS = '{"holo-alias":"';
const CAP = 64 * 1024 * 1024;   // sanity cap on single-object write-back (heavy weights ride O3's streaming pin)

export function makeStoreRung() {
  const sha256hex = async (u8) => {
    const d = await crypto.subtle.digest("SHA-256", u8);
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  };
  const derive = (axis, u8) => (axis === "sha256" ? sha256hex(u8) : Promise.resolve(blake3hex(u8)));

  // the refusal record — one JSON body per event in the "holo-witness" cache (inspectable from any page)
  async function witness(kind, detail) {
    try {
      const c = await caches.open("holo-witness");
      const url = new URL("/.holo-witness/" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e6).toString(36), self.location.href).href;
      await c.put(new Request(url), new Response(JSON.stringify({ kind, at: new Date().toISOString(), ...detail }), { headers: { "content-type": "application/json" } }));
    } catch {}
  }

  const rawGet = async (hex) => { try { return (await kget(hex)) || null; } catch { return null; } };

  // get(axis, hex) → verified Uint8Array | null. Tampered entry → purge + witness + null (fail to net).
  async function get(axis, hex) {
    let u8 = await rawGet(hex);
    let via = hex;
    if (u8 && u8.length < 200) {                            // possible alias marker — follow, then verify vs REQUESTED hex
      try {
        const t = new TextDecoder().decode(u8);
        if (t.startsWith(ALIAS)) { via = JSON.parse(t)["holo-alias"]; u8 = await rawGet(via); }
      } catch {}
    }
    if (!u8) return null;
    let got;
    try { got = await derive(axis, u8); } catch { return null; }   // hasher trouble → never serve unverified
    if (got !== hex) {
      try { await kdel(via); if (via !== hex) await kdel(hex); } catch {}
      await witness("store-tamper", { axis, want: hex, got, bytes: u8.length, purged: true });
      return null;
    }
    return u8;
  }

  // put(axis, hex, bytes) — bytes the CALLER has already verified against hex (the SW's L5 path).
  // otherHex (optional) records the dual-axis alias so the same bytes answer on both axes.
  async function put(axis, hex, bytes, { otherHex = null } = {}) {
    if (!bytes || bytes.length > CAP) return false;
    try {
      await kput(hex, bytes);
      if (otherHex && otherHex !== hex) await kput(otherHex, new TextEncoder().encode(ALIAS + hex + '"}'));
      return true;
    } catch { return false; }
  }

  async function has(hex) { try { return await khas(hex); } catch { return false; } }

  return { get, put, has, witness };
}

export default { makeStoreRung };
