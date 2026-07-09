// holo-messenger-weave.mjs — weave HoloChat INTO the real messenger (additive, no monolith edits).
//
// Why: there were two messengers — the beautiful one, and a plainer HoloChat surface behind "#". This
//   dissolves the second into the first, so apps/money/identity/proofs live in the messenger you know.
// How: the real UI is a closed React/chatscope app exposing only low-level globals, so we weave at the
//   DOM seam (the pattern the app itself uses to turn pay/watch links into cards): a body-level observer
//   upgrades card-text bubbles into native cards, and the composer attach "+" opens the unified App Tray.
// What: in ANY conversation, a message whose text is a HoloChat card renders as that card; tapping "+"
//   opens apps · Spaces · money · identity · prove, and a pick sends into the current conversation.

import "./holo-app-tray.mjs";   // installs window.HoloApps (+ HoloOpen)

const CONTENT = ".cs-message__content";
const EDITOR = ".cs-message-input__content-editor";
const SEND = ".cs-button--send";
const ATTACH = ".cs-button--attachment";

// drop a card into whatever conversation is open by POPULATING the real composer (reliable), then the user
// presses Send — exactly like attaching in WhatsApp. Set the contenteditable's text + dispatch a native
// `input` event so chatscope's React onInput registers it and enables Send; place the cursor at the end.
function composerChannel() {
  return {
    send(text) {
      const ed = document.querySelector(EDITOR); if (!ed) return;
      ed.focus();
      ed.textContent = String(text);
      ed.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: String(text) }));
      try { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch {}
    },
  };
}

// upgrade one message-content node: if its text is a HoloChat card, replace it with the rendered card.
function upgrade(node) {
  try {
    if (!node || node.dataset.holoCard) return;
    const A = window.HoloApps; if (!A || !A.isCard) return;
    const text = (node.textContent || "").trim();
    if (!A.isCard(text)) return;
    node.dataset.holoCard = "1";
    node.textContent = "";
    node.appendChild(A.renderCard(text, composerChannel()));
  } catch {}
}

// the composer attach "+" opens the unified tray (the modern "attach anything": apps, money, id, files).
function hookAttach(btn) {
  if (!btn || btn.dataset.holoAttach) return;
  btn.dataset.holoAttach = "1";
  btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (window.HoloApps) window.HoloApps.pick(composerChannel()); }, true);
}

// a native "Spaces" rail at the top of the chat list — the familiar status/Communities strip. Placed in
// the app's own .holo-convlist-wrap (a sibling of React's <ul>, so it survives re-renders); tap → open.
const WRAP = ".holo-convlist-wrap";
// one clean word per Space — no truncation, no ellipsis.
const SPACE_SHORT = { "org.hologram.holospace.Web3": "Web3", "org.hologram.holospace.CreatorStudio": "Studio", "org.hologram.holospace.DevCockpit": "Dev", "org.hologram.holospace.AILab": "AI", "org.hologram.holospace.TrustCenter": "Trust", "org.hologram.holospace.EmulationArcade": "Arcade" };
async function mountSpaces() {
  try {
    if (document.getElementById("holo-spaces")) return;
    const list = document.querySelector(".cs-conversation-list"); if (!list) return;
    const wrap = document.querySelector(WRAP) || list.parentElement; if (!wrap) return;
    const A = window.HoloApps; if (!A || !A.catalog) return;
    const spaces = (await A.catalog()).filter((x) => x.kind === "space");
    if (!spaces.length || document.getElementById("holo-spaces")) return;
    const open0 = (() => { try { return localStorage.getItem("holo.spaces.open") === "1"; } catch { return false; } })();
    const sec = document.createElement("div"); sec.id = "holo-spaces";
    sec.style.cssText = "flex:0 0 auto;border-bottom:1px solid #ffffff0d;background:transparent;";
    const head = document.createElement("button"); head.type = "button";   // one quiet line by default; tap to reveal
    head.style.cssText = "display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:#e9edef;cursor:pointer;padding:11px 16px;font:600 13px system-ui;opacity:.6;transition:opacity .15s ease;";
    head.innerHTML = `<span style="font-size:15px;">✨</span><span style="flex:1;text-align:left;">Spaces</span><span class="hsp-chev" style="font-size:17px;line-height:1;opacity:.7;transition:transform .18s ease;">›</span>`;
    head.onmouseenter = () => { head.style.opacity = "1"; }; head.onmouseleave = () => { head.style.opacity = ".6"; };
    const rail = document.createElement("div"); rail.style.cssText = "display:" + (open0 ? "flex" : "none") + ";gap:18px;overflow-x:auto;padding:2px 16px 12px;scrollbar-width:none;";
    for (const s of spaces) {
      const nm = SPACE_SHORT[s.id] || s.name;
      const b = document.createElement("button"); b.type = "button"; b.title = s.tagline || s.name;
      b.style.cssText = "flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:6px;border:0;background:transparent;color:#e9edef;cursor:pointer;";
      b.innerHTML = `<span class="hsp-av" style="width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-size:19px;background:${s.accent}12;box-shadow:inset 0 0 0 1px ${s.accent}44;transition:transform .15s ease,box-shadow .15s ease;">${s.glyph}</span>` +
        `<span style="font-size:13px;font-weight:500;opacity:.62;">${nm}</span>`;
      const av = b.querySelector(".hsp-av");
      b.onmouseenter = () => { av.style.transform = "scale(1.08)"; av.style.boxShadow = "inset 0 0 0 1.5px " + s.accent + "aa"; b.lastChild.style.opacity = "1"; };
      b.onmouseleave = () => { av.style.transform = "scale(1)"; av.style.boxShadow = "inset 0 0 0 1px " + s.accent + "44"; b.lastChild.style.opacity = ".62"; };
      b.onclick = () => (window.HoloOpen ? window.HoloOpen(s) : A.openSpace(s));
      rail.appendChild(b);
    }
    const chev = head.querySelector(".hsp-chev"); chev.style.transform = open0 ? "rotate(90deg)" : "rotate(0deg)";
    head.onclick = () => {
      const opening = rail.style.display === "none";
      rail.style.display = opening ? "flex" : "none";
      chev.style.transform = opening ? "rotate(90deg)" : "rotate(0deg)";
      try { localStorage.setItem("holo.spaces.open", opening ? "1" : "0"); } catch {}
    };
    sec.append(head, rail); wrap.insertBefore(sec, list);
  } catch {}
}

function scan(root) {
  (root || document).querySelectorAll?.(CONTENT).forEach(upgrade);
  (root || document).querySelectorAll?.(ATTACH).forEach(hookAttach);
  mountSpaces();
}

// a light, reversible calm: soften the loudest native strip (the "need you" banner) and hide the rail's
// scrollbar. Conservative — no functional element is hidden; remove #holo-calm to revert entirely.
function injectCalm() {
  if (document.getElementById("holo-calm")) return;
  const st = document.createElement("style"); st.id = "holo-calm";
  st.textContent = [
    ".holo-catchup{opacity:.8;}",                     // soften the loud "need you" banner
    ".holo-chip:not(.on){opacity:.62;font-weight:500;}", // quiet the inactive filters (all still work)
    ".holo-chip{transition:opacity .15s ease;} .holo-chip:hover{opacity:1;}",
    "#holo-spaces::-webkit-scrollbar{display:none;height:0;}",
  ].join("");
  (document.head || document.documentElement).appendChild(st);
}

let _obs = null;
function start() {
  if (_obs || typeof MutationObserver === "undefined") return;
  injectCalm();
  scan(document);
  _obs = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches?.(CONTENT)) upgrade(n);
      if (n.matches?.(ATTACH)) hookAttach(n);
      n.querySelectorAll?.(CONTENT).forEach(upgrade);
      n.querySelectorAll?.(ATTACH).forEach(hookAttach);
      if (n.matches?.(".cs-conversation-list") || n.querySelector?.(".cs-conversation-list")) mountSpaces();
    }
  });
  _obs.observe(document.body, { childList: true, subtree: true });
}

export function installWeave() { if (typeof document !== "undefined") { if (document.body) start(); else document.addEventListener("DOMContentLoaded", start); } return true; }

if (typeof window !== "undefined") {
  const flag = () => { try { return localStorage.getItem("holo.chat.enabled") === "1" || /(?:^|[?&])chat=1(?:&|$)/.test(location.search); } catch { return false; } };
  if (flag()) installWeave();
}
export default { installWeave };
