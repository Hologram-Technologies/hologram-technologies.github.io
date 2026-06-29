// Sealed riscv workspace boot worker — page navigates via the sealed OS route (148-safe); runtime/kernel fetched
// from the /holospaces/* dev-seam (subresource fetch works on 148). Observable (yields + terminal deltas) + input.
import init, { Workspace } from "/holospaces/pkg/holospaces_web.js";
const gunzip = async (b) => new Uint8Array(await new Response(new Response(b).body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
const bytes = async (p) => new Uint8Array(await (await fetch(p)).arrayBuffer());
let ws = null;
async function boot() {
  postMessage({ kind: "stage", s: "init" }); await init();
  postMessage({ kind: "stage", s: "fetch kernel+dtb" });
  const kernel = await gunzip(await bytes("/holospaces/workspace-kernel.gz"));
  const dtb = await bytes("/holospaces/workspace.dtb");
  postMessage({ kind: "stage", s: "Workspace.boot" });
  ws = Workspace.boot(kernel, dtb, 128 * 1024 * 1024, 0x80000000, 0x87000000);
  postMessage({ kind: "booted" });
  let last = "";
  const tick = () => { let halted = false;
    try { for (let k = 0; k < 24 && !halted; k++) halted = ws.run(2_000_000); }
    catch (e) { postMessage({ kind: "error", error: String(e && e.stack || e) }); return; }
    const t = ws.terminal(); if (t !== last) { last = t; postMessage({ kind: "term", text: t }); }
    if (halted) { postMessage({ kind: "halted" }); return; } setTimeout(tick, 0); };
  tick();
}
// suspend → the live VM state bytes (the page seals them under the TEE key via holospace-lifecycle.snapshot);
// resume → load a snapshot back (the page has already openState'd it — owner+TEE only — before handing bytes here).
onmessage = (e) => {
  const m = e.data || {};
  if (m.kind === "boot") boot();
  else if (m.kind === "input" && ws) ws.feed_input(new TextEncoder().encode(m.data));
  else if (m.kind === "suspend" && ws) {
    try { const b = ws.suspend(); postMessage({ kind: "suspended", bytes: b }, [b.buffer]); }
    catch (err) { postMessage({ kind: "error", error: "suspend: " + String(err && err.stack || err) }); }
  } else if (m.kind === "resume" && ws) {
    try { ws.resume_devcontainer(m.bytes); postMessage({ kind: "resumed" }); }
    catch (err) { postMessage({ kind: "error", error: "resume: " + String(err && err.stack || err) }); }
  }
};
