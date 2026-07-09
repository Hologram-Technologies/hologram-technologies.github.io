# Phase 1b — dump Moonshine stage-goldens (conv stem + encoder output + first-step logits) so the JS κ-forge
# oracle can be verified stage-by-stage against the trusted reference. Writes gpu/moonshine-*.f32 + .json.
import sys, json, struct, numpy as np, torch
from transformers import AutoProcessor, MoonshineForConditionalGeneration
MODEL = "./.models/moonshine-tiny"
WAV = sys.argv[1] if len(sys.argv) > 1 else "C:/Users/pavel/Desktop/SovereignAI/1_Compute/whisper.cpp/jo16.wav"
def read_wav16(p):
    b = open(p, "rb").read(); o = 12
    while o + 8 <= len(b):
        cid = b[o:o+4]; sz = struct.unpack("<I", b[o+4:o+8])[0]
        if cid == b"data": return np.frombuffer(b[o+8:o+8+sz], dtype="<i2").astype(np.float32) / 32768.0
        o += 8 + sz + (sz & 1)
audio = read_wav16(WAV)
proc = AutoProcessor.from_pretrained(MODEL)
model = MoonshineForConditionalGeneration.from_pretrained(MODEL, torch_dtype="float32").eval()
inputs = proc(audio, sampling_rate=16000, return_tensors="pt")
acts = {}
def hook(name):
    def h(m, i, o): acts[name] = (o[0] if isinstance(o, tuple) else o).detach().float().contiguous().numpy()
    return h
enc = model.model.encoder
enc.conv1.register_forward_hook(hook("conv1")); enc.conv2.register_forward_hook(hook("conv2")); enc.conv3.register_forward_hook(hook("conv3"))
with torch.no_grad():
    eo = enc(inputs.input_values).last_hidden_state          # [1, frames, 288]
    # first decoder step logits over the bos prompt (greedy step 0)
    dec_in = torch.tensor([[1]])
    logits = model(input_values=inputs.input_values, decoder_input_ids=dec_in).logits[0, -1].float().numpy()
acts["enc"] = eo[0].detach().numpy()
def dump(name, arr):
    arr = np.ascontiguousarray(arr.astype(np.float32)); arr.tofile(f"./gpu/moonshine-{name}.f32"); return list(arr.shape)
shapes = {k: dump(k, v) for k, v in acts.items()}
dump("logits0", logits)
import numpy as _np
meta = {"shapes": shapes, "logits0_argmax": int(_np.argmax(logits)), "logits0_len": int(logits.shape[0]),
        "audioSec": len(audio) / 16000, "n_samples": len(audio)}
json.dump(meta, open("./gpu/moonshine-stage-ref.json", "w"), indent=1)
print(json.dumps(meta, indent=1))
