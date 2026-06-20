// holo-voice-tier.witness.mjs — proves the tiered voice (instant + HD) composition, in Node, with MOCK
// engines (no models, no network). Asserts the contract Q's voice relies on:
//   1. first word never waits — synth uses `primary` immediately, before HD has loaded.
//   2. transparent upgrade — once the background HD load resolves, synth switches to HD.
//   3. resilient — if HD fails to load, it stays on primary (hdFailed); if HD errors mid-use, it falls back.
//   4. primary-only — with no HD, it's just the primary engine.
//   5. voices() is the union.
//
//   node holo-voice-tier.witness.mjs   · exit 0 = all green · 1 = a failure.

import { createTieredTTS } from "../os/usr/lib/holo/voice/holo-voice-tts.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mockEngine(label, opts = {}) {
  let ready = false;
  return {
    id: label, info: () => ({ ready, label }), voices: () => opts.voices || [label + "_v"],
    async load() { await sleep(opts.loadDelay || 0); if (opts.loadFails) throw new Error("load fail"); ready = true; return { ready: true, label }; },
    async synth() { if (opts.synthFails) throw new Error("synth fail"); return { audio: new Float32Array(8), sampling_rate: 24000, _by: label }; },
  };
}

async function main() {
  let pass = 0, fail = 0; const log = (ok, m) => { console.log((ok ? "  ✓ " : "  ✗ ") + m); ok ? pass++ : fail++; };
  console.log("holo-voice-tier witness — instant + HD composition (mock engines)");

  // 2 + 1: instant primary, then background upgrade to HD
  {
    const t = createTieredTTS({ primary: mockEngine("kokoro"), hd: mockEngine("hd", { loadDelay: 60 }) });
    await t.load();
    const a = await t.synth("hi");
    log(a._by === "kokoro" && t.tier === "primary", "before HD ready: speaks on primary (" + a._by + ")");
    await sleep(140);
    const b = await t.synth("hi");
    log(b._by === "hd" && t.tier === "hd", "after HD loads: transparently upgrades to HD (" + b._by + ")");
    const v = t.voices();
    log(v.includes("kokoro_v") && v.includes("hd_v"), "voices() is the union: [" + v.join(", ") + "]");
  }
  // 3: HD fails to load → stays on primary
  {
    const t = createTieredTTS({ primary: mockEngine("kokoro"), hd: mockEngine("hd", { loadDelay: 20, loadFails: true }) });
    await t.load(); await sleep(80);
    const a = await t.synth("hi");
    log(a._by === "kokoro" && t.info().hdFailed === true && t.tier === "primary", "HD load failure → stays on primary, hdFailed flagged");
  }
  // 4: HD ready but synth throws → falls back to primary, keeps talking
  {
    const t = createTieredTTS({ primary: mockEngine("kokoro"), hd: mockEngine("hd", { loadDelay: 10, synthFails: true }) });
    await t.load(); await sleep(60);
    const a = await t.synth("hi");
    log(a._by === "kokoro" && t.tier === "primary", "HD synth error → falls back to primary mid-use");
  }
  // 5: primary-only (no HD) behaves like the primary engine
  {
    const t = createTieredTTS({ primary: mockEngine("kokoro") });
    await t.load(); const a = await t.synth("hi");
    log(a._by === "kokoro" && t.tier === "primary", "no HD configured → pure primary");
  }

  console.log((fail ? "FAIL" : "PASS") + " — " + pass + "/" + (pass + fail) + " checks");
  process.exit(fail ? 1 : 0);
}
main();
