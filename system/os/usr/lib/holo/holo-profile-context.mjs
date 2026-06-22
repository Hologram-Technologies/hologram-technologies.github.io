// holo-profile-context.mjs — THE ONE personalization seam. Reads your on-device memory (holo-memory),
// distills it into a profile (holo-profile), and exposes a cached, read-only `window.HoloProfile` that the
// shell AND every app frame can read — mirroring how holo-plus-boot injects the ambient "+" everywhere, so
// EVERY surface personalizes with ZERO per-app work. 100% local: a projection of your own memory; the
// profile object carries interests/intentions only (no raw memory, no identity, never egresses).
//
// Surfaces read: window.HoloProfile.profile() → the profile κ-object; .terms() → flat interest signal for
// rankByContext/launch-order/tool-router; .refresh() → re-distill (called on a memory-changed event).
import { distillProfile, profileTerms } from "./holo-profile.mjs";

// makeProfileContext({ memory }) — pure + injectable (Node-testable). `memory` is a holo-memory instance
// (or any { recent(): records[] } / { all(): records[] }). Lazily distills + caches; refresh() re-distills
// when memory grew. Never throws — degrades to an empty profile.
export function makeProfileContext({ memory = null, distill = distillProfile } = {}) {
  let cached = null, lastN = -1;
  const records = () => {
    try {
      if (!memory) return [];
      if (typeof memory.all === "function") return memory.all() || [];
      if (typeof memory.recent === "function") return memory.recent({ n: 500 }) || [];
      if (Array.isArray(memory)) return memory;
    } catch (e) {}
    return [];
  };
  function profile() {
    const recs = records();
    if (cached && recs.length === lastN) return cached;     // cache until memory grows (cheap, deterministic)
    lastN = recs.length; cached = distill(recs);
    return cached;
  }
  function refresh() { cached = null; lastN = -1; return profile(); }
  function terms() { return profileTerms(profile()); }
  return { profile, refresh, terms };
}

// Browser binding: build the context over window.HoloMemory and expose a read-only window.HoloProfile that
// every surface (shell + each injected app frame) reads. Idempotent; re-distills on "holo-memory-changed".
if (typeof window !== "undefined" && !window.HoloProfile) {
  const ctx = makeProfileContext({ memory: (typeof window !== "undefined" && window.HoloMemory) || null });
  // a frozen, read-only facade — apps READ the profile, they cannot write it (the user owns it).
  window.HoloProfile = Object.freeze({
    profile: () => { try { return ctx.profile(); } catch (e) { return null; } },
    terms: () => { try { return ctx.terms(); } catch (e) { return []; } },
    refresh: () => { try { return ctx.refresh(); } catch (e) { return null; } },
  });
  try { document.documentElement.addEventListener("holo-memory-changed", () => ctx.refresh(), { passive: true }); } catch (e) {}
  // if HoloMemory arrives AFTER this module (load-order), rebind once it's present.
  if (!window.HoloMemory) {
    let tries = 0; const t = setInterval(() => {
      if (window.HoloMemory) { clearInterval(t); const c2 = makeProfileContext({ memory: window.HoloMemory });
        try { window.HoloProfile = Object.freeze({ profile: () => c2.profile(), terms: () => c2.terms(), refresh: () => c2.refresh() }); } catch (e) {} }
      else if (++tries > 40) clearInterval(t);
    }, 250);
  }
}

export default makeProfileContext;
