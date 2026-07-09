# Rigorous WER benchmark on a held-out set (LibriSpeech dummy clean, 73 utts w/ references).
# Compares moonshine-tiny vs whisper-tiny.en vs whisper-base.en via HF reference runtimes (ground truth).
# Word-level WER (Levenshtein on normalized tokens). No jiwer dep.
import re, time, json, sys, io
import numpy as np, soundfile as sf
from datasets import load_dataset, Audio
from transformers import pipeline
import torch

def norm(s): return re.sub(r"[^a-z0-9' ]", " ", s.lower()).split()
def wer_counts(ref, hyp):
    r, h = norm(ref), norm(hyp); n, m = len(r), len(h)
    dp = list(range(m + 1))
    for i in range(1, n + 1):
        prev = dp[0]; dp[0] = i
        for j in range(1, m + 1):
            cur = dp[j]; dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (r[i - 1] != h[j - 1])); prev = cur
    return dp[m], n

ds = load_dataset("hf-internal-testing/librispeech_asr_dummy", "clean", split="validation").cast_column("audio", Audio(decode=False))
def load_audio(ex):
    a = ex["audio"]; raw = a.get("bytes")
    if raw is None: arr, sr = sf.read(a["path"], dtype="float32")
    else: arr, sr = sf.read(io.BytesIO(raw), dtype="float32")
    if arr.ndim > 1: arr = arr.mean(axis=1)
    return arr.astype(np.float32)
print(f"dataset: {len(ds)} utterances", flush=True)
MODELS = {"moonshine-tiny": "UsefulSensors/moonshine-tiny", "whisper-tiny.en": "openai/whisper-tiny.en", "whisper-base.en": "openai/whisper-base.en"}
out = {}
for name, mid in MODELS.items():
    asr = pipeline("automatic-speech-recognition", model=mid, device=-1, torch_dtype=torch.float32)
    te = tw = 0; t0 = time.time(); tot_audio = 0.0
    for ex in ds:
        a = load_audio(ex); tot_audio += len(a) / 16000
        hyp = asr(a, generate_kwargs={"max_new_tokens": 200})["text"]
        e, w = wer_counts(ex["text"], hyp); te += e; tw += w
    dt = time.time() - t0
    out[name] = {"wer_pct": round(100 * te / tw, 2), "ref_words": tw, "edits": te, "sec": round(dt, 1), "rtf": round(dt / tot_audio, 3)}
    print(f"{name:18} WER {out[name]['wer_pct']:6}%  ({te}/{tw} words)  {dt:.0f}s  RTFx {out[name]['rtf']}", flush=True)
json.dump(out, open("./gpu/moonshine-wer.json", "w"), indent=1)
print("\n=== WER (held-out LibriSpeech-dummy clean) ===")
for n, r in sorted(out.items(), key=lambda x: x[1]["wer_pct"]): print(f"  {n:18} {r['wer_pct']}%")
