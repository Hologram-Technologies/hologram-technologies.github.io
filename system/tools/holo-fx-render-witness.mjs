#!/usr/bin/env node
// holo-fx-render-witness.mjs — proves the Holo FX engine (the faithful unicode-animations adoption)
// actually renders + animates in a real browser, and honours prefers-reduced-motion. Loads find.html
// (which loads holo-fx.js), checks the engine surface, drives the `scan` search loader, and samples
// the glyph over time to confirm motion (and a static frame under reduced motion).
//
//   node tools/holo-fx-render-witness.mjs        (needs the FHS serve on :8300)

import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const ORIG = "C:/Users/pavel/Desktop/hologram-os";
const { chromium } = createRequire(pathToFileURL(join(ORIG, "package.json")))("playwright");
const BASE = "http://127.0.0.1:8300";
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, ok: !!pass, detail }); console.log(`  ${pass ? "✓" : "✗"}  ${name}${detail ? " — " + detail : ""}`); };

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  // ── 1) engine surface: all 18 spinners + utilities, from the served bytes ──────────────
  const page = await browser.newPage();
  await page.goto(`${BASE}/find.html`, { waitUntil: "load" });
  await page.waitForFunction(() => !!window.HoloFX, { timeout: 5000 });
  const surface = await page.evaluate(() => {
    const fx = window.HoloFX;
    const names = Object.keys(fx.spinners);
    return {
      count: names.length,
      hasInstrument: ["braille", "scan", "dna", "cascade"].every((n) => fx.spinners[n] && Array.isArray(fx.spinners[n].frames)),
      scanInterval: fx.spinners.scan.interval,
      emptyBraille: fx.gridToBraille(fx.makeGrid(4, 2)),
      hasLoader: typeof fx.loader === "function",
    };
  });
  ok("engine exposes all 18 spinners", surface.count === 18, `${surface.count} names`);
  ok("Instrument vocabulary present (braille·scan·dna·cascade)", surface.hasInstrument);
  ok("gridToBraille(makeGrid(4,2)) === ⠀", surface.emptyBraille === "⠀", JSON.stringify(surface.emptyBraille));
  ok("scan interval = 70ms (faithful to spec)", surface.scanInterval === 70, `${surface.scanInterval}ms`);
  ok("HoloFX.loader helper present", surface.hasLoader);

  // ── 2) the search `scan` loader renders + ANIMATES ─────────────────────────────────────
  await page.fill("#q", "marie curie");
  await page.click("#go");
  await page.waitForSelector("#out .hfx-load .hfx-s", { timeout: 4000 });
  const sample = async () => page.$eval("#out .hfx-load .hfx-s", (e) => e.textContent);
  const frames = new Set();
  for (let i = 0; i < 10; i++) { frames.add(await sample()); await page.waitForTimeout(60); }
  ok("scan loader renders a braille glyph", [...frames].some((f) => /[⠀-⣿]/.test(f)), `glyphs: ${[...frames].join("")}`);
  ok("scan loader ANIMATES (frames change)", frames.size >= 3, `${frames.size} distinct frames`);
  await page.screenshot({ path: join(ORIG, "..", "Hologram OS2", "system", "tools", "holo-fx-render-witness.png") }).catch(() => {});

  // ── 3) prefers-reduced-motion → a STATIC settled frame, no timer ───────────────────────
  const rm = await browser.newContext({ reducedMotion: "reduce" });
  const rp = await rm.newPage();
  await rp.goto(`${BASE}/find.html`, { waitUntil: "load" });
  await rp.waitForFunction(() => !!window.HoloFX, { timeout: 5000 });
  await rp.fill("#q", "london");
  await rp.click("#go");
  await rp.waitForSelector("#out .hfx-load .hfx-s", { timeout: 4000 });
  const rmFrames = new Set();
  for (let i = 0; i < 8; i++) { rmFrames.add(await rp.$eval("#out .hfx-load .hfx-s", (e) => e.textContent)); await rp.waitForTimeout(70); }
  ok("reduced-motion shows a single static frame (no timer)", rmFrames.size === 1, `${rmFrames.size} frame(s): ${[...rmFrames].join("")}`);
  await rm.close();

  // ── 4) κ as streaming braille: faithful, auto-detected, animates, hover reveals ─────────
  const K = "did:holo:sha256:3ff288d0c06a0fd22da898301cb6c8c11fc62e3b2b7ab58a53c7cb0cb385f00c";
  const faithful = await page.evaluate((k) => {
    const fx = window.HoloFX;
    const hex = k.split(":").pop();
    const b = fx.hexToBraille(hex);
    // each braille cell must equal 0x2800 | the matching byte
    let ok = b.length === hex.length / 2;
    for (let i = 0; i < b.length; i++) if (b.codePointAt(i) - 0x2800 !== parseInt(hex.substr(i * 2, 2), 16)) ok = false;
    return { ok, len: b.length, first: "0x" + b.codePointAt(0).toString(16) };
  }, K);
  ok("hash→braille is faithful (cell = U+2800 | byte)", faithful.ok, `${faithful.len} cells, first ${faithful.first}`);

  // inject a digest in arbitrary text → the observer must auto-upgrade it
  await page.evaluate((k) => { const d = document.createElement("div"); d.id = "ktest"; d.textContent = "verified " + k + " ok"; document.body.appendChild(d); }, K);
  await page.waitForSelector("#ktest .holo-k", { timeout: 3000 });
  const isBraille = await page.$eval("#ktest .holo-k", (e) => /^[⠀-⣿]+$/.test(e.textContent));
  ok("auto-scan upgrades a did:holo digest in text", isBraille);

  const kFrames = new Set();
  for (let i = 0; i < 10; i++) { kFrames.add(await page.$eval("#ktest .holo-k", (e) => e.textContent)); await page.waitForTimeout(60); }
  ok("κ braille STREAMS (frames change)", kFrames.size >= 3, `${kFrames.size} distinct frames`);

  // hover → freeze + reveal the hash underneath (synthetic mouseenter: the element animates, so a
  // real Playwright hover is "unstable" — a user hovers fine; this just side-steps the stability gate)
  await page.$eval("#ktest .holo-k", (e) => e.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })));
  await page.waitForTimeout(120);
  const revealed = await page.$eval("#ktest .holo-k", (e) => e.textContent);
  ok("hover reveals the hash underneath", revealed.includes("did:holo:sha256:"), revealed.slice(0, 28) + "…");
  // a copy button appears on reveal, to the right of the hash
  const hasCopy = await page.$("#ktest .holo-k .holo-k-copy");
  ok("hover shows a copy button beside the hash", !!hasCopy);
  await page.screenshot({ path: join(ORIG, "..", "Hologram OS2", "system", "tools", "holo-fx-kappa-witness.png") }).catch(() => {});

  // one click copies the FULL κ to the clipboard + confirms with a check
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => {});
  await page.$eval("#ktest .holo-k .holo-k-copy", (b) => b.click());
  await page.waitForTimeout(150);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => "")).catch(() => "");
  ok("clicking copy puts the FULL κ on the clipboard", clip === K, clip.slice(0, 24) + "…");
  const confirmed = await page.$eval("#ktest .holo-k .holo-k-copy", (b) => b.classList.contains("copied"));
  ok("copy confirms with a check state", confirmed);

  await page.evaluate(() => document.querySelector("#ktest .holo-k").dispatchEvent(new MouseEvent("mouseleave")));
  await page.waitForTimeout(120);
  const resumed = await page.$eval("#ktest .holo-k", (e) => /^[⠀-⣿]+$/.test(e.textContent) && !e.querySelector(".holo-k-copy"));
  ok("leaving resumes the stream + removes the button", resumed);

  // ── 5) wallet / chain addresses + did:key auto-recognized + faithfully byte-derived ────
  const ADDR = {
    "EVM 0x address (20 bytes)": ["0x52908400098527886E0F7030069857D2E4169EE7", 20],
    "did:key ed25519 (34 bytes)": ["did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", 34],
    "BTC bech32 (20-byte program)": ["bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4", 20],
  };
  let ai = 0;
  for (const [label, [addr, want]] of Object.entries(ADDR)) {
    const id = "atest" + ai++;
    await page.evaluate(([a, i]) => { const d = document.createElement("div"); d.id = i; d.textContent = "owner " + a + " ✓"; document.body.appendChild(d); }, [addr, id]);
    const upgraded = await page.waitForSelector(`#${id} .holo-k`, { timeout: 3000 }).then(() => true).catch(() => false);
    const cells = upgraded ? await page.$eval(`#${id} .holo-k`, (e) => e.textContent.length) : -1;
    ok(`auto-detects ${label} → faithful braille`, upgraded && cells === want, `${cells} cells (want ${want})`);
    if (upgraded) {
      await page.$eval(`#${id} .holo-k`, (e) => e.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true })));
      await page.waitForTimeout(40);
      const rev = await page.$eval(`#${id} .holo-k`, (e) => e.textContent);
      ok(`  ${label} hover reveals + copy the full address`, rev.includes(addr) && !!(await page.$(`#${id} .holo-k-copy`)), rev.slice(0, 14) + "…");
    }
  }

  // ── 6) live micro-display: meter / graph faithful, scope animates, audioScope reads sound ──
  const prim = await page.evaluate(() => {
    const fx = window.HoloFX, all = (s, ch) => [...s].every((c) => c === ch);
    return {
      empty: all(fx.meter(0, 6), "⠀"), full: all(fx.meter(1, 6), "⣿"),
      half: fx.meter(0.5, 6) === "⣿⣿⣿⠀⠀⠀",
      ramp: fx.graph([0, 1, 2, 3, 4, 5, 6, 7], { width: 4 }) === "⣀⠤⠒⠉",
    };
  });
  ok("meter(v) is a faithful braille level bar (0·½·1)", prim.empty && prim.half && prim.full);
  ok("graph() plots a faithful braille sparkline", prim.ramp, "rising ramp → ⣀⠤⠒⠉");

  // scope(): a live sine → a streaming braille waveform that changes frame to frame
  await page.evaluate(() => {
    const el = document.createElement("div"); el.id = "scopetest"; document.body.appendChild(el);
    let t = 0; window.__scope = window.HoloFX.scope(el, () => Math.sin((t++) / 3), { kind: "wave", width: 12, fps: 30 });
  });
  const sFrames = new Set();
  for (let i = 0; i < 10; i++) { sFrames.add(await page.$eval("#scopetest", (e) => e.textContent)); await page.waitForTimeout(50); }
  ok("scope() renders a LIVE braille waveform", sFrames.size >= 3 && [...sFrames].some((f) => /[⠀-⣿]/.test(f)), `${sFrames.size} frames`);
  await page.evaluate(() => window.__scope && window.__scope.stop());

  // audioScope(): a real oscillator → an <audio> element → analyser → braille spectrum that moves
  const audioRes = await page.evaluate(async () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = 220;
      const dest = ctx.createMediaStreamDestination(); osc.connect(dest); osc.start();
      const audio = document.createElement("audio"); audio.srcObject = dest.stream; audio.muted = true; document.body.appendChild(audio);
      await audio.play().catch(() => {});
      const el = document.createElement("div"); el.id = "eqtest"; document.body.appendChild(el);
      const sc = window.HoloFX.audioScope(el, audio, { kind: "bars", width: 9 });
      const seen = new Set();
      await new Promise((r) => setTimeout(r, 700));
      for (let i = 0; i < 8; i++) { seen.add(el.textContent); await new Promise((r) => setTimeout(r, 60)); }
      sc.stop();
      const nonBlank = [...seen].some((s) => /[⠁-⣿]/.test(s));
      return { wired: typeof sc.stop === "function", width: (el.textContent || "").length, frames: seen.size, nonBlank };
    } catch (e) { return { err: String(e && e.message || e) }; }
  });
  ok("audioScope() wires an analyser without throwing", !!audioRes.wired, audioRes.err || `${audioRes.width}-cell readout`);
  ok("audioScope() turns real sound into a moving braille EQ", !!audioRes.nonBlank, `${audioRes.frames} frames, signal=${audioRes.nonBlank}`);

  // ── 7) Holo Q inference telemetry: real tokens/sec → a live braille pulse (the exact stats()
  //        render path from apps/q/ui/messages.js, driven by a realistic decode curve) ──────────
  await page.evaluate(() => {
    const m = document.createElement("div"); m.id = "qmeta"; m.className = "meta";
    m.innerHTML = `<span class="spin"></span><span class="tps" hidden><span class="bar" style="font-family:ui-monospace;color:#34e2b0;letter-spacing:1px"></span> <span class="n" style="color:#7a8;font-family:ui-monospace"></span></span>`;
    m.style.cssText = "font-size:20px;padding:16px;background:#0d1117;color:#e8e6f0"; document.body.appendChild(m);
    const tpsEl = m.querySelector(".tps"), bar = m.querySelector(".tps .bar"), n = m.querySelector(".tps .n"), hist = [];
    window.__qstats = (s) => {                         // verbatim logic from messages.js stats(s)
      const v = Math.max(0, (s && s.tokps) || 0); if (!v && !hist.length) return;
      hist.push(v); if (hist.length > 28) hist.shift(); tpsEl.hidden = false;
      if (window.HoloFX) bar.textContent = window.HoloFX.graph(hist, { width: 14, fill: true, min: 0 });
      n.textContent = v ? Math.round(v) + " tok/s" : "";
    };
  });
  const qbars = new Set(); let qnum = "";
  for (let i = 0; i < 24; i++) {                       // simulate a decode: ramp 6→48 tok/s with jitter
    const tokps = 6 + 42 * Math.min(1, i / 14) + (i % 3 === 0 ? 5 : -3);
    await page.evaluate((tokps) => window.__qstats({ tokps }), tokps);
    qbars.add(await page.$eval("#qmeta .tps .bar", (e) => e.textContent));
    if (i === 20) qnum = await page.$eval("#qmeta .tps .n", (e) => e.textContent);
    await page.waitForTimeout(25);
  }
  ok("Holo Q tokens/sec → a LIVE braille sparkline", qbars.size >= 3 && [...qbars].some((b) => /[⠁-⣿]/.test(b)), `${qbars.size} frames`);
  ok("Holo Q shows the numeric rate alongside", /^\d+ tok\/s$/.test(qnum), JSON.stringify(qnum));
  await page.screenshot({ path: join(ORIG, "..", "Hologram OS2", "system", "tools", "holo-fx-qtps.png"), clip: { x: 0, y: 0, width: 520, height: 120 } }).catch(() => {});

  // ── 8) Holo Code inference telemetry: the assistant-row tokens/sec pulse (verbatim _stats()
  //        render path from apps/code/holo-code-repl.js, driven by a decode curve) ──────────────
  await page.evaluate(() => {
    const m = document.createElement("div"); m.id = "ctest"; m.style.cssText = "padding:16px;background:#0d1117;color:#e8e6f0;font-family:ui-monospace";
    m.innerHTML = `<div class="role" style="display:flex;align-items:center;gap:.5rem;color:#d97757">holo q<span class="tps" style="display:inline-flex;align-items:center;gap:.4rem"><span class="bar" style="color:#d97757;letter-spacing:.5px"></span><span class="n" style="color:#8a8f98"></span></span></div>`;
    document.body.appendChild(m);
    const atps = m.querySelector(".tps"); let hist = [];
    window.__cstats = (tokps) => {                     // verbatim logic from holo-code-repl.js _stats(ev)
      const v = Math.max(0, tokps || 0); hist.push(v); if (hist.length > 24) hist.shift();
      const bar = window.HoloFX ? window.HoloFX.graph(hist, { width: 12, fill: true, min: 0 }) : "";
      atps.innerHTML = `<span class="bar" style="color:#d97757;letter-spacing:.5px">${bar}</span><span class="n" style="color:#8a8f98">${v ? Math.round(v) + " tok/s" : ""}</span>`;
    };
  });
  const cbars = new Set(); let cnum = "";
  for (let i = 0; i < 22; i++) { const tokps = 4 + 30 * Math.min(1, i / 12) + (i % 4 === 0 ? 4 : -2); await page.evaluate((t) => window.__cstats(t), tokps); cbars.add(await page.$eval("#ctest .tps .bar", (e) => e.textContent)); if (i === 18) cnum = await page.$eval("#ctest .tps .n", (e) => e.textContent); await page.waitForTimeout(22); }
  ok("Holo Code tokens/sec → a LIVE braille sparkline beside the byline", cbars.size >= 3 && [...cbars].some((b) => /[⠁-⣿]/.test(b)), `${cbars.size} frames`);
  ok("Holo Code shows the numeric rate", /^\d+ tok\/s$/.test(cnum), JSON.stringify(cnum));

  // ── 9) Holo Music: a braille spectrum read from an EXISTING analyser (the exact updateMusicScope
  //        path — scope() reading Holo Audio's analyser.getByteFrequencyData) ─────────────────────
  const musicRes = await page.evaluate(async () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator(); osc.type = "square"; osc.frequency.value = 330;
      const an = ctx.createAnalyser(); an.fftSize = 256; osc.connect(an); osc.start();   // (no destination — silent, analyser still reads)
      const el = document.createElement("div"); el.id = "mtest"; document.body.appendChild(el);
      const sc = window.HoloFX.scope(el, () => {                                          // verbatim updateMusicScope sample
        const fd = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(fd);
        const n = 14 * 2, a = []; for (let c = 0; c < n; c++) a.push(fd[Math.floor(c * fd.length / n)] / 255); return a;
      }, { width: 14, fps: 30, fill: true, min: 0, max: 1 });
      const seen = new Set(); await new Promise((r) => setTimeout(r, 500));
      for (let i = 0; i < 8; i++) { seen.add(el.textContent); await new Promise((r) => setTimeout(r, 60)); }
      sc.stop();
      return { wired: typeof sc.stop === "function", width: (el.textContent || "").length, nonBlank: [...seen].some((s) => /[⠁-⣿]/.test(s)) };
    } catch (e) { return { err: String(e && e.message || e) }; }
  });
  ok("Holo Music: scope reads an analyser into a braille spectrum", !!musicRes.wired && musicRes.width === 14, musicRes.err || `${musicRes.width}-cell`);
  ok("Holo Music: real signal moves the braille spectrum", !!musicRes.nonBlank, `signal=${musicRes.nonBlank}`);
} finally {
  await browser.close();
}

const witnessed = results.every((r) => r.ok);
writeFileSync(new URL("./holo-fx-render-witness.result.json", import.meta.url),
  JSON.stringify({ spec: "Holo FX (unicode-animations adoption) renders + animates in a real browser, reduced-motion aware", witnessed, results }, null, 2) + "\n");
console.log(`\n${witnessed ? "PASS" : "FAIL"} — Holo FX render witness (${results.filter((r) => r.ok).length}/${results.length})`);
process.exit(witnessed ? 0 : 1);
