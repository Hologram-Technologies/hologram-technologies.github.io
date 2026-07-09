// ui/messages.js — renders the ACTIVE THREAD of the message tree: user bubbles, assistant
// markdown, hover actions (copy · edit · regenerate · fork · feedback · read-aloud), the
// sibling pager for branches, and the verifiable-inference receipt card. Pure view layer —
// every action delegates to the chat controller through `act`.

import { SVG } from "./shell.js";
import { renderMarkdown } from "../render/markdown.js";

const eh = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const shortK = (k) => { const s = String(k || ""); const ax = s.split(":").slice(0, 2).join(":"); const h = s.split(":").pop(); return ax + ":" + (h.length > 18 ? h.slice(0, 12) + "…" + h.slice(-4) : h); };

// Fallback frames if the OS motion engine (window.HoloFX, the faithful unicode-animations
// adoption) isn't present. When it is, the streaming row uses the house `dna` spinner — the
// shared, sharp vocabulary for generative/inference states.
const SPIN_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];

export function makeMessagesView({ els, t, act, settings }) {
  let spinTimer = null, spinHandle = null;
  const stopSpin = () => { clearInterval(spinTimer); spinTimer = null; if (spinHandle) { spinHandle.stop(); spinHandle = null; } };

  function sibPager(msg, siblings) {
    if (siblings.length < 2) return null;
    const i = siblings.indexOf(msg.id);
    const d = document.createElement("span"); d.className = "sib";
    d.innerHTML = `<button data-d="-1" aria-label="Previous version">${SVG.left1}</button><span>${i + 1}/${siblings.length}</span><button data-d="1" aria-label="Next version">${SVG.right1}</button>`;
    d.querySelectorAll("button").forEach((b) => (b.onclick = () => act.switchSibling(msg, +b.dataset.d)));
    return d;
  }

  function iact(title, svg, fn, cls = "") {
    const b = document.createElement("button"); b.className = "iact " + cls; b.title = title; b.innerHTML = svg;
    b.onclick = (e) => fn(b, e); return b;
  }

  function userRow(msg, siblings) {
    const m = document.createElement("div"); m.className = "msg user"; m.dataset.id = msg.id;
    const b = document.createElement("div"); b.className = "bubble"; b.textContent = msg.text; m.appendChild(b);
    const meta = document.createElement("div"); meta.className = "meta";
    const pager = sibPager(msg, siblings); if (pager) meta.appendChild(pager);
    meta.appendChild(iact(t("com_ui_copy"), SVG.copy, async (btn) => { try { await navigator.clipboard.writeText(msg.text); flash(btn); } catch {} }));
    meta.appendChild(iact(t("com_ui_edit"), SVG.edit, () => editInPlace(m, msg)));
    m.appendChild(meta);
    return m;
  }

  function editInPlace(rowEl, msg) {
    const old = rowEl.querySelector(".bubble"); if (!old) return;
    const wrap = document.createElement("div"); wrap.className = "edit-area";
    wrap.innerHTML = `<textarea>${eh(msg.text)}</textarea><div class="row"><button class="btn" data-a="cancel">${t("com_ui_cancel")}</button><button class="btn primary" data-a="save">${t("com_ui_edit_submit")}</button></div>`;
    old.replaceWith(wrap);
    const ta = wrap.querySelector("textarea"); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    wrap.querySelector('[data-a="cancel"]').onclick = () => act.rerender();
    wrap.querySelector('[data-a="save"]').onclick = () => { const v = ta.value.trim(); if (v && v !== msg.text) act.editResubmit(msg, v); else act.rerender(); };
    ta.onkeydown = (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) wrap.querySelector('[data-a="save"]').click(); if (e.key === "Escape") act.rerender(); };
  }

  function assistantRow(msg, siblings, { isLeaf }) {
    const m = document.createElement("div"); m.className = "msg assistant"; m.dataset.id = msg.id;
    if (msg.toolTrace && msg.toolTrace.length) m.appendChild(trailCard(msg));
    const body = document.createElement("div"); body.className = "body"; m.appendChild(body);
    if (msg.text) renderMarkdown(body, msg.text);
    const meta = document.createElement("div"); meta.className = "meta";
    const pager = sibPager(msg, siblings); if (pager) meta.appendChild(pager);
    meta.appendChild(iact(t("com_ui_copy"), SVG.copy, async (btn) => { try { await navigator.clipboard.writeText(msg.text); flash(btn); } catch {} }));
    if (isLeaf) meta.appendChild(iact(t("com_ui_regenerate"), SVG.regen, () => act.regenerate(msg)));
    meta.appendChild(iact(t("com_ui_fork"), SVG.fork, () => act.fork(msg)));
    meta.appendChild(iact(t("com_ui_feedback_up"), SVG.thumbU, (btn) => act.feedback(msg, "thumbsUp", btn), msg.feedback?.rating === "thumbsUp" ? "on" : ""));
    meta.appendChild(iact(t("com_ui_feedback_down"), SVG.thumbD, (btn) => act.feedback(msg, "thumbsDown", btn), msg.feedback?.rating === "thumbsDown" ? "on" : ""));
    if (settings.get("tts") && "speechSynthesis" in window) meta.appendChild(iact(t("com_ui_read_aloud"), SVG.speak, (btn) => act.speak(msg, btn)));
    m.appendChild(meta);
    if (msg.receiptKappa && settings.get("receipts") === true) m.appendChild(receiptCard(msg));   // opt-IN (clean UX default; receipts still seal underneath)
    return m;
  }

  // The verifiable-inference receipt card (collapsed by default). Data is resolved lazily
  // from the κ-store on first expand — the receipt body re-derives to its address (Law L5).
  function receiptCard(msg) {
    const el = document.createElement("div"); el.className = "receipt";
    el.innerHTML = `<div class="rhead"><span class="rdot"></span><span class="rt">${t("com_ui_receipt_title")} ${msg.fromMemo ? `<span class="memo-chip">${t("com_ui_memo_replay")}</span>` : ""}<span class="rsub"> · ${t("com_ui_receipt_sub")}</span></span><span class="rk">${eh(shortK(msg.receiptKappa))}</span><span class="rchev">${SVG.right}</span></div><div class="rbody"></div>`;
    const head = el.querySelector(".rhead"), bodyEl = el.querySelector(".rbody");
    let loaded = false;
    head.onclick = async () => {
      el.classList.toggle("open");
      if (loaded || !el.classList.contains("open")) return;
      loaded = true;
      const rec = await act.resolveReceipt(msg);
      if (!rec) { bodyEl.innerHTML = `<div class="rverdict show bad">${t("com_ui_integrity_refused")}</div>`; return; }
      const U = rec.body["prov:used"], G = rec.body["prov:generated"], p = rec.params || U["holo:params"];
      const row = (lab, val) => `<div class="rrow"><div class="rlab">${lab}</div><div class="rval">${eh(String(val))}</div></div>`;
      bodyEl.innerHTML =
        row("receipt κ", rec.id) + row("model", U["holo:model"]) + row("engine", U["holo:engine"]) +
        row("prompt κ", U["holo:prompt"]) + row("context κ", U["holo:context"]) + row("output κ", G["holo:outputTokens"]) +
        row("decode", `${p.decode} · ≤${p.maxTokens} tok · rep ${p.repetitionPenalty} · ${p.template}`) +
        `<div class="racts"><button class="rbtn go" data-a="verify">${t("com_ui_verify")}</button><button class="rbtn" data-a="rederive">${t("com_ui_rederive")}</button><button class="rbtn" data-a="copy">${t("com_ui_copy_receipt")}</button></div><div class="rverdict" data-v></div>`;
      const vEl = bodyEl.querySelector("[data-v]");
      bodyEl.querySelector('[data-a="verify"]').onclick = async () => {
        const r = await act.verifyReceipt(rec);
        vEl.className = "rverdict show " + (r.ok ? "ok" : "bad");
        vEl.innerHTML = r.ok ? `<b>✓ ${t("com_ui_integrity_ok")}</b>` : `<b>✗ ${t("com_ui_integrity_bad")}</b> <small>${eh(shortK(r.again))} ≠ ${eh(shortK(rec.id))}</small>`;
      };
      bodyEl.querySelector('[data-a="rederive"]').onclick = async (e) => {
        const btn = e.currentTarget, label = btn.textContent; btn.disabled = true; btn.textContent = "…";
        vEl.className = "rverdict show warn"; vEl.textContent = "Re-running this exact inference, greedily…";
        try {
          const r = await act.reDeriveReceipt(rec, msg);
          vEl.className = "rverdict show " + (r.ok ? "ok" : r.reason ? "warn" : "bad");
          vEl.innerHTML = r.ok ? `<b>✓ ${t("com_ui_rederived_ok")}</b>` : r.reason ? `<b>○ ${eh(r.reason)}</b>` : `<b>✗ ${t("com_ui_rederived_bad")}</b> <small>got ${eh(shortK(r.got))} ≠ ${eh(shortK(r.want))}</small>`;
        } catch (err) { vEl.className = "rverdict show bad"; vEl.textContent = "re-derive error: " + err; }
        finally { btn.disabled = false; btn.textContent = label; }
      };
      bodyEl.querySelector('[data-a="copy"]').onclick = async () => { try { await navigator.clipboard.writeText(JSON.stringify({ id: rec.id, ...rec.body }, null, 2)); } catch {} };
    };
    return el;
  }

  function flash(btn) { const old = btn.innerHTML; btn.innerHTML = SVG.ok; setTimeout(() => (btn.innerHTML = old), 1100); }

  // Render the whole active thread. `thread` = [{...msg}], `siblingsOf(msg)` = ordered sibling ids.
  // Empty thread = LANDING mode: the scroller hides and the composer rises to the golden line
  // with the greeting + suggestion chips (body.landing drives it all in CSS).
  function render(thread, siblingsOf) {
    stopSpin();
    els.thread.innerHTML = "";
    const landing = !thread.length;
    document.body.classList.toggle("landing", landing);
    els.greet.hidden = !landing; els.chips.hidden = !landing;
    thread.forEach((msg, i) => {
      const siblings = siblingsOf(msg);
      els.thread.appendChild(msg.isCreatedByUser ? userRow(msg, siblings) : assistantRow(msg, siblings, { isLeaf: i === thread.length - 1 }));
    });
  }

  // Streaming row: a live assistant message updated per token (markdown re-render throttled),
  // with a live WORK TRAIL for agentic turns (tool calls appear as they happen — the Claude
  // desktop "using tool…" feel, but each line is backed by a sealed receipt).
  function startStream() {
    document.body.classList.remove("landing");
    els.greet.hidden = true; els.chips.hidden = true;
    const m = document.createElement("div"); m.className = "msg assistant streaming";
    m.innerHTML = `<div class="trail" hidden></div><div class="body stream"></div><div class="meta pinned"><span class="spin"></span><span class="tps" hidden><span class="bar"></span><span class="n"></span></span></div>`;
    els.thread.appendChild(m);
    const body = m.querySelector(".body"), spin = m.querySelector(".spin"), trailEl = m.querySelector(".trail");
    const tpsEl = m.querySelector(".tps"), tpsBar = m.querySelector(".tps .bar"), tpsN = m.querySelector(".tps .n");
    if (window.HoloFX) spinHandle = window.HoloFX.spin(spin, "dna");
    else { let i = 0; spinTimer = setInterval(() => { spin.textContent = SPIN_FRAMES[i++ % SPIN_FRAMES.length]; }, 80); }
    let lastMd = 0; const tpsHist = [];                // live tokens/sec → a braille pulse (the speed IS the signal)
    return {
      el: m,
      update(text) {
        body.textContent = text;                      // instant raw text per token
        const now = performance.now();
        if (now - lastMd > 400) { lastMd = now; renderMarkdown(body, text).then(() => body.classList.remove("stream")); }
        maybeScroll();
      },
      // Real per-token decode telemetry (engine stats.tokps) plotted as a live braille sparkline.
      stats(s) {
        const v = Math.max(0, (s && s.tokps) || 0); if (!v && !tpsHist.length) return;
        tpsHist.push(v); if (tpsHist.length > 28) tpsHist.shift();
        tpsEl.hidden = false;
        if (window.HoloFX) tpsBar.textContent = window.HoloFX.graph(tpsHist, { width: 14, fill: true, min: 0 });
        tpsN.textContent = v ? Math.round(v) + " tok/s" : "";
      },
      trail(html) {
        trailEl.hidden = false;
        const d = document.createElement("div"); d.className = "trail-item"; d.innerHTML = html;
        trailEl.appendChild(d); maybeScroll();
      },
      done() { stopSpin(); m.classList.remove("streaming"); m.querySelector(".meta")?.remove(); },
    };
  }

  // The stored work-trail card (collapsed): rendered above an agentic answer from lc:toolTrace.
  function trailCard(msg) {
    const trace = msg.toolTrace || [];
    const el = document.createElement("div"); el.className = "receipt trailcard";
    el.innerHTML = `<div class="rhead"><span class="rdot" style="background:var(--blue);box-shadow:0 0 9px var(--blue)"></span><span class="rt">${t("com_tools_trail")}<span class="rsub"> · ${t("com_tools_calls", { n: String(trace.length) })}</span></span><span class="rchev">${SVG.right}</span></div><div class="rbody"></div>`;
    const bodyEl = el.querySelector(".rbody");
    el.querySelector(".rhead").onclick = () => {
      el.classList.toggle("open");
      if (bodyEl.childElementCount) return;
      for (const s of trace) {
        const row = document.createElement("div");
        row.innerHTML = `<div class="rrow"><div class="rlab">${s.ok ? "✓" : "✗"} ${eh(s.name)}</div><div class="rval">${eh(JSON.stringify(s.args)).slice(0, 200)}</div></div>` +
          `<div class="rrow"><div class="rlab">→</div><div class="rval" style="color:var(--muted)">${eh((s.text || "").slice(0, 300))}</div></div>` +
          (s.receiptId ? `<div class="rrow"><div class="rlab">receipt κ</div><div class="rval">${eh(shortK(s.receiptId))}</div></div>` : "");
        bodyEl.appendChild(row);
      }
    };
    return el;
  }

  // Smart follow: stick to the bottom only while the reader is already there.
  const nearBottom = () => els.scroller.scrollHeight - els.scroller.scrollTop - els.scroller.clientHeight < 90;
  let follow = true;
  els.scroller.addEventListener("scroll", () => { follow = nearBottom(); }, { passive: true });
  function maybeScroll() { if (follow) els.scroller.scrollTop = els.scroller.scrollHeight; }
  function scrollBottom() { follow = true; els.scroller.scrollTop = els.scroller.scrollHeight; }

  return { render, startStream, scrollBottom, maybeScroll };
}
