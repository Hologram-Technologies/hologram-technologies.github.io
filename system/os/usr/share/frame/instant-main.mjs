// instant-main.mjs — Holo Instant, the "adjust" surface. Make a look once; it's instant forever.
//
// Two commuting cyclic color adjustments — Hue (axis a) and Tint (axis b), each a 30° step ∈ Z_12 —
// so different EDIT PATHS to the same look provably collapse to one κ (tqc-mtc D(Z_12) fusion). The
// render is a PURE function of the net look (a,b): equivalent paths produce byte-identical pixels.
// First time we render (honest, real per-pixel work); every equivalent look after is served from the
// durable κ-store INSTANTLY and PROVED byte-identical. No κ/MTC shown unless asked.

import { instant } from "/usr/lib/holo/holo-instant.mjs";
import { kappaBlake3 } from "/usr/lib/holo/holo-blake3.mjs";
import { ORACLE } from "./instant-oracle.mjs";

const N = ORACLE.n;
const TE = new TextEncoder();
const GEN = Object.fromEntries(ORACLE.generators.map((g) => [g.name, g.charge]));
const $ = (id) => document.getElementById(id);

// ── the math projection (faithful image of D(Z_12) fusion: abelian group law) ────────────────
function reduce(seq) {
  let a = 0, b = 0;
  for (const name of seq) { const g = GEN[name]; if (!g) continue; a = (a + g[0]) % N; b = (b + g[1]) % N; }
  return [a, b];
}
const classKeyOf = (a, b) => `${ORACLE.surface}:Z${N}|${a},${b}`;

// ── WITNESS: re-derive every oracle κ + the pin in JS; refuse to run on drift ─────────────────
function runWitness() {
  const split = (s) => (s === "" ? [] : s.split(" "));
  for (const r of ORACLE.sequences) {
    const [a, b] = reduce(split(r.seq));
    if (a !== r.charge[0] || b !== r.charge[1]) return { ok: false, why: `charge drift "${r.seq}"` };
    const k = kappaBlake3(TE.encode(classKeyOf(a, b)));
    if (k !== r.kappa) return { ok: false, why: `κ drift "${r.seq}"` };
  }
  const pin = kappaBlake3(TE.encode(ORACLE.sequences.map((r) => `${r.seq}=${r.kappa}`).sort().join("\n")));
  if (pin !== ORACLE.pin) return { ok: false, why: "pin mismatch vs TQC oracle" };
  return { ok: true, classes: new Set(ORACLE.sequences.map((r) => r.kappa)).size };
}

// ── the "heavy" render: a PURE function of the look (a,b). CPU per-pixel HSL work, so it is real
//    (measurable) AND realization-independent (identical bytes on every machine for the same look). ──
const S = 256;
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360; const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function renderLook(a, b) {
  const img = new ImageData(S, S), d = img.data;
  const tintH = (b * 30) % 360, [tr, tg, tb] = hsl2rgb(tintH, 0.85, 0.5), al = 0.32;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - S / 2, dy = y - S / 2, r = Math.hypot(dx, dy) / (S * 0.7);
      let H = (Math.atan2(dy, dx) * 180 / Math.PI + 360 + x * 0.7 + Math.sin(r * 6) * 20) % 360;
      const L = Math.max(0.12, Math.min(0.85, 0.6 - r * 0.3)), Sat = 0.72;
      H = (H + a * 30) % 360;
      let [R, G, B] = hsl2rgb(H, Sat, L);
      R = R * (1 - al) + tr * al; G = G * (1 - al) + tg * al; B = B * (1 - al) + tb * al;
      const i = (y * S + x) * 4; d[i] = R & 255; d[i + 1] = G & 255; d[i + 2] = B & 255; d[i + 3] = 255;
    }
  }
  return { img, bytes: new Uint8Array(d.buffer.slice(0)) };
}

// ── state ─────────────────────────────────────────────────────────────────────────────────────
let seq = [];
let saved = 0;
const seenLooks = new Map(); // classKappa -> {a,b}

const fmt = (k) => String(k).replace("blake3:", "").slice(0, 12) + "…";
function renderSeqChip() { $("seq").textContent = seq.length ? seq.join(" · ") : "(original)"; }

function paintLooks() {
  const ul = $("looks"); ul.innerHTML = "";
  if (!seenLooks.size) { ul.innerHTML = `<li class="muted">No looks yet — adjust and Apply.</li>`; return; }
  for (const [k, { a, b }] of seenLooks) {
    const li = document.createElement("li");
    li.title = "re-apply (instant)";
    li.innerHTML = `<span class="sw" style="background:hsl(${a * 30} 70% 55%)"></span><code>${fmt(k)}</code>`;
    li.addEventListener("click", () => { seq = []; pushCharge(a, b); apply(); });
    ul.appendChild(li);
  }
}
// rebuild a minimal sequence that lands on (a,b) so re-applying a look works
function pushCharge(a, b) { for (let i = 0; i < a; i++) seq.push("hue+"); for (let i = 0; i < b; i++) seq.push("bright+"); renderSeqChip(); }

async function apply() {
  const ctx = $("canvas").getContext("2d");
  const [a, b] = reduce(seq);
  const classKey = classKeyOf(a, b);

  const out = await instant(classKey, async () => renderLook(a, b).bytes);
  // paint the result bytes onto the visible canvas
  ctx.putImageData(new ImageData(new Uint8ClampedArray(out.bytes), S, S), 0, 0);

  seenLooks.set(out.classKappa, { a, b });
  if (out.hit) {
    saved += 1; // (we count instant hits; per-render ms shown live below)
    $("status").innerHTML = `⚡ <b>Instant</b> — you've made this look before`;
    $("proof").innerHTML = out.verified
      ? `<b>Verified identical.</b> served from your library in <b>${out.ms.toFixed(0)} ms</b> · κ <code>${fmt(out.classKappa)}</code>`
      : `<b style="color:#f87171">verification failed</b> (should never happen)`;
    narrate("You've made this look before. Instant.");
  } else {
    $("status").innerHTML = `Rendered in <b>${out.ms.toFixed(0)} ms</b> · saved to your library`;
    $("proof").innerHTML = `Any equivalent edit path to this look is now instant · κ <code>${fmt(out.classKappa)}</code>`;
  }
  $("savedn").textContent = saved ? `${saved} instant hit${saved > 1 ? "s" : ""}` : "";
  paintLooks();
}

function narrate(line) { try { if (window.HoloVoice?.say) window.HoloVoice.say(line); } catch {} }

function share() {
  const [a, b] = reduce(seq);
  const link = `${location.origin}/instant.html#look=${a},${b}`;
  try { navigator.clipboard?.writeText(link); $("status").textContent = "Look link copied — it re-derives the same look anywhere."; } catch { $("status").textContent = link; }
  try { window.HoloNotify?.toast("Look link copied"); } catch {}
}
function loadHash() {
  const m = /#look=(\d+),(\d+)/.exec(location.hash || ""); if (!m) return;
  seq = []; pushCharge(+m[1] % N, +m[2] % N); apply();
}

function boot() {
  const w = runWitness(), badge = $("witness");
  if (w.ok) { badge.textContent = `✓ verified against TQC oracle · ${w.classes} looks · pin ${fmt(ORACLE.pin)}`; badge.classList.add("ok"); }
  else { badge.textContent = `✗ drift: ${w.why}`; badge.classList.add("bad"); $("apply").disabled = true; }

  document.querySelectorAll("[data-gen]").forEach((b) => b.addEventListener("click", () => { seq.push(b.dataset.gen); renderSeqChip(); }));
  $("apply").addEventListener("click", apply);
  $("clear").addEventListener("click", () => { seq = []; renderSeqChip(); });
  $("share").addEventListener("click", share);

  renderSeqChip(); paintLooks();
  // paint the original look on first frame so the canvas is never empty
  const ctx = $("canvas").getContext("2d");
  ctx.putImageData(renderLook(0, 0).img, 0, 0);
  loadHash();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
