// SPM tokenizer witness: JS SPM encode == llama_tokenize (forge-ref.exe --tokhex)
// on a range of strings, plus decode(encode(s)) round-trip. Ground truth is the
// built qvac llama.cpp. Model = Gemma-3 (tokenizer.ggml.model="llama" = SPM, 262k
// vocab). The JS side reads only the GGUF metadata PREFIX (the vocab + scores live
// at the file head) so we never load the 3.3GB of weights.

import assert from "node:assert";
import { openSync, readSync, closeSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { makeTokenizer } from "./gguf-forge-tokenizer.mjs";

const MODEL = "C:/Users/pavel/.lmstudio/models/lmstudio-community/gemma-3-4b-it-GGUF/gemma-3-4b-it-Q4_K_M.gguf";
const EXE = "C:/Users/pavel/Desktop/qvac-fabric-llm.cpp-master/qvac-fabric-llm.cpp-master/forge-ref.exe";
const MINGW = "C:/Users/pavel/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin";
const env = { ...process.env, PATH: MINGW + ";" + process.env.PATH };

if (!existsSync(MODEL)) { console.log("SKIP: Gemma SPM model not present at " + MODEL); process.exit(0); }

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

function refTokenize(text) {
  const hex = Buffer.from(text, "utf8").toString("hex");
  const out = execFileSync(EXE, [MODEL, "--tokhex", hex], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 24 });
  const m = out.match(/ids:([\s\d]*)/);
  return m[1].trim().split(/\s+/).filter(Boolean).map(Number);
}

// read just the metadata prefix (vocab arrays sit at the file head, before tensors)
const N = 48 * 1024 * 1024;
const b = Buffer.allocUnsafe(N), fd = openSync(MODEL, "r"); const got = readSync(fd, b, 0, N, 0); closeSync(fd);
const tok = makeTokenizer(new Uint8Array(b.subarray(0, got)));
console.log(`tokenizer: model=${tok.model} pre=${tok.pre} nVocab=${tok.nVocab}`);
assert.strictEqual(tok.model, "llama", "expected SPM (model=llama)");

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
    const gotIds = tok.encode(s, { addSpecial: false });
    assert.deepStrictEqual(gotIds, ref, `\n      got ${JSON.stringify(gotIds)}\n      ref ${JSON.stringify(ref)}`);
  });
}

t("decode(encode(s)) recovers text (modulo SPM space normalization)", () => {
  for (const s of STRINGS) {
    const back = tok.decode(tok.encode(s, { addSpecial: false }));
    // SPM collapses a leading space into the prefix; compare on the escaped form.
    assert.strictEqual(back, s, `round-trip: ${JSON.stringify(s)} -> ${JSON.stringify(back)}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
