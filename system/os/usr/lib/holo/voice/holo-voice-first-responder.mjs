// holo-voice-first-responder.mjs — H5: wire the SEED first-responder into the live voice loop, FAIL-SOFT.
//
// A cold user can't wait for the 485MB brain. The seed (q-seed.holo, ~7MB int8, context-aligned, holo-seed-runner.mjs)
// speaks an instant qwen-aligned opener ("Sure! …") the moment it loads; the full brain then continues mid-utterance
// (makeSeedHandoff, speak-while-streaming). This module is the ONE place the loop opts into that — and it is fail-soft
// at every step: a missing/broken seed silently degrades to brain-only, never breaking listen/respond.
//
//   loadFirstResponder({tokenizer, ort, openFiles?, spec?, createRunner?}) → runner | null   (null = no seed → brain-only)
//   adaptBrain(llm) → { ready, verify }                                                       (a createLLM → handoff's `full`)
//   makeVoiceResponder({seed, full, speak, onEvent}) → { mode, turn(history) }                (seed-handoff | brain-only)
//
// createRunner/openFiles are injectable so this is Node-witnessable without the holo:// runtime.

import { makeSeedHandoff } from "./holo-voice-seed-handoff.mjs";
import { seedSpec } from "./holo-q-faculty-models.mjs";

const SEED_RUNNER_URL = "holo://os/apps/q/forge/gpu/holo-seed-runner.mjs";
const SEED_FILES_URL = "holo://os/apps/q/forge/gpu/holo-files.mjs";

export async function loadFirstResponder({ tokenizer, ort = null, openFiles = null, spec = seedSpec, createRunner = null } = {}) {
  try {
    const mk = createRunner || (await import(/* @vite-ignore */ SEED_RUNNER_URL)).createSeedRunner;
    const of = openFiles || (await import(/* @vite-ignore */ SEED_FILES_URL)).openHoloFiles;
    const runner = await mk({ holoUrl: spec.url, openFiles: of, tokenizer, ort });
    if (!runner || typeof runner.respond !== "function") return null;
    return runner;
  } catch (e) {
    return null;   // FAIL-SOFT: no seed → caller uses brain-only
  }
}

// a raw createLLM (load/generate) → the { ready, verify } makeSeedHandoff expects. NOTE: verify here is
// NON-speculative (the full brain re-generates; it does not yet accept the seed's draft tokens) — the seed still
// gives instant first-audio, which is the product win. TRUE speculative verify (accept the seed prefix → continue) is
// the H2 upgrade; swap it in here without touching the loop.
export function adaptBrain(llm) {
  let readyP = null;
  return {
    ready: () => (readyP ||= Promise.resolve(typeof llm.load === "function" ? llm.load() : null)),
    verify: (history) => llm.generate(history),
  };
}

export function makeVoiceResponder({ seed, full, speak, onEvent = () => {} }) {
  const evt = (e, d) => { try { onEvent(e, d); } catch {} };
  const brainOnly = async (history) => { let s = ""; for await (const t of full.verify(history)) { s += t; speak(t); } return s.trim(); };

  if (seed && typeof seed.respond === "function") {
    const handoff = makeSeedHandoff({ seed, full, speak, onEvent });
    return {
      mode: "seed-handoff",
      turn: async (history) => {
        try { return await handoff.turn(history); }
        catch (e) { evt("seed-error", { msg: String((e && e.message) || e) }); return brainOnly(history); }   // FAIL-SOFT mid-turn
      },
    };
  }
  return { mode: "brain-only", turn: brainOnly };
}

export default { loadFirstResponder, adaptBrain, makeVoiceResponder };
