// ui/vardialog.js — the prompt VARIABLE-FILL dialog: one field per {{variable}} (a dropdown
// when the prompt declares {{name:opt1|opt2}} options), live preview with filled values
// emphasized, Submit substitutes and hands the final text back.

import { detectVariables, fillVariables, replaceSpecialVars } from "../core/promptsLib.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// open the dialog for `promptText`; resolves with the filled text, or null on cancel.
export function fillPromptDialog({ els, t, promptText, userName }) {
  return new Promise((resolve) => {
    const text = replaceSpecialVars(promptText, { userName });
    const vars = detectVariables(text);
    if (!vars.length) return resolve(text);

    els.modals.hidden = false;
    els.modals.innerHTML = `
      <div class="sheet" role="dialog" style="width:min(560px,94vw)">
        <div class="sheet-head"><h2>${t("com_prompts_fill")}</h2><button class="x">✕</button></div>
        <div class="sheet-pane" style="max-height:60vh">
          <div id="vd-fields" style="display:flex;flex-direction:column;gap:10px"></div>
          <div class="pcard" style="margin-top:6px"><div class="plab">${t("com_prompts_preview")}</div><div id="vd-preview" style="font-size:var(--fs);line-height:1.6;color:var(--muted);white-space:pre-wrap;max-height:160px;overflow-y:auto"></div></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
            <button class="btn" id="vd-cancel">${t("com_ui_cancel")}</button>
            <button class="btn primary" id="vd-submit">${t("com_ui_send")}</button>
          </div>
        </div>
      </div>`;
    const fields = els.modals.querySelector("#vd-fields");
    const values = {};
    for (const v of vars) {
      const wrap = document.createElement("div");
      wrap.innerHTML = `<div class="plab" style="margin-bottom:5px">${esc(v.name)}</div>`;
      if (v.options) {
        const sel = document.createElement("select");
        sel.style.cssText = "width:100%;background:var(--field);border:1px solid var(--field-b);border-radius:9px;color:var(--text);padding:8px 10px;font-size:max(16px,14px)";
        sel.innerHTML = v.options.map((o) => `<option>${esc(o)}</option>`).join("");
        sel.onchange = () => { values[v.raw] = sel.value; preview(); };
        values[v.raw] = v.options[0];
        wrap.appendChild(sel);
      } else {
        const ta = document.createElement("textarea");
        ta.rows = 1; ta.placeholder = v.name;
        ta.style.cssText = "width:100%;background:var(--field);border:1px solid var(--field-b);border-radius:9px;color:var(--text);padding:8px 10px;resize:vertical;font-size:max(16px,14px)";
        ta.oninput = () => { values[v.raw] = ta.value; preview(); };
        wrap.appendChild(ta);
      }
      fields.appendChild(wrap);
    }
    const previewEl = els.modals.querySelector("#vd-preview");
    const preview = () => { previewEl.textContent = fillVariables(text, values); };
    preview();
    const close = (result) => { els.modals.hidden = true; els.modals.innerHTML = ""; resolve(result); };
    els.modals.querySelector(".x").onclick = () => close(null);
    els.modals.querySelector("#vd-cancel").onclick = () => close(null);
    els.modals.querySelector("#vd-submit").onclick = () => close(fillVariables(text, values));
    els.modals.onclick = (e) => { if (e.target === els.modals) close(null); };
  });
}
