# Phase 1 — Moonshine Tier-A reference oracle (HF transformers = ground truth).
# Transcribe a wav, print token ids + text + timing. The κ-forge oracle must reproduce these ids.
#   python run-moonshine-ref.py [model_dir] [wav]
import sys, json, time, struct, numpy as np
from transformers import AutoProcessor, MoonshineForConditionalGeneration

MODEL = sys.argv[1] if len(sys.argv) > 1 else "./.models/moonshine-tiny"
WAV = sys.argv[2] if len(sys.argv) > 2 else "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/jo16.wav"
OUT = sys.argv[3] if len(sys.argv) > 3 else "./gpu/moonshine-tx-ref.json"

def read_wav16(path):
    b = open(path, "rb").read(); o = 12
    while o + 8 <= len(b):
        cid = b[o:o+4]; sz = struct.unpack("<I", b[o+4:o+8])[0]
        if cid == b"data":
            pcm = np.frombuffer(b[o+8:o+8+sz], dtype="<i2").astype(np.float32) / 32768.0
            return pcm
        o += 8 + sz + (sz & 1)
    raise SystemExit("no data chunk")

audio = read_wav16(WAV)
proc = AutoProcessor.from_pretrained(MODEL)
model = MoonshineForConditionalGeneration.from_pretrained(MODEL, torch_dtype="float32").eval()
inputs = proc(audio, sampling_rate=16000, return_tensors="pt")
t0 = time.time()
ids = model.generate(**inputs, max_new_tokens=200)
ms = int((time.time() - t0) * 1000)
out_ids = ids[0].tolist()
text = proc.batch_decode(ids, skip_special_tokens=True)[0]
print("audio_sec %.2f" % (len(audio) / 16000))
print("ids", json.dumps(out_ids))
print("n_ids", len(out_ids), "cpu_ms", ms)
print("text", text)
json.dump({"model": MODEL.split("/")[-1], "wav": WAV.split("/")[-1], "ids": out_ids, "text": text,
           "cpuMs": ms, "audioSec": len(audio) / 16000}, open(OUT, "w"), indent=1)
