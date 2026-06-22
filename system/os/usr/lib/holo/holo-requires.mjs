// holo-requires.mjs — honest HARD-requirement degradation (distinct from holo-capability.mjs, the ADR-028
// soft UX TIER system). A new user's browser may lack WebGPU, block storage (private mode), or run without
// SharedArrayBuffer (no COOP/COEP). An app that ASSUMES one shows a blank frame or throws — "many parts dont
// work for me." This is the ONE place that detects what the machine actually has and, when something an app
// REQUIRES is missing, renders a calm LABELED fallback instead of a crash. The shell consults it before
// mounting (os/etc/app-capabilities.json declares each app's needs); witnessed under REAL capability stripping.
//
// Exposes window.HoloRequires = { detect, missingFor, label, fallbackDoc, mountWithCapability }.

const CAP_LABEL = {
  webgpu: "WebGPU (GPU acceleration)",
  opfs: "private file storage (OPFS)",
  sab: "SharedArrayBuffer (cross-origin isolation)",
  storage: "local storage",
  threads: "multi-threading",
};
export const label = (c) => CAP_LABEL[c] || c;

// Detect REAL capabilities of THIS browser. Each probe is defensive: a thrown getter (some privacy modes
// throw on access) reads as "absent", never crashes the caller.
export function detect() {
  const has = (fn) => { try { return !!fn(); } catch { return false; } };
  const webgpu = has(() => navigator.gpu);
  const opfs = has(() => navigator.storage && typeof navigator.storage.getDirectory === "function");
  const sab = has(() => typeof SharedArrayBuffer !== "undefined") && has(() => self.crossOriginIsolated === true);
  const storage = has(() => { const k = "__holoreq__"; localStorage.setItem(k, "1"); const ok = localStorage.getItem(k) === "1"; localStorage.removeItem(k); return ok; });
  const threads = sab && has(() => (navigator.hardwareConcurrency || 1) > 1);
  return { webgpu, opfs, sab, storage, threads };
}

// Given an app's required capabilities, return the ones this machine LACKS (empty = good to mount).
export function missingFor(requires, caps) {
  const c = caps || detect();
  return (requires || []).filter((r) => c[r] === false || c[r] === undefined);
}

// A full standalone HTML document (for an iframe srcdoc) — calm, dark, OS-tokened, no external deps, no
// scripts. Names exactly what's missing and what the device still supports, so the user is never stranded
// on a blank frame wondering why nothing happened.
export function fallbackDoc({ appName = "This app", missing = [], present = [] } = {}) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const miss = missing.map((m) => `<li>${esc(label(m))}</li>`).join("");
  const have = present.length ? `<p class="have">Your device does support: ${present.map((p) => esc(label(p))).join(", ")}.</p>` : "";
  const need = missing.length === 1 ? `needs ${esc(label(missing[0]))}` : `needs ${missing.length} capabilities this browser doesn’t provide`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/><title>${esc(appName)} needs more — Hologram OS</title>
<style>
  :root{ --fg:#eaf0fb; --soft:#c6d2e6; --muted:#8b97ad; --line:#1b2433; --accent:#7defc9; }
  *{ box-sizing:border-box; } html,body{ height:100%; margin:0; }
  body{ background:radial-gradient(120% 120% at 20% 0%, #1b2a4a 0%, #0d1117 58%, #05070c 100%) fixed; color:var(--fg);
    font:400 16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,Helvetica,Arial,sans-serif;
    display:grid; place-items:center; padding:24px; -webkit-font-smoothing:antialiased; }
  .card{ width:100%; max-width:460px; border:1px solid #2a3547; border-radius:16px; padding:30px clamp(20px,5vw,36px);
    background:rgba(12,17,27,.72); -webkit-backdrop-filter:blur(20px); backdrop-filter:blur(20px); box-shadow:0 30px 90px -34px rgba(0,0,0,.8); }
  .ico{ width:42px; height:42px; border-radius:11px; display:grid; place-items:center; margin:0 0 16px; color:var(--accent);
    background:color-mix(in srgb, var(--accent) 14%, transparent); }
  .kicker{ margin:0 0 9px; font-size:11.5px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; color:var(--accent); }
  h1{ margin:0 0 12px; font-size:clamp(20px,3.4vw,24px); font-weight:700; letter-spacing:-.01em; line-height:1.2; color:#fff; }
  p{ margin:0 0 10px; color:var(--soft); } .muted{ color:var(--muted); font-size:14px; }
  ul{ margin:6px 0 14px; padding-left:20px; color:var(--soft); } li{ margin:3px 0; }
  .have{ color:var(--muted); font-size:14px; border-top:1px solid var(--line); padding-top:13px; margin-top:14px; }
  @media (prefers-reduced-motion: reduce){ *{ transition:none!important; } }
</style></head>
<body>
  <main class="card" role="note" aria-labelledby="h" data-holo-requires-fallback="1">
    <div class="ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 4v5c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg></div>
    <div class="kicker">Not supported here</div>
    <h1 id="h">${esc(appName)} ${esc(need)}</h1>
    <p>This app couldn’t open because your browser doesn’t provide everything it needs${missing.length ? ":" : "."}</p>
    ${miss ? `<ul>${miss}</ul>` : ""}
    <p class="muted">Try a recent Chrome, Edge, or a desktop browser — and make sure you’re not in private mode if the app needs to save data.</p>
    ${have}
  </main>
</body></html>`;
}

// In-page helper for apps that mount into a DOM host (not an iframe): if a required capability is missing,
// render the labeled fallback into `host` and return false (caller skips its real mount); else returns true.
export function mountWithCapability(host, { requires = [], appName = "This app" } = {}) {
  const missing = missingFor(requires);
  if (!missing.length) return true;
  const present = requires.filter((r) => !missing.includes(r));
  try { if (host) { const f = host.ownerDocument.createElement("iframe"); f.setAttribute("title", appName + " — not supported"); f.style.cssText = "width:100%;height:100%;border:0;display:block"; f.srcdoc = fallbackDoc({ appName, missing, present }); host.innerHTML = ""; host.appendChild(f); } } catch {}
  return false;
}

try { if (typeof window !== "undefined") window.HoloRequires = { detect, missingFor, label, fallbackDoc, mountWithCapability }; } catch {}
