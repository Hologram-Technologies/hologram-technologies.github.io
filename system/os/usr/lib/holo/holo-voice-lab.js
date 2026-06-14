// holo-voice-lab.js — a browser test & auto-tune bench for Holo Voice (Q).
//
// Load it from the shell's DevTools console (it runs on import, attaching window.QLab):
//
//     await import('/_shared/holo-voice-lab.js')
//
// Then talk to Q. A small panel shows the live latency of every turn (the number that decides whether
// it feels real-time is FIRST-AUDIO: your end-of-speech → Q's first sound). When you're done:
//
//     QLab.report()      → averages + p50/p90 for the session, and what's dominating the latency
//     QLab.calibrate()   → measures your room/echo and sets a safe barge-in floor (run while quiet, then talk)
//     QLab.autotune()    → applies a recommended config from what it just measured
//     QLab.set({ silenceMs: 450, bargeFrames: 7 })   → tweak any knob live (no reload)
//     QLab.guide()       → prints a short spoken test script to run through
//
// Everything is on-device; the bench only reads HoloVoice's own meters + per-turn telemetry events.

(function () {
  "use strict";
  var W = window, HV = W.HoloVoice;
  if (!HV) { console.warn("[QLab] HoloVoice isn't loaded on this page — open the shell (shell.html)."); return; }

  var turns = [];                                  // collected per-turn metrics
  function pct(a, p) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; }
  function avg(a) { return a.length ? Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length) : 0; }
  function col(ms, good, ok) { return ms <= good ? "#34d399" : ms <= ok ? "#fbbf24" : "#fb7185"; }

  // ── live panel ────────────────────────────────────────────────────────────────────────────────────
  var panel, rows = {}, meter;
  function mount() {
    if (panel) return;
    panel = document.createElement("div");
    panel.style.cssText = "position:fixed;left:14px;bottom:14px;z-index:2147483647;width:260px;padding:12px 14px;border-radius:14px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8ecf5;background:rgba(12,14,22,.92);border:1px solid rgba(139,92,246,.4);box-shadow:0 12px 40px rgba(0,0,0,.5);backdrop-filter:blur(10px)";
    panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><b style="letter-spacing:.04em">Q · Voice Lab</b><span id="ql-n" style="opacity:.6">0 turns</span></div>'
      + '<div id="ql-rows"></div>'
      + '<div style="margin-top:8px;height:5px;border-radius:9px;background:rgba(255,255,255,.1);overflow:hidden"><div id="ql-meter" style="height:100%;width:0;background:linear-gradient(90deg,#2dd4bf,#8b5cf6);transition:width .06s"></div></div>'
      + '<div id="ql-state" style="margin-top:6px;opacity:.6">idle</div>'
      + '<div style="margin-top:8px;opacity:.55;font-size:11px">QLab.report() · QLab.autotune() · QLab.calibrate()</div>';
    document.body.appendChild(panel);
    ["firstAudio", "transcript", "firstToken", "total"].forEach(function (k) {
      var r = document.createElement("div"); r.style.cssText = "display:flex;justify-content:space-between";
      r.innerHTML = '<span style="opacity:.7">' + ({ firstAudio: "first audio", transcript: "transcript", firstToken: "first token", total: "turn total" })[k] + '</span><span class="v" style="font-weight:700">—</span>';
      panel.querySelector("#ql-rows").appendChild(r); rows[k] = r.querySelector(".v");
    });
    meter = panel.querySelector("#ql-meter");
    (function tick() { if (!panel) return; try { var L = HV.levels(); meter.style.width = Math.min(100, Math.round((L.live === "speaking" ? L.tts : L.mic) * 220)) + "%"; panel.querySelector("#ql-state").textContent = (L.liveOn ? L.live : "tap Q to start") + (L.live === "listening" ? " — speak now" : ""); } catch (e) {} requestAnimationFrame(tick); })();
  }
  function render(m) {
    mount();
    rows.firstAudio.textContent = (m.at.firstAudio != null ? m.at.firstAudio : "—") + " ms"; rows.firstAudio.style.color = col(m.at.firstAudio || 9999, 900, 1800);
    rows.transcript.textContent = (m.at.transcript != null ? m.at.transcript : "—") + " ms"; rows.transcript.style.color = col(m.at.transcript || 9999, 700, 1500);
    rows.firstToken.textContent = (m.at.firstToken != null ? m.at.firstToken : "—") + " ms"; rows.firstToken.style.color = col(m.at.firstToken || 9999, 1200, 2500);
    rows.total.textContent = (m.total != null ? m.total : "—") + " ms";
    panel.querySelector("#ql-n").textContent = turns.length + " turn" + (turns.length === 1 ? "" : "s");
  }

  W.addEventListener("holo-voice-metrics", function (e) {
    var m = e.detail; turns.push(m); render(m);
    console.log("%c[QLab] turn " + turns.length + "%c  first-audio " + (m.at.firstAudio) + "ms · transcript " + m.at.transcript + "ms · first-token " + (m.at.firstToken == null ? "—" : m.at.firstToken) + "ms · total " + m.total + "ms",
      "color:#8b5cf6;font-weight:700", "color:inherit");
  });

  // ── calibration: find the mic's echo/ambient floor while Q is talking, set barge-in just above it ──
  async function calibrate() {
    if (!HV.levels().liveOn) { console.warn("[QLab] start a conversation first (tap Q), then run calibrate() and stay SILENT for ~3s while Q talks."); return; }
    console.log("[QLab] calibrating — stay silent while Q is speaking…");
    var samples = [], t0 = performance.now();
    await new Promise(function (res) { (function s() { var L = HV.levels(); if (L.live === "speaking") samples.push(L.mic); if (performance.now() - t0 > 3000) return res(); requestAnimationFrame(s); })(); });
    if (samples.length < 10) { console.warn("[QLab] didn't catch Q speaking — try again while Q is mid-sentence."); return; }
    var peak = samples.sort(function (a, b) { return a - b; })[Math.floor(samples.length * 0.95)];
    var floor = Math.max(0.04, Math.round((peak + 0.03) * 1000) / 1000);
    HV.tune({ bargeFloor: floor });
    console.log("%c[QLab] echo floor ≈ " + peak.toFixed(3) + " → bargeFloor set to " + floor + ". Now speak over Q to test interrupting.", "color:#34d399");
    return floor;
  }

  // ── auto-tune: recommend config from what we measured ──────────────────────────────────────────────
  function autotune() {
    if (turns.length < 2) { console.warn("[QLab] need a few turns first — talk to Q, then run autotune()."); return; }
    var fa = turns.map(function (t) { return t.at.firstAudio || 0; }).filter(Boolean);
    var tr = turns.map(function (t) { return t.at.transcript || 0; }).filter(Boolean);
    var ft = turns.map(function (t) { return t.at.firstToken; }).filter(function (x) { return x != null; });
    var rec = {}, notes = [];
    var aTr = avg(tr), aFt = avg(ft), aFa = avg(fa);
    // the dominant cost decides the advice
    if (aTr > 1200) notes.push("ASR is the bottleneck (" + aTr + "ms). Try WebGPU (right-click the mic → Use WebGPU → Test), or a shorter utterance.");
    if (aFt > 1800) notes.push("First token is slow (" + aFt + "ms) — likely a cold/seldom-used model. Keep the tab warm; replies are already short-form.");
    if (aFa > 1500 && aFt && aFa - aFt > 600) notes.push("TTS is lagging the first sentence (" + (aFa - aFt) + "ms after first token). WebGPU speeds Kokoro up.");
    // turn-taking: nudge the endpoint toward snappy without clipping
    if (aFa < 1100) { rec.silenceMs = 450; notes.push("Latency is good — tightening end-of-speech to 450ms for snappier turns (raise it if Q starts cutting you off)."); }
    else { rec.silenceMs = 600; }
    HV.tune(rec);
    console.log("%c[QLab] applied:%c " + JSON.stringify(rec), "color:#8b5cf6;font-weight:700", "color:inherit");
    notes.forEach(function (n) { console.log("  • " + n); });
    return HV.config();
  }

  function report() {
    if (!turns.length) { console.warn("[QLab] no turns yet — talk to Q first."); return; }
    var fa = turns.map(function (t) { return t.at.firstAudio || 0; }).filter(Boolean);
    var tr = turns.map(function (t) { return t.at.transcript || 0; }).filter(Boolean);
    var ft = turns.map(function (t) { return t.at.firstToken; }).filter(function (x) { return x != null; });
    var tot = turns.map(function (t) { return t.total || 0; }).filter(Boolean);
    console.log("%c═══ Q Voice Lab — " + turns.length + " turns ═══", "color:#8b5cf6;font-weight:700");
    console.table({
      "first audio (felt latency)": { avg: avg(fa), p50: pct(fa, 50), p90: pct(fa, 90) },
      "transcript (ASR)": { avg: avg(tr), p50: pct(tr, 50), p90: pct(tr, 90) },
      "first token (LLM)": { avg: avg(ft), p50: pct(ft, 50), p90: pct(ft, 90) },
      "turn total": { avg: avg(tot), p50: pct(tot, 50), p90: pct(tot, 90) }
    });
    console.log("target: first-audio < ~900ms feels real-time. Run QLab.autotune() to apply tuning, QLab.calibrate() for barge-in.");
    return { firstAudio: { avg: avg(fa), p90: pct(fa, 90) }, transcript: avg(tr), firstToken: avg(ft) };
  }

  function guide() {
    console.log("%c[QLab] spoken test script — say each line, judge the feel:", "color:#8b5cf6;font-weight:700");
    [
      "1. COMMAND latency:  'open the browser'   → should act + confirm almost instantly",
      "2. THEME:            'switch to dark mode' → instant, no thinking",
      "3. SHORT CHAT:       'how are you?'        → first words within ~1s, sounds human",
      "4. LONGER CHAT:      'what can you do here?'→ Q should START talking on sentence 1, not after the whole answer",
      "5. BARGE-IN:         while Q is talking, jump in: 'wait — open settings instead'  → Q stops at once and hears you",
      "6. TURN-TAKING:      ask, answer, ask again → no awkward gaps; raise silenceMs if it cuts you off, lower if laggy",
      "7. WIND DOWN:        'that's all, thanks'   → Q signs off"
    ].forEach(function (l) { console.log("   " + l); });
    console.log("then: QLab.report()  ·  QLab.calibrate()  ·  QLab.autotune()");
  }

  function start() { try { HV.live(); } catch (e) {} mount(); guide(); }

  W.QLab = { start: start, report: report, autotune: autotune, calibrate: calibrate, guide: guide,
    set: function (p) { return HV.tune(p); }, config: function () { return HV.config(); },
    turns: function () { return turns; }, reset: function () { turns = []; if (panel) panel.querySelector("#ql-n").textContent = "0 turns"; } };

  mount(); guide();
  console.log("%c[QLab] ready.%c  Tap Q (or QLab.start()) and talk. Live latency is in the panel, bottom-left.", "color:#34d399;font-weight:700", "color:inherit");
})();
