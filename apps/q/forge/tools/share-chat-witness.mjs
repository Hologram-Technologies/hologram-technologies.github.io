// Share-a-chat SUBSTRATE witness: a conversation is a content κ over {modelKappa, system, messages};
// re-deriving it (re-prefill the transcript by κ) resumes to the EXACT next token — "exactly where the
// sender was", deterministic, no replay of generation. Proves the κ-identity + exact-resume claims; the
// UI/Share-carriage transport (URL #fragment / IPFS, witnessed 26/26) carries the κ, it doesn't change it.
import { readFileSync } from "node:fs";
import { openGgufHolo, kstreamLoad } from "../gguf-forge-kstream.mjs";
import { synthesizeGraph } from "../gguf-forge-graph.mjs";
import { forward } from "../gguf-forge-exec.mjs";
import { makeTokenizer } from "../gguf-forge-tokenizer.mjs";
import { sha256hex, jcs, didHolo } from "../../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

const { plan, store, headerBytes, rootHolo } = openGgufHolo(new Uint8Array(readFileSync("./.models/qwen2.5-0.5b-instruct.holo")));
const graph = synthesizeGraph(plan), tok = makeTokenizer(headerBytes);
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };

// a chat is content: {modelKappa, system, messages}. Its κ is the hash of that — share THIS string.
const chatKappa = (chat) => didHolo("sha256", sha256hex(jcs(chat)));
// ChatML transcript → token ids ending at "<|im_start|>assistant\n" (the model's next token is the reply)
const toTokens = (chat) => {
  let s = `<|im_start|>system\n${chat.system}<|im_end|>\n`;
  for (const m of chat.messages) s += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`;
  s += `<|im_start|>assistant\n`;
  return tok.encode(s, { addSpecial: false, parseSpecial: true });
};
const nextToken = (chat) => { const ids = toTokens(chat); const lg = forward(plan, graph, store, ids, { load: kstreamLoad }); let am = 0; for (let j = 1; j < lg.length; j++) if (lg[j] > lg[am]) am = j; return { am, n: ids.length }; };

// ── a multi-turn conversation, mid-thought ──
const chat = { modelKappa: String(rootHolo), system: "You are a concise, helpful assistant.",
  messages: [{ role: "user", content: "What is the capital of France? One word." }, { role: "assistant", content: "Paris." }, { role: "user", content: "And the capital of Italy? One word." }] };

// SENDER: where they are = the next token the model would produce now
const live = nextToken(chat); const kappa = chatKappa(chat);
console.log(`chat κ = ${kappa.slice(0, 32)}…  transcript ${live.n} tokens, next-token ${live.am} (${JSON.stringify(tok.decode([live.am]))})`);

// SHARE: serialize the chat to a link payload (this is what the URL #fragment / IPFS carries)
const payload = JSON.stringify(chat);
ok(payload.length < 4096, `chat serializes to a small shareable payload (${payload.length} B) — fits a URL/QR, not the KV bytes`);

// RECEIVER: restore from the payload (fresh — nothing carried but the content) and re-derive
const restored = JSON.parse(payload);
ok(chatKappa(restored) === kappa, "restored chat re-derives the SAME κ (content-addressed identity)");
const resume = nextToken(restored);
ok(resume.am === live.am && resume.n === live.n, `re-prefill resumes to the EXACT next token ${resume.am} == ${live.am} — "exactly where they were", no replay`);

// a DIFFERENT conversation is a DIFFERENT κ (and a different continuation) — the κ captures the chat
const chat2 = { ...chat, messages: [...chat.messages.slice(0, 2), { role: "user", content: "And the capital of Spain? One word." }] };
const k2 = chatKappa(chat2), n2 = nextToken(chat2);
ok(k2 !== kappa, "a different conversation → a different κ (the hash binds the exact messages)");
console.log(`  (control: Spain-chat κ ${k2.slice(0, 16)}… next-token ${n2.am} ${JSON.stringify(tok.decode([n2.am]))})`);

console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: a chat IS a content κ; sharing it resumes to the exact token"}`);
process.exit(fail ? 1 : 0);
