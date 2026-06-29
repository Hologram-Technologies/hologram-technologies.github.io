// alpine-worker.mjs — the DEVCONTAINER machine (full Alpine riscv64 userland) for the sovereign holospace.
// Sealed page navigates via the OS route (148-safe, survives boot via the baked --disable-hang-monitor); the large
// PUBLIC kernel/rootfs-layer are fetched by κ from the /holospaces/* dev-seam (subresource fetch). This is the
// machine whose suspend()/resume_devcontainer() are the matched pair (engine .d.ts) — so it snapshots and resumes.
import init, { DevcontainerImage, Workspace } from "/holospaces/pkg/holospaces_web.js";
const gunzip = async (b) => new Uint8Array(await new Response(new Response(b).body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
const bytes  = async (p) => new Uint8Array(await (await fetch(p)).arrayBuffer());
let ws = null;

function pump() {
  let last = "";
  const tick = () => { let halted = false;
    try { for (let k = 0; k < 24 && !halted; k++) halted = ws.run(2_000_000); }
    catch (e) { postMessage({ kind: "error", error: String(e && e.stack || e) }); return; }
    const t = ws.terminal(); if (t !== last) { last = t; postMessage({ kind: "term", text: t }); }
    if (halted) { postMessage({ kind: "halted" }); return; } setTimeout(tick, 0); };
  tick();
}

// cold boot the full Alpine devcontainer (public kernel + OCI layer → assemble_bootable → boot_devcontainer)
async function boot() {
  postMessage({ kind: "stage", s: "init" }); await init();
  postMessage({ kind: "stage", s: "fetch riscv kernel + alpine layer (by κ)" });
  const kernel = await gunzip(await bytes("/holospaces/devcontainer-kernel.gz"));
  const layer  = await bytes("/holospaces/alpine-riscv64-layer.tar.gz");
  postMessage({ kind: "stage", s: "assemble_bootable (128MB)" });
  const img = new DevcontainerImage();
  img.add_layer("application/vnd.oci.image.layer.v1.tar+gzip", layer);
  // 128MB disk: minimal Alpine needs ~little; a smaller disk halves the renderer's memory footprint vs 256MB
  // (the 256MB allocation was killing the renderer — RESULT_CODE_KILLED — within seconds on the heavy assemble).
  const rootfs = img.assemble_bootable(128 * 1024 * 1024);
  postMessage({ kind: "stage", s: "boot_devcontainer" });
  ws = Workspace.boot_devcontainer(kernel, rootfs);
  postMessage({ kind: "booted", resumed: false });
  pump();
}

// INSTANT resume: the page already openState'd the snapshot (owner + TEE only) and hands the plaintext bytes here.
async function resume(snapshot) {
  postMessage({ kind: "stage", s: "init" }); await init();
  postMessage({ kind: "stage", s: "resume_devcontainer (skip cold boot)" });
  ws = Workspace.resume_devcontainer(snapshot);   // CPU+RAM+rootfs+9p workspace files come back exactly
  postMessage({ kind: "booted", resumed: true });
  pump();
}

onmessage = (e) => {
  const m = e.data || {};
  if (m.kind === "boot") boot();
  else if (m.kind === "resume" && m.bytes) resume(m.bytes);
  else if (m.kind === "input" && ws) ws.feed_input(new TextEncoder().encode(m.data));
  else if (m.kind === "suspend" && ws) {
    // snapshot the live machine → the page seals these bytes under the TEE key (holospace-lifecycle.snapshot)
    try { const b = ws.suspend(); postMessage({ kind: "suspended", bytes: b }, [b.buffer]); }
    catch (err) { postMessage({ kind: "error", error: "suspend: " + String(err && err.stack || err) }); }
  }
};
