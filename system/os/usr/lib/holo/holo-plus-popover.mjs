// holo-plus-popover.mjs — "The + Everywhere" A1 (UI). The small panel the "+" opens. Listens for the
// holo-plus-invoke event A0 (holo-plus-ambient) emits, anchors a popover by the invoking input, and offers the
// three intake modes — Upload a file · Paste a link · Link a holo object by κ — then runs the reflex (runPlus) on
// whatever was offered and emits holo-plus-result. Result ROUTING (chip vs brief vs Q) is A6; context is A2/A3;
// here the popover just runs intake → runPlus and shows the proactive lines inline. Self-initialising per document
// (like holo-sound / the ambient injector); browser-only. Imports the witnessed pure cores — no new logic here.

import { intakeToInputs, browserResolver, isHoloRef } from "./holo-plus-intake.mjs";
import { captureContext } from "./holo-plus-context.mjs";

const CSS = `
.holo-plus-pop{position:absolute;z-index:2147483601;width:320px;max-width:92vw;background:var(--holo-surface,#11141c);
 color:var(--holo-ink,#e8ecf5);border:1px solid var(--holo-border,#222838);border-radius:14px;
 box-shadow:0 18px 50px rgba(0,0,0,.5);font:14px/1.5 ui-sans-serif,system-ui,sans-serif;padding:.8rem;}
.holo-plus-pop h4{margin:.1rem 0 .6rem;font:700 .8rem ui-sans-serif;letter-spacing:.02em;}
.holo-plus-pop .mode{display:flex;gap:.4rem;align-items:center;margin:.35rem 0;}
.holo-plus-pop input[type=text]{flex:1 1 auto;min-width:0;background:var(--holo-bg,#0a0c12);color:inherit;
 border:1px solid var(--holo-border,#222838);border-radius:8px;padding:.4rem .55rem;font:.85rem ui-monospace,monospace;}
.holo-plus-pop button{background:transparent;color:var(--holo-ink,#e8ecf5);border:1px solid var(--holo-border,#222838);
 border-radius:8px;padding:.4rem .6rem;font:.82rem ui-sans-serif;cursor:pointer;white-space:nowrap;}
.holo-plus-pop button.go{background:var(--holo-accent,#ff5c8a);color:#fff;border:0;font-weight:700;}
.holo-plus-pop .res{margin-top:.6rem;border-top:1px solid var(--holo-border,#222838);padding-top:.5rem;
 font:.8rem ui-sans-serif;color:var(--holo-ink-dim,#8b93a7);max-height:200px;overflow:auto;}
.holo-plus-pop .res .ln{padding:.2rem 0;color:var(--holo-ink,#e8ecf5);}
.holo-plus-pop .res .ln b{color:var(--holo-accent,#ff5c8a);}`;

export function makePopover({ doc = document, win = window, run = null } = {}) {
  let host = null, fileInput = null, hiddenFiles = [];
  const ensureStyle = () => { if (!doc.getElementById("holo-plus-pop-css")) { const s = doc.createElement("style"); s.id = "holo-plus-pop-css"; s.textContent = CSS; (doc.head || doc.documentElement).appendChild(s); } };
  const close = () => { if (host) { host.remove(); host = null; hiddenFiles = []; } };

  function open(target, side) {
    ensureStyle(); close();
    host = doc.createElement("div");
    host.className = "holo-plus-pop"; host.setAttribute("data-holo-plus-ui", "1");
    host.innerHTML = `<h4>Add to context — the +</h4>
      <div class="mode"><button data-act="file" data-holo-plus-ui="1">Upload file…</button><span style="color:var(--holo-ink-dim,#8b93a7);font-size:.78rem" data-files>none</span></div>
      <div class="mode"><input type="text" data-holo-plus-ui="1" data-url placeholder="Paste a link (https://…)"></div>
      <div class="mode"><input type="text" data-holo-plus-ui="1" data-obj placeholder="Link a holo object (κ / holo://…)"></div>
      <div class="mode" style="justify-content:flex-end;gap:.5rem"><button data-act="cancel" data-holo-plus-ui="1">Cancel</button><button class="go" data-act="go" data-holo-plus-ui="1">Process →</button></div>
      <div class="res" data-res hidden></div>`;
    // position by the input (absolute overlay, like the "+")
    const r = target.getBoundingClientRect ? target.getBoundingClientRect() : { bottom: 40, left: 20 };
    host.style.top = ((win.scrollY || 0) + r.bottom + 6) + "px";
    host.style.left = ((win.scrollX || 0) + Math.max(8, r.left)) + "px";
    (doc.body || doc.documentElement).appendChild(host);

    fileInput = doc.createElement("input"); fileInput.type = "file"; fileInput.multiple = true; fileInput.style.display = "none";
    fileInput.setAttribute("data-holo-plus-ui", "1"); host.appendChild(fileInput);
    fileInput.addEventListener("change", () => { hiddenFiles = [...fileInput.files]; host.querySelector("[data-files]").textContent = hiddenFiles.length ? hiddenFiles.map((f) => f.name).join(", ") : "none"; });

    host.addEventListener("click", async (e) => {
      const act = e.target && e.target.getAttribute && e.target.getAttribute("data-act");
      if (act === "file") fileInput.click();
      else if (act === "cancel") close();
      else if (act === "go") await process(target);
    });
    host.querySelector("[data-obj]").focus();
    const onDoc = (e) => { if (host && !host.contains(e.target) && e.target !== target) { close(); doc.removeEventListener("pointerdown", onDoc, true); } };
    setTimeout(() => doc.addEventListener("pointerdown", onDoc, true), 0);
    win.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); }, { once: true });
  }

  async function process(target) {
    const url = host.querySelector("[data-url]").value.trim();
    const obj = host.querySelector("[data-obj]").value.trim();
    const res = host.querySelector("[data-res]"); res.hidden = false; res.innerHTML = `<span style="color:var(--holo-accent,#ff5c8a)">processing…</span>`;
    try {
      const links = url ? [url] : [], objects = (obj && isHoloRef(obj)) ? [obj] : [];
      if (obj && !objects.length) { res.innerHTML = `<span style="color:var(--holo-danger,#ff6b6b)">that doesn't look like a holo κ</span>`; return; }
      const inputs = await intakeToInputs({ files: hiddenFiles, links, objects }, { resolve: browserResolver({}), fetchImpl: (typeof fetch !== "undefined" ? fetch : null) });
      if (!inputs.length) { res.innerHTML = `<span style="color:var(--holo-ink-dim,#8b93a7)">add a file, link, or κ first</span>`; return; }
      const context = captureContext({ target });   // A2: the local surface — what you're doing right now
      const out = await (run ? run(inputs, { target, context }) : defaultRun(inputs, context));
      renderResult(res, out);
      // hand the whole result to whoever wants it (A4 Q fusion / A6 routing listen for this)
      target.dispatchEvent(new win.CustomEvent("holo-plus-result", { bubbles: true, detail: { result: out, target } }));
    } catch (e) { res.innerHTML = `<span style="color:var(--holo-danger,#ff6b6b)">${(e && e.message) || e}</span>`; }
  }

  async function defaultRun(inputs, context = null) {
    const { runPlus, bindQ } = await import("./holo-plus.mjs");
    const tap = (win.HoloTap && typeof win.HoloTap.observeIngest === "function") ? win.HoloTap : null;
    // Graceful brain upgrade (silent over the deterministic baseline): use Q's FAST text model for
    // extraction/insight when it's warm, so the "+" stays fast; absent → bindQ({}) → baseline. Never blocks.
    const hv = win.HoloVoice;
    const brain = (hv && typeof hv.quick === "function") ? { generate: (p) => hv.quick(p) }
                : (win.Q && typeof win.Q.generate === "function") ? win.Q : null;
    let q = {};
    try { q = await bindQ(brain); } catch (e) { q = {}; }
    // FILE the verified brief to the Inbox as a proactive "letter" (three-category holo-notify) so the
    // insight PERSISTS past this popover — unrequested, surfaced gently, never demanding. holo-brief.deliver()
    // RENDERS first (verify-before-show, L5), so the sink only ever sees verified claims. Absent Inbox → no-op.
    const sink = async (b) => {
      try {
        const n = win.HoloNotify;
        if (n && typeof n.q === "function") {
          n.q({ category: "letter", sender: "Q", title: b.title || "What the + found", body: b.body || "", deepLink: b.briefKappa ? "brief:" + b.briefKappa : undefined });
          return { delivered: true };
        }
      } catch (e) {}
      return { delivered: false };
    };
    return runPlus(inputs, { tap, context, title: "What the + found", ...q, sink });
  }
  function renderResult(res, out) {
    const items = (out.brief && out.brief["holo:items"]) || out.insights || [];
    res.innerHTML = items.length
      ? `<div style="margin-bottom:.3rem">Found ${items.length}:</div>` + items.slice(0, 6).map((i) => `<div class="ln">• ${esc(i["schema:text"])} <b>(${(i["holo:confidence"]*100)|0}%)</b></div>`).join("")
      : `<div class="ln">ingested ${out.graph ? out.graph["holo:stats"].entities : 0} entities — nothing flagged yet.</div>`;
  }
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  return { open, close };
}

// ── self-init: one popover per document, wired to the ambient injector's invoke event ───────────────
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const W = window;
  if (!W.HoloPlusPopover) {
    const pop = makePopover({});
    W.HoloPlusPopover = pop;
    document.addEventListener("holo-plus-invoke", (e) => {
      const target = e.target, side = (e.detail && e.detail.side) || "right";
      pop.open(target, side);
    });
  }
}

export default { makePopover };
