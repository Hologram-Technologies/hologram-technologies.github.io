// Oracle expected outputs for the 4 element-wise/norm WGSL kernels.
import { writeFileSync } from "node:fs";
import { rmsNorm, ropeNeox, softmax, swiglu } from "../gguf-forge-kernels.mjs";

function prng(s) { s >>>= 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const r = prng(0xABCDEF);
const rand = (n, amp = 1) => Float32Array.from({ length: n }, () => r() * amp);

const D = 256, HD = 64, NROT = 64, NS = 64, F = 128, EPS = 1e-6, POS = 7, FREQ = 1000000, SCALE = 0.125;

const rmsX = rand(D, 4), rmsW = rand(D, 1).map((x) => Math.abs(x) + 0.3);
const ropeX = rand(HD, 3);
const sm = rand(NS, 6);
const swG = rand(F, 2), swU = rand(F, 2);

const data = {
  rmsnorm: { x: [...rmsX], w: [...rmsW], eps: EPS, expected: [...rmsNorm(rmsX, rmsW, EPS)] },
  rope:    { x: [...ropeX], pos: POS, nRot: NROT, freqBase: FREQ, expected: [...ropeNeox(ropeX, POS, NROT, FREQ)] },
  softmax: { s: [...sm], scale: SCALE, expected: [...softmax(sm, SCALE)] },
  swiglu:  { g: [...swG], u: [...swU], expected: [...swiglu(swG, swU)] },
};
writeFileSync(new URL("./_kerneldata.json", import.meta.url), JSON.stringify(data));
console.log("wrote _kerneldata.json:", Object.keys(data).join(", "));
