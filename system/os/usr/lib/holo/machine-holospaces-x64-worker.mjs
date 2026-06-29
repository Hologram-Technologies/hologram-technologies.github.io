// machine-holospaces-x64-worker.mjs — boots a REAL Linux dev container in a Worker, IN-MEMORY.
//
// WITNESSED 2026-06-26 on the native CEF host: this path boots real Linux to userspace in a tab — the kernel
// mounts ext4 over virtio-blk, runs /init, prints USERSPACE-OK (CDP-captured). It is the holospaces
// `Workspace.boot_devcontainer(kernel, rootfs)` path: DevcontainerImage.assemble() builds the rootfs in WASM
// memory, so it needs NO OPFS — which matters because this CEF host does NOT support OPFS
// createSyncAccessHandle (it throws SecurityError even with a persistent cache_path profile — a deeper
// CEF/Chromium File-System-Access limitation, not incognito). That blocks the OPFS-streamed x86-64 path
// (X64Workspace.boot_devcontainer_opfs_streamed) AND snapshot/streamed-κ-disk on this host.
//
// HONEST BOUNDARY: Workspace.boot_devcontainer is the riscv/arm in-memory machine (the only Uint8Array-rootfs
// boot in the wasm — X64Workspace exposes ONLY OPFS-handle boots). So in-memory ⇒ riscv/arm; true x86-64 and
// the streamed κ-disk need OPFS SyncAccessHandle enabled in the host (the next milestone). The devcontainer
// layer is a witness-init that reaches USERSPACE-OK then powers down; an interactive shell needs an Alpine
// layer + a persistent-shell init.
//   • assets by ABSOLUTE /holospaces/* URL (host seam) · continuous run loop · screen out / keystrokes in.

let ws = null;
const enc = new TextEncoder();
const gunzip = async (buf) =>
  new Uint8Array(await new Response(new Response(buf).body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
const fetchBytes = async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer());

async function boot(base) {
  const mod = await import(base + "pkg/holospaces_web.js");
  await mod.default();                                          // init() → fetches pkg/holospaces_web_bg.wasm
  const { DevcontainerImage, Workspace } = mod;

  const kernel = await gunzip(await fetchBytes(base + "devcontainer-kernel.gz")); // riscv devcontainer kernel
  const layer  = await fetchBytes(base + "devcontainer-layer.tar.gz");            // the OCI overlay

  const img = new DevcontainerImage();
  img.add_layer("application/vnd.oci.image.layer.v1.tar+gzip", layer);
  const rootfs = img.assemble();                                // gunzip + untar + overlay + ext4, IN WASM (no OPFS)
  ws = Workspace.boot_devcontainer(kernel, rootfs);             // boot over virtio-blk from the in-RAM image
  postMessage({ kind: "booted" });

  let last = "";
  const SLICE = 8_000_000;
  const tick = () => {
    let halted = false;
    try { halted = ws.run(SLICE); } catch (e) { postMessage({ kind: "error", error: String(e && e.stack || e) }); return; }
    const screen = ws.terminal();
    if (screen !== last) { last = screen; postMessage({ kind: "term", text: screen }); }
    if (halted) { postMessage({ kind: "halted" }); return; }
    setTimeout(tick, 0);
  };
  tick();
}

onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.kind === "boot") await boot(m.base || "/holospaces/");
    else if (m.kind === "input" && ws) ws.feed_input(enc.encode(m.data));
  } catch (err) { postMessage({ kind: "error", error: String(err && err.stack || err) }); }
};
