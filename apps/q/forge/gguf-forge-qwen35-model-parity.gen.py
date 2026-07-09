# Ground truth for the WHOLE qwen3-next model (tiny 4-layer Qwen3NextForCausalLM): 3 linear + 1 attention,
# dense SwiGLU MLP, embed + final norm + lm_head. Exports all weights (mapped to GGUF/forge layout) + logits.
import json, os, numpy as np, torch
torch.manual_seed(7); torch.use_deterministic_algorithms(True, warn_only=True)
from transformers.models.qwen3_next.configuration_qwen3_next import Qwen3NextConfig
from transformers.models.qwen3_next.modeling_qwen3_next import Qwen3NextForCausalLM

H=64; FF=128; NH=4; NKV=2; HD=16; NVH=4; NKH=2; HK=16; HV=16; KW=4; V=100; T=5
cfg=Qwen3NextConfig(vocab_size=V, hidden_size=H, intermediate_size=FF, num_hidden_layers=4,
  num_attention_heads=NH, num_key_value_heads=NKV, head_dim=HD,
  linear_num_value_heads=NVH, linear_num_key_heads=NKH, linear_key_head_dim=HK, linear_value_head_dim=HV,
  linear_conv_kernel_dim=KW, layer_types=["linear_attention","linear_attention","linear_attention","full_attention"],
  num_experts=0, decoder_sparse_step=1, mlp_only_layers=[], rms_norm_eps=1e-6, hidden_act="silu",
  attention_bias=False, tie_word_embeddings=False, max_position_embeddings=64,
  rope_parameters={"rope_type":"default","rope_theta":10000.0,"partial_rotary_factor":1.0})
model=Qwen3NextForCausalLM(cfg).eval().float()

ids=torch.randint(0,V,(1,T))
with torch.no_grad():
    out=model(input_ids=ids)
logits=out.logits[0].numpy()
# rotary cos/sin actually used
pos=torch.arange(T)[None]
cos,sin=model.model.rotary_emb(torch.zeros(1,T,H), pos)
cos=cos[0].numpy(); sin=sin[0].numpy()   # [T, head_dim]

sd=model.state_dict()
def g(k): return sd[k].detach().numpy()
def f(a): return np.asarray(a,dtype=np.float64).ravel().tolist()
key_dim=HK*NKH; value_dim=HV*NVH; conv_dim=2*key_dim+value_dim; group=NVH//NKH

def linear_W(p):  # p = "model.layers.L.linear_attn."
    Wq=g(p+"in_proj_qkvz.weight").reshape(NKH,2*HK+2*group*HV,H)
    q=Wq[:,0:HK,:].reshape(key_dim,H); k=Wq[:,HK:2*HK,:].reshape(key_dim,H)
    v=Wq[:,2*HK:2*HK+group*HV,:].reshape(value_dim,H); z=Wq[:,2*HK+group*HV:,:].reshape(value_dim,H)
    Wba=g(p+"in_proj_ba.weight").reshape(NKH,2*group,H); b=Wba[:,0:group,:].reshape(NVH,H); a=Wba[:,group:2*group,:].reshape(NVH,H)
    cw=g(p+"conv1d.weight").reshape(conv_dim,KW); sc=np.zeros((KW,conv_dim))
    for j in range(KW):
        for c in range(conv_dim): sc[j,c]=cw[c,j]
    return {"attn_qkv":f(np.concatenate([q,k,v],0)),"attn_gate":f(z),"ssm_alpha":f(a),"ssm_beta":f(b),
            "ssm_a":f(g(p+"A_log")),"ssm_dt":f(g(p+"dt_bias")),"ssm_conv1d":f(sc),"ssm_norm":f(g(p+"norm.weight")),"ssm_out":f(g(p+"out_proj.weight"))}

layers=[]
for L in range(4):
    lp=f"model.layers.{L}."
    W={"attn_norm":f(g(lp+"input_layernorm.weight")),"post_attention_norm":f(g(lp+"post_attention_layernorm.weight")),
       "ffn_gate":f(g(lp+"mlp.gate_proj.weight")),"ffn_up":f(g(lp+"mlp.up_proj.weight")),"ffn_down":f(g(lp+"mlp.down_proj.weight"))}
    if cfg.layer_types[L]=="linear_attention": W.update(linear_W(lp+"linear_attn."))
    else: W.update({"attn_q":f(g(lp+"self_attn.q_proj.weight")),"attn_k":f(g(lp+"self_attn.k_proj.weight")),
                    "attn_v":f(g(lp+"self_attn.v_proj.weight")),"attn_output":f(g(lp+"self_attn.o_proj.weight")),
                    "attn_q_norm":f(g(lp+"self_attn.q_norm.weight")),"attn_k_norm":f(g(lp+"self_attn.k_norm.weight"))})
    layers.append({"type":"attn" if cfg.layer_types[L]=="full_attention" else "linear","W":W})

D={"d_model":H,"ffn":FF,"n_layer":4,"vocab":V,"eps":1e-6,"rope_dim":HD,
   "head_k":HK,"head_v":HV,"num_k_heads":NKH,"num_v_heads":NVH,"key_dim":key_dim,"value_dim":value_dim,"conv_dim":conv_dim,"conv_k":KW,
   "n_head":NH,"n_kv":NKV,"head_dim":HD,"interval":4}
out={"D":D,"ids":ids[0].tolist(),"logits":[f(logits[t]) for t in range(T)],
     "cos":[f(cos[t]) for t in range(T)],"sin":[f(sin[t]) for t in range(T)],
     "token_embd":f(g("model.embed_tokens.weight")),"output_norm":f(g("model.norm.weight")),"lm_head":f(g("lm_head.weight")),
     "layers":layers}
p=os.path.join(os.path.dirname(__file__),"parity-model.json"); json.dump(out,open(p,"w"))
print("wrote",p,"| logits[0][:5]",np.round(logits[0][:5],4).tolist(),"| argmax/token",[int(logits[t].argmax()) for t in range(T)])
