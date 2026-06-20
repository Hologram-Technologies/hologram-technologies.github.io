// holo-q-trinity-ui.js — the shell installer for Holo Trinity (ADR-0087). The shell imports this ONCE
// (the twin of holo-mind-ui.js / holo-prov-ui.js); on load it installs the ONE OS-wide trinity as
// window.HoloTrinity and starts the cheap ambient self-improvement ticker. Every native app then
// inherits the create·exist·perceive loop by conforming: `window.HoloTrinity.mount({ target })` once
// and `.create(intent)` per act — exist + perceive are automatic, the loop invisible.
//
// Serverless + low-latency by construction (it composes the dependency-free Holo Q modules); the
// ambient ticker is near-free when nothing changed (the scene-κ skips an unchanged perceive pass) and
// its every heal passes the conscience (ADR-0033) when present. Side-effect import — no exports needed.

import { installTrinity } from "./holo-q-trinity.js";
import { installQ } from "./holo-q.js";
import "./holo-q-boost.js";   // exposes window.HoloBoostInstall (inert until a user installs an API key)

const g = (typeof window !== "undefined") ? window : globalThis;

// install the singleton (idempotent — installTrinity no-ops if window.HoloTrinity already exists).
const trinity = installTrinity();

// install Q — THE ONE unified surface over the trinity (ADR-0091). window.Q is the single door for
// humans, apps, and (governed, fail-closed) external agents; it COMPOSES, never replaces, the
// trinity/mind/conscience. Every native app inherits this one Q.
const Q = installQ({ trinity });
g.Q = Q;

// start the continuous, invisible self-improvement loop once the page is interactive. Gentle cadence;
// the scene-κ short-circuit makes an unchanged tick cost ~nothing, so this stays cheap OS-wide.
// ONE AMBIENT LOOP (S1): if window.HoloAmbient owns the heartbeat (the spine registers drift-heal as a
// faculty there), trinity does NOT arm its own timer — no second loop. It still self-times when the ambient
// layer is absent, so trinity stays standalone-safe. A short retry covers the ambient module loading late.
function startAmbient() {
  try {
    if (typeof window !== "undefined" && window.HoloAmbient) return;   // the one loop already drives drift-heal
    let waited = 0;
    const arm = () => {
      if (typeof window !== "undefined" && window.HoloAmbient) return;  // ambient came up — stand down
      if (waited >= 4000) { try { trinity.startImproving(2000); } catch (e) {} return; }   // no ambient after ~4s — self-time
      waited += 500; setTimeout(arm, 500);
    };
    arm();
  } catch (e) { try { trinity.startImproving(2000); } catch (x) {} }
}
if (typeof document !== "undefined" && document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startAmbient, { once: true });
} else {
  startAmbient();
}

// a tiny convenience the shell/apps can call to join the trinity in one line.
g.HoloTrinity = trinity;
g.holoCreate = (spec) => trinity.mount({ id: (spec && spec.app) || "shell", target: spec && spec.target }).create(spec);
