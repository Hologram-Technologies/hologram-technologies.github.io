// GGUF Forge — tokenizers. Dispatches on tokenizer.ggml.model:
//   "gpt2"  -> BPE (GPT2/Qwen2 byte-level): regex pretokenize -> GPT2 byte->unicode
//              map -> rank-ordered pair merges -> vocab ids.
//   "llama" -> SPM (SentencePiece, byte-level BPE w/ byte fallback): escape spaces to
//              ▁ (U+2581) -> per-UTF8-char symbols -> score-priority bigram merges ->
//              resegment with <0xXX> byte fallback. Port of llm_tokenizer_spm_session
//              (src/llama-vocab.cpp:114-238); byte_to_token :3599, escape :3038.
//
// BPE pretokenizer regex from src/llama-vocab.cpp (LLAMA_VOCAB_PRE_TYPE_QWEN2, :375).
// BPE merge order = lowest merge-rank first, leftmost on ties (matches
// llm_tokenizer_bpe_session::tokenize, :562). Byte map = the standard GPT2
// bytes_to_unicode. Both paths verified against the built llama_tokenize (see test).

const QWEN2_RE = /(?:'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD])|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

// ── GGUF KV reader (captures the tokenizer arrays parseGgufHeader skips) ──
function readTokenizerMeta(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 0;
  const u32 = () => { const v = dv.getUint32(p, true); p += 4; return v; };
  const u64 = () => { const lo = dv.getUint32(p, true), hi = dv.getUint32(p + 4, true); p += 8; return hi * 4294967296 + lo; };
  const str = () => { const n = u64(); const s = new TextDecoder().decode(buf.subarray(p, p + n)); p += n; return s; };
  const td = new TextDecoder();
  if (u32() !== 0x46554747) throw new Error("not GGUF");
  const version = u32(); if (version !== 3 && version !== 2) throw new Error("GGUF v" + version);
  u64(); // tensor_count
  const nkv = u64();
  const WANT = new Set(["tokenizer.ggml.tokens", "tokenizer.ggml.merges", "tokenizer.ggml.token_type",
    "tokenizer.ggml.scores", "tokenizer.ggml.model", "tokenizer.ggml.pre",
    "tokenizer.ggml.bos_token_id", "tokenizer.ggml.eos_token_id",
    "tokenizer.ggml.add_bos_token", "tokenizer.ggml.add_eos_token", "tokenizer.ggml.add_space_prefix"]);
  const out = {};
  const readScalar = (ty) => {
    switch (ty) {
      case 0: case 7: { const v = buf[p]; p += 1; return ty === 7 ? v !== 0 : v; }
      case 1: { const v = (buf[p] << 24 >> 24); p += 1; return v; }
      case 2: { const v = dv.getUint16(p, true); p += 2; return v; }
      case 3: { const v = dv.getInt16(p, true); p += 2; return v; }
      case 4: return u32();
      case 5: { const v = dv.getInt32(p, true); p += 4; return v; }
      case 6: { const v = dv.getFloat32(p, true); p += 4; return v; }
      case 8: return str();
      case 10: case 11: return u64();
      case 12: { const v = dv.getFloat64(p, true); p += 8; return v; }
      default: throw new Error("bad type " + ty);
    }
  };
  const skip = (ty) => { readScalar(ty); };
  for (let i = 0; i < nkv; i++) {
    const keyLen = u64(); const key = td.decode(buf.subarray(p, p + keyLen)); p += keyLen;
    const ty = u32();
    if (ty === 9) {                                   // array
      const ety = u32(), cnt = u64();
      if (WANT.has(key)) {
        const arr = new Array(cnt);
        for (let j = 0; j < cnt; j++) arr[j] = readScalar(ety);
        out[key] = arr;
      } else {
        for (let j = 0; j < cnt; j++) skip(ety);
      }
    } else {
      const v = readScalar(ty);
      if (WANT.has(key)) out[key] = v;
    }
  }
  return out;
}

// Special/user-defined token pre-partition (tokenizer_st_partition, :2903). Tokens
// of type CONTROL(3)/USER_DEFINED(4)/UNKNOWN(2) are extracted from the raw text —
// longest first — BEFORE byte-level/escape processing, so e.g. Gemma's literal
// whitespace tokens ("  ", "\t") become single ids. With parseSpecial=false,
// CONTROL/UNKNOWN are skipped but USER_DEFINED are still partitioned (:2909).
function buildPartition(tokens, tokenType) {
  const ids = [];
  for (let i = 0; i < tokens.length; i++) { const ty = tokenType ? tokenType[i] : 1; if (ty === 2 || ty === 3 || ty === 4) ids.push(i); }
  ids.sort((a, b) => (tokens[b]?.length || 0) - (tokens[a]?.length || 0)); // longest text first
  return function partition(text, parseSpecial) {
    let frags = [{ raw: text }];
    for (const id of ids) {
      const ty = tokenType ? tokenType[id] : 1;
      if (!parseSpecial && (ty === 2 || ty === 3)) continue;        // skip CONTROL/UNKNOWN unless parse_special
      const tt = tokens[id]; if (!tt) continue;
      const next = [];
      for (const f of frags) {
        if (f.id !== undefined) { next.push(f); continue; }
        const raw = f.raw; let from = 0, idx;
        while ((idx = raw.indexOf(tt, from)) !== -1) {
          if (idx > from) next.push({ raw: raw.slice(from, idx) });
          next.push({ id });
          from = idx + tt.length;
        }
        if (from < raw.length) next.push({ raw: raw.slice(from) });
      }
      frags = next;
    }
    return frags;
  };
}

// GPT2 bytes_to_unicode (and inverse).
function byteUnicodeMaps() {
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n++; }
  const b2u = new Array(256), u2b = {};
  for (let i = 0; i < bs.length; i++) { const ch = String.fromCharCode(cs[i]); b2u[bs[i]] = ch; u2b[ch] = bs[i]; }
  return { b2u, u2b };
}

// Build a tokenizer from a GGUF buffer.
export function makeTokenizer(buf) {
  const meta = readTokenizerMeta(buf);
  const tokens = meta["tokenizer.ggml.tokens"];
  if (!tokens) throw new Error("tokenizer: no tokens array in GGUF");
  const model = meta["tokenizer.ggml.model"], pre = meta["tokenizer.ggml.pre"];
  const tokenToId = new Map(); for (let i = 0; i < tokens.length; i++) tokenToId.set(tokens[i], i);
  const partition = buildPartition(tokens, meta["tokenizer.ggml.token_type"]);
  if (model === "llama") return makeSpmTokenizer({ meta, tokens, tokenToId, model, pre, partition });
  const merges = meta["tokenizer.ggml.merges"] || [];
  const rank = new Map(); for (let i = 0; i < merges.length; i++) rank.set(merges[i], i); // "A B" -> rank
  const { b2u, u2b } = byteUnicodeMaps();
  const enc = new TextEncoder(), dec = new TextDecoder();

  // BPE on a byte-mapped char array: merge lowest-rank adjacent pair first.
  function bpe(chars) {
    if (chars.length < 2) return chars;
    let word = chars;
    for (;;) {
      let best = Infinity, bi = -1;
      for (let i = 0; i < word.length - 1; i++) {
        const r = rank.get(word[i] + " " + word[i + 1]);
        if (r !== undefined && r < best) { best = r; bi = i; }
      }
      if (bi < 0) break;
      const merged = word.slice(0, bi);
      merged.push(word[bi] + word[bi + 1]);
      for (let i = bi + 2; i < word.length; i++) merged.push(word[i]);
      word = merged;
    }
    return word;
  }

  function encode(text, { addSpecial = false, parseSpecial = false } = {}) {
    const ids = [];
    if (addSpecial && meta["tokenizer.ggml.add_bos_token"] && meta["tokenizer.ggml.bos_token_id"] != null)
      ids.push(meta["tokenizer.ggml.bos_token_id"]);
    for (const frag of partition(text, parseSpecial)) {
      if (frag.id !== undefined) { ids.push(frag.id); continue; } // special/user-defined token, verbatim
      for (const m of frag.raw.matchAll(QWEN2_RE)) {
        const piece = m[0];
        // byte-level map each UTF-8 byte -> unicode char
        const bytes = enc.encode(piece);
        const chars = new Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) chars[i] = b2u[bytes[i]];
        for (const sub of bpe(chars)) {
          const id = tokenToId.get(sub);
          if (id === undefined) throw new Error("tokenizer: unknown subword '" + sub + "'");
          ids.push(id);
        }
      }
    }
    return ids;
  }

  function decode(ids) {
    const bytes = [];
    for (const id of ids) {
      const tok = tokens[id]; if (tok === undefined) continue;
      for (const ch of tok) { const b = u2b[ch]; if (b !== undefined) bytes.push(b); }
    }
    return dec.decode(new Uint8Array(bytes));
  }

  return { encode, decode, model, pre, nVocab: tokens.length, meta, tokenToId, tokens };
}

// ── SPM (SentencePiece / LLaMA) ──────────────────────────────────────────────
// Port of llm_tokenizer_spm_session (src/llama-vocab.cpp:114). Symbols are UTF-8
// chars in a doubly-linked list; a max-priority queue (by token SCORE, ties→lower
// left index) repeatedly merges the best adjacent bigram that is a vocab token.
const HEXU = "0123456789ABCDEF";
const utf8Len = (b) => b < 0x80 ? 1 : (b & 0xe0) === 0xc0 ? 2 : (b & 0xf0) === 0xe0 ? 3 : (b & 0xf8) === 0xf0 ? 4 : 1;

function makeSpmTokenizer({ meta, tokens, tokenToId, model, pre, partition }) {
  const scores = meta["tokenizer.ggml.scores"] || [];
  const enc = new TextEncoder(), dec = new TextDecoder();
  const addSpacePrefix = meta["tokenizer.ggml.add_space_prefix"] !== false; // default true for SPM
  const byteFallback = (b) => {
    const k = "<0x" + HEXU[b >> 4] + HEXU[b & 15] + ">";
    let id = tokenToId.get(k);
    if (id === undefined) id = tokenToId.get(String.fromCharCode(b));   // raw-byte fallback
    if (id === undefined) throw new Error("spm: no byte token for 0x" + b.toString(16));
    return id;
  };

  function tokenizePiece(bytes, out) {
    // symbols: parallel arrays start/n/prev/next over the byte buffer
    const start = [], n = [], prev = [], next = [];
    for (let offs = 0, i = 0; offs < bytes.length; i++) {
      const len = Math.min(utf8Len(bytes[offs]), bytes.length - offs);
      start.push(offs); n.push(len); prev.push(i - 1); offs += len;
      next.push(offs === bytes.length ? -1 : i + 1);
    }
    const symText = (i) => dec.decode(bytes.subarray(start[i], start[i] + n[i]));
    // max-heap of bigrams: better = higher score, then lower left index.
    const heap = [];
    const better = (a, b) => a.score > b.score || (a.score === b.score && a.left < b.left);
    const push = (x) => { heap.push(x); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (better(heap[c], heap[p])) { [heap[c], heap[p]] = [heap[p], heap[c]]; c = p; } else break; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { let m = c; const l = 2 * c + 1, r = 2 * c + 2; if (l < heap.length && better(heap[l], heap[m])) m = l; if (r < heap.length && better(heap[r], heap[m])) m = r; if (m === c) break; [heap[c], heap[m]] = [heap[m], heap[c]]; c = m; } } return top; };
    const tryAdd = (left, right) => {
      if (left === -1 || right === -1) return;
      const text = dec.decode(bytes.subarray(start[left], start[left] + n[left] + n[right]));
      const id = tokenToId.get(text);
      if (id === undefined) return;
      push({ left, right, score: scores[id] ?? 0, size: n[left] + n[right] });
    };
    for (let i = 1; i < start.length; i++) tryAdd(i - 1, i);
    while (heap.length) {
      const bg = pop();
      const L = bg.left, R = bg.right;
      if (n[L] === 0 || n[R] === 0 || n[L] + n[R] !== bg.size) continue;  // stale
      n[L] += n[R]; n[R] = 0;                                             // merge R into L
      next[L] = next[R]; if (next[R] >= 0) prev[next[R]] = L;
      tryAdd(prev[L], L); tryAdd(L, next[L]);
    }
    // emit: each surviving symbol → its token, else byte fallback per UTF-8 byte.
    for (let i = 0; i !== -1; i = next[i]) {
      const id = tokenToId.get(symText(i));
      if (id !== undefined) { out.push(id); continue; }
      for (let j = 0; j < n[i]; j++) out.push(byteFallback(bytes[start[i] + j]));
    }
  }

  function encode(text, { addSpecial = false, parseSpecial = false } = {}) {
    const out = [];
    let isPrevSpecial = true;                  // prefix-space only at start / after a special token
    if (addSpecial && meta["tokenizer.ggml.add_bos_token"] && meta["tokenizer.ggml.bos_token_id"] != null)
      out.push(meta["tokenizer.ggml.bos_token_id"]);
    for (const frag of partition(text, parseSpecial)) {
      if (frag.id !== undefined) { out.push(frag.id); isPrevSpecial = true; continue; }
      let s = (addSpacePrefix && isPrevSpecial) ? " " + frag.raw : frag.raw;
      s = s.replace(/ /g, "▁");                // llama_escape_whitespace: ' ' → ▁
      if (s.length) tokenizePiece(enc.encode(s), out);
      isPrevSpecial = false;
    }
    if (addSpecial && meta["tokenizer.ggml.add_eos_token"] && meta["tokenizer.ggml.eos_token_id"] != null)
      out.push(meta["tokenizer.ggml.eos_token_id"]);
    return out;
  }

  function decode(ids) {
    const bytes = [];
    for (const id of ids) {
      const tok = tokens[id]; if (tok === undefined) continue;
      const mB = /^<0x([0-9A-Fa-f]{2})>$/.exec(tok);
      if (mB) { bytes.push(parseInt(mB[1], 16)); continue; }
      for (const b of enc.encode(tok.replace(/▁/g, " "))) bytes.push(b);
    }
    let txt = dec.decode(new Uint8Array(bytes));
    if (addSpacePrefix && txt.startsWith(" ")) txt = txt.slice(1);   // drop the prefix space
    return txt;
  }

  return { encode, decode, model, pre, nVocab: tokens.length, meta, tokenToId, tokens, scores };
}
