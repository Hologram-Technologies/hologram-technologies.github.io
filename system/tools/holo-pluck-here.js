/* holo-pluck-here.js — TEST THE WHOLE LOOP DIRECTLY IN THE WHATSAPP TAB.
 *
 * Paste into DevTools (F12 → Console) on web.whatsapp.com. Self-contained: no imports, no
 * Hologram origin, no second tab. Hover any message bubble → a κ chip. Click it → an overlay
 * resolves the message FROM THE κ BYTES (decode → re-hash → verify), with WhatsApp's DOM out
 * of the resolve path, and lets you flip a byte to watch it refuse. Mints the SAME κ as the
 * Hologram substrate (witnessed byte-identical): for the "Ilya" bubble expect 6b1178be… /
 * the-future-is-light-phot~kosid-lofuv-tudof.
 */
(() => {
  // ── pure core — byte-identical to holo-pluck.mjs / holo-pluck-inpage.mjs (witnessed) ──
  const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]" :
    (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}" : JSON.stringify(v);
  const headline = (t, n = 6) => String(t || "").replace(/\s+/g, " ").trim().split(" ").slice(0, n).join(" ").slice(0, 48) || "message";
  const buildObj = ({ text = "", sender = "", sentAt = "", chat = "", source = "" }) => ({
    "@context": ["https://schema.org/", { holo: "https://hologram.os/ns#" }],
    "@type": ["schema:Message", "schema:Comment"], "schema:name": headline(text), "schema:text": String(text),
    ...(sender ? { "schema:sender": String(sender) } : {}), ...(sentAt ? { "schema:dateSent": String(sentAt) } : {}),
    ...(chat ? { "schema:isPartOf": String(chat) } : {}), ...(source ? { "holo:capturedFrom": String(source) } : {}),
  });
  const sha256hex = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const addressOf = async (obj) => { const { id, ...c } = obj; return "did:holo:sha256:" + await sha256hex(jcs(c)); };  // strips id, like address()
  const C = "bdfghjklmnprstvz", V = "aiou";
  const quint = (h) => { const x = parseInt(h, 16); return C[(x >> 12) & 15] + V[(x >> 10) & 3] + C[(x >> 6) & 15] + V[(x >> 4) & 3] + C[x & 15]; };
  const slug = (t) => headline(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "holo";
  const truename = (hex, t) => slug(t) + "~" + [0, 1, 2].map((i) => quint(hex.substr(i * 4, 4))).join("-");
  const ipv6 = (hex) => { const b = hex.match(/.{2}/g).slice(0, 16).map((x) => parseInt(x, 16)); b[0] = 0xfd; const g = []; for (let i = 0; i < 16; i += 2) g.push(((b[i] << 8) | b[i + 1]).toString(16)); return g.join(":").replace(/\b0(?::0\b)+/, ":").replace(/:{3,}/, "::"); };
  const b64url = (s) => { const u = new TextEncoder().encode(s); let bin = ""; for (const x of u) bin += String.fromCharCode(x); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };

  const pluck = async (input) => { const o = buildObj(input); const hex = await sha256hex(jcs(o)); o.id = "did:holo:sha256:" + hex; return { object: o, hex, kappa: o.id, truename: truename(hex, input.text), payload: { kappa: o.id, object: o } }; };
  // verify-before-trust: re-derive the (possibly tampered) bytes' address, admit only on match
  const mount = async (payload) => { const claimed = String(payload.kappa || payload.object.id).split(":").pop(); const real = (await addressOf(payload.object)).split(":").pop(); return { ok: real === claimed, claimed, real, object: payload.object }; };

  // ── DOM capture (reads what WhatsApp DREW; touches none of its code) ──
  const readBubble = (row) => {
    const cap = row.querySelector("[data-pre-plain-text]"); const pre = cap && cap.getAttribute("data-pre-plain-text");
    const m = pre && /^\[([^,\]]+),[^\]]*\]\s*(.*?):\s*$/.exec(pre);
    const el = row.querySelector("span.selectable-text") || row.querySelector(".copyable-text span") || cap;
    const ttl = document.querySelector('header [role="button"] span[title]') || document.querySelector("header span[title]");
    return { text: (el && (el.innerText || el.textContent) || "").trim(), sentAt: m ? m[1].trim() : "", sender: m ? m[2].trim() : "", chat: ttl ? (ttl.getAttribute("title") || ttl.textContent || "").trim() : "", source: location.hostname };
  };

  // ── overlay: resolve FROM THE κ (decode → re-hash → verify) + flip-a-byte refusal ──
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  async function openOverlay(token) {
    let working = JSON.parse(JSON.stringify(JSON.parse(decodeURIComponent(escape(atob(token.replace(/-/g, "+").replace(/_/g, "/")))))));
    let ov = document.getElementById("holo-ov");
    if (!ov) { ov = document.createElement("div"); ov.id = "holo-ov"; document.body.appendChild(ov); }
    ov.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.6);display:grid;place-items:center;font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif");
    async function paint() {
      const res = await mount(working);
      const o = working.object, txt = o["schema:text"] || "", hex = res.real, claimed = res.claimed;
      const tn = truename(hex, txt), wrds = ipv6(hex);
      ov.innerHTML = `<div style="max-width:520px;width:92%;background:#0b141a;color:#e9edef;border:1px solid #2a3942;border-radius:16px;overflow:hidden">
        <div style="padding:13px 16px;border-bottom:1px solid #2a3942;display:flex;justify-content:space-between;align-items:center">
          <b>Hologram — resolved from the κ</b><span id="holo-x" style="cursor:pointer;color:#8696a0">✕</span></div>
        <div style="padding:18px">
          <div style="background:#202c33;border-radius:0 8px 8px 8px;padding:8px 11px;max-width:90%">
            ${o["schema:sender"] ? `<div style="color:#53bdeb;font-size:12.5px;font-weight:600">${esc(o["schema:sender"])}</div>` : ""}
            <div style="white-space:pre-wrap">${esc(txt)}</div>
            <div style="text-align:right;color:#8696a0;font-size:11px">${esc(o["schema:dateSent"] || "")} ${res.ok ? "✓✓" : "⚠"}</div></div>
          <div style="margin-top:14px;padding:10px 12px;border-radius:10px;border:1px solid ${res.ok ? "#1f7a44" : "#7a2530"};background:#111b21;display:flex;gap:9px;align-items:flex-start">
            <span style="width:20px;height:20px;border-radius:50%;background:${res.ok ? "#25d366" : "#f15c6d"};color:#000;display:grid;place-items:center;flex:none">${res.ok ? "✓" : "✕"}</span>
            <div>${res.ok
              ? `<b>Verified — re-derived byte-identical.</b><div style="color:#8696a0;font-size:12px">The bytes hash to exactly the κ they claim (Law L5). WhatsApp's DOM is not in this resolve path.</div>`
              : `<b style="color:#ffd7dc">Refused — bytes don't re-derive.</b><div style="color:#8696a0;font-size:12px">Now hash <code style="color:#f15c6d">${esc(hex.slice(0, 8))}</code> ≠ claimed <code>${esc(claimed.slice(0, 8))}</code>. A changed byte changes the κ.</div>`}</div></div>
          <div style="margin-top:12px;font-family:ui-monospace,monospace;font-size:12.5px;color:#aebac1">
            <div>κ&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span style="color:${res.ok ? "#25d366" : "#f15c6d"}">${esc(hex.slice(0, 8))}</span>${esc(hex.slice(8, 28))}…</div>
            <div>name&nbsp;&nbsp;${esc(tn)}</div><div>IPv6&nbsp;&nbsp;${esc(wrds)}</div>
            <div>from&nbsp;&nbsp;${esc(o["holo:capturedFrom"] || "")} — code untouched</div></div>
          <div style="margin-top:16px;display:flex;gap:9px;flex-wrap:wrap">
            <button id="holo-flip" style="font:inherit;padding:8px 13px;border-radius:9px;border:1px solid #7a2530;background:#1d2b33;color:#ffd7dc;cursor:pointer">✎ Flip one byte</button>
            <button id="holo-rest" style="font:inherit;padding:8px 13px;border-radius:9px;border:1px solid #2a3942;background:#1d2b33;color:#e9edef;cursor:pointer">↺ Restore</button>
            <button id="holo-copy" style="font:inherit;padding:8px 13px;border-radius:9px;border:1px solid #2a3942;background:#1d2b33;color:#e9edef;cursor:pointer">⧉ Copy link</button></div></div></div>`;
      ov.querySelector("#holo-x").onclick = () => ov.remove();
      ov.querySelector("#holo-flip").onclick = () => { const t = working.object["schema:text"] || "x"; working.object["schema:text"] = t.slice(0, -1) + (t.slice(-1) === "." ? "!" : "."); paint(); };
      ov.querySelector("#holo-rest").onclick = () => { working = JSON.parse(JSON.stringify(JSON.parse(decodeURIComponent(escape(atob(token.replace(/-/g, "+").replace(/_/g, "/")))))));; paint(); };
      ov.querySelector("#holo-copy").onclick = (e) => { const link = "holo://os/usr/share/frame/holopluck.html#m=" + token; navigator.clipboard.writeText(link).catch(() => {}); e.target.textContent = "✓ copied"; };
    }
    paint();
  }

  // ── chips ──
  const STYLE = "position:absolute;top:4px;right:8px;font:11px/1.4 ui-monospace,monospace;background:#0b141a;color:#8696a0;border:1px solid #2a3942;border-radius:10px;padding:2px 8px;cursor:pointer;z-index:99999;opacity:.9;user-select:none";
  const chipFor = async (row) => {
    if (row.__holo) return; const input = readBubble(row); if (!input.text) return; row.__holo = 1;
    const { hex, truename: tn, payload } = await pluck(input);
    const token = b64url(JSON.stringify(payload));
    const chip = document.createElement("div"); chip.setAttribute("style", STYLE);
    chip.textContent = "κ " + hex.slice(0, 8) + " · resolve →"; chip.title = "Resolve this message from its κ — in this tab";
    chip.onclick = (e) => { e.stopPropagation(); openOverlay(token); };
    if (getComputedStyle(row).position === "static") row.style.position = "relative";
    row.appendChild(chip);
  };
  const sel = "div.message-in, div.message-out, div[role='row']";
  const scan = () => document.querySelectorAll(sel).forEach((r) => r.addEventListener("mouseenter", () => chipFor(r), { once: true }));
  scan(); new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  console.log("%c[holo-pluck] installed — hover a bubble, click the κ chip to resolve it in-tab", "color:#25d366");
})();
