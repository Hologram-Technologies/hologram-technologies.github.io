// discord-activity-adapter.mjs — the DISCORD host adapter for Holo Messenger.
//
// "One runtime, many hosts." The messenger runtime is the SAME modules the native/CEF and web hosts boot
// (holo-messenger-app.mjs et al). This adapter is the thin Discord-Activity host: it establishes the sandbox
// context, neutralizes host-incompatible dependencies, then calls the canonical boot() seam. No fork.
//
// M1 SCOPE — FIRST PAINT. Prove the runtime paints inside a genuine Discord Activity iframe, zero backend we
// operate. Explicitly deferred: network bridges (M3), Discord OAuth identity (M2), multiplayer/participants
// (M4), warm-boot 0-net + media rail. This adapter must NOT depend on any of them.
//
// SANDBOX FACTS (verified 2026-07, Discord Activities):
//   • Strict CSP: inline <script>, eval(), and injected <script> are BLOCKED. Native ESM import() is allowed
//     (same-origin / proxied modules), which is why every load here is a dynamic import — never eval/inject.
//   • Service Workers: NOT supported. We never register one; the runtime is fail-soft without it (OPFS/Cache
//     still work directly for later warm-boot milestones).
//   • WebGPU: present on desktop Discord (Electron/Chromium); may be ABSENT on Android System WebView. The
//     Q-orb fallback ladder (worker→direct-GPU→WebGL→2D) already handles this — we only feature-detect + record.
//   • WASM compile: the one unresolved GO/NO-GO. We probe it here so a real Activity boot doubles as the
//     kill-test; if blocked, the runtime degrades (Q → seed tier) rather than bricking first-paint.

// ── Capability probe — the researcher's {gpu, wasm} kill-test, folded into the real boot. Two facts that
// convert the remaining CONDITIONALs into a firm verdict, captured on the FIRST real-Activity open. ──
async function probeCaps() {
  const caps = { gpu: false, webgl2: false, wasm: null, host: "discord-activity" };
  try { caps.gpu = typeof navigator !== "undefined" && !!navigator.gpu; } catch {}
  try { const c = document.createElement("canvas"); caps.webgl2 = !!c.getContext("webgl2"); } catch {}
  try {
    // Smallest valid module: the 8-byte wasm header (magic + version). If Discord's CSP lacks
    // 'wasm-unsafe-eval', instantiate throws with a CSP error — that's the NO-GO signal for WASM inference.
    await WebAssembly.instantiate(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    caps.wasm = true;
  } catch (e) { caps.wasm = String((e && e.message) || e); }
  try { window.__holoCaps = caps; } catch {}
  const wasmTag = caps.wasm === true ? "GO" : "NO-GO (" + caps.wasm + ")";
  console.log("%cHOLO-CAPS", "background:#5865F2;color:#fff;padding:2px 6px;font-weight:bold",
    "host=discord | gpu=" + caps.gpu + " | webgl2=" + caps.webgl2 + " | wasm=" + wasmTag);
  return caps;
}

// ── ON-DEVICE CAPABILITY BEACON (M2 kill-test, visible WITHOUT devtools) ──────────────────────────────
// A phone in a real Discord Activity has no console. This tiny dismissible pill surfaces the decisive
// verdicts — wasm (the last GO/NO-GO), gpu/webgl2 (which Q-orb tier the device gets), and the live count
// of real-CSP violations. Built with createElement + textContent + programmatic element.style ONLY, which
// is NOT subject to CSP style-src (only markup/inline <style> is) — so the beacon itself never violates CSP.
const _csp = [];   // real CSP violations, surfaced not swallowed
function _onCSP(e) {
  try { _csp.push((e.effectiveDirective || e.violatedDirective || "?") + " ← " + (e.blockedURI || "inline")); renderBeacon(window.__holoCaps); } catch {}
}
try { if (typeof document !== "undefined") document.addEventListener("securitypolicyviolation", _onCSP); } catch {}
try { window.__holoCSP = _csp; } catch {}

function renderBeacon(caps) {
  if (typeof document === "undefined" || !document.body || (typeof window !== "undefined" && window.__holoNoBeacon)) return;
  caps = caps || {};
  let el = document.getElementById("holo-caps-beacon");
  if (!el) {
    el = document.createElement("div"); el.id = "holo-caps-beacon";
    const s = el.style;
    s.position = "fixed"; s.left = "8px"; s.bottom = "8px"; s.zIndex = "2147483600";
    s.font = "11px/1.4 ui-monospace,Menlo,Consolas,monospace"; s.padding = "6px 9px"; s.borderRadius = "8px";
    s.background = "rgba(8,12,20,.82)"; s.color = "#dbe4f2"; s.maxWidth = "78vw"; s.cursor = "pointer";
    s.userSelect = "none"; s.border = "1px solid rgba(125,239,201,.25)"; s.boxShadow = "0 4px 16px rgba(0,0,0,.4)";
    try { s.backdropFilter = "blur(6px)"; } catch {}
    el.title = "Holo capability beacon — tap to dismiss";
    el.addEventListener("click", () => { try { el.remove(); } catch {} });
    document.body.appendChild(el);
  }
  const wasmOk = caps.wasm === true;
  const t = (label, ok) => label + " " + (ok ? "✓" : "✗");
  // hf: silent when the default "/hf" answers; named when upgraded (/.proxy) or blocked (Q→seed).
  const hf = _hfVerdict === false ? " · hf ✗" : _hfVerdict === "/.proxy/hf" ? " · hf:/.proxy" : "";
  const q = _q.state ? " · " + _q.state + _q.detail : "";
  el.textContent = "Holo · " + t("wasm", wasmOk) + " · " + t("gpu", !!caps.gpu) + " · " + t("webgl2", !!caps.webgl2) +
    " · csp:" + _csp.length + hf + q + (wasmOk ? "" : " (Q→seed)");
  el.style.borderColor = _q.ok ? "rgba(52,211,166,.7)" : wasmOk ? "rgba(52,211,166,.45)" : "rgba(255,120,120,.55)";
}

// ── M3-D1: resolve the REAL /hf prefix. Discord has served external mappings both BARE (/hf) and under
// /.proxy/ across client versions (both verified answering 2026-07-06, Range forwarded as 206). Probe with a
// 1-byte Range GET (HEAD is not guaranteed through HF's redirect chain) and keep whichever answers, so Q's
// weight stream never depends on which proxy scheme this client runs. Fail-soft: neither answering leaves the
// default "/hf" (the brain ladder degrades to seed and the beacon names it).
const HF_PROBE_PATH = "/HOLOGRAMTECH/q-bitnet-2b/resolve/main/manifest.json";
let _hfVerdict = null;   // null=probing · "/hf" | "/.proxy/hf" = answering prefix · false = blocked
async function resolveHfPrefix() {
  for (const p of ["/hf", "/.proxy/hf"]) {
    try {
      const r = await fetch(p + HF_PROBE_PATH, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
      if (r.ok || r.status === 206) { _hfVerdict = p; try { window.HOLO_HF_PROXY = p; } catch (e) {} return p; }
    } catch (e) {}
  }
  _hfVerdict = false;
  return null;
}

// ── M3-D3: Q readout for the beacon — the phone-side proof the REAL brain is up, visible without devtools.
// Reads only fail-soft host seams the runtime exposes: window.HoloQ.info()/.stats() and window.__holoQLoad
// ({done,total,phase} fed by the brain's load(onProgress)). States: q:loading N% → q:ready · ttft · tok/s
// (stats appear after the first real generation), or q:seed (reason) when the ladder degraded.
let _q = { state: "", detail: "", ok: false };
function watchQ() {
  const t0 = Date.now();
  const tick = () => {
    let again = Date.now() - t0 < 360000;   // bounded: 6 min covers a cold 0.69GB stream on slow links
    try {
      const HQ = window.HoloQ;
      const info = HQ && HQ.info ? HQ.info() : null;
      const load = window.__holoQLoad;
      const stats = HQ && HQ.stats ? HQ.stats() : null;
      const caps = window.__holoCaps || {};
      if (info && info.ready) {
        _q.ok = info.device === "webgpu" && !!info.resident;
        _q.state = _q.ok ? "q:ready" : "q:ready·" + (info.device || "cpu");
        _q.detail = (stats && stats.ttft != null)
          ? " " + (stats.ttft >= 1000 ? (stats.ttft / 1000).toFixed(1) + "s" : Math.round(stats.ttft) + "ms") + " · " + Math.round(stats.tokps || 0) + " tok/s"
          : "";
        if (_q.detail) again = false;   // final form reached — stop polling
      } else if (load && load.total) {
        _q.state = "q:loading " + Math.min(99, Math.round((load.done / load.total) * 100)) + "%"; _q.detail = "";
      } else if (_hfVerdict === false) {
        _q.state = "q:seed"; _q.detail = " (hf-blocked)"; again = false;
      } else if (caps.wasm !== undefined && (caps.wasm !== true || !caps.gpu)) {
        _q.state = "q:seed"; _q.detail = !caps.gpu ? " (no-gpu)" : " (no-wasm)"; again = false;
      } else if (HQ && info) {
        // brain constructed, κ-stream in flight (this load path reports no byte progress — stay honest, not fake %)
        _q.state = "q:warming…"; _q.detail = "";
      }
      renderBeacon(window.__holoCaps);
    } catch (e) {}
    if (again) setTimeout(tick, 1000);
  };
  tick();
}

function inDiscordActivity() {
  try {
    return /(^|\.)discordsays\.com$/.test(location.hostname) ||
      new URLSearchParams(location.search).has("frame_id");   // Discord seeds ?frame_id on the Activity URL
  } catch { return false; }
}

// Load + await the Embedded App SDK IF vendored, and complete the ready() handshake so Discord shows our frame
// instead of the loading spinner. Tolerant of absence: the headless verify and any non-Discord open must still
// boot. NO OAuth here — ready() resolves before authorize(); participant/presence (M4) is unauthenticated too.
async function readySDK() {
  const clientId = new URLSearchParams(location.search).get("client_id") ||
    (typeof window !== "undefined" && window.HOLO_DISCORD_CLIENT_ID) || "";
  try {
    const mod = await import("./_vendor/discord/embedded-app-sdk.mjs");
    const DiscordSDK = mod.DiscordSDK || (mod.default && (mod.default.DiscordSDK || mod.default));
    if (typeof DiscordSDK !== "function") throw new Error("no DiscordSDK export (vendor the SDK)");
    const sdk = new DiscordSDK(clientId);
    // Race ready() against a timeout: in a real Activity the handshake resolves fast; in any non-Discord
    // context (headless verify, plain open) there is no parent to answer, so we must not hang the beacon/boot.
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("ready() timeout — no Discord parent")), 5000));
    await Promise.race([sdk.ready(), timeout]);
    try { window.__discordSDK = sdk; } catch {}
    console.log("[discord-adapter] SDK ready — handshake complete");
    return sdk;
  } catch (e) {
    console.warn("[discord-adapter] SDK unavailable — booting host-agnostic:", (e && e.message) || e);
    return null;
  }
}

export async function mountDiscord() {
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");

  // (1) Neutralize host-incompatible deps BEFORE the runtime module evaluates. These globals are read at the
  //     top of holo-messenger-app.mjs, so they MUST be set before its dynamic import below.
  //   • Bridges: localhost:8788-8793 are unreachable from an iframe AND not serverless. Empty map = no bridge
  //     fetches; bridged chats simply show empty. The connect/health/avatar paths already fail-soft on this.
  window.HoloBridges = {};
  //   • Service worker: Discord blocks SW; mark intent (we also simply never import the SW registrar here).
  window.__holoNoSW = true;
  //   • Q model weights: a direct huggingface.co fetch is connect-src-blocked in the Activity. Route the Q
  //     brain's weight stream through the same-origin "/hf" prefix (Discord URL Mapping /hf → huggingface.co).
  //     The Q loader (q/core/loader.js) reads this global to rebase its model origin; unset = direct (native).
  window.HOLO_HF_PROXY = "/hf";

  // (2) Kick the capability probe + the /hf prefix probe + the Discord handshake in parallel with nothing
  //     blocking on them. Render the on-device beacon the moment caps resolve — visible even if boot later
  //     hangs — and start the Q readout watcher (it narrates loading → ready → measured speed).
  const capsP = probeCaps().then((c) => { renderBeacon(c); return c; });
  const hfP = resolveHfPrefix().then((p) => { try { renderBeacon(window.__holoCaps); } catch (e) {} return p; });
  const sdkP = inDiscordActivity() ? readySDK() : Promise.resolve(null);
  try { watchQ(); } catch (e) {}

  // (3) Load the runtime shell in order (side-effect imports set window.HoloMessengerUI before boot needs it),
  //     then the canonical boot seam. Dynamic import() (not static) guarantees window.HoloBridges is already
  //     set when holo-messenger-app.mjs evaluates.
  await import("./_vendor/ui/chat-ui.bundle.js?v=3ef215ca8472");   // → window.HoloMessengerUI
  await import("./messenger-shadcn-ui.mjs");                       // streaming shadcn κ-UI
  const { boot } = await import("./holo-messenger-app.mjs?v=f94eb36f726b");

  // (4) Boot with DEVICE-STABLE identity: pass a resolved null so boot() uses its own device-stable path
  //     (no biometric gate, no Discord OAuth) — the same fail-soft branch app.html takes when the login
  //     module is absent.
  const bootP = boot(root, Promise.resolve(null)).then(() => {
    try { document.body.classList.add("holo-booted"); } catch {}   // fade the splash once the runtime paints
  });

  await Promise.allSettled([capsP, hfP, sdkP, bootP]);
  try { renderBeacon(window.__holoCaps); } catch {}   // final refresh (picks up any CSP violations raised during boot)
  return { ok: true, caps: (typeof window !== "undefined" && window.__holoCaps) || null, csp: _csp.slice() };
}

// Auto-mount when loaded as the Activity entry. A verify harness can set window.__holoDiscordManual = true
// before import to drive mountDiscord() itself.
if (typeof window !== "undefined" && !window.__holoDiscordManual) {
  mountDiscord().catch((e) => {
    try {
      const s = document.getElementById("holo-splash");
      if (s) s.innerHTML = "<pre style='color:#f88;padding:16px;white-space:pre-wrap;max-width:90vw'>discord boot error:\n" +
        ((e && e.stack) || e) + "</pre>";
    } catch {}
    console.error("[discord-adapter] fatal:", e);
  });
}
