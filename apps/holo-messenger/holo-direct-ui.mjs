// holo-direct-ui.mjs - the native Holo Direct chat surface: a self-contained sealed-conversation panel (OWN DOM, inline
// styles → zero React conflict). Shows the 🔒 end-to-end state, a tap-to-verify SAFETY NUMBER (emoji strip + 60 digits),
// a KEY-CHANGE warning banner (anti-MITM), message bubbles (with a per-message unverified flag), and a composer. The app
// wires it to the holo-direct engine (onSend → engine.send; engine "message"/"keychange" → addMessage/showKeyChange).

export function openDirectChat({ name = "Contact", onSend = () => {}, onVerify = () => {}, onClose = () => {} } = {}) {
  if (typeof document === "undefined") return { addMessage() {}, setSafety() {}, showKeyChange() {}, setVerified() {}, close() {} };
  const el = (t, css, html) => { const n = document.createElement(t); if (css) n.style.cssText = css; if (html != null) n.innerHTML = html; return n; };
  const overlay = el("div", "position:fixed;inset:0;z-index:2147483500;background:rgba(4,7,11,.72);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif");
  const card = el("div", "width:min(420px,96vw);height:min(720px,92vh);background:#0e1620;border:1px solid #1f2c35;border-radius:20px;box-shadow:0 32px 90px rgba(0,0,0,.6);display:flex;flex-direction:column;color:#e9f1f5;overflow:hidden");

  const initial = (name.trim()[0] || "·").toUpperCase();
  const head = el("div", "display:flex;align-items:center;gap:10px;padding:13px 14px;border-bottom:1px solid #16212b");
  head.innerHTML = `<div style="width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-weight:700;color:#04110d;background:linear-gradient(135deg,#00d09c,#27e3b3)">${initial}</div>
    <div style="flex:1;min-width:0"><div style="font-weight:700">${name}</div><div style="font-size:12px;color:#00d09c">🔒 End-to-end encrypted</div></div>`;
  const shield = el("button", "background:rgba(255,255,255,.06);border:1px solid #1f2c35;border-radius:10px;padding:7px 10px;font-size:13px;color:#e9f1f5;cursor:pointer", "🛡 Verify");
  const closeBtn = el("button", "background:transparent;border:0;color:#8aa0ad;font-size:20px;cursor:pointer;padding:0 6px", "✕");
  head.append(shield, closeBtn); closeBtn.onclick = () => { onClose(); close(); };

  const banner = el("div", "display:none;background:rgba(233,111,111,.14);border-bottom:1px solid rgba(233,111,111,.4);color:#ffd7d7;padding:9px 14px;font-size:12.5px");
  const list = el("div", "flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:8px");
  const composer = el("div", "display:flex;gap:8px;padding:12px;border-top:1px solid #16212b");
  const input = el("input", "flex:1;background:#0a1119;border:1px solid #1f2c35;border-radius:12px;padding:11px 13px;color:#e9f1f5;outline:none;font-size:14px"); input.placeholder = "Sealed message…";
  const sendBtn = el("button", "background:linear-gradient(90deg,#00d09c,#1fd6ac);color:#04110d;border:0;border-radius:12px;padding:0 16px;font-weight:700;cursor:pointer", "Send");
  composer.append(input, sendBtn);

  // safety sheet (tap 🛡)
  const sheet = el("div", "display:none;position:absolute;inset:0;background:rgba(4,7,11,.92);flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:26px;text-align:center");
  card.style.position = "relative";
  const sheetBody = el("div", "max-width:320px");
  sheet.append(sheetBody);

  card.append(head, banner, list, composer, sheet); overlay.append(card); document.body.append(overlay);

  const doSend = () => { const t = input.value.trim(); if (!t) return; input.value = ""; onSend(t); };
  sendBtn.onclick = doSend; input.onkeydown = (e) => { if (e.key === "Enter") doSend(); };

  let safety = { emojis: "", digits: "", status: "new" };
  shield.onclick = () => {
    const verified = safety.status === "same-verified";
    sheetBody.innerHTML = `<div style="font-size:15px;font-weight:700;margin-bottom:4px">Verify ${name}</div>
      <div style="color:#8aa0ad;font-size:12.5px;margin-bottom:14px">Compare this in person or over a call. If it matches, no one is in the middle.</div>
      <div style="font-size:30px;letter-spacing:4px;margin:8px 0">${safety.emojis}</div>
      <div style="font-family:ui-monospace,monospace;font-size:12px;color:#cfe;word-spacing:4px;line-height:1.8">${safety.digits}</div>`;
    const vb = el("button", `margin-top:16px;background:${verified ? "#1f2c35" : "#00d09c"};color:${verified ? "#8aa0ad" : "#04110d"};border:0;border-radius:12px;padding:11px 18px;font-weight:700;cursor:pointer`, verified ? "✓ Verified" : "Mark verified");
    const cb = el("button", "margin-top:8px;background:transparent;border:0;color:#8aa0ad;cursor:pointer;display:block;width:100%", "Close");
    vb.onclick = () => { if (!verified) { onVerify(); } sheet.style.display = "none"; };
    cb.onclick = () => { sheet.style.display = "none"; };
    sheetBody.append(vb, cb); sheet.style.display = "flex";
  };

  function bubble(m) {
    const mine = m.from === "me";
    const row = el("div", `display:flex;${mine ? "justify-content:flex-end" : "justify-content:flex-start"}`);
    const b = el("div", `max-width:78%;padding:8px 12px;border-radius:14px;font-size:14px;${mine ? "background:linear-gradient(135deg,#0b6,#0a9);color:#04110d;border-bottom-right-radius:4px" : "background:#182430;border-bottom-left-radius:4px"}`);
    b.className = "hd-bubble";
    b.textContent = m.text;
    if (!mine && m.verified === false) { const w = el("div", "font-size:11px;color:#ffb0b0;margin-top:3px", "⚠ unverified sender"); b.append(w); }
    row.append(b); return row;
  }

  function close() { try { overlay.remove(); } catch {} }
  return {
    overlay,
    addMessage(m) { list.append(bubble(m)); list.scrollTop = list.scrollHeight; },
    setSafety({ emojis, digits, status }) { safety = { emojis, digits, status }; shield.textContent = status === "same-verified" ? "🛡 Verified" : (status === "changed" ? "⚠ Verify" : "🛡 Verify"); shield.style.color = status === "same-verified" ? "#00d09c" : (status === "changed" ? "#ffb0b0" : "#e9f1f5"); },
    showKeyChange(on) { banner.style.display = on ? "block" : "none"; if (on) banner.innerHTML = `⚠ <b>${name}'s security code changed.</b> Verify again before trusting new messages.`; },
    setVerified(v) { this.setSafety({ ...safety, status: v ? "same-verified" : safety.status }); },
    close,
  };
}
