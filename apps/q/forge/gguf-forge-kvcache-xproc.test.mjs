// Cross-process prefix-KV witness (substrate-convergence S4). Drives kv-xproc.mjs as
// two SEPARATE node processes through an on-disk content-addressed store, proving KV
// state is portable across the process boundary, content-addressed (filename = blob
// hash = L5), and tamper-refused on restore.
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { rmSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const MODEL = ".models/qwen2.5-0.5b-instruct-q4_k_m.gguf";
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

if (!existsSync(MODEL)) { console.log("  --  skipped (model not present)"); process.exit(0); }
const DIR = ".kvxproc-test";
const run = (mode) => execFileSync("node", ["kv-xproc.mjs", mode, DIR], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

rmSync(DIR, { recursive: true, force: true });

t("process A persists KV to a content-addressed on-disk store", () => {
  const out = run("produce");
  assert.match(out, /PRODUCE ok/, out);
  const files = readdirSync(DIR);
  assert.ok(files.includes("index.json"), "index written");
  const blob = files.find((x) => x.endsWith(".kvb"));
  assert.ok(blob, "blob written");
  // filesystem-level L5: the blob's NAME is the sha256 of its bytes
  const bytes = readFileSync(join(DIR, blob));
  const h = createHash("sha256").update(bytes).digest("hex");
  assert.strictEqual(blob, h + ".kvb", "blob is content-addressed (name == hash)");
});

t("process B (fresh) restores from disk, decodes suffix only, matches golden + llama.cpp", () => {
  const out = run("consume");
  assert.match(out, /CONSUME ok/, out);
  assert.match(out, /decoded only 3 suffix tok/, "prefill of the prefix was skipped");
  assert.match(out, /== golden 576/, "cross-process next token == golden (== llama.cpp)");
});

t("tampered on-disk blob is refused on restore (L5 across the boundary)", () => {
  const blob = readdirSync(DIR).find((x) => x.endsWith(".kvb"));
  const b = readFileSync(join(DIR, blob)); b[100] ^= 0xff; writeFileSync(join(DIR, blob), b);
  assert.throws(() => run("consume"), /L5 REFUSE|Command failed/, "corrupted blob must refuse");
});

rmSync(DIR, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
