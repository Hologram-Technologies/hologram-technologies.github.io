// holo-tor-host.mjs — MANAGED Tor for the native / dev host (the Brave model: run real Tor for the user so
// onion "just works" with no manual install). This is the piece that turns ADR-0103's auto-detected SOCKS5
// transport into a zero-install experience: if no Tor is already listening, the host provisions one.
//
// HOLO-NATIVE TWIST (Law L5 on an executable): the Tor binary is a κ-addressed substrate object. Before it
// is ever launched it is RE-DERIVED against its pinned κ — a tampered / wrong binary is REFUSED, never run.
// You never execute an unverified Tor. If no κ is pinned, we refuse to download-and-run at all (fail honest,
// not fail open). A binary already vendored on disk is verified the same way.
//
// HONESTY (decided with the operator): anonymity is NOT a goal here — this is "discover + browse the onion
// web seamlessly," not Tor-Browser-grade privacy. So the receipt says so: a managed/user Tor IS a real Tor
// circuit (directTor:true), but anonymityGrade:"best-effort" (no Tor-Browser fingerprinting defenses).
//
// Node-only (spawns a process, touches disk). Every side-effecting dependency is injected so the witness can
// drive the whole decision + verify + launch state machine with NO real download and NO real process.

import { probeLocalTor } from "./holo-omni-onion-transport.mjs";

// Per-platform Tor Expert Bundle: the κ is the content address of the binary we will execute. These MUST be
// filled with the real published release hashes (or overridden via HOLO_TOR_KAPPA) — until then, provisioning
// refuses (L5: never run an unpinned executable). A vendored on-disk binary is the recommended ship anyway.
export const TOR_DIST = {
  "win32-x64":  { kappa: null, url: null, bin: "tor/tor.exe" },
  "linux-x64":  { kappa: null, url: null, bin: "tor/tor" },
  "darwin-x64": { kappa: null, url: null, bin: "tor/tor" },
  "darwin-arm64": { kappa: null, url: null, bin: "tor/tor" },
};
export const platformKey = (deps = {}) => `${deps.platform || (typeof process !== "undefined" ? process.platform : "")}-${deps.arch || (typeof process !== "undefined" ? process.arch : "")}`;

// resolveTorPin(deps) → { kappa, url, bin } | null — the pinned binary identity for this platform, with an
// env / opts override. null means "no pin" → provisioning must refuse.
export function resolveTorPin(deps = {}) {
  const env = deps.env || (typeof process !== "undefined" ? process.env : {}) || {};
  const key = platformKey(deps);
  const base = TOR_DIST[key] || { bin: "tor/tor" };
  const kappa = deps.kappa || env.HOLO_TOR_KAPPA || base.kappa || null;
  const url = deps.url || env.HOLO_TOR_URL || base.url || null;
  return kappa ? { kappa, url, bin: base.bin, platform: key } : null;
}

// verifyTorBinary(bytes, kappa, deps) → boolean — re-derive the binary and match its pinned κ (L5). kappa is
// "<axis>:<hex>" (sha256 or blake3); deps.sha256hex / deps.blake3hex injected (real hashers in prod).
export async function verifyTorBinary(bytes, kappa, deps = {}) {
  if (!bytes || !bytes.length || !kappa) return false;
  const [axis, hex] = String(kappa).replace(/^did:holo:/, "").split(":");
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let got = null;
  if (axis === "sha256" && deps.sha256hex) got = await deps.sha256hex(u8);
  else if (axis === "blake3" && deps.blake3hex) got = await deps.blake3hex(u8);
  else return false;
  return typeof got === "string" && got.toLowerCase() === String(hex || "").toLowerCase();
}

// torArgs(socksPort, dataDir) — minimal CLI for a SOCKS-only Tor (no control port, log to stdout so we can
// watch for the bootstrap line). CLI overrides avoid writing a torrc.
export function torArgs(socksPort, dataDir) {
  return ["--SocksPort", String(socksPort), "--ControlPort", "0", "--DataDirectory", dataDir, "--Log", "notice stdout", "--ClientOnly", "1"];
}
// isBootstrapped(line) — Tor prints "Bootstrapped 100% (done): Done" on the notice log when circuits are ready.
export const isBootstrapped = (line) => /Bootstrapped 100%/.test(String(line || ""));

const DEFAULT_SOCKS = 9050;

// ensureTor(opts, deps) → { ok, socksPort, source, anonymityGrade?, reason? }
//   source: "user-tor" (already running — reuse it) | "managed-tor" (we launched it) | null (refused)
// Priority: reuse an already-listening Tor (9050/9150) → else provision a κ-verified managed Tor.
// deps (all injected; real impls on the host): { net, fetchImpl, spawn, readFile, exists, cacheDir,
//   sha256hex, blake3hex, env, platform, arch, onStatus }.
export async function ensureTor(opts = {}, deps = {}) {
  const onStatus = deps.onStatus || (() => {});
  // 1 · reuse an already-running Tor — nothing to provision, the cheapest + most respectful path.
  const existing = await probeLocalTor({ net: deps.net });
  if (existing) { onStatus({ phase: "reuse", endpoint: existing.endpoint }); return { ok: true, socksPort: portOf(existing.endpoint), source: "user-tor", anonymityGrade: "best-effort" }; }

  // 2 · provision a managed Tor — but only a κ-VERIFIED binary may run (L5).
  const pin = resolveTorPin(deps);
  if (!pin) { onStatus({ phase: "refused", reason: "no-pin" }); return { ok: false, source: null, reason: "no pinned Tor κ for " + platformKey(deps) + " — set HOLO_TOR_KAPPA or vendor a verified Tor binary (refusing to run an unpinned executable)" }; }

  let bytes = null, binPath = opts.binPath || (deps.env && deps.env.HOLO_TOR_BIN) || null;
  if (binPath && deps.readFile && (!deps.exists || await deps.exists(binPath))) {
    try { bytes = await deps.readFile(binPath); } catch { bytes = null; }
  }
  if (!bytes && pin.url && deps.fetchImpl) {                      // fetch-by-source (a latency choice; verified next)
    onStatus({ phase: "fetch", url: pin.url });
    try { const r = await deps.fetchImpl(pin.url); if (r && r.ok) bytes = new Uint8Array(await r.arrayBuffer()); } catch { bytes = null; }
  }
  if (!bytes) { onStatus({ phase: "refused", reason: "no-binary" }); return { ok: false, source: null, reason: "no Tor binary available (no vendored path, no fetch source)" }; }

  if (!(await verifyTorBinary(bytes, pin.kappa, deps))) {        // L5 — a binary that does not re-derive is REFUSED
    onStatus({ phase: "refused", reason: "kappa-mismatch" });
    return { ok: false, source: null, reason: "Tor binary failed re-derivation against its pinned κ — refused (Law L5)" };
  }
  onStatus({ phase: "verified", kappa: pin.kappa });

  // 3 · launch + wait for bootstrap. spawn is injected; the witness drives a fake process that emits the
  //     bootstrap line. We never proceed until Tor reports circuits ready (or time out honestly).
  if (!deps.spawn) { onStatus({ phase: "refused", reason: "no-spawn" }); return { ok: false, source: null, reason: "host cannot spawn a process (pure static deploy) — managed Tor needs the native/dev host" }; }
  const socksPort = opts.socksPort || DEFAULT_SOCKS;
  const dataDir = opts.dataDir || ((deps.cacheDir || ".") + "/tor-data");
  const launchBin = binPath || ((deps.cacheDir || ".") + "/" + pin.bin);
  onStatus({ phase: "launch", socksPort });
  const proc = deps.spawn(launchBin, torArgs(socksPort, dataDir));
  const ok = await waitBootstrap(proc, opts.timeoutMs || 90000);
  if (!ok) { try { proc.kill && proc.kill(); } catch {} onStatus({ phase: "timeout" }); return { ok: false, source: null, reason: "Tor did not bootstrap within the timeout" }; }
  onStatus({ phase: "ready", socksPort });
  return { ok: true, socksPort, source: "managed-tor", anonymityGrade: "best-effort", proc };
}

function portOf(endpoint) { const m = String(endpoint || "").match(/:(\d+)$/); return m ? +m[1] : DEFAULT_SOCKS; }

// waitBootstrap(proc, timeoutMs) → resolves true on "Bootstrapped 100%", false on exit/timeout. Reads the
// child's stdout (notice log). proc is an EventEmitter-ish with .stdout.on('data') + .on('exit').
function waitBootstrap(proc, timeoutMs) {
  return new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
    const to = setTimeout(() => fin(false), timeoutMs);
    const onData = (d) => { if (isBootstrapped(d)) { clearTimeout(to); fin(true); } };
    try { proc.stdout && proc.stdout.on && proc.stdout.on("data", onData); } catch {}
    try { proc.on && proc.on("exit", () => { clearTimeout(to); fin(false); }); } catch {}
    try { proc.on && proc.on("error", () => { clearTimeout(to); fin(false); }); } catch {}
  });
}

export default { TOR_DIST, platformKey, resolveTorPin, verifyTorBinary, torArgs, isBootstrapped, ensureTor };
