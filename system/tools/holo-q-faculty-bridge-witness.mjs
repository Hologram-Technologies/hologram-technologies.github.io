// holo-q-faculty-bridge-witness.mjs — re-derivable proof that the P3 consumer cut-over is SAFE and REAL:
//   (a) the holo-q-faculty-models bridge produces specs BYTE-IDENTICAL to the values holo-voice-holo-brain.mjs
//       and holo-voice.js used to hardcode (so nothing breaks when unbound), and
//   (b) a settings-picker override (bindSpecialist) actually re-routes a faculty (so the one UI is real).
// Pure Node — no network, no GPU, no browser. Run: node holo-q-faculty-bridge-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const bridge = await imp("../os/usr/lib/holo/voice/holo-q-faculty-models.mjs");
const brain = await imp("../os/usr/lib/holo/voice/holo-voice-holo-brain.mjs");
const mux = await imp("../os/usr/lib/holo/q/holo-q-mux.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const REL = "https://github.com/Hologram-Technologies/hologram-apps/releases/download/models-v1/";
const FORGE = "/apps/q/forge/.models/";

console.log("\nholo-q faculty bridge — P3 cut-over witness\n");

// (a) the OLD hardcoded values holo-voice-holo-brain.mjs / holo-voice.js shipped — must be reproduced EXACTLY.
console.log("bridge specs == the old hardcoded values (no breakage when unbound):");
mux.unbindAll();
const respond = bridge.instantSpec("respond");
ok(respond.url === FORGE + "qwen2.5-0.5b-instruct.holo", "respond url unchanged");
ok(respond.release === REL + "qwen2.5-0.5b-instruct.holo", "respond release unchanged");
ok(respond.kappa === "41a930c07450623751f84af6a55bbecd54fe608ad6e94adf17f83c712aaf1b91", "respond κ unchanged");
const up = bridge.upgradeSpec("respond");
ok(up.url === FORGE + "qwen2.5-1.5b-instruct.holo" && up.kappa === "ea7323369bfeebb344c9d0b6252de485e2b9833784405678f910a16cd7746202", "respond upgrade (1.5B) url+κ unchanged");

const listen = bridge.resolveFacultyModel("listen");
ok(listen.source === "pinned" && listen.instant.url === FORGE + "moonshine-tiny-int8.holo", "listen holoUrl unchanged (== CFG.knativeEar)");
ok(listen.instant.kappa === "bbd89df22c86fc54455779be070395cc8dab0c3438cbe85974c9f02d2a291780", "listen κ unchanged");
ok(listen.instant.release === REL + "moonshine-tiny-int8.holo", "listen release unchanged");
ok(listen.upgrade && listen.upgrade.url === FORGE + "moonshine-tiny-f16.holo" && listen.upgrade.kappa === "ff7e1c8b3c9e360ab062ce96a297e6f2467608c634f2e4b171078180056a72d8", "listen upgrade (f16) url+κ unchanged");

const code = bridge.instantSpec("code");
ok(code.url === FORGE + "qwen2.5-coder-3b-instruct.holo" && code.kappa === "33ca24ae50bf5649b4c431817ebf15924b8aa929ab87868c33abeeeb8f695a17", "code (Coder-3B) url+κ unchanged");

// holo-voice-holo-brain's MODELS catalog now resolves the SAME specs (κ deduped from the mux).
console.log("\nholo-voice-holo-brain consumes the bridge (κ deduped, faculty-aware):");
ok(brain.modelKeyForFaculty("respond") === "qwen2.5-0.5b", "modelKeyForFaculty(respond) → the pinned instant tier");
ok(brain.modelKeyForFaculty("code") === "qwen-coder-3b", "modelKeyForFaculty(code) → Coder-3B");

// (b) the settings picker (bindSpecialist) re-routes a faculty — the override actually flows.
console.log("\nan override re-routes the faculty (the one picker is real):");
mux.bindSpecialist("respond", { id: "qwen2.5-1.5b", generate: () => {} });   // user picks the bigger brain
ok(brain.modelKeyForFaculty("respond") === "qwen2.5-1.5b", "after override → brain loads the chosen model key");
ok(bridge.resolveFacultyModel("respond").source === "override", "bridge reports source=override");
mux.bindSpecialist("listen", { id: "some-other-asr", transcribe: () => {} });
ok(bridge.resolveFacultyModel("listen").source === "override", "listen override flows (holo-voice would honor it)");
mux.bindSpecialist("respond", { id: "not-a-known-holo-model", generate: () => {} });
ok(brain.modelKeyForFaculty("respond") === null, "override naming a non-.holo model → null (caller keeps its own path, no crash)");
mux.unbindAll();
ok(brain.modelKeyForFaculty("respond") === "qwen2.5-0.5b", "unbind restores the pinned default");

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
