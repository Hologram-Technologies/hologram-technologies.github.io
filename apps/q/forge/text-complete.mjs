// End-to-end text capstone: real prompt -> tokenize -> forge to κ-objects ->
// execute -> greedy next token -> decode. Compares the predicted token to upstream
// llama.cpp on the identical ids. The full loop, on a real model, witnessed.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { makeTokenizer } from "./gguf-forge-tokenizer.mjs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { sha256hex } from "../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const MODEL = ".models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
const EXE = "C:/Users/pavel/Desktop/qvac-fabric-llm.cpp-master/qvac-fabric-llm.cpp-master/forge-ref.exe";
const MINGW = "C:/Users/pavel/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin";
const env = { ...process.env, PATH: MINGW + ";" + process.env.PATH };

const prompt = process.argv[2] || "The capital of France is";
const buf = new Uint8Array(readFileSync(MODEL));

const tok = makeTokenizer(buf);
const ids = tok.encode(prompt, { addSpecial: false });
console.log(`prompt : ${JSON.stringify(prompt)}`);
console.log(`tokens : [${ids.join(", ")}]  -> ${JSON.stringify(ids.map((i) => tok.tokens[i]).join("|"))}`);

const f = forgeGguf(buf);
const graph = synthesizeGraph(f.plan);
const store = { get: (h) => f.blocks.get(h) };
const verified = new Set();
const load = (st, k) => { const h = String(k).split(":").pop(); const b = st.get(h); if (!verified.has(h)) { if (sha256hex(b) !== h) throw new Error("L5"); verified.add(h); } return b; };

const logits = forward(f.plan, graph, store, ids, { load });
let am = 0; for (let i = 1; i < logits.length; i++) if (logits[i] > logits[am]) am = i;

// upstream reference argmax on identical ids
const out = execFileSync(EXE, [MODEL, ".models/_tmp.bin", ...ids.map(String)], { env, encoding: "utf8" });
const refAm = Number(out.match(/argmax=(\d+)/)[1]);

console.log(`\nforge  next token: ${am} ${JSON.stringify(tok.decode([am]))}`);
console.log(`llama  next token: ${refAm} ${JSON.stringify(tok.decode([refAm]))}`);
console.log(`\ncontinuation (forge): ${JSON.stringify(prompt + tok.decode([am]))}`);
console.log(`${am === refAm ? "MATCH" : "MISMATCH"} — greedy next-token parity with upstream llama.cpp`);
process.exit(am === refAm ? 0 : 1);
