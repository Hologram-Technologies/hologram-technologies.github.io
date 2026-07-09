// BitNet greedy reference via the forge CPU executor (the witnessed Tier-A oracle: forge-CPU == llama.cpp
// for BitNet was established earlier). Prints the prompt token ids + the greedy continuation so the
// browser GPU run (run-native ?model=bitnet&ids=…&n=…) can be asserted token-for-token against it.
// If forge-ref.exe is present, also re-confirms CPU == llama.cpp in-session.
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { openGgufHolo, kstreamLoad } from "../gguf-forge-kstream.mjs";
import { synthesizeGraph } from "../gguf-forge-graph.mjs";
import { forward } from "../gguf-forge-exec.mjs";
import { makeTokenizer } from "../gguf-forge-tokenizer.mjs";

const N = +(process.argv[2] || 4);
const PROMPT = process.argv[3] || "The capital of France is";
const t0 = Date.now(), el = () => ((Date.now() - t0) / 1000).toFixed(1);

const { plan, store, headerBytes } = openGgufHolo(new Uint8Array(readFileSync("./.models/bitnet-xl-tq2_0.holo")));
const graph = synthesizeGraph(plan);
console.log(`[${el()}s] family=${graph.family} layers=${graph.stats.n_layer} arch=${plan.arch}`);
const tok = makeTokenizer(headerBytes);
const promptIds = tok.encode(PROMPT, { addSpecial: false });
console.log(`prompt "${PROMPT}" → ids ${promptIds.join(",")}`);

let seq = [...promptIds]; const gen = [];
for (let i = 0; i < N; i++) {
  const lg = forward(plan, graph, store, seq, { load: kstreamLoad });
  let am = 0; for (let j = 1; j < lg.length; j++) if (lg[j] > lg[am]) am = j;
  gen.push(am); seq.push(am);
  console.log(`[${el()}s] token ${i + 1}/${N} = ${am}`);
}
console.log(`CPU gen: ${gen.join(" ")}`);

const EXE = "C:/Users/pavel/Desktop/qvac-fabric-llm.cpp-master/qvac-fabric-llm.cpp-master/forge-ref.exe";
if (existsSync(EXE)) {
  const MINGW = "C:/Users/pavel/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin";
  const env = { ...process.env, PATH: MINGW + ";" + process.env.PATH };
  try {
    const out = execFileSync(EXE, ["./.models/bitnet-xl-tq2_0.gguf", "--gen", String(N), ...promptIds.map(String)], { env, encoding: "utf8", maxBuffer: 1 << 20, stdio: ["ignore", "pipe", "ignore"] });
    const ref = ((out.match(/gen:([\s\d]*)/) || [])[1] || "").trim().split(/\s+/).filter(Boolean).map(Number);
    console.log(`LLAMA gen: ${ref.join(" ")}`);
    console.log(gen.join(" ") === ref.join(" ") ? "CPU == llama.cpp ✓ (Tier-A re-confirmed in-session)" : "CPU != llama.cpp ✗");
  } catch (e) { console.log("(forge-ref.exe present but failed: " + e.message + ")"); }
} else console.log("(forge-ref.exe absent — CPU oracle only; forge-CPU == llama.cpp for BitNet anchored by prior witness)");

console.log(`\nWITNESS_IDS=${promptIds.join(",")}`);
console.log(`WITNESS_GEN=${gen.join(",")}`);
