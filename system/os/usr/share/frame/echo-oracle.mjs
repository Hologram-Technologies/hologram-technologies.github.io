// echo-oracle.mjs — EMITTED by composing tqc-mtc's verified D(Z_6) modular tensor category
// (scratchpad/echo-oracle, `cargo run`). Do not hand-edit: it is an external oracle, pinned by
// `pin` (blake3 over its sorted seq=κ lines). echo-main.mjs re-derives every κ in JS and asserts
// it matches this file — the tqc-vv-style witness that the live page never drifts from TQC.
//
// Equivalence classes here are the Verlinde-verified fusion (n_ijk) of D(Z_6): visibly-different
// braids that fuse to the same charge (a,b) carry one κ = blake3("D(Z6)|a,b").
export const ORACLE = {
  "category": "D(Z6)",
  "n": 6,
  "encoding": "blake3 of \"D(Z6)|a,b\"",
  "witness": "verify_modular + verify_braiding + verify_verlinde green for n=6",
  "pin": "blake3:b6c4d06dfc59d00478542a9aede165e429e1e27dbdd869bf874690ce27cc417b",
  "generators": [
    { "name": "spin",   "charge": [1, 0] },
    { "name": "tint",   "charge": [0, 1] },
    { "name": "warp",   "charge": [1, 1] },
    { "name": "unspin", "charge": [5, 0] },
    { "name": "untint", "charge": [0, 5] }
  ],
  "braids": [
    { "seq": "",                            "charge": [0, 0], "kappa": "blake3:98a851a94acb3de96e484760f0a2f3d49c5b47df2e81a32b5e1ed0b1f958ec43" },
    { "seq": "spin+unspin",                 "charge": [0, 0], "kappa": "blake3:98a851a94acb3de96e484760f0a2f3d49c5b47df2e81a32b5e1ed0b1f958ec43" },
    { "seq": "spin+tint",                   "charge": [1, 1], "kappa": "blake3:15a7bbab9210bb7d53a0d59cd0ca18473226a1335aa14c0121c9f3ceff3cd387" },
    { "seq": "tint+spin",                   "charge": [1, 1], "kappa": "blake3:15a7bbab9210bb7d53a0d59cd0ca18473226a1335aa14c0121c9f3ceff3cd387" },
    { "seq": "warp",                        "charge": [1, 1], "kappa": "blake3:15a7bbab9210bb7d53a0d59cd0ca18473226a1335aa14c0121c9f3ceff3cd387" },
    { "seq": "spin+tint+unspin+spin",       "charge": [1, 1], "kappa": "blake3:15a7bbab9210bb7d53a0d59cd0ca18473226a1335aa14c0121c9f3ceff3cd387" },
    { "seq": "warp+warp+warp",              "charge": [3, 3], "kappa": "blake3:fa6b79c1665a222631cfa50fa6381a118124462331e950380f6ee34367823793" },
    { "seq": "spin+spin+spin+tint+tint+tint","charge": [3, 3], "kappa": "blake3:fa6b79c1665a222631cfa50fa6381a118124462331e950380f6ee34367823793" },
    { "seq": "tint+tint",                   "charge": [0, 2], "kappa": "blake3:296f1bfd751476884c5670a71131285a2f4b52fb2d32aee7dfc8c2884e0c778f" },
    { "seq": "spin+spin",                   "charge": [2, 0], "kappa": "blake3:4e54c4b18f76d52ed7bf0141c9b4a8942bd447d1376f661eaf13971786510ce6" }
  ]
};
export default ORACLE;
