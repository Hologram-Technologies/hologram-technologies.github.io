// holo-workspace-bridge.mjs — THE ONE WIRE between the shell's EXISTING per-app state round-trip and the
// per-app source chains (Phase A, live). The shell already collects each participating app's opt-in state
// (collectAppState → `holo-session:save`/`state`) into its world node (`node.appState`), and restores it on
// mount (`holo-session:ready` → `holo-session:restore`). This bridge points that SAME signal at each app's
// own holo-strand: on every save tick it lazily appends the app's state to ITS chain; on a cold reopen it
// resumes the chain head. So every holospace tab/app becomes its own time-travelable workspace with ZERO
// app code — apps that already speak the session handshake get persistence + history + resume for free.
//
// Division of labour (honest): the SESSION snapshot keeps COARSE continuity for EVERY window (which app,
// where it sits, open/closed). This bridge adds RICH per-app history ONLY for apps that expose state — so
// an ephemeral, stateless app (a calculator) writes no chain and costs nothing (lazy by construction).
//
// Pure + injectable (host passed in) so it is node-witnessable against the real makeWorkspaceHost; the
// shell calls it with window.HoloWorkspaceHost. Importing this module also boots that host binding.
import "./holo-workspace-host.mjs";   // ensure window.HoloWorkspaceHost is wired wherever the bridge loads

// appKappaOf(node) → the per-app chain identity for a world node, or null if it isn't a persistable app.
// One app κ ⇒ one resumable workspace (the common case + the magic: reopen the app → exactly as you left
// it). Prefers the app's content κ (appDid), else its catalog id as a holo:// κ, else a content ref.
export function appKappaOf(node) {
  if (!node || node.kind !== "app") return null;
  return node.appDid || (node.appId ? "holo://" + node.appId : null) || node.contentRef || null;
}

// activeHost() → the capture host for the CURRENTLY ACTIVE workspace (so per-app history is isolated per
// workspace), or the global host if the workspace switcher isn't present yet. Fail-soft both ways.
export async function activeHost() {
  try {
    const W = (typeof window !== "undefined") ? window.HoloWorkspaces : null;
    if (W && typeof W.active === "function" && typeof W.host === "function") {
      const id = await W.active();
      if (id) return W.host(id);                                    // the active workspace's SCOPED per-app host
    }
  } catch (e) { /* fall through to global */ }
  return (typeof window !== "undefined") ? (window.HoloWorkspaceHost || null) : null;
}

// captureWorld(world, host) → for each app node carrying state, lazily append to ITS per-app chain.
// Lazy/cheap (the host dedups identical state → no version) and fail-soft. Returns how many chains advanced.
export async function captureWorld(world, host) {
  host = host || await activeHost();                               // default: the active workspace's scoped host
  if (!host || !Array.isArray(world)) return 0;
  let saved = 0;
  for (const node of world) {
    const k = appKappaOf(node); if (!k) continue;
    const state = node.appState; if (state == null) continue;     // only rich-state apps; coarse rides the session
    try { const r = await host.workspace(k).save(state); if (r) saved++; } catch (e) { /* fail-soft */ }
  }
  return saved;
}

// resumeFor(node, host) → the per-app chain head state for a freshly-mounted app, or null (cold/none).
// The shell posts this back to the app as a `holo-session:restore` when it has no session-queued state.
export async function resumeFor(node, host) {
  const k = appKappaOf(node); if (!k) return null;
  host = host || await activeHost();
  if (!host) return null;
  try { const m = await host.mount(k); return m ? (m.state ?? null) : null; } catch (e) { return null; }
}

if (typeof window !== "undefined") window.HoloWorkspaceBridge = { appKappaOf, captureWorld, resumeFor, activeHost };
