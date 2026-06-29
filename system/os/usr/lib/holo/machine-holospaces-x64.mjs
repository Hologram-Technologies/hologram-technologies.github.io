// machine-holospaces-x64.mjs — the `holospaces-x64` machine adapter for mount(κ).
//
// realize() spawns the boot worker (machine-holospaces-x64-worker.mjs), renders the live guest terminal into
// the tab's surface, and relays keystrokes back into the guest. It registers itself into the Machines registry,
// so mount(κ) of ANY manifest whose `machine` is the holospaces-x64 κ boots a real x86-64 Linux dev container
// in that tab — one boot path shared with Holo Workspace, no duplicate.
//
// Isolation is intrinsic: a guest kernel, running in a Worker, fed by an OPFS κ-disk — stronger than a Chrome
// process. The boot itself is the holospaces repo's witnessed capability; this is the thin tab-side wrapper.

import { Machines } from "./holospace.mjs";

// the machine κ — the stable content-address of this adapter's contract (the manifest's `machine` field).
export const HOLOSPACES_X64 = "did:holo:blake3:" + "78016c64".padEnd(64, "0"); // 0x78='x' 0x64='d' — mnemonic, stable
// the host serve seam (kappa_scheme.cc route req="/os/holospaces/*"). On a holo://os page, "os" is the
// AUTHORITY, so the absolute PATH is "/holospaces/…" → resolves to holo://os/holospaces/… → req "/os/holospaces/…".
const BASE = "/holospaces/";
const WORKER_URL = new URL("./machine-holospaces-x64-worker.mjs", import.meta.url);

// a minimal, dependency-free terminal: a <pre> that shows the guest screen and turns key presses into guest
// input. (v1 renders raw screen text; xterm rendering of ANSI is a later polish — Holo Workspace already
// κ-vendors xterm and can be swapped in here behind the same write()/onKey() seam.)
function makeTerminal(surface) {
  surface.textContent = "";
  const pre = surface.ownerDocument.createElement("pre");
  pre.setAttribute("tabindex", "0");
  pre.style.cssText =
    "margin:0;width:100%;height:100%;overflow:auto;background:#07070c;color:#cfe;outline:none;" +
    "font:13px/1.35 ui-monospace,Menlo,Consolas,monospace;padding:10px;box-sizing:border-box;white-space:pre-wrap;";
  surface.appendChild(pre);
  pre.focus();
  return {
    write: (text) => { pre.textContent = text; pre.scrollTop = pre.scrollHeight; },
    onKey: (send) =>
      pre.addEventListener("keydown", (ev) => {
        let s = null;
        if (ev.key === "Enter") s = "\n";
        else if (ev.key === "Backspace") s = "\x7f";
        else if (ev.key === "Tab") s = "\t";
        else if (ev.key === "Escape") s = "\x1b";
        else if (ev.ctrlKey && ev.key.length === 1) s = String.fromCharCode(ev.key.toUpperCase().charCodeAt(0) & 0x1f);
        else if (ev.key.length === 1 && !ev.metaKey) s = ev.key;
        if (s !== null) { ev.preventDefault(); send(s); }
      }),
  };
}

export const adapter = {
  // realize(imageκ, params, snapshot, surface) → a live x86-64 dev container in `surface`.
  // (snapshot/restore is the next step — boot_devcontainer_opfs_streamed already pages from an OPFS pack, so a
  // captured pack κ becomes the resume point; not yet wired here.)
  realize(imageKappa, params = {}, snapshot = null, surface) {
    const term = makeTerminal(surface);
    term.write("Streaming x86-64 Linux…\n");
    const worker = new Worker(WORKER_URL, { type: "module" });
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.kind === "term") term.write(m.text);
      else if (m.kind === "error") term.write("\n[holospace error] " + m.error + "\n");
    };
    term.onKey((data) => worker.postMessage({ kind: "input", data }));
    // unique OPFS namespace per boot: a FileSystemSyncAccessHandle is exclusive-per-file, so reusing a name
    // across boots collides with a still-open handle (SecurityError). Uniqueness sidesteps it; snapshot/resume
    // (S6) will key the disk by the manifest's snapshot κ instead.
    const ns = "hs-" + String(imageKappa || "x64").slice(-8) + "-" + Date.now().toString(36);
    worker.postMessage({ kind: "boot", base: BASE, opts: { ns, diskMiB: params.diskMiB || 256 } });
    return { worker, terminal: term, dispose: () => worker.terminate() };
  },
};

// register into the process-wide registry (browser only).
if (typeof window !== "undefined") Machines.register(HOLOSPACES_X64, adapter);

export default adapter;
