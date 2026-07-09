# Generate a ground-truth reference for ONE qwen3-next gated-DeltaNet layer (HF), with weights mapped to the
# GGUF / gguf-forge-qwen35 layout, so the JS layer can be checked numerically. Tiny config (no 9B load).
import json, os, numpy as np, torch, torch.nn.functional as F
torch.manual_seed(0); torch.use_deterministic_algorithms(True, warn_only=True)
from transformers.models.qwen3_next.configuration_qwen3_next import Qwen3NextConfig
from transformers.models.qwen3_next.modeling_qwen3_next import Qwen3NextGatedDeltaNet

H=64; NVH=4; NKH=2; HK=16; HV=16; KW=4; T=6
cfg=Qwen3NextConfig(hidden_size=H, linear_num_value_heads=NVH, linear_num_key_heads=NKH,
                    linear_key_head_dim=HK, linear_value_head_dim=HV, linear_conv_kernel_dim=KW,
                    rms_norm_eps=1e-6, hidden_act="silu")
layer=Qwen3NextGatedDeltaNet(cfg, layer_idx=0).eval().float()
key_dim=HK*NKH; value_dim=HV*NVH; conv_dim=2*key_dim+value_dim; group=NVH//NKH

x=torch.randn(1,T,H)
with torch.no_grad():
    y=layer(x.float())                      # cache_params=None -> torch prefill (chunk) path
y=y[0].numpy()

sd={k:v.detach().numpy() for k,v in layer.state_dict().items()}
def f(a): return np.asarray(a,dtype=np.float64).ravel().tolist()

# split in_proj_qkvz weight rows (fix_query_key_value_ordering on the OUTPUT dim) -> contiguous [q|k|v] + z
Wqkvz=sd["in_proj_qkvz.weight"].reshape(NKH, 2*HK+2*group*HV, H)
q_w=Wqkvz[:,0:HK,:].reshape(key_dim,H)
k_w=Wqkvz[:,HK:2*HK,:].reshape(key_dim,H)
v_w=Wqkvz[:,2*HK:2*HK+group*HV,:].reshape(value_dim,H)
z_w=Wqkvz[:,2*HK+group*HV:,:].reshape(value_dim,H)
attn_qkv=np.concatenate([q_w,k_w,v_w],axis=0)        # [conv_dim, H]
Wba=sd["in_proj_ba.weight"].reshape(NKH, 2*group, H)
b_w=Wba[:,0:group,:].reshape(NVH,H)
a_w=Wba[:,group:2*group,:].reshape(NVH,H)
conv_w=sd["conv1d.weight"].reshape(conv_dim,KW)       # depthwise [C, K]
ssm_conv1d=np.zeros((KW,conv_dim))
for j in range(KW):
    for c in range(conv_dim): ssm_conv1d[j,c]=conv_w[c,j]

out={"dims":{"d_model":H,"value_dim":value_dim,"head_k":HK,"head_v":HV,"num_k_heads":NKH,"num_v_heads":NVH,
             "key_dim":key_dim,"conv_dim":conv_dim,"conv_k":KW,"eps":1e-6,"n_layer":1,"interval":4},
     "x":[f(x[0,t]) for t in range(T)], "y":[f(y[t]) for t in range(T)],
     "W":{"attn_qkv":f(attn_qkv),"attn_gate":f(z_w),"ssm_alpha":f(a_w),"ssm_beta":f(b_w),
          "ssm_a":f(sd["A_log"]),"ssm_dt":f(sd["dt_bias"]),"ssm_conv1d":f(ssm_conv1d),
          "ssm_norm":f(sd["norm.weight"]),"ssm_out":f(sd["out_proj.weight"]),"attn_norm":f(np.ones(H))}}
p=os.path.join(os.path.dirname(__file__),"parity-ref.json")
json.dump(out,open(p,"w"))
print("wrote",p); print("y[0][:5]",np.round(y[0][:5],5).tolist()); print("|y|max",float(np.abs(y).max()))
print("state_dict keys:",list(sd.keys()))
