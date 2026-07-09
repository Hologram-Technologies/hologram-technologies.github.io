# Ground-truth reference for ONE qwen3-next FULL-attention layer (gated GQA + QK-norm + partial NEOX RoPE).
import json, os, numpy as np, torch
torch.manual_seed(1); torch.use_deterministic_algorithms(True, warn_only=True)
from transformers.models.qwen3_next.configuration_qwen3_next import Qwen3NextConfig
from transformers.models.qwen3_next.modeling_qwen3_next import Qwen3NextAttention

H=64; NH=4; NKV=2; HD=16; ROPE=8; T=6; THETA=10000.0
cfg=Qwen3NextConfig(hidden_size=H, num_attention_heads=NH, num_key_value_heads=NKV, head_dim=HD,
                    rms_norm_eps=1e-6, attention_bias=False, attention_dropout=0.0)
cfg._attn_implementation="eager"
attn=Qwen3NextAttention(cfg, layer_idx=0).eval().float()

# manual partial RoPE cos/sin (dim=ROPE), positions 0..T-1
inv=1.0/(THETA**(np.arange(0,ROPE,2)/ROPE))           # [ROPE/2]
pos=np.arange(T)[:,None]*inv[None,:]                   # [T, ROPE/2]
emb=np.concatenate([pos,pos],axis=-1)                  # [T, ROPE]
cos=np.cos(emb); sin=np.sin(emb)
# HF expects cos/sin shaped [b, T, head_dim] for broadcast; but rope dim < head_dim → pad with ones(cos)/zeros(sin) so the
# pass-through dims are unchanged (cos=1,sin=0 → identity). This matches partial rope applied to the first ROPE dims.
cos_full=np.concatenate([cos, np.ones((T,HD-ROPE))],axis=-1)[None]   # [1,T,HD]
sin_full=np.concatenate([sin, np.zeros((T,HD-ROPE))],axis=-1)[None]
cosT=torch.tensor(cos_full,dtype=torch.float32); sinT=torch.tensor(sin_full,dtype=torch.float32)

x=torch.randn(1,T,H)
mask=torch.full((1,1,T,T), float("-inf")); mask=torch.triu(mask,diagonal=1)
with torch.no_grad():
    y,_=attn(x.float(), position_embeddings=(cosT,sinT), attention_mask=mask, past_key_values=None)
y=y[0].numpy()

sd={k:v.detach().numpy() for k,v in attn.state_dict().items()}
def f(a): return np.asarray(a,dtype=np.float64).ravel().tolist()
out={"dims":{"d_model":H,"n_head":NH,"n_kv":NKV,"head_dim":HD,"rope_dim":ROPE,"eps":1e-6},
     "x":[f(x[0,t]) for t in range(T)], "y":[f(y[t]) for t in range(T)],
     "cos":[f(cos[t]) for t in range(T)], "sin":[f(sin[t]) for t in range(T)],
     "W":{"attn_q":f(sd["q_proj.weight"]),"attn_k":f(sd["k_proj.weight"]),"attn_v":f(sd["v_proj.weight"]),
          "attn_output":f(sd["o_proj.weight"]),"attn_q_norm":f(sd["q_norm.weight"]),"attn_k_norm":f(sd["k_norm.weight"])}}
p=os.path.join(os.path.dirname(__file__),"parity-attn.json")
json.dump(out,open(p,"w")); print("wrote",p,"| |y|max",float(np.abs(y).max()),"| keys",list(sd.keys()))
