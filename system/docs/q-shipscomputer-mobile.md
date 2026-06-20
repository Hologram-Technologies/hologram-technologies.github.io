# Q — the ship's computer for everyone (mobile, voice-first)

North-star for the single mobile surface that delivers the entire Hologram OS and Q's
full capability through one voice-first experience. The felt result: the user talks to
an omnipresent, intelligent computer and it just happens. The orb is the computer; the
OS disappears behind the conversation.

## First principles (non-negotiable)
1. Voice-first, intent-not-menus — Q parses intent (context, role, history, ambiguity).
2. Compose on the fly — no pre-built dashboards; the right thing is surfaced per intent, then dissolved.
3. Abstract complexity, deliver simplicity — natural-language facade; zero learning curve.
4. On-device, private, offline, serverless — one link/κ boot; nothing leaves the device unless asked.
5. κ-native, self-verifying — identity is content (L1); every byte re-derived (L5); biometric authority.
6. Alive and proactive, never intrusive — always sensing; surfaces insight when earned; defers judgment.

## Bundle, don't rebuild — the seams
| Ship's-computer attribute | Hologram seam |
|---|---|
| Wake + always-listening | KWS "Q" wake-spot + mic meter (holo-voice.js); silero VAD (holo-voice-vad.mjs) |
| The ear (ASR) | on-device Whisper-tiny/base (holo-voice-asr.mjs `createASR`) |
| The voice (TTS) | Kokoro-82M (holo-voice-tts.mjs `createTTS`/`createTieredTTS`) |
| The face | living WebGPU/WebGL orb (holo-voice-orb*, the hero in usr/share/frame/home-screen.html) |
| The cortex (intent→action) | Q mux / Mixture-of-Specialists (holo-q-mux: intent→resolve→mux→floor) |
| Compose-any-interface | κ-native launch + holospace projection (holospace.html resolve→admit→mount) |
| The proactive mind | "+" ingest→hypergraph→insight (holo-plus*, holo-insight, holo-brief) |
| The always-on nervous system | autonomy spine sense→reason→speak (holo-telemetry-tap, coherence, observer) |
| Notifications / curation | three-category Inbox (action/update/letter), courier voice |
| Knowledge / brains | .holo WebGPU brain, GGUF→κ / ONNX→κ forge, mux faculties (Qwen 0.5B/1.5B vendored) |
| The travelling body | single-link CID/κ boot, IPFS-pinned, offline (holo-cid-boot, holo-heal-boot); biometric login |

## The experience loop
Boot (one κ/CID, offline PWA, biometric) → Idle (calm orb presence + ambient monitoring) →
Wake ("Q" KWS or tap → Q fills the screen) → Listen (speech surfaces as on-screen intent; orb
breathes with your voice) → Orchestrate (intent → mux faculties; multi-step from one utterance) →
Compose (spoken summary AND, when useful, a control/app/holospace rendered on the fly) →
Iterate (natural follow-ups, full context) → Proactive (quiet Inbox letters, never a nag) →
Exit (swipe down / "Q, dismiss"). One gesture in, one out.

## Architecture — three layers + ambient
- **L1 Presence/Voice facade** (the only thing the user meets): orb, mic, wake word, ASR in, TTS out,
  the rendered-on-the-fly surface. Lives in the mobile home shell (home-screen.html hero + holo-q-mobile.mjs).
- **L2 Q Orchestrator** (intent plane): the mux. Parse intent → choose faculties → plan → ground in
  context → dispatch → stream. Owns ambiguity, role/authority, conversation state.
- **L3 κ-substrate** (execution/compose plane): resolve κ → def+lock → admit → mount/act; every faculty
  reached by reference, L5-verified.
- **Ambient**: the autonomy spine feeds L2 continuously so Q is omnipresent and proactive, not request-only.

## Mobile-native requirements
WebGPU orb at full device DPR (auto-scaling); on-device ASR/TTS (no cloud, instant first word);
mic → live orb level + bands; wake word low-power; barge-in (tap/voice interrupts TTS); PWA
installable + single-link CID boot + full offline + biometric + safe-area/φ layout; latency is the
product (minimise TTFW and intent→first-pixel); graceful degradation everywhere (no mic / no WebGPU /
no brain → still beautiful, still useful).

## Build path (each phase shippable + witnessed)
- **P0** Unify the surface: home + Q hero is the one entry; wake word "Q" opens it hands-free.
- **P1** Close the voice loop on-device: Whisper ear + Kokoro voice + silero VAD wired into the hero
  (replacing the browser SpeechRecognition/speechSynthesis fallback). → `holo-q-mobile.mjs`.
- **P2** Bind the hero to the REAL Q mux: intent → faculties (not the generic brain bridge); stream; context.
- **P3** Compose-on-the-fly: intent mounts a κ app / holospace / control INTO the hero surface, then dissolves it.
- **P4** Ambient + proactive: autonomy spine + ingest feed the Inbox; Q speaks unbidden when earned.
- **P5** Authority + safety: biometric-gated restricted actions; L5 on every mounted byte; confirm
  irreversible/outward actions; defer judgment to the human.

## Done = the feel
A first-time user, no instructions, says "Q, …" and it works. Common asks resolve by voice end-to-end
with the right thing composed on screen. It feels like conversing with one omniscient, helpful entity —
magical, frictionless, empowering. Works offline, from one link, on a mid-range phone, at 60fps presence.

## Guardrails
Never fabricate an answer or capability; degrade honestly. Never break boot. Keep the sealed anchor
untouched. Reseal frames/substrate after edits (seal-frame + gen-substrate-index). Hold the simplicity
bar: if a feature adds a control the user must learn, it's wrong — find the voice-first form instead.

## Status
- Surface unified; Q hero (full-screen, voice-first, WebGPU orb, mic-reactive) live in home-screen.html.
- Browser-API voice loop is the current floor; P1 (`holo-q-mobile.mjs`) swaps in Q's own on-device ear/voice.
- All voice weights vendored: whisper-tiny/base, Kokoro-82M, silero-vad, Qwen2.5 0.5B/Coder-1.5B.
