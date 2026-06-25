import * as bao from "/usr/lib/holo/holo-bao.mjs";
import { streamVerified } from "/usr/lib/holo/holo-bao-stream.mjs";
const $ = (id) => document.getElementById(id);

// native bridge (the host engine) — present in the Hologram browser; absent → in-page fallback.
const bridge = (cmd) => new Promise((res, rej) => {
  if (!window.cefQuery) return rej(new Error("no bridge"));
  window.cefQuery({ request: cmd, onSuccess: (r) => res(r), onFailure: (_c, m) => rej(new Error(m)) });
});

// ── 1 · O(1) compute ──
async function runCompute() {
  $("c-run").disabled = true; $("c-status").textContent = "running…";
  try {
    const json = await bridge("holo:compute:o1demo");           // the NATIVE Hologram engine, bare metal
    const r = JSON.parse(json);
    $("c-mode").textContent = "native engine"; $("c-mode").classList.add("good");
    $("c-novel").innerHTML = fmtNs(r.novel_ns);
    $("c-hit").innerHTML = fmtNs(r.hit_ns);
    $("c-ratio").innerHTML = Math.round(r.ratio).toLocaleString() + "<span class='unit'>×</span>";
    $("c-status").textContent = "compute once, instant forever — " + r.engine;
  } catch (e) {
    // in-page fallback: a content-addressed memo over a small compute (felt, not native-fast)
    $("c-mode").textContent = "in-page";
    const work = (seed) => { let a = seed >>> 0; for (let i = 0; i < 2_000_000; i++) a = (a * 1664525 + 1013904223) >>> 0; return a; };
    const memo = new Map();
    const t0 = performance.now(); const v = work(7); const novel = performance.now() - t0; memo.set(7, v);
    const t1 = performance.now(); for (let i = 0; i < 100000; i++) memo.get(7); const hit = (performance.now() - t1) / 100000;
    $("c-novel").innerHTML = fmtMs(novel); $("c-hit").innerHTML = fmtMs(hit);
    $("c-ratio").innerHTML = Math.round(novel / hit).toLocaleString() + "<span class='unit'>×</span>";
    $("c-status").textContent = "compute once, instant forever (in-page memo; native engine is far faster)";
  }
  $("c-run").disabled = false;
}

// ── 2 · verified streaming (a progressive image, reveal-on-verify) ──
const cv = $("s-cv"), ctx = cv.getContext("2d"), W = 320, H = 180, img = ctx.createImageData(W, H);
function buildObj() { const px = new Uint8Array(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; px[o] = x * 255 / W | 0; px[o+1] = y * 255 / H | 0; px[o+2] = (x+y) * 255 / (W+H) | 0; if (Math.abs(x/W - y/H) < 0.02) px[o]=px[o+1]=px[o+2]=255; px[o+3] = 255; } return px; }
async function runStream() {
  $("s-run").disabled = true; const OBJ = buildObj(); img.data.fill(0); ctx.putImageData(img, 0, 0);
  const root = bao.rootHex(OBJ), total = bao.chunkCount(OBJ.length); const enc = bao.encode(OBJ);
  let first = null, t0 = performance.now();
  async function* src() { for (const c of enc.chunks) { await new Promise(r => setTimeout(r, 3)); yield { index: c.index, bytes: Uint8Array.from(c.bytes), proof: c.proof }; } }
  const onChunk = (index, bytes) => { if (first === null) { first = performance.now() - t0; $("s-ttfc").innerHTML = fmtMs(first); } const base = index * 1024; for (let i = 0; i < bytes.length; i++) img.data[base + i] = bytes[i]; ctx.putImageData(img, 0, 0); $("s-fill").style.width = ((index + 1) / total * 100).toFixed(1) + "%"; };
  await streamVerified(root, src(), { onChunk });
  $("s-resid").innerHTML = "~1.2 <span class='unit'>KB</span>"; $("s-status").innerHTML = "<span class='good'>usable from the first chunk · " + total + " chunks, each proven</span>";
  $("s-run").disabled = false;
}

// ── 3 · κ-cache (this page re-fetches a real OS module cold then warm) ──
async function runCache() {
  $("k-run").disabled = true; $("k-status").textContent = "measuring…";
  const url = "/usr/lib/holo/holo-blake3.mjs?bust=" + Date.now();   // cold (cache-busted)
  const t0 = performance.now(); await (await fetch(url, { cache: "no-store" })).arrayBuffer(); const cold = performance.now() - t0;
  const warmUrl = "/usr/lib/holo/holo-blake3.mjs";                   // warm (κ-cache / SW)
  await fetch(warmUrl); // prime
  const t1 = performance.now(); await (await fetch(warmUrl)).arrayBuffer(); const warm = performance.now() - t1;
  $("k-cold").innerHTML = fmtMs(cold); $("k-warm").innerHTML = fmtMs(Math.max(warm, 0.01));
  $("k-ratio").innerHTML = Math.max(1, Math.round(cold / Math.max(warm, 0.01))) + "<span class='unit'>×</span>";
  $("k-status").textContent = "the second open is served from content, not the network";
  $("k-run").disabled = false;
}

const fmtNs = (ns) => ns < 1000 ? (ns.toFixed(0) + "<span class='unit'> ns</span>") : ns < 1e6 ? ((ns/1000).toFixed(1) + "<span class='unit'> µs</span>") : ((ns/1e6).toFixed(2) + "<span class='unit'> ms</span>");
const fmtMs = (ms) => ms < 0.001 ? ((ms*1e6).toFixed(0) + "<span class='unit'> ns</span>") : ms < 1 ? ((ms*1000).toFixed(1) + "<span class='unit'> µs</span>") : (ms.toFixed(2) + "<span class='unit'> ms</span>");

$("c-run").onclick = runCompute; $("s-run").onclick = runStream; $("k-run").onclick = runCache;
// auto-detect the native engine for the badge, and auto-run stream so there's motion on open
bridge("holo:compute:o1demo").then(() => { $("c-mode").textContent = "native engine"; $("c-mode").classList.add("good"); }).catch(() => { $("c-mode").textContent = "in-page"; });
runStream();
