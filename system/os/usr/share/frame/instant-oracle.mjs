// instant-oracle.mjs — EMITTED by composing tqc-mtc's verified D(Z_12) fusion
// (scratchpad/instant-oracle, `cargo run`). Surface "adjust": commuting image edits (hue 30°-steps
// ∈ Z_12, brightness ∈ Z_12) — different edit PATHS to the same look fuse to one charge (a,b) and
// carry one κ = blake3("adjust:Z12|a,b"). instant-main.mjs re-derives every κ in JS and refuses to
// run on drift (the tqc-vv-style witness). Do not hand-edit; it is a sha-pinned external oracle.
export const ORACLE = {
  "surface": "adjust",
  "category": "D(Z12)",
  "n": 12,
  "encoding": "blake3 of \"adjust:Z12|a,b\"",
  "witness": "verify_modular + verify_braiding + verify_verlinde green for n=12",
  "pin": "blake3:95153ea7ba49f6db5748c22bf273230356a34446c8cdb40d810a4c243504ce09",
  "generators": [
    { "name": "hue+",    "charge": [1, 0] },
    { "name": "hue-",    "charge": [11, 0] },
    { "name": "bright+", "charge": [0, 1] },
    { "name": "bright-", "charge": [0, 11] },
    { "name": "warm",    "charge": [1, 1] }
  ],
  "sequences": [
    { "seq": "",                          "charge": [0, 0], "kappa": "blake3:8777314ad3f93fbdda2729f46601d3b1fae5b591f1adba35dc99a628bebb5ac2" },
    { "seq": "hue+ hue-",                 "charge": [0, 0], "kappa": "blake3:8777314ad3f93fbdda2729f46601d3b1fae5b591f1adba35dc99a628bebb5ac2" },
    { "seq": "hue+ bright+",              "charge": [1, 1], "kappa": "blake3:624195ab2cf2bb7811fcd235b56fd69ffd4a9b07fad973b0ed33a9f848bafa5e" },
    { "seq": "bright+ hue+",              "charge": [1, 1], "kappa": "blake3:624195ab2cf2bb7811fcd235b56fd69ffd4a9b07fad973b0ed33a9f848bafa5e" },
    { "seq": "warm",                      "charge": [1, 1], "kappa": "blake3:624195ab2cf2bb7811fcd235b56fd69ffd4a9b07fad973b0ed33a9f848bafa5e" },
    { "seq": "hue+ bright+ hue- hue+",    "charge": [1, 1], "kappa": "blake3:624195ab2cf2bb7811fcd235b56fd69ffd4a9b07fad973b0ed33a9f848bafa5e" },
    { "seq": "warm warm",                 "charge": [2, 2], "kappa": "blake3:d49f9346bd59051accc20b4d887ed5e7de2c0f66ee2d246f9878ed5ac799e363" },
    { "seq": "hue+ bright+ hue+ bright+", "charge": [2, 2], "kappa": "blake3:d49f9346bd59051accc20b4d887ed5e7de2c0f66ee2d246f9878ed5ac799e363" },
    { "seq": "hue+ hue+",                 "charge": [2, 0], "kappa": "blake3:3284c224929e88a9356bb3bd7fef512f67cf9ba63ad52478619cebf4ee96167a" },
    { "seq": "bright+ bright+ bright+",   "charge": [0, 3], "kappa": "blake3:9739112bce664949a6b80600cfdae2828eaf683009a674135087e7bcfafaf352" }
  ]
};
export default ORACLE;
