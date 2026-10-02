// holo-persist.mjs — O2 of HOLO-SOVEREIGN-OFFLINE: the ONE owner of storage durability.
//
// navigator.storage.persist() + estimate() were scattered best-effort calls with ignored results —
// so nobody knew whether the device store was actually durable. This module is the single door:
// called once at boot (idempotent, memoized), the outcome RECORDED honestly under
// localStorage["holo.persist"] — if the browser says no, the status says no; nothing pretends.
//
//   const s = await persistOnce();   // { persisted, quota, usage, headroom, at, why? }
//   const h = await headroom();      // bytes available before the quota floor (for the O3 pin)
//
// Fail-soft: environments without navigator.storage (old browsers, some workers) report
// { persisted:false, why:"unsupported" } and everything above continues exactly as today.

const KEY = "holo.persist";
const FLOOR = 64 * 1024 * 1024;   // keep 64MB clear of the quota — the pin defers `heavy` below this

let _once = null;

export function persistOnce() {
  return (_once ||= (async () => {
    const out = { persisted: false, quota: 0, usage: 0, headroom: 0, at: new Date().toISOString() };
    try {
      if (!(typeof navigator !== "undefined" && navigator.storage)) { out.why = "unsupported"; return record(out); }
      if (navigator.storage.persisted) out.persisted = await navigator.storage.persisted().catch(() => false);
      if (!out.persisted && navigator.storage.persist) out.persisted = await navigator.storage.persist().catch(() => false);
      if (navigator.storage.estimate) {
        const e = await navigator.storage.estimate().catch(() => null);
        if (e) { out.quota = e.quota || 0; out.usage = e.usage || 0; out.headroom = Math.max(0, (e.quota || 0) - (e.usage || 0) - FLOOR); }
      }
      if (!out.persisted) out.why = "browser-declined";     // honest: the OS runs, durability is best-effort
    } catch (e) { out.why = String(e && e.message || e).slice(0, 80); }
    return record(out);
  })());
}

function record(s) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  return s;
}

export async function headroom() { return (await persistOnce()).headroom; }
export function lastStatus() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }

export default { persistOnce, headroom, lastStatus };
