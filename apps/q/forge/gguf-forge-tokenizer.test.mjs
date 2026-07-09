// Tokenizer witness: JS BPE encode == llama_tokenize (forge-ref.exe --tok) on a
// range of strings, plus decode(encode(s)) round-trip. Ground truth is the built
// qvac llama.cpp, so this is a real conformance check, not a self-test.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { makeTokenizer } from "./gguf-forge-tokenizer.mjs";

const MODEL = ".models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
const EXE = "C:/Users/pavel/Desktop/qvac-fabric-llm.cpp-master/qvac-fabric-llm.cpp-master/forge-ref.exe";
const MINGW = "C:/Users/pavel/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin";
const env = { ...process.env, PATH: MINGW + ";" + process.env.PATH };

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

function refTokenize(text) {
  // pass UTF-8 as hex so non-ASCII survives Windows argv encoding
  const hex = Buffer.from(text, "utf8").toString("hex");
  const out = execFileSync(EXE, [MODEL, "--tokhex", hex], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const m = out.match(/ids:([\s\d]*)/);
  return m[1].trim().split(/\s+/).filter(Boolean).map(Number);
}

const tok = makeTokenizer(new Uint8Array(readFileSync(MODEL)));
console.log(`tokenizer: model=${tok.model} pre=${tok.pre} nVocab=${tok.nVocab}`);

const STRINGS = [
  "Hello, world!",
  "The quick brown fox jumps over the lazy dog.",
  "import numpy as np\ndef f(x): return x**2",
  "Numbers: 12345 and 3.14159",
  "  leading and trailing spaces  ",
  "tabs\tand\nnewlines\n\n",
  "Contractions: I'm, you're, it's, we'll, don't",
  "Unicode: café, naïve, 世界, emoji 🚀",
  "MixedCASE_with-punct!@#$%^&*()",
  "a",
];

for (const s of STRINGS) {
  t(`encode matches llama.cpp: ${JSON.stringify(s.slice(0, 28))}`, () => {
    const ref = refTokenize(s);
    const got = tok.encode(s, { addSpecial: false });
    assert.deepStrictEqual(got, ref, `\n      got ${JSON.stringify(got)}\n      ref ${JSON.stringify(ref)}`);
  });
}

t("decode(encode(s)) round-trips", () => {
  for (const s of STRINGS) {
    const back = tok.decode(tok.encode(s, { addSpecial: false }));
    assert.strictEqual(back, s, `round-trip: ${JSON.stringify(s)} -> ${JSON.stringify(back)}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
