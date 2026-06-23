/* holo-pluck-paste.js — PASTE INTO DEVTOOLS on the live web.whatsapp.com tab.
 *
 * Self-contained (no imports, no Hologram origin, no CSP fetch) so it runs in WhatsApp's
 * own page world untouched. Mints the SAME κ as the Hologram substrate (holo-pluck.mjs):
 * same JCS, same SHA-256, same proquint truename — witnessed byte-identical.
 *
 * Hover any message bubble → a κ chip appears. Click it → the holo:// link is copied and
 * the full κ-object is logged. Open that link in a Hologram surface (holospace.html) and it
 * mounts byte-identical, verify-before-trust, with WhatsApp closed.
 *
 * For the test target — the "Ilya" bubble "The future is light photonics. HOLOGRAM." at
 * 08:31 in the "Ilya" chat — expect:
 *   κ        6b1178bedc62cecc77670238dc8d9070df066c3be0f7a3d09bf0c87a300e53de
 *   truename the-future-is-light-phot~kosid-lofuv-tudof
 * (κ commits to EXACTLY the drawn strings; a different time/sender/chat → a different κ.)
 */
(() => {
  const jcs = (v) =>
    Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]" :
    (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}" :
    JSON.stringify(v);
  const headline = (t, n = 6) => String(t || "").replace(/\s+/g, " ").trim().split(" ").slice(0, n).join(" ").slice(0, 48) || "message";
  const buildObj = ({ text = "", sender = "", sentAt = "", chat = "", source = "" }) => ({
    "@context": ["https://schema.org/", { holo: "https://hologram.os/ns#" }],
    "@type": ["schema:Message", "schema:Comment"],
    "schema:name": headline(text), "schema:text": String(text),
    ...(sender ? { "schema:sender": String(sender) } : {}),
    ...(sentAt ? { "schema:dateSent": String(sentAt) } : {}),
    ...(chat ? { "schema:isPartOf": String(chat) } : {}),
    ...(source ? { "holo:capturedFrom": String(source) } : {}),
  });
  const sha256hex = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const C = "bdfghjklmnprstvz", V = "aiou";
  const quint = (h) => { const x = parseInt(h, 16); return C[(x >> 12) & 15] + V[(x >> 10) & 3] + C[(x >> 6) & 15] + V[(x >> 4) & 3] + C[x & 15]; };
  const slug = (t) => headline(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "holo";
  const truename = (hex, t) => slug(t) + "~" + [0, 1, 2].map((i) => quint(hex.substr(i * 4, 4))).join("-");
  const pluck = async (input) => { const o = buildObj(input); const hex = await sha256hex(jcs(o)); o.id = "did:holo:sha256:" + hex; return { object: o, hex, kappa: o.id, truename: truename(hex, input.text), holoLink: "holo://" + hex }; };

  const readBubble = (row) => {
    const cap = row.querySelector("[data-pre-plain-text]");
    const pre = cap && cap.getAttribute("data-pre-plain-text");
    const m = pre && /^\[([^,\]]+),[^\]]*\]\s*(.*?):\s*$/.exec(pre);
    const el = row.querySelector("span.selectable-text") || row.querySelector(".copyable-text span") || cap;
    const ttl = document.querySelector('header [role="button"] span[title]') || document.querySelector("header span[title]");
    return { text: (el && (el.innerText || el.textContent) || "").trim(), sentAt: m ? m[1].trim() : "", sender: m ? m[2].trim() : "", chat: ttl ? (ttl.getAttribute("title") || ttl.textContent || "").trim() : "", source: location.hostname };
  };

  const STYLE = "position:absolute;top:4px;right:8px;font:11px/1.4 ui-monospace,monospace;background:#0b141a;color:#8696a0;border:1px solid #2a3942;border-radius:10px;padding:2px 8px;cursor:pointer;z-index:99999;opacity:.9;user-select:none";
  const chipFor = async (row) => {
    if (row.__holo) return; const input = readBubble(row); if (!input.text) return; row.__holo = 1;
    const { kappa, hex, truename: tn, holoLink, object } = await pluck(input);
    const chip = document.createElement("div"); chip.setAttribute("style", STYLE);
    chip.textContent = "κ " + hex.slice(0, 8) + " · " + tn; chip.title = "Pluck into eternity — copy " + holoLink;
    chip.onclick = async (e) => { e.stopPropagation(); try { await navigator.clipboard.writeText(holoLink); } catch {} chip.textContent = "✓ minted · " + hex.slice(0, 8); console.log("[holo-pluck]", { kappa, truename: tn, holoLink, object }); };
    if (getComputedStyle(row).position === "static") row.style.position = "relative";
    row.appendChild(chip);
  };
  const sel = "div.message-in, div.message-out, div[role='row']";
  const scan = () => document.querySelectorAll(sel).forEach((r) => r.addEventListener("mouseenter", () => chipFor(r), { once: true }));
  scan(); new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  console.log("%c[holo-pluck] installed — hover any message bubble to mint its κ", "color:#25d366");
})();
