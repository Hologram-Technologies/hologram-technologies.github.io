// holo-linux-worker.js — the Holo Linux boot worker.
//
// Boots a REAL riscv64 Linux 6.6 kernel on a real Debian 13 (trixie) rootfs, off
// the main thread, on the holospaces in-browser ISA core (the same engine the OS
// holospace uses — crates/holospaces-web, compiled to wasm). The holospace IS the
// machine: no server boots the kernel (Law L1/L4).
//
// What this worker adds over the plain OS path is a HARD κ-GATE (Law L5): before a
// single guest instruction runs, it re-derives the SHA-256 of the fetched kernel +
// rootfs and refuses to boot unless each matches its content address in kappa.json.
// The kernel's κ is the SAME content address pinned canonically at /boot/kernel.uor.json
// — so "anchored in the k-addressable substrate" is proven at load, not asserted.
//
// The console is the holospace's terminal channel: the guest's own serial tty is
// streamed to xterm.js via `terminal_delta()` and keystrokes go back through
// `feed_input()` — a real tty, so the guest's line discipline echoes, edits and
// raises SIGINT on Ctrl-C. Real PIDs, real syscalls hitting a real kernel.
//
// Protocol (main <-> worker):
//   main -> worker:  {type:'stdin', data:Uint8Array}     raw keystrokes
//   worker -> main:  {type:'status', text}               boot progress
//                    {type:'kappa', which, name, expected, actual, ok, canonical}
//                    {type:'booted'}                      machine running
//                    {type:'stdout', data:Uint8Array}     console delta
//                    {type:'mips', mips}                  live throughput
//                    {type:'halt', reason}                guest powered off
//                    {type:'error', text, hint?}          fatal (gate failure included)

// The wasm engine is served from the OS /pkg seam (absolute): natively the κ-route serves holo://os/pkg
// (make-dist projects usr/lib/pkg → /pkg); the dev server maps /pkg the same way. (Was ./pkg, which only
// existed under the dev serve and was never staged into the native image.)
import init, { DevcontainerImage, Workspace } from "/pkg/holospaces_web.js?v=hl1";

const Q = new URLSearchParams(self.location.search);
// Per-TAB session id: OPFS hands the κ-disk file to one tab at a time, so each tab
// namespaces its own writable disk → multiple tabs each run an INDEPENDENT machine.
const SID = (Q.get("sid") || "default").replace(/[^a-z0-9]/gi, "").slice(0, 16) || "default";
// Writable ext4 the OS works in. The κ-disk is sparse + disk-backed (OPFS), so boot
// time and wasm-heap cost are independent of this size. 1 GiB default; cap < 4 GiB
// (a 32-bit wasm byte length would wrap). Tunable via ?disk=<MiB>.
const DISK_MIB = Math.max(16, Math.min(3072, parseInt(Q.get("disk") || "1024", 10) || 1024));
const DISK_BYTES = DISK_MIB * 1024 * 1024;

const KERNEL_URL = "./os-kernel.gz";
const ROOTFS_URL = "./os-rootfs.tar.gz";
const PINS_URL = "./kappa.json";
const OPFS_ROOTFS = `hl-rootfs-${SID}.ext4`;
const OPFS_DISK_PACK = `hl-disk-${SID}.kpack`;
const LAYER_MEDIA = "application/vnd.oci.image.layer.v1.tar+gzip";

// ── Local persistence (CC-30) ──────────────────────────────────────────────────
// The machine you build in survives a full browser restart. The engine's `suspend()`
// captures the whole machine — CPU + RAM + the rootfs disk + the workspace files — as
// canonical, content-addressed bytes; we gzip them into OPFS, and the next launch
// `resume_devcontainer()`s them instead of cold-booting. The snapshot is keyed by the
// (stable) machine id so it reattaches across restarts. Persistent local storage AND a
// persistent, content-addressed machine identity (κ of the snapshot) fall out of this.
const OPFS_STATE = `hl-state-${SID}.snap.gz`;    // legacy plaintext snapshot (pre-seal) — cleaned up on boot
const OPFS_STATE_META = `hl-state-${SID}.json`;  // legacy meta
// Sovereign machine (sealed-at-rest): the snapshot is AES-256-GCM ciphertext on disk, owner-signed
// (ECDSA P-256) and bound to a NON-EXTRACTABLE, device-local key — so a copied blob cannot be opened or
// forged on another device, and there is no readable machine at rest. (TEE/biometric gate = next milestone.)
const OPFS_SEALED = `hl-machine-${SID}.sealed`;      // iv(12) || AES-GCM ciphertext(gzip(snapshot))
const OPFS_SEALED_META = `hl-machine-${SID}.json`;   // {kappa, sealedKappa, sig, pub, alg, attestRoot, kernelKappa, …}
const EPHEMERAL = Q.has("ephemeral");            // never persist, never resume (throwaway machine)
const RESET = Q.has("fresh");                    // discard any saved machine, cold-boot, then persist anew
// Periodic crash-resilient autosave while running (ms; 0 disables). Lifecycle events
// (tab hidden / pagehide) also trigger a save from the page.
const AUTOSAVE_MS = Math.max(0, parseInt(Q.get("autosave") || "30000", 10) || 0);
let KERNEL_KAPPA = null;                          // pins.kernel.sha256, captured at boot — stale-snapshot guard
let persisting = false;                           // single-flight guard around suspend()

// Adaptive tick: aim each run() chunk at ~TARGET_MS so the worker yields ~once per
// frame to deliver stdin — native-class input latency — while per-chunk overhead
// stays negligible.
const TARGET_MS = 8;
let budget = 2_000_000;

const status = (text) => postMessage({ type: "status", text });
const fail = (text, hint) => postMessage({ type: "error", text, hint });

// Boot artifacts are content-addressed + immutable and the κ-gate re-derives their SHA-256 on
// EVERY boot, so the HTTP cache is safe to lean on: a stale or corrupt cached byte simply fails
// the gate (Law L5) rather than booting. "force-cache" lets repeat boots skip the network entirely
// (cold boot still downloads once). The pins themselves are fetched no-store so they stay fresh.
const fetchBytes = async (url, cache = "force-cache") => {
  const resp = await fetch(url, { cache });
  if (!resp.ok) throw Object.assign(new Error(`HTTP ${resp.status}`), { status: resp.status });
  // A static host (or a SW fallback) can answer a MISSING artifact with an HTML page (its 404/index)
  // at HTTP 200 — which would then explode in JSON.parse as "Unexpected token '<'". Treat any HTML
  // body where we expect a binary/JSON artifact as a clean "missing artifact" (404), so the boot fails
  // gracefully ("Boot artifacts missing.") instead of leaking a raw parse error.
  if (/^text\/html\b/i.test(resp.headers.get("content-type") || "")) {
    throw Object.assign(new Error(`expected the artifact at ${url}, got an HTML page — it is not present on this deploy`), { status: 404 });
  }
  return new Uint8Array(await resp.arrayBuffer());
};
// Public IPFS gateways — content-addressed, NEVER trusted: gate() re-derives the whole-file sha256 below
// and refuses a mismatch (Law L5), so a wrong byte from any gateway is rejected, not booted.
const IPFS_GATEWAYS = ["https://ipfs.io", "https://dweb.link", "https://cloudflare-ipfs.com"];
// Fetch a boot artifact location-agnostically: prefer the same-origin path (dev / vendored image), else
// stream it from IPFS by its content (the κ-DAG CID pinned in kappa.json). The OS is agnostic to WHERE the
// bytes live — the κ is the only link — and the κ-gate verifies whatever source served them.
async function fetchArtifact(localUrl, ipfsCid) {
  try { return await fetchBytes(localUrl); }
  catch (e) {
    if (!ipfsCid) throw e;
    let last = e;
    for (const gw of IPFS_GATEWAYS) {
      try { return await fetchBytes(`${gw}/ipfs/${ipfsCid}`); } catch (g) { last = g; }
    }
    throw last;
  }
}
const gunzip = async (bytes) =>
  new Uint8Array(await new Response(new Response(bytes).body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
const gzip = async (bytes) =>
  new Uint8Array(await new Response(new Response(bytes).body.pipeThrough(new CompressionStream("gzip"))).arrayBuffer());

// ── κ re-derivation (Law L5) ──────────────────────────────────────────────────
// The browser's own SubtleCrypto computes the content address — no engine, no
// trust. `did:holo:sha256:<hex>` is the κ; we compare it to the pin and to the
// canonical /boot pin. This is the whole point: bytes are admitted by identity.
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
async function sha256hex(bytes) {
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}
// Verify one artifact against its κ-pin. Posts the result to the UI and THROWS on a
// mismatch — a failed gate must stop the boot, never warn-and-continue.
async function gate(which, pin, bytes) {
  status(`re-deriving κ of the ${which}…`);
  const actual = await sha256hex(bytes);
  const ok = actual === pin.sha256;
  postMessage({
    type: "kappa", which, name: pin.name,
    expected: "did:holo:sha256:" + pin.sha256,
    actual: "did:holo:sha256:" + actual,
    multibase: pin.digestMultibase, ok,
    canonical: pin.canonicalPin || null,
  });
  if (!ok) {
    throw Object.assign(
      new Error(`κ mismatch on the ${which}: the fetched bytes do not match their content address.`),
      { gate: true, which, expected: pin.sha256, actual },
    );
  }
}

// ── OPFS κ-disk helpers (the streamed, off-heap writable disk) ─────────────────
async function opfsSyncHandle(name, truncate) {
  const root = await navigator.storage.getDirectory();
  const fh = await root.getFileHandle(name, { create: true });
  let lastErr;
  for (let i = 0; i < 40; i++) { // ~8s of retries — a terminated worker frees its handle within ~1s
    try { const h = await fh.createSyncAccessHandle(); if (truncate) h.truncate(0); return h; }
    catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 200)); }
  }
  throw Object.assign(new Error(`the OPFS disk file "${name}" is locked by another session`), { opfsLocked: true, cause: lastErr });
}
async function opfsRemove(name) {
  try { const root = await navigator.storage.getDirectory(); await root.removeEntry(name); } catch (_) {}
}
// GC dead tabs' κ-disks so multi-tab use doesn't leak OPFS. A live tab holds its
// pack handle → removeEntry throws → we leave that session alone. Never touches THIS session.
async function sweepDeadSessions() {
  try {
    const root = await navigator.storage.getDirectory();
    const others = [];
    for await (const name of root.keys()) { const m = /^hl-disk-(.+)\.kpack$/.exec(name); if (m && m[1] !== SID) others.push(m[1]); }
    for (const sid of others) {
      try { await root.removeEntry(`hl-disk-${sid}.kpack`); await opfsRemove(`hl-rootfs-${sid}.ext4`); } catch (_) {}
    }
  } catch (_) {}
}

// ── snapshot persistence helpers (CC-30 local persistence) ─────────────────────
// OPFS files are written via an exclusive SyncAccessHandle (synchronous, durable even
// under tab-close pressure). The snapshot files are SEPARATE from the running κ-disk
// pack, so saving never contends with the live machine's disk handle.
async function writeOpfs(name, bytes) {
  const h = await opfsSyncHandle(name, true);
  try { h.write(bytes, { at: 0 }); h.flush(); } finally { try { h.close(); } catch (_) {} }
}
async function readOpfsIfExists(name) {
  const root = await navigator.storage.getDirectory();
  try { await root.getFileHandle(name, { create: false }); } catch (_) { return null; }  // absent → no snapshot
  const h = await opfsSyncHandle(name, false);
  try { const n = h.getSize(); if (!n) return null; const b = new Uint8Array(n); h.read(b, { at: 0 }); return b; }
  finally { try { h.close(); } catch (_) {} }
}
async function clearSnapshot() {
  await opfsRemove(OPFS_STATE); await opfsRemove(OPFS_STATE_META);   // legacy plaintext
  await opfsRemove(OPFS_SEALED); await opfsRemove(OPFS_SEALED_META); // sealed
}

// ── device-bound machine keys (IndexedDB, NON-EXTRACTABLE) ──────────────────────
// SOFT tier of the sovereign machine: an AES-GCM seal key + an ECDSA P-256 owner key, both
// non-extractable and device-local. The raw key bytes never reach JS and never touch OPFS, so a
// snapshot copied to another device can't be decrypted (no key there) or forged (can't sign).
// On this device the machine resumes transparently. TEE upgrade (enclave-gated key + biometric
// step-up whose challenge is the snapshot κ) is the next milestone — attestRoot will become "tee".
const b64 = (u8) => btoa(String.fromCharCode(...new Uint8Array(u8)));
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const KEYDB = "holo-linux-keys", KEYSTORE = "keys";
function idbOpen() { return new Promise((res, rej) => { const r = indexedDB.open(KEYDB, 1); r.onupgradeneeded = () => r.result.createObjectStore(KEYSTORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbGet(k) { const db = await idbOpen(); return new Promise((res, rej) => { const t = db.transaction(KEYSTORE, "readonly").objectStore(KEYSTORE).get(k); t.onsuccess = () => res(t.result || null); t.onerror = () => rej(t.error); }); }
async function idbPut(k, v) { const db = await idbOpen(); return new Promise((res, rej) => { const t = db.transaction(KEYSTORE, "readwrite").objectStore(KEYSTORE).put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); }
let machineKeys = null;   // {aes, sign(priv), verify(pub), pubRaw, attestRoot}
// TEE unlock: the page performs the device biometric (WebAuthn PRF / native holo:hello) and posts the PRF
// secret here BEFORE keys are used (boot awaits it when ?tee=1). The secret is held in memory only, never
// persisted — the seal key is re-derived from it per session, so the machine is bound to your biometric.
let unlockSecret = null, _unlockResolve; const unlockReady = new Promise((r) => (_unlockResolve = r));
// HKDF the biometric PRF secret → the AES-GCM seal key. Deterministic (same secret ⇒ same key ⇒ opens);
// a different biometric/identity derives a different key and AEAD refuses. Verified in Node (tee-crypto-check).
async function aesFromSecret(secret) {
  const ikm = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(SID + "|holo-linux/seal/v1"), info: new TextEncoder().encode("aes-gcm") },
    ikm, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function ensureMachineKeys() {
  if (machineKeys) return machineKeys;
  // The owner SIGNING key (ownership) + the SOFT seal key are device-local + non-extractable (IndexedDB).
  let rec = await idbGet("machine-" + SID);
  const soft = rec && (rec.softAes || rec.aes);
  if (!rec || !rec.priv || !rec.pub || !rec.pubRaw || !soft) {
    const softAes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]); // pubKey stays extractable per spec
    const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
    rec = { softAes, priv: kp.privateKey, pub: kp.publicKey, pubRaw };
    await idbPut("machine-" + SID, rec);
  }
  // Seal key source: TEE (HKDF from the biometric PRF secret) when unlocked, else the device-local soft key.
  let aes, attestRoot;
  if (unlockSecret) { aes = await aesFromSecret(unlockSecret); attestRoot = "tee"; }
  else { aes = rec.softAes || rec.aes; attestRoot = "soft"; }
  machineKeys = { aes, sign: rec.priv, verify: rec.pub, pubRaw: new Uint8Array(rec.pubRaw), attestRoot };
  return machineKeys;
}
// Encrypt + owner-sign the gzipped snapshot. Signature binds BOTH the ciphertext κ and the plaintext κ.
async function sealBytes(gz, kappaHex) {
  const k = await ensureMachineKeys();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k.aes, gz));
  const sealedKappa = await sha256hex(ct);
  const msg = new TextEncoder().encode(sealedKappa + ":" + kappaHex);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k.sign, msg));
  return { iv, ct, sealedKappa, sig: b64(sig), pub: b64(k.pubRaw), attestRoot: k.attestRoot };
}
// Verify ownership + integrity, then decrypt. Throws {sovereign:true, reason} on any failure (foreign
// device, wrong identity, tamper) so the caller refuses + recovers (Law L5 / SEC-1 / SEC-4).
async function openSealed(meta, iv, ct) {
  if (meta.attestRoot === "tee" && !unlockSecret) throw { sovereign: true, reason: "this machine is sealed to your biometric — unlock required" };
  const k = await ensureMachineKeys();
  if (!meta.pub || meta.pub !== b64(k.pubRaw)) throw { sovereign: true, reason: "this saved machine is bound to a different device or identity" };
  const sealedKappa = await sha256hex(ct);
  if (sealedKappa !== meta.sealedKappa) throw { sovereign: true, reason: "sealed bytes failed their κ (tampered)" };
  const msg = new TextEncoder().encode(sealedKappa + ":" + meta.kappa);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k.verify, b64d(meta.sig), msg);
  if (!ok) throw { sovereign: true, reason: "owner signature invalid" };
  const gz = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k.aes, ct));
  const snap = await gunzip(gz);
  if ((await sha256hex(snap)) !== meta.kappa) throw { sovereign: true, reason: "plaintext κ mismatch" };
  return snap;
}

// Capture the running machine, SEAL it (encrypt + owner-sign), and persist. Content-addressed (Law L5);
// opaque at rest (SEC-5). Single-flight; safe between run() ticks (the worker is single-threaded).
async function persistSnapshot(reason) {
  if (!ws || EPHEMERAL || persisting) return;
  persisting = true;
  try {
    const snap = ws.suspend();                       // CPU + RAM + disk + 9p workspace files
    const kappa = await sha256hex(snap);
    const gz = await gzip(snap);
    const sealed = await sealBytes(gz, kappa);
    const blob = new Uint8Array(12 + sealed.ct.length); blob.set(sealed.iv, 0); blob.set(sealed.ct, 12);
    await writeOpfs(OPFS_SEALED, blob);
    const meta = { kappa, sealedKappa: sealed.sealedKappa, sig: sealed.sig, pub: sealed.pub,
      alg: "AES-256-GCM+ECDSA-P256", attestRoot: sealed.attestRoot, kernelKappa: KERNEL_KAPPA,
      bytes: snap.length, sealedBytes: blob.length, createdAt: Date.now(), reason: reason || "manual" };
    await writeOpfs(OPFS_SEALED_META, new TextEncoder().encode(JSON.stringify(meta)));
    await opfsRemove(OPFS_STATE); await opfsRemove(OPFS_STATE_META);   // drop any legacy plaintext
    postMessage({ type: "suspended", kappa: "did:holo:sha256:" + kappa, bytes: snap.length, gzBytes: blob.length, attestRoot: sealed.attestRoot, reason: reason || "manual" });
  } catch (e) {
    postMessage({ type: "persist-error", text: String((e && e.message) || e) });
  } finally { persisting = false; }
}

// Smallest κ-disk we'll fall back to when storage is tight — still comfortably fits the
// Debian rootfs (~70 MiB used) plus working room. Below this we surface a clear error.
const DISK_FLOOR = 384 * 1024 * 1024;
const isSpaceError = (e) => {
  const m = String((e && (e.message || e.name)) || e);
  return (e && e.name === "QuotaExceededError") || /no space|quota|insufficient|allocat/i.test(m);
};
// Best-effort: persistent storage isn't evicted under pressure and tends to grant a larger,
// stabler quota. Not available in every worker context — ignore if absent.
async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) {}
}
// Size the κ-disk to the space actually free RIGHT NOW. OPFS shares ONE origin quota with the
// service-worker caches and every other holospace, so a fixed 1 GiB truncate fails with "No
// space available" when the origin is near quota. Fit to free space (less a safety margin),
// never below the floor; the caller still retries smaller if even this overshoots.
async function fitDiskBytes(requested) {
  try {
    const est = (await navigator.storage.estimate()) || {};
    const quota = est.quota || 0, usage = est.usage || 0;
    if (quota > 0) {
      const usable = (quota - usage) - 96 * 1024 * 1024; // keep 96 MiB headroom for fs metadata + caches
      if (usable < requested) return Math.max(DISK_FLOOR, Math.min(requested, usable));
    }
  } catch (_) {}
  return requested;
}
// Provision a fresh rootfs handle + assemble the bootable image into it. Fresh OPFS files each
// attempt, so a retry never inherits a half-written disk. Closes the handle and rethrows on
// failure so the caller can reclaim space and retry at a smaller size.
async function provisionRootfs(image, diskBytes) {
  await opfsRemove(OPFS_ROOTFS);
  await opfsRemove(OPFS_DISK_PACK);
  const h = await opfsSyncHandle(OPFS_ROOTFS, true);
  try { image.assemble_bootable_into_opfs(h, diskBytes, true); return h; } // REAL_IMG=true → execs /bin/bash -l
  catch (e) { try { h.close(); } catch (_) {} throw e; }
}

let ws = null;            // the running Workspace
const pendingInput = [];  // keystrokes that arrived before boot finished

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg) return;
  if (msg.type === "stdin") { if (ws) ws.feed_input(msg.data); else pendingInput.push(msg.data); }
  else if (msg.type === "unlock") { unlockSecret = msg.secret ? new Uint8Array(msg.secret) : null; machineKeys = null; _unlockResolve(); }  // biometric PRF secret from the page; drop cached keys so the next seal re-derives (soft→tee "make sovereign" re-seals live state under the TEE key)
  else if (msg.type === "suspend") { persistSnapshot(msg.reason || "request"); }   // page asks us to save (button / tab hidden / pagehide)
  else if (msg.type === "reset") { clearSnapshot().then(() => postMessage({ type: "reset-done" })); }
};

(async () => {
  try {
    status("loading the machine…");
    await init(new URL("/pkg/holospaces_web_bg.wasm?v=hl1", location.origin));
    await requestPersistence();
    await sweepDeadSessions();
    if (RESET) { await clearSnapshot(); status("starting a fresh machine…"); }

    // ── κ-pins first — needed BOTH to stale-check a saved machine (kernel κ) and to
    //    gate a cold boot. Small + no-store so they stay fresh. ────────────────────
    status("fetching the κ-pins…");
    let pins;
    try { pins = JSON.parse(new TextDecoder().decode(await fetchBytes(PINS_URL, "no-store"))); }
    catch (err) {
      if (err.status === 404) return fail("Boot artifacts missing.", "kappa.json must sit beside this worker.");
      throw err;
    }
    KERNEL_KAPPA = (pins.kernel && pins.kernel.sha256) || null;

    // TEE unlock handshake: when the page signalled it has a biometric (?tee=1), wait briefly for the PRF
    // secret before any key use, so the seal key is enclave-derived. Times out → soft fallback (still sealed).
    if (Q.get("tee")) { await Promise.race([unlockReady, new Promise((r) => setTimeout(r, 8000))]); }

    // ── RESUME PATH (sovereign machine): if a SEALED saved machine exists, verify ownership +
    //    integrity (owner signature + L5 κ, bound to this device's non-extractable key), DECRYPT,
    //    and resume it exactly — skipping the whole cold boot. A foreign/tampered/wrong-kernel
    //    machine is refused and we recover by cold-booting. ?tamper forces a cold boot (rootfs
    //    tamper test); ?tampersnap flips a ciphertext byte to exercise THIS gate. ───────────────
    if (!EPHEMERAL && !RESET && !Q.get("tamper")) {
      try {
        const metaBytes = await readOpfsIfExists(OPFS_SEALED_META);
        const sealed = await readOpfsIfExists(OPFS_SEALED);
        if (metaBytes && sealed) {
          const meta = JSON.parse(new TextDecoder().decode(metaBytes));
          status("found your sealed machine — verifying owner + κ…");
          const iv = sealed.slice(0, 12);
          const ct = sealed.slice(12);
          if (Q.get("tampersnap")) { ct[0] ^= 0xff; status("⚠ tamper test — flipped 1 byte of the sealed machine; the gate must refuse it"); }
          const kernelOk = !meta.kernelKappa || meta.kernelKappa === KERNEL_KAPPA;
          if (!kernelOk) {
            status("kernel changed since the saved machine — booting fresh");
            await clearSnapshot();
          } else {
            const snap = await openSealed(meta, iv, ct);   // throws {sovereign} on foreign/tamper/forged
            postMessage({ type: "kappa", which: "snapshot", name: "sealed machine",
              expected: "did:holo:sha256:" + meta.kappa, actual: "did:holo:sha256:" + meta.kappa,
              ok: true, canonical: meta.attestRoot === "tee" ? "device TEE" : "device key" });
            status("resuming your sealed machine…");
            ws = Workspace.resume_devcontainer(snap);
            postMessage({ type: "resumed", kappa: "did:holo:sha256:" + meta.kappa, bytes: snap.length, gzBytes: sealed.length, attestRoot: meta.attestRoot });
          }
        }
      } catch (e) {
        const sov = e && e.sovereign;
        if (sov) postMessage({ type: "kappa", which: "snapshot", name: "sealed machine", expected: "—", actual: "—", ok: false, canonical: null });
        postMessage({ type: "persist-error", text: (sov ? e.reason : "resume failed (" + String((e && e.message) || e) + ")") + " — booting fresh" });
        await clearSnapshot();   // can't open it (foreign/tampered/lost key) → recover with a fresh machine
        ws = null;
      }
    }

    // ── COLD BOOT: no saved machine (or reset / tamper) — fetch, gate, assemble, boot ──
    if (!ws) {
      status("fetching the κ-pinned kernel + Debian rootfs…");
      let kernelGz, rootfsLayer;
      try {
        [kernelGz, rootfsLayer] = await Promise.all([fetchArtifact(KERNEL_URL, pins.kernel && pins.kernel.ipfs), fetchArtifact(ROOTFS_URL, pins.rootfs && pins.rootfs.ipfs)]);
      } catch (err) {
        if (err.status === 404) return fail("Boot artifacts missing.", "os-kernel.gz / os-rootfs.tar.gz / kappa.json must sit beside this worker.");
        throw err;
      }

      // Tamper test (?tamper=1): flip ONE byte of the rootfs before the gate, to prove
      // the κ-gate is real — the very next step re-derives the address and must refuse.
      if (Q.get("tamper")) {
        rootfsLayer[0] ^= 0xff;
        status("⚠ tamper test — flipped 1 byte of the rootfs; the κ-gate must now refuse it");
      }

      // THE κ-GATE: re-derive content addresses, refuse to boot on mismatch.
      await gate("kernel", pins.kernel, kernelGz);
      await gate("rootfs", pins.rootfs, rootfsLayer);
      status("κ verified — both artifacts match their content address.");

      // assemble the bootable ext4 from the verified rootfs layer
      const kernel = await gunzip(kernelGz);
      status("assembling the root filesystem…");
      const image = new DevcontainerImage();
      image.add_layer(LAYER_MEDIA, rootfsLayer); // the in-engine assembler gunzips + untars it

      // provision the κ-disk into OPFS (sparse, off-heap) and boot. Robust against a near-full
      // origin quota: size to free space, and on "No space" reclaim dead sessions + retry smaller.
      status("provisioning the κ-disk (sparse, OPFS-backed)…");
      let diskBytes = await fitDiskBytes(DISK_BYTES);
      let rootfsH;
      for (let attempt = 0; ; attempt++) {
        try { rootfsH = await provisionRootfs(image, diskBytes); break; }
        catch (err) {
          if (isSpaceError(err) && attempt < 3 && diskBytes > DISK_FLOOR) {
            status("storage is tight — reclaiming space, retrying with a smaller κ-disk…");
            await sweepDeadSessions();
            diskBytes = Math.max(DISK_FLOOR, Math.floor(diskBytes / 2));
            continue;
          }
          throw err;
        }
      }
      const diskH = await opfsSyncHandle(OPFS_DISK_PACK, true);
      status("powering on (riscv64, streamed κ-disk)…");
      ws = Workspace.boot_devcontainer_opfs_streamed(kernel, rootfsH, diskH);
    }

    for (const buf of pendingInput) ws.feed_input(buf);
    pendingInput.length = 0;

    const bootStart = performance.now();
    postMessage({ type: "booted" });
    // Crash-resilient autosave: snapshot the running machine to OPFS every AUTOSAVE_MS so a
    // crash/forced-close still leaves a recent machine to resume. Lifecycle saves (tab hidden /
    // pagehide) come from the page via {type:'suspend'}.
    if (AUTOSAVE_MS && !EPHEMERAL) setInterval(() => persistSnapshot("autosave"), AUTOSAVE_MS);

    // A zero-delay yield that isn't throttled to 4ms (unlike setTimeout(0)) — the
    // run loop stays continuous in ~TARGET_MS chunks, the event loop runs between
    // chunks to deliver stdin.
    const yieldChan = new MessageChannel();
    yieldChan.port1.onmessage = () => tick();
    const scheduleTick = () => yieldChan.port2.postMessage(0);

    let lastReport = bootStart, instret = 0;
    const tick = () => {
      const t0 = performance.now();
      let halted = false;
      try { halted = ws.run(budget); } catch (err) { return fail(`run: ${err && err.message ? err.message : err}`); }
      instret += budget;
      const dt = performance.now() - t0;
      if (dt > 0.1) budget = Math.max(100_000, Math.min(80_000_000, Math.round((budget * TARGET_MS) / dt)));
      const out = ws.terminal_delta();
      if (out.length) postMessage({ type: "stdout", data: out }, [out.buffer]);
      const now = performance.now();
      if (now - lastReport > 400) { postMessage({ type: "mips", mips: instret / ((now - bootStart) / 1000) / 1e6 }); lastReport = now; }
      if (halted) postMessage({ type: "halt", reason: "the guest powered off" });
      else scheduleTick();
    };
    tick();
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (err && err.gate) {
      return fail(msg, `Holo Linux refuses to execute bytes that do not match their κ.\nexpected did:holo:sha256:${err.expected}\nactual   did:holo:sha256:${err.actual}`);
    }
    if (isSpaceError(err)) {
      return fail("Browser storage is full — couldn't allocate the κ-disk.",
        "OPFS shares one quota across every Holo app. Close other Holo Linux / Holo tabs (each holds its own disk) or clear this site's data, then press ⟳ reboot. You can also boot a smaller disk with ?disk=256.");
    }
    const locked = (err && err.opfsLocked) || /createSyncAccessHandle|Access Handle/i.test(msg);
    fail(locked ? "The disk is open in another tab." : msg,
      locked ? "OPFS gives the κ-disk to one tab at a time. Close other Holo Linux tabs, then press ⟳ reboot." : undefined);
  }
})();
