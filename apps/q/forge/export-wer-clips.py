# Export the held-out WER set (LibriSpeech-dummy clean) as 16k PCM16 wavs + references, so the in-browser
# κ-engine can be scored at each quant precision (f32/f16/int8) — the int8 quality gate.
import io, json, os, struct
import numpy as np, soundfile as sf
from datasets import load_dataset, Audio

OUT = "./gpu/wer"; os.makedirs(OUT, exist_ok=True)
ds = load_dataset("hf-internal-testing/librispeech_asr_dummy", "clean", split="validation").cast_column("audio", Audio(decode=False))
def load_audio(a):
    raw = a.get("bytes"); arr, sr = sf.read(io.BytesIO(raw) if raw else a["path"], dtype="float32")
    if arr.ndim > 1: arr = arr.mean(axis=1)
    return arr.astype(np.float32), sr
def write_wav16(path, pcm):
    pcm16 = np.clip(pcm * 32768, -32768, 32767).astype("<i2").tobytes()
    with open(path, "wb") as f:
        f.write(b"RIFF"); f.write(struct.pack("<I", 36 + len(pcm16))); f.write(b"WAVEfmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, 16000, 32000, 2, 16)); f.write(b"data"); f.write(struct.pack("<I", len(pcm16))); f.write(pcm16)

refs = []
for i, ex in enumerate(ds):
    arr, sr = load_audio(ex["audio"]); assert sr == 16000, sr
    fn = f"{i:03d}.wav"; write_wav16(f"{OUT}/{fn}", arr); refs.append({"file": fn, "text": ex["text"]})
json.dump(refs, open("./gpu/wer-refs.json", "w"))
print(f"exported {len(refs)} clips → gpu/wer/ + gpu/wer-refs.json")
