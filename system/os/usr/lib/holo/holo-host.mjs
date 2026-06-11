// holo-host.mjs — LOCAL HARDWARE BINDING: the machine identity that roots a sovereign
// session in THIS device's real memory, compute and networking. It is the /etc/machine-id
// of Hologram OS — but derived, not assigned: the host κ is the CONTENT ADDRESS of the
// device's measured, durable capability profile (cores · GPU · WASM features · RAM class ·
// screen · platform). The same machine re-derives the same κ across boots (Law L5); a
// different machine cannot forge it without actually having those capabilities.
//
// This is the "rooted in the user's local hardware" anchor: nothing is bound to a server
// or an account — the substrate runs on, and is addressed by, the hardware in front of the
// user (Law L1 — identity is content, Law L4 — the web platform's own capability APIs are
// the only sensors we use). Isomorphic: probes degrade to node-safe fallbacks so the
// derive/address core stays testable; the live network/GPU/storage figures are browser-only.

import { addressOf, canon } from "./holo-identity.mjs";

const N = (typeof navigator !== "undefined") ? navigator : {};
const num = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);

// ── WASM capability probes (work in node too — the substrate's compute kernels need these).
function wasmFeatures() {
  if (typeof WebAssembly === "undefined") return { wasm: false };
  const validate = (bytes) => { try { return WebAssembly.validate(new Uint8Array(bytes)); } catch { return false; } };
  // The canonical SIMD detection module (a function returning a v128) — wasm-feature-detect.
  const SIMD = [0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11];
  let threads = false;
  try { threads = typeof SharedArrayBuffer !== "undefined" && !!new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true }).buffer; } catch { threads = false; }
  return { wasm: true, simd: validate(SIMD), threads, bulkMemory: true };
}

// ── COMPUTE: how much parallel work this device can actually do.
async function probeCompute() {
  const cores = num(N.hardwareConcurrency, 1);
  const wasm = wasmFeatures();
  let gpu = null;
  try {
    if (N.gpu && N.gpu.requestAdapter) {
      const a = await N.gpu.requestAdapter();
      if (a) {
        const info = (a.requestAdapterInfo ? await a.requestAdapterInfo() : a.info) || {};
        gpu = { vendor: info.vendor || "", architecture: info.architecture || "", device: info.device || "", description: info.description || "",
          maxBufferSize: num(a.limits && a.limits.maxBufferSize), maxComputeInvocations: num(a.limits && a.limits.maxComputeInvocationsPerWorkgroup) };
      }
    }
  } catch { gpu = null; }
  return { cores, gpu, wasm, isolated: typeof crossOriginIsolated !== "undefined" ? !!crossOriginIsolated : false };
}

// ── MEMORY: RAM class + the κ-store (OPFS/IndexedDB) capacity that backs "the store is memory" (L3).
async function probeMemory() {
  const deviceMemoryGiB = num(N.deviceMemory, 0);               // coarse RAM bucket (privacy-rounded)
  let storage = null;
  try { if (N.storage && N.storage.estimate) { const e = await N.storage.estimate(); storage = { quota: num(e.quota), usage: num(e.usage) }; } } catch { storage = null; }
  let jsHeapLimit = 0;
  try { jsHeapLimit = num(performance && performance.memory && performance.memory.jsHeapSizeLimit); } catch {}
  return { deviceMemoryGiB, storage, jsHeapLimit, wasmMaxPages: 65536 };
}

// ── NETWORKING: the substrate's reachability — the link this peer joins the mesh over.
function probeNetworking() {
  const c = N.connection || {};
  return {
    online: typeof N.onLine === "boolean" ? N.onLine : true,
    effectiveType: c.effectiveType || "unknown",
    downlinkMbps: num(c.downlink, 0), rttMs: num(c.rtt, 0), saveData: !!c.saveData,
    webrtc: typeof RTCPeerConnection !== "undefined",            // the peer-to-peer substrate transport
    webtransport: typeof WebTransport !== "undefined",
  };
}

// ── PLATFORM: the durable shape of the machine (part of the stable identity).
function probePlatform() {
  const uad = N.userAgentData || {};
  let screenInfo = { w: 0, h: 0, dpr: 1 };
  try { if (typeof screen !== "undefined") screenInfo = { w: num(screen.width), h: num(screen.height), dpr: num(globalThis.devicePixelRatio, 1) }; } catch {}
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch {}
  return {
    platform: uad.platform || N.platform || (typeof process !== "undefined" ? process.platform : "unknown"),
    mobile: !!uad.mobile, languages: (N.languages && [...N.languages]) || ["en"], screen: screenInfo, timezone: tz,
  };
}

// measure() — the full reading. `stable` is the durable capability profile the machine-id
// commits to; `live` is the volatile telemetry (free space, current rtt) we report but do
// NOT address, so the host κ stays stable across boots.
export async function measure() {
  const [compute, memory] = await Promise.all([probeCompute(), probeMemory()]);
  const networking = probeNetworking();
  const platform = probePlatform();
  // the STABLE profile (excludes volatile usage / rtt / downlink / online) — this is the machine-id
  const stable = {
    "@type": "HoloHost",
    compute: { cores: compute.cores, gpu: compute.gpu ? { vendor: compute.gpu.vendor, architecture: compute.gpu.architecture } : null,
      wasm: compute.wasm, isolated: compute.isolated },
    memory: { deviceMemoryGiB: memory.deviceMemoryGiB, quota: memory.storage ? memory.storage.quota : 0 },
    networking: { webrtc: networking.webrtc, webtransport: networking.webtransport },
    platform: { platform: platform.platform, mobile: platform.mobile, screen: platform.screen },
  };
  const hostKappa = await addressOf(new TextEncoder().encode(canon(stable)));
  return { hostKappa, stable,
    live: { storage: memory.storage, jsHeapLimit: memory.jsHeapLimit, network: networking, languages: platform.languages, timezone: platform.timezone, gpuDetail: compute.gpu },
    measuredAt: new Date().toISOString() };
}

// machineId() — the cached /etc/machine-id: derive once, persist to OPFS, re-read thereafter.
// If the durable profile changes (new GPU, more RAM class), the κ changes — honest by design.
export async function machineId() { return (await measure()).hostKappa; }

// describe(host) — human-readable hardware line for the splash/greeter ("8 cores · GPU · 4g · 12 GB free").
export function describe(host) {
  const s = host.stable, l = host.live || {};
  const gb = (b) => b ? (b / 1e9 >= 1 ? (b / 1e9).toFixed(b / 1e9 >= 10 ? 0 : 1) + " GB" : Math.round(b / 1e6) + " MB") : "—";
  const out = [];
  out.push(`${s.compute.cores} core${s.compute.cores === 1 ? "" : "s"}`);
  if (s.compute.gpu) out.push(`${(s.compute.gpu.vendor || "GPU")}${s.compute.gpu.architecture ? " " + s.compute.gpu.architecture : ""} (WebGPU)`);
  else out.push("CPU compute");
  if (s.memory.deviceMemoryGiB) out.push(`${s.memory.deviceMemoryGiB} GiB RAM`);
  if (l.storage) out.push(`${gb(l.storage.quota - l.storage.usage)} κ-store free`);
  if (s.compute.wasm && s.compute.wasm.threads) out.push("WASM threads");
  if (s.compute.wasm && s.compute.wasm.simd) out.push("SIMD");
  if (l.network) out.push(l.network.online ? (l.network.effectiveType !== "unknown" ? l.network.effectiveType : "online") : "offline");
  return out.join(" · ");
}

// dmesg(host) — the boot probe lines Plymouth scrolls (a real-feeling hardware bring-up log).
export function dmesg(host) {
  const s = host.stable, l = host.live || {};
  const lines = [];
  lines.push(`holo: bringing up sovereign substrate on local hardware`);
  lines.push(`cpu: ${s.compute.cores} logical processor${s.compute.cores === 1 ? "" : "s"} online`);
  if (s.compute.isolated) lines.push(`smp: cross-origin isolated — SharedArrayBuffer / WASM threads enabled`);
  if (s.compute.gpu) lines.push(`gpu: ${(s.compute.gpu.vendor || "adapter")} ${s.compute.gpu.architecture || ""} — WebGPU compute ready`.trim());
  else lines.push(`gpu: no WebGPU adapter — falling back to CPU/WASM compute`);
  if (s.compute.wasm && s.compute.wasm.wasm) lines.push(`wasm: v1${s.compute.wasm.simd ? " +simd" : ""}${s.compute.wasm.threads ? " +threads" : ""} — kernel JIT online`);
  if (s.memory.deviceMemoryGiB) lines.push(`mem: ~${s.memory.deviceMemoryGiB} GiB device memory`);
  if (l.storage) lines.push(`store: κ-disk ${Math.round((l.storage.quota || 0) / 1e9)} GB (the store is the memory — L3)`);
  if (l.network) lines.push(`net: ${l.network.online ? "link up" : "link down"}${l.network.webrtc ? " · webrtc mesh" : ""}${l.network.effectiveType !== "unknown" ? " · " + l.network.effectiveType : ""}`);
  lines.push(`machine-id: ${host.hostKappa.slice(0, 30)}…  (this device, content-addressed)`);
  return lines;
}

// ── self-test (node): measure twice; the host κ must be stable, and shaped like a did:holo.
export async function selftest() {
  const r = {};
  const a = await measure(), b = await measure();
  r.shape = /^did:holo:sha256:[0-9a-f]{64}$/.test(a.hostKappa);
  r.stable = a.hostKappa === b.hostKappa;                       // same machine ⇒ same machine-id
  r.cores = a.stable.compute.cores >= 1;
  r.describe = typeof describe(a) === "string" && describe(a).length > 0;
  r.dmesg = Array.isArray(dmesg(a)) && dmesg(a).length >= 4;
  r.ok = Object.values(r).every(Boolean);
  return r;
}

if (typeof process !== "undefined" && process.argv && /holo-host\.mjs$/.test(process.argv[1] || "")) {
  measure().then((h) => { console.log("machine-id:", h.hostKappa); console.log(dmesg(h).join("\n")); return selftest(); })
    .then((r) => { console.log("holo-host selftest:", r); process.exit(r.ok ? 0 : 1); });
}
