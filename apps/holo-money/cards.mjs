// Holo Money — virtual card engine.
// A card IS a κ-object: { v, kind:"card", chain, address, label, edition, holder, created }
// κ = SHA-256(canonical fields). The card FACE is generative art derived
// deterministically from κ — same κ, same face, on any device (Law L5).
// Faces render on 2D canvas (works everywhere, including the headless gate).

export const CARD_VERSION = 1;

export const EDITIONS = {
  standard:  { name: "Standard",  tag: "matte black",        locked: false },
  volt:      { name: "Volt",      tag: "electric streaks",   locked: false },
  fiber:     { name: "Fiber",     tag: "woven copper",       locked: false },
  sovereign: { name: "Sovereign", tag: "TEE holders only",   locked: true  },
};

const CANON_KEYS = ["v", "kind", "chain", "address", "label", "edition", "holder", "created"];

function canon(card) {
  return JSON.stringify(CANON_KEYS.map((k) => card[k] ?? null));
}

export async function sha256hex(str) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function mintCard({ chain = "ethereum", address = "", label = "Card", edition = "standard", holder = "" } = {}) {
  const card = { v: CARD_VERSION, kind: "card", chain, address, label, edition, holder, created: Date.now(), frozen: false };
  card.kappa = await sha256hex(canon(card));
  return card;
}

export async function verifyCard(card) {
  return card && card.kappa === (await sha256hex(canon(card)));
}

/* ── deterministic PRNG seeded from κ ─────────────────────────────── */
function rngFrom(kappaHex) {
  let a = parseInt(kappaHex.slice(0, 8), 16) >>> 0;
  let b = parseInt(kappaHex.slice(8, 16), 16) >>> 0;
  let c = parseInt(kappaHex.slice(16, 24), 16) >>> 0;
  let d = parseInt(kappaHex.slice(24, 32), 16) >>> 0;
  return () => { // sfc32
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return (t >>> 0) / 4294967296;
  };
}

/* ── face painters (one per edition) ──────────────────────────────── */
// ISO/IEC 7810 ID-1 ratio 1.586; render at 2× for crisp text.
export const FACE_W = 856, FACE_H = 540;

function matteBase(ctx, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, FACE_W * 0.35, FACE_H);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FACE_W, FACE_H);
}

function grain(ctx, rnd, n, alpha) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(255,255,255,${rnd() * alpha})`;
    ctx.fillRect(rnd() * FACE_W, rnd() * FACE_H, 1, 1);
  }
  ctx.restore();
}

function paintStandard(ctx, rnd) {
  matteBase(ctx, "#101114", "#050506");
  // faint diagonal specular band, position seeded by κ
  const x = FACE_W * (0.2 + rnd() * 0.6);
  const g = ctx.createLinearGradient(x - 180, 0, x + 180, FACE_H);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.5, "rgba(255,255,255,0.045)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, FACE_W, FACE_H);
  grain(ctx, rnd, 900, 0.05);
}

function paintVolt(ctx, rnd) {
  matteBase(ctx, "#04070f", "#010208");
  // long-exposure light streaks — additive glowing beziers
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const hueBase = 205 + rnd() * 40;
  for (let i = 0; i < 42; i++) {
    const y0 = FACE_H * rnd(), y1 = FACE_H * rnd();
    const cx1 = FACE_W * rnd(), cx2 = FACE_W * rnd();
    const hue = hueBase + (rnd() - 0.5) * 50;
    ctx.strokeStyle = `hsla(${hue}, 100%, ${55 + rnd() * 25}%, ${0.03 + rnd() * 0.10})`;
    ctx.lineWidth = 0.5 + rnd() * 3.2;
    ctx.beginPath();
    ctx.moveTo(-40, y0);
    ctx.bezierCurveTo(cx1, y0 + (rnd() - 0.5) * 260, cx2, y1 + (rnd() - 0.5) * 260, FACE_W + 40, y1);
    ctx.stroke();
  }
  ctx.restore();
  grain(ctx, rnd, 500, 0.04);
}

function paintFiber(ctx, rnd) {
  // woven copper macro — the Revolut "SIX FIVE FOUR" vibe, in warm strands
  matteBase(ctx, "#12080a", "#070304");
  ctx.save();
  const sweep = FACE_W * (0.3 + rnd() * 0.4); // bright sweep origin
  for (let y = -4; y < FACE_H + 4; y += 2) {
    const near = Math.exp(-Math.abs(y - FACE_H * 0.45) / (FACE_H * 0.5));
    const warm = rnd();
    const l = 8 + warm * 30 + near * 22;
    ctx.strokeStyle = `hsla(${14 + rnd() * 26}, ${55 + rnd() * 35}%, ${l}%, ${0.5 + rnd() * 0.5})`;
    ctx.lineWidth = 1 + rnd() * 1.6;
    ctx.beginPath();
    const wob = (rnd() - 0.5) * 22;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(sweep * 0.5, y + wob, sweep, y - wob, FACE_W, y + (rnd() - 0.5) * 14);
    ctx.stroke();
  }
  // hot filament highlights
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 60; i++) {
    const y = FACE_H * rnd();
    ctx.strokeStyle = `hsla(${20 + rnd() * 25}, 100%, ${60 + rnd() * 25}%, ${0.10 + rnd() * 0.22})`;
    ctx.lineWidth = 0.6 + rnd();
    ctx.beginPath();
    const x0 = FACE_W * rnd() * 0.7;
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + FACE_W * (0.15 + rnd() * 0.5), y + (rnd() - 0.5) * 10);
    ctx.stroke();
  }
  ctx.restore();
}

function paintSovereign(ctx, rnd) {
  matteBase(ctx, "#0a0a12", "#040408");
  // iridescent oil-slick bands
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const phase = rnd() * Math.PI * 2;
  for (let i = 0; i < 26; i++) {
    const t = i / 26;
    const hue = (phase * 57 + t * 320 + rnd() * 30) % 360;
    const y = FACE_H * (t + (rnd() - 0.5) * 0.06);
    const g = ctx.createLinearGradient(0, y - 60, FACE_W, y + 60);
    g.addColorStop(0, `hsla(${hue},90%,60%,0)`);
    g.addColorStop(0.5, `hsla(${hue},90%,60%,${0.05 + rnd() * 0.06})`);
    g.addColorStop(1, `hsla(${(hue + 60) % 360},90%,60%,0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(FACE_W / 2, y, FACE_W * (0.55 + rnd() * 0.25), 46 + rnd() * 40, (rnd() - 0.5) * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  grain(ctx, rnd, 700, 0.05);
}

const PAINTERS = { standard: paintStandard, volt: paintVolt, fiber: paintFiber, sovereign: paintSovereign };

/* ── typography + chrome overlay ──────────────────────────────────── */
function overlay(ctx, card) {
  const pad = 52;
  ctx.save();
  // wordmark
  ctx.fillStyle = "rgba(255,255,255,0.94)";
  ctx.font = "600 44px ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText("Holo", pad, pad - 6);
  ctx.font = "300 44px ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("Money", pad + 106, pad - 6);
  // VIRTUAL tag
  ctx.font = "700 22px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.62)";
  const tag = "VIRTUAL";
  ctx.fillText(tag, FACE_W - pad - ctx.measureText(tag).width, pad + 4);
  // holder + label, bottom-left
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = "500 30px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(card.holder || "Operator", pad, FACE_H - pad - 34);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "400 24px ui-monospace, Consolas, monospace";
  const last4 = (card.address || card.kappa || "").slice(-4);
  ctx.fillText(`${card.label}  ··${last4}`, pad, FACE_H - pad);
  // H mark — two overlapping circles, branded (not Mastercard's palette)
  const cy = FACE_H - pad - 26, cx = FACE_W - pad - 34, r = 30;
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath(); ctx.arc(cx - 20, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.34)";
  ctx.beginPath(); ctx.arc(cx + 20, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(10,10,14,0.85)";
  ctx.font = "800 30px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("H", cx - 11, cy + 11);
  ctx.restore();
}

/* ── public: paint a card face onto a canvas ──────────────────────── */
export function renderFace(canvas, card) {
  canvas.width = FACE_W; canvas.height = FACE_H;
  const ctx = canvas.getContext("2d");
  const rnd = rngFrom(card.kappa || "deadbeefdeadbeefdeadbeefdeadbeef");
  (PAINTERS[card.edition] || paintStandard)(ctx, rnd);
  // vignette for depth
  const v = ctx.createRadialGradient(FACE_W / 2, FACE_H / 2, FACE_H * 0.4, FACE_W / 2, FACE_H / 2, FACE_W * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = v; ctx.fillRect(0, 0, FACE_W, FACE_H);
  overlay(ctx, card);
  return canvas;
}
