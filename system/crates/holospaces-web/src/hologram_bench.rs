//! In-tab tensor compute through hologram's CPU backend (wasm) — the
//! de-risking milestone for running a model *through hologram* in the browser.
//!
//! This proves hologram's content-addressed tensor runtime executes real
//! kernels (matmul) inside the browser peer's wasm, and measures the throughput
//! so we know what model size is realistic before assembling a transformer.

use hologram_backend::cpu::dtype::DTYPE_F32;
use hologram_backend::{
    Backend, BufferRef, CpuBackend, KernelCall, MatMulCall, SplitReads, Workspace,
};
use hologram_compiler::{compile, BackendKind};
use hologram_exec::{BufferArena, InferenceSession, InputBuffer};
use hologram_graph::node::Node;
use hologram_graph::registry::{DTypeId, ShapeDescriptor};
use hologram_graph::{Graph, GraphOp, InputSource, OpKind};
use smallvec::SmallVec;
use uor_foundation::WittLevel;
use wasm_bindgen::prelude::*;

/// A minimal byte-slot workspace (the runtime buffer pool the backend writes
/// into) — the same shape hologram's own perf V&V uses.
struct VecWorkspace {
    slots: Vec<Vec<u8>>,
}
impl Workspace for VecWorkspace {
    fn read(&self, b: BufferRef) -> &[u8] {
        &self.slots[b.slot as usize][..]
    }
    fn write(&mut self, b: BufferRef) -> &mut [u8] {
        let s = b.slot as usize;
        let n = self.slots[s].len();
        &mut self.slots[s][..n]
    }
    fn split_borrow<'a>(
        &'a mut self,
        reads: &[BufferRef],
        write: BufferRef,
    ) -> Option<(SplitReads<'a>, &'a mut [u8])> {
        let w = write.slot as usize;
        if reads.iter().any(|r| r.slot as usize == w) {
            return None;
        }
        let (lo, hi) = self.slots.split_at_mut(w);
        let (wbuf, rest) = hi.split_first_mut()?;
        let rs = reads
            .iter()
            .map(|r| {
                let i = r.slot as usize;
                if i < w {
                    &lo[i][..]
                } else {
                    &rest[i - w - 1][..]
                }
            })
            .collect();
        Some((rs, wbuf.as_mut_slice()))
    }
}

const fn buf(slot: u32) -> BufferRef {
    BufferRef {
        slot,
        offset: 0,
        length: 0,
    }
}

/// Run `runs` square f32 matmuls of dimension `dim` through hologram's CPU
/// backend and report throughput as JSON `{ "dim", "ms", "gflops" }`. Timed
/// with the JS clock (`std::time::Instant` is unavailable on wasm).
#[wasm_bindgen]
pub fn hologram_matmul_bench(dim: usize, runs: u32) -> String {
    let bytes = dim * dim * 4;
    let a = vec![0x3f_u8; bytes];
    let b = vec![0x3e_u8; bytes];
    let mut ws = VecWorkspace {
        slots: vec![a, b, vec![0u8; bytes]],
    };
    let mut backend: CpuBackend<VecWorkspace> = CpuBackend::new();
    let call = KernelCall::MatMul(MatMulCall {
        a: buf(0),
        b: buf(1),
        output: buf(2),
        m: dim as u32,
        k: dim as u32,
        n: dim as u32,
        dtype: DTYPE_F32,
        b_packed: false,
    });

    if backend.dispatch(&call, &mut ws).is_err() {
        return String::from("{\"error\":\"dispatch failed\"}");
    }
    let runs = runs.max(1);
    let t0 = js_sys::Date::now();
    for _ in 0..runs {
        let _ = backend.dispatch(&call, &mut ws);
    }
    let ms = (js_sys::Date::now() - t0) / f64::from(runs);
    let gflops = 2.0 * (dim as f64).powi(3) / (ms / 1000.0) / 1e9;
    format!("{{\"dim\":{dim},\"ms\":{ms:.3},\"gflops\":{gflops:.2}}}")
}

/// Prove hologram's **full graph pipeline** runs in the tab: build a graph,
/// compile it to a content-addressed `.holo` archive, load an inference
/// session, and execute it on real data. This is the exact mechanism a
/// transformer runs through (just more ops + the weights as constants), so a
/// passing softmax here de-risks the whole model path.
#[wasm_bindgen]
pub fn hologram_graph_demo() -> String {
    const F32: u8 = 8;
    let mut graph = Graph::new();
    let shape = graph
        .shape_registry_mut()
        .intern(ShapeDescriptor::rank3(1, 1, 4));
    let input = graph.add_node(Node {
        op: GraphOp::Input,
        inputs: SmallVec::new(),
        output_dtype: DTypeId(F32),
        output_shape: shape,
    });
    graph.add_input(input);
    let softmax = graph.add_node(Node {
        op: GraphOp::Op(OpKind::Softmax),
        inputs: SmallVec::from_iter([InputSource::Node(input)]),
        output_dtype: DTypeId(F32),
        output_shape: shape,
    });
    let output = graph.add_node(Node {
        op: GraphOp::Output,
        inputs: SmallVec::from_iter([InputSource::Node(softmax)]),
        output_dtype: DTypeId(F32),
        output_shape: shape,
    });
    graph.add_output(output);

    let compiled = match compile(graph, BackendKind::Cpu, WittLevel::W32) {
        Ok(c) => c,
        Err(e) => return format!("{{\"error\":\"compile: {e:?}\"}}"),
    };
    let backend: CpuBackend<BufferArena> = CpuBackend::new();
    let mut session = match InferenceSession::load(&compiled.archive, backend) {
        Ok(s) => s,
        Err(e) => return format!("{{\"error\":\"load: {e:?}\"}}"),
    };
    let bytes: Vec<u8> = [1.0f32, 2.0, 3.0, 4.0]
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .collect();
    let outputs = match session.execute(&[InputBuffer { bytes: &bytes }]) {
        Ok(o) => o,
        Err(e) => return format!("{{\"error\":\"execute: {e:?}\"}}"),
    };
    let result: Vec<f32> = outputs[0]
        .bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect();
    let sum: f32 = result.iter().sum();
    format!("{{\"softmax\":{result:?},\"sum\":{sum}}}")
}

/// Generate tokens from a tiny transformer **entirely in the browser**, through
/// hologram — the whole LM (embedding, multi-head RoPE attention, SwiGLU MLP,
/// LM head, token loop) runs in wasm. Returns JSON `{ tokens, ms }`.
#[wasm_bindgen]
pub fn qvac_generate(max_new: usize, temp: f32, seed: f64) -> String {
    let prompt = [2usize, 7, 1];
    let t0 = js_sys::Date::now();
    // d=12, 3 heads, ff=28, vocab=19, 2 layers — a real (small) language model.
    // d=12, 3 query heads, 1 kv head (GQA), ff=28, vocab=19, 2 layers.
    let seq = qvac_layer::demo_generate(&prompt, 12, 3, 1, 28, 19, 2, max_new, temp, seed as u64);
    let ms = js_sys::Date::now() - t0;
    let toks: Vec<String> = seq.iter().map(|t| t.to_string()).collect();
    format!(
        "{{\"tokens\":[{}],\"prompt\":{},\"generated\":{},\"ms\":{ms:.0}}}",
        toks.join(","),
        prompt.len(),
        max_new
    )
}

/// Generate from a **real GGUF model** entirely in the browser, through hologram.
/// `gguf` is the fetched model file's bytes. Loads it, generates `max_new` tokens
/// greedily/sampled from `<s>`, detokenizes via the embedded vocab, and returns
/// JSON `{ text, tokens, ms, arch }`.
#[wasm_bindgen]
pub fn qvac_generate_gguf(gguf: &[u8], max_new: usize, temp: f32, seed: f64) -> String {
    let g = match qvac_layer::Gguf::parse(gguf.to_vec()) {
        Ok(g) => g,
        Err(e) => return format!("{{\"error\":\"parse: {e:?}\"}}"),
    };
    let arch = g
        .metadata
        .get("general.architecture")
        .and_then(|m| m.as_str())
        .unwrap_or("llama")
        .to_string();
    let vocab: Vec<String> = match g.metadata.get("tokenizer.ggml.tokens") {
        Some(qvac_layer::Meta::Array(a)) => a.iter().filter_map(|m| m.as_str().map(String::from)).collect(),
        _ => Vec::new(),
    };
    let model = match qvac_layer::OwnedModel::from_gguf(&g, &arch) {
        Ok(m) => m,
        Err(e) => return format!("{{\"error\":\"load: {e}\"}}"),
    };
    let t0 = js_sys::Date::now();
    let out = model.generate(&[1usize], max_new, temp, seed as u64, 1 + max_new);
    let ms = js_sys::Date::now() - t0;
    let text: String = out
        .iter()
        .map(|&id| vocab.get(id).map(|s| s.replace('\u{2581}', " ")).unwrap_or_default())
        .collect();
    let esc = text.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n");
    format!("{{\"arch\":\"{arch}\",\"tokens\":{},\"ms\":{ms:.0},\"text\":\"{esc}\"}}", out.len())
}

// ── A living AI mind: load once, then continue from any token sequence ──
// The token sequence IS the mind's state; generation is deterministic (greedy),
// so the same sequence always continues into the same thought — which is what
// makes a mind teleportable and verifiable by its content hash.
thread_local! {
    // The CPU model is `Option` — GPU-only big models (e.g. 1.1B) skip building it
    // entirely (that f32→int8 round-trip is the wasm OOM source); they keep just the
    // vocab/scores (for tokenize/detok) + the GGUF (for the GPU export).
    static MIND: core::cell::RefCell<Option<(Option<qvac_layer::OwnedModel>, Vec<String>, Vec<f32>, Option<qvac_layer::Gguf>)>> =
        const { core::cell::RefCell::new(None) };
    // Byte-level BPE tokenizer (Qwen2/GPT-2 models). When set, it overrides the
    // SPM path in qvac_tokenize / detok.
    static BPE: core::cell::RefCell<Option<qvac_layer::Bpe>> = const { core::cell::RefCell::new(None) };
    // (bos, eos, add_bos) read from GGUF tokenizer metadata (defaults: 1, 2, true)
    static SPECIAL: core::cell::Cell<(u32, u32, bool)> = const { core::cell::Cell::new((1, 2, true)) };
}

fn parse_ids(json: &str) -> Vec<usize> {
    json.trim()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .split(',')
        .filter_map(|s| {
            let s = s.trim();
            if s.is_empty() { None } else { s.parse().ok() }
        })
        .collect()
}

/// Load a GGUF model into the page (once). Returns `{ ok, arch, vocab }`.
#[wasm_bindgen]
pub fn qvac_load_model(gguf: &[u8]) -> String {
    let g = match qvac_layer::Gguf::parse(gguf.to_vec()) {
        Ok(g) => g,
        Err(e) => return format!("{{\"error\":\"parse: {e:?}\"}}"),
    };
    let arch = g
        .metadata
        .get("general.architecture")
        .and_then(|m| m.as_str())
        .unwrap_or("llama")
        .to_string();
    let vocab: Vec<String> = match g.metadata.get("tokenizer.ggml.tokens") {
        Some(qvac_layer::Meta::Array(a)) => a.iter().filter_map(|m| m.as_str().map(String::from)).collect(),
        _ => Vec::new(),
    };
    let scores: Vec<f32> = match g.metadata.get("tokenizer.ggml.scores") {
        Some(qvac_layer::Meta::Array(a)) => a.iter().map(|m| m.as_f32().unwrap_or(0.0)).collect(),
        _ => Vec::new(),
    };
    // special tokens from metadata (instead of hardcoding 1/2)
    let bos = g.metadata.get("tokenizer.ggml.bos_token_id").and_then(|m| m.as_u64()).unwrap_or(1) as u32;
    let eos = g.metadata.get("tokenizer.ggml.eos_token_id").and_then(|m| m.as_u64()).unwrap_or(2) as u32;
    let add_bos = match g.metadata.get("tokenizer.ggml.add_bos_token") {
        Some(qvac_layer::Meta::Bool(b)) => *b,
        _ => true,
    };
    SPECIAL.with(|s| s.set((bos, eos, add_bos)));
    BPE.with(|b| *b.borrow_mut() = None); // SPM model → no BPE
    match qvac_layer::OwnedModel::from_gguf(&g, &arch) {
        Ok(model) => {
            let v = model.vocab;
            // keep the GGUF for the per-block GPU export (freed after export)
            MIND.with(|m| *m.borrow_mut() = Some((Some(model), vocab, scores, Some(g))));
            format!("{{\"ok\":true,\"arch\":\"{arch}\",\"vocab\":{v},\"bos\":{bos},\"eos\":{eos},\"add_bos\":{add_bos}}}")
        }
        Err(e) => format!("{{\"error\":\"load: {e}\"}}"),
    }
}

/// Load a GGUF model **for the GPU engine only** — parses metadata + tokenizer
/// vocab/scores and retains the GGUF for [`qvac_gpu_export`], but does NOT build
/// the CPU [`OwnedModel`]. That f32→int8 round-trip (≈ the whole model materialised
/// twice) is what OOMs the tab on a 1.1B; skipping it is the difference between a
/// 1.1B loading or crashing. Takes `Vec<u8>` (moved, not copied — one fewer ~640 MB
/// copy than `&[u8].to_vec()`). Returns `{ ok, arch, vocab, bos, eos, add_bos }`.
#[wasm_bindgen]
pub fn qvac_load_gpu(gguf: Vec<u8>) -> String {
    let g = match qvac_layer::Gguf::parse(gguf) {
        Ok(g) => g,
        Err(e) => return format!("{{\"error\":\"parse: {e:?}\"}}"),
    };
    let arch = g
        .metadata
        .get("general.architecture")
        .and_then(|m| m.as_str())
        .unwrap_or("llama")
        .to_string();
    let vocab: Vec<String> = match g.metadata.get("tokenizer.ggml.tokens") {
        Some(qvac_layer::Meta::Array(a)) => a.iter().filter_map(|m| m.as_str().map(String::from)).collect(),
        _ => Vec::new(),
    };
    let scores: Vec<f32> = match g.metadata.get("tokenizer.ggml.scores") {
        Some(qvac_layer::Meta::Array(a)) => a.iter().map(|m| m.as_f32().unwrap_or(0.0)).collect(),
        _ => Vec::new(),
    };
    let bos = g.metadata.get("tokenizer.ggml.bos_token_id").and_then(|m| m.as_u64()).unwrap_or(1) as u32;
    let eos = g.metadata.get("tokenizer.ggml.eos_token_id").and_then(|m| m.as_u64()).unwrap_or(2) as u32;
    let add_bos = match g.metadata.get("tokenizer.ggml.add_bos_token") {
        Some(qvac_layer::Meta::Bool(b)) => *b,
        _ => true,
    };
    SPECIAL.with(|s| s.set((bos, eos, add_bos)));
    let v = vocab.len();
    // byte-level BPE tokenizer for gpt2-class models (Qwen2); None for SPM/Llama
    let bpe = g.build_bpe();
    let is_bpe = bpe.is_some();
    BPE.with(|b| *b.borrow_mut() = bpe);
    MIND.with(|m| *m.borrow_mut() = Some((None, vocab, scores, Some(g))));
    format!("{{\"ok\":true,\"arch\":\"{arch}\",\"vocab\":{v},\"bos\":{bos},\"eos\":{eos},\"add_bos\":{add_bos},\"bpe\":{is_bpe},\"gpu_only\":true}}")
}

/// Export the loaded model for the WebGPU engine — **per-block int8** (a scale per
/// 32 weights, the GGUF's native precision) in `[out,in]` layout. Consumes the
/// retained GGUF (freeing ~its bytes). Blob: `[u32 manifest_len][JSON][q+scales]`.
#[wasm_bindgen]
pub fn qvac_gpu_export(bits: u32) -> Vec<u8> {
    MIND.with(|m| {
        let mut b = m.borrow_mut();
        match b.as_mut().and_then(|(_, _, _, g)| g.take()) {
            Some(g) => {
                let arch = g
                    .metadata
                    .get("general.architecture")
                    .and_then(|m| m.as_str())
                    .unwrap_or("llama")
                    .to_string();
                qvac_layer::gpu_export_blocks(&g, &arch, bits as u8)
            }
            None => Vec::new(),
        }
    })
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn error(s: &str);
}

/// Route Rust panics to `console.error` (release wasm otherwise traps silently).
#[wasm_bindgen]
pub fn qvac_panic_hook() {
    std::panic::set_hook(Box::new(|info| error(&format!("QVAC WASM PANIC: {info}"))));
}

/// **Streaming GPU export** — the manifest only (dims + tensor list). JS then
/// pulls each tensor with [`qvac_gpu_tensor`] and uploads it, so the converted
/// weights never coexist with the GGUF (the memory wall that blocks 1.7B+).
#[wasm_bindgen]
pub fn qvac_gpu_manifest(bits: u32) -> String {
    MIND.with(|m| {
        let b = m.borrow();
        match b.as_ref().and_then(|(_, _, _, g)| g.as_ref()) {
            Some(g) => {
                let arch = g.metadata.get("general.architecture").and_then(|m| m.as_str()).unwrap_or("llama").to_string();
                qvac_layer::gpu_export_manifest(g, &arch, bits as u8)
            }
            None => String::from("{}"),
        }
    })
}

/// One tensor's GPU bytes (`[q][f32 scales]` or `[f32]`) — quantized on demand
/// from the retained GGUF. Peak = GGUF + this one tensor.
#[wasm_bindgen]
pub fn qvac_gpu_tensor(name: &str, bits: u32) -> Vec<u8> {
    MIND.with(|m| {
        let b = m.borrow();
        match b.as_ref().and_then(|(_, _, _, g)| g.as_ref()) {
            Some(g) => {
                let arch = g.metadata.get("general.architecture").and_then(|m| m.as_str()).unwrap_or("llama").to_string();
                qvac_layer::gpu_export_tensor(g, &arch, bits as u8, name)
            }
            None => Vec::new(),
        }
    })
}

/// Free the retained GGUF once all tensors have been streamed to the GPU.
#[wasm_bindgen]
pub fn qvac_gpu_free() {
    MIND.with(|m| { if let Some(t) = m.borrow_mut().as_mut() { t.3 = None; } });
}

/// A symbol in the SPM merge list (a growing piece + intrusive linked list).
struct Sym {
    text: String,
    n: usize, // char count; 0 = merged away
    prev: i32,
    next: i32,
}
/// A candidate merge of two adjacent symbols, ordered by the merged piece's score.
#[derive(PartialEq)]
struct Bigram {
    score: f32,
    left: i32,
    right: i32,
    len: usize,
}
impl Eq for Bigram {}
impl PartialOrd for Bigram {
    fn partial_cmp(&self, o: &Self) -> Option<core::cmp::Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Bigram {
    fn cmp(&self, o: &Self) -> core::cmp::Ordering {
        // max-heap: highest score first, ties → smaller left index first
        self.score
            .partial_cmp(&o.score)
            .unwrap_or(core::cmp::Ordering::Equal)
            .then_with(|| o.left.cmp(&self.left))
    }
}

/// Tokenize text with the model's SentencePiece vocab + scores using llama.cpp's
/// **greedy score-merge** algorithm (not unigram Viterbi — Llama's SPM merges the
/// highest-scoring adjacent pair repeatedly), so a typed prompt becomes the *same*
/// tokens the model trained on. Prepends `<s>`; unknown chars fall back to bytes.
#[wasm_bindgen]
pub fn qvac_tokenize(text: &str) -> String {
    use std::collections::{BinaryHeap, HashMap};
    // byte-level BPE (Qwen2/GPT-2) — handles its own special tokens + spacing.
    if let Some(json) = BPE.with(|b| b.borrow().as_ref().map(|bpe| {
        let ids: Vec<String> = bpe.encode(text).iter().map(|x| x.to_string()).collect();
        format!("{{\"ids\":[{}]}}", ids.join(","))
    })) {
        return json;
    }
    MIND.with(|m| {
        let b = m.borrow();
        let (_, tokens, scores, _) = match b.as_ref() {
            Some(x) => x,
            None => return String::from("{\"error\":\"no model\"}"),
        };
        let mut map: HashMap<&str, (usize, f32)> = HashMap::with_capacity(tokens.len());
        for (i, t) in tokens.iter().enumerate() {
            map.entry(t.as_str()).or_insert((i, scores.get(i).copied().unwrap_or(0.0)));
        }
        // SPM normalization: a leading ▁, and spaces → ▁.
        let mut norm = String::from("\u{2581}");
        for ch in text.chars() {
            norm.push(if ch == ' ' { '\u{2581}' } else { ch });
        }
        let (bos, _, add_bos) = SPECIAL.with(|s| s.get());
        let chars: Vec<char> = norm.chars().collect();
        let ns = chars.len();
        if ns == 0 {
            return if add_bos { format!("{{\"ids\":[{bos}]}}") } else { String::from("{\"ids\":[]}") };
        }
        let mut syms: Vec<Sym> = (0..ns)
            .map(|i| Sym {
                text: chars[i].to_string(),
                n: 1,
                prev: i as i32 - 1,
                next: if i + 1 < ns { i as i32 + 1 } else { -1 },
            })
            .collect();

        let mk = |syms: &Vec<Sym>, l: i32, r: i32| -> Option<Bigram> {
            if l < 0 || r < 0 {
                return None;
            }
            let merged = format!("{}{}", syms[l as usize].text, syms[r as usize].text);
            map.get(merged.as_str()).map(|&(_, sc)| Bigram {
                score: sc,
                left: l,
                right: r,
                len: syms[l as usize].n + syms[r as usize].n,
            })
        };
        let mut heap = BinaryHeap::new();
        for i in 1..ns {
            if let Some(bg) = mk(&syms, i as i32 - 1, i as i32) {
                heap.push(bg);
            }
        }
        while let Some(bg) = heap.pop() {
            let (l, r) = (bg.left as usize, bg.right as usize);
            if syms[l].n == 0 || syms[r].n == 0 || syms[l].n + syms[r].n != bg.len {
                continue; // a symbol was already merged — stale candidate
            }
            let rt = core::mem::take(&mut syms[r].text);
            syms[l].text.push_str(&rt);
            syms[l].n += syms[r].n;
            syms[r].n = 0;
            let rn = syms[r].next;
            syms[l].next = rn;
            if rn >= 0 {
                syms[rn as usize].prev = l as i32;
            }
            let (lp, ln) = (syms[l].prev, syms[l].next);
            if let Some(b) = mk(&syms, lp, l as i32) {
                heap.push(b);
            }
            if let Some(b) = mk(&syms, l as i32, ln) {
                heap.push(b);
            }
        }

        let mut ids: Vec<usize> = if add_bos { vec![bos as usize] } else { Vec::new() };
        let mut i = 0i32;
        while i >= 0 {
            if syms[i as usize].n > 0 {
                let t = syms[i as usize].text.as_str();
                if let Some(&(id, _)) = map.get(t) {
                    ids.push(id);
                } else {
                    for byte in t.bytes() {
                        let bt = format!("<0x{byte:02X}>");
                        ids.push(map.get(bt.as_str()).map(|&(id, _)| id).unwrap_or(0));
                    }
                }
            }
            i = syms[i as usize].next;
        }
        let s: Vec<String> = ids.iter().map(|x| x.to_string()).collect();
        format!("{{\"ids\":[{}]}}", s.join(","))
    })
}

/// Continue a mind: given the current token sequence (`ids_json`), greedily
/// generate `n_more` tokens. Returns `{ ids, text, ms }` — the new full
/// sequence and its decoded text. Deterministic, so any holder of the same
/// sequence continues into the identical thought.
#[wasm_bindgen]
pub fn qvac_continue(ids_json: &str, n_more: usize, temp: f32, seed: f64, cap_hint: usize) -> String {
    let mut prompt = parse_ids(ids_json);
    if prompt.is_empty() {
        prompt.push(1); // <s>
    }
    MIND.with(|m| {
        let b = m.borrow();
        let (model_opt, vocab, _, _) = match b.as_ref() {
            Some(x) => x,
            None => return String::from("{\"error\":\"no model loaded\"}"),
        };
        let t0 = js_sys::Date::now();
        // GPU-only models have no CPU model — inference runs on the GPU (JS), so here
        // we only DETOKENIZE the given ids (n_more must be 0). A CPU model generates.
        let out = match model_opt {
            Some(model) => model.generate(&prompt, n_more, temp, seed as u64, cap_hint),
            None => prompt.clone(),
        };
        let ms = js_sys::Date::now() - t0;
        // BPE detok (Qwen2) reverses the byte→unicode map; SPM detok swaps ▁→space.
        let text: String = match BPE.with(|b| b.borrow().as_ref().map(|bpe| {
            bpe.decode(&out.iter().map(|&x| x as u32).collect::<Vec<u32>>())
        })) {
            Some(t) => t,
            None => out
                .iter()
                .map(|&id| vocab.get(id).map(|s| s.replace('\u{2581}', " ")).unwrap_or_default())
                .collect(),
        };
        let esc = text.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n");
        let ids: Vec<String> = out.iter().map(|x| x.to_string()).collect();
        format!("{{\"ids\":[{}],\"text\":\"{esc}\",\"ms\":{ms:.0}}}", ids.join(","))
    })
}
