// holo-sovereign.mjs — THE SOVEREIGN BROKER: one presence (identity + Holo Pass) projected onto every
// page through ONE message protocol, behind ONE biometric gate. This is the door the live-page seam
// (pageGuard) and the self-contained demo both call. It never lets a page reach the store directly.
//
// LAWS: SEC-5 a secret reaches ONLY the exact origin that earned it (a look-alike gets null) · SEC-2 read
// ≠ fill ≠ save, each a distinct capability · SEC-4 the right to reveal is the operator's biometric, not a
// page-supplied token · fail-closed: no operator → every op is answered but reveals NOTHING.
//
// The store is pluggable: a REAL signed-in operator uses the TEE-encrypted holo-vault; a guest/demo uses a
// clearly-labeled local store. Either way the ORIGIN-BINDING (the anti-phishing core) is identical — that
// is the property this proves, and it is orthogonal to where the bytes are encrypted.

// registrable-origin equality: exact scheme + host. No suffix match, no normalization — a look-alike
// (IDN homograph, extra subdomain, scheme downgrade) is a DIFFERENT origin and earns nothing (SEC-5).
export function sameOrigin(a, b) {
  try { const x = new URL(a), y = new URL(b); return x.protocol === y.protocol && x.host === y.host; }
  catch { return String(a) === String(b); }
}
export function originOf(u) { try { return new URL(u).origin; } catch { return String(u || ""); } }

// A store is { get(origin)->cred|null, put(origin,cred), list()->[{origin,username}], has()->bool }.
// The demo/guest store is localStorage, labeled so nobody mistakes it for the TEE vault.
export function makeLocalStore(ns = "holo.pass.demo.v1") {
  const load = () => { try { return JSON.parse(localStorage.getItem(ns) || "{}"); } catch { return {}; } };
  const save = (o) => { try { localStorage.setItem(ns, JSON.stringify(o)); } catch {} };
  return {
    kind: "local",
    async get(origin) { const o = load(); const e = o[originOf(origin)]; return e ? { username: e.username, secret: e.secret, totp: e.totp || null } : null; },
    async put(origin, cred) { const o = load(); o[originOf(origin)] = { username: cred.username || "", secret: cred.secret || "", totp: cred.totp || null, ts: Date.now() }; save(o); },
    async list() { const o = load(); return Object.keys(o).map((k) => ({ origin: k, username: o[k].username })); },
    async has() { return Object.keys(load()).length > 0; },
  };
}

// Wrap a real holo-vault projection as a store (used when an operator is signed in). The vault is opened
// elsewhere (behind the biometric); here we just read/write its origin→credential view.
export function makeVaultStore(vault) {
  return {
    kind: "vault",
    async get(origin) { const c = vault.find ? vault.find(originOf(origin)) : null; return c ? { username: c.username, secret: c.secret, totp: c.totp || null } : null; },
    async put(origin, cred) { if (vault.save) await vault.save({ origin: originOf(origin), username: cred.username, secret: cred.secret, totp: cred.totp || null }); },
    async list() { return vault.list ? vault.list() : []; },
    async has() { return vault.list ? vault.list().length > 0 : false; },
  };
}

// The broker. `stepUp(action)` is the biometric gate: returns true to REVEAL, false/throw to refuse. For a
// real operator it wraps holo-stepup-gate.enforce; for the demo it can be a confirm() or an auto-approve
// with an on-screen note. `operator` null → guest: queries work (to show "sign in to use Pass") but no
// reveal ever happens. presentFor(origin) tells the seam WHAT to surface (a saved login? a place to save?).
export function makeBroker({ store, operator = null, stepUp = null, hostOrigin = () => location.href } = {}) {
  const trusted = (declared) => {
    // SEC-5: trust ONLY the host-verified page origin, never a page-supplied string. In the live seam the
    // SW stamps <meta holo-source>; the caller passes that. If a declared origin disagrees, refuse.
    const real = hostOrigin();
    if (declared && !sameOrigin(declared, real)) return null;
    return real;
  };
  async function gate(action) {
    if (!operator) return false;                 // guest: never reveal (fail-closed)
    if (typeof stepUp !== "function") return true;
    try { return await stepUp({ ...action, operator }); } catch { return false; }
  }
  return {
    kind: store.kind, operator,
    // What should the seam show at this origin? (no reveal — just presence)
    async presentFor(declaredOrigin) {
      const origin = trusted(declaredOrigin); if (!origin) return { present: false };
      const cred = await store.get(origin);
      return { present: true, operator: !!operator, hasLogin: !!cred, canSave: !cred, origin: originOf(origin), storeKind: store.kind };
    },
    // Fill: reveal the saved secret for THIS EXACT origin, behind the biometric. Look-alike → null.
    async fill(declaredOrigin) {
      const origin = trusted(declaredOrigin);
      if (!origin) return { ok: false, refused: "origin-mismatch" };     // the anti-phishing refusal
      const cred = await store.get(origin);
      if (!cred) return { ok: false, refused: "no-login-for-origin" };
      if (!(await gate({ kind: "pass.fill", origin: originOf(origin) }))) return { ok: false, refused: operator ? "step-up-denied" : "no-identity" };
      return { ok: true, credential: { username: cred.username, secret: cred.secret } };
    },
    // Save a login captured on submit (a write capability, distinct from fill — SEC-2).
    async save(declaredOrigin, cred) {
      const origin = trusted(declaredOrigin);
      if (!origin) return { ok: false, refused: "origin-mismatch" };
      if (!operator && store.kind !== "local") return { ok: false, refused: "no-identity" };
      await store.put(origin, cred);
      return { ok: true };
    },
    async totp(declaredOrigin) {
      const origin = trusted(declaredOrigin); if (!origin) return { ok: false, refused: "origin-mismatch" };
      const cred = await store.get(origin); if (!cred || !cred.totp) return { ok: false, refused: "no-totp" };
      if (!(await gate({ kind: "pass.totp", origin: originOf(origin) }))) return { ok: false, refused: "step-up-denied" };
      return { ok: true, code: cred.totp };   // (a real TOTP derives the live code; the demo stores a fixed one)
    },

    // ── WALLET — the SECOND face of the SAME presence. SEC-2 attenuation: connect ≠ sign ≠ send. The dApp
    // gets your ADDRESS, never a key. connect is low-friction (like MetaMask); sign needs the biometric;
    // send needs a FRESH biometric BOUND to the transaction (a connected site can't drain you silently). ──
    async walletConnect(declaredOrigin) {
      const origin = trusted(declaredOrigin); if (!origin) return { ok: false, refused: "origin-mismatch" };
      if (!operator) return { ok: false, refused: "no-identity" };
      return { ok: true, address: addressFor(operator), chainId: "0x1" };   // real operator → holo-wdk derives it
    },
    async walletSign(declaredOrigin, message) {
      const origin = trusted(declaredOrigin); if (!origin) return { ok: false, refused: "origin-mismatch" };
      if (!operator) return { ok: false, refused: "no-identity" };
      if (!(await gate({ kind: "wallet.sign", origin: originOf(origin), message }))) return { ok: false, refused: "step-up-denied" };
      return { ok: true, signature: demoSignature(operator, "sign", message), address: addressFor(operator) };
    },
    async walletSend(declaredOrigin, tx) {
      const origin = trusted(declaredOrigin); if (!origin) return { ok: false, refused: "origin-mismatch" };
      if (!operator) return { ok: false, refused: "no-identity" };
      // a SEND is the strongest capability — a FRESH biometric bound to THIS tx, never suppressible by a
      // prior connect/sign window (the caller passes force:true to enforce.enforce → a real re-prompt).
      if (!(await gate({ kind: "wallet.send", force: true, origin: originOf(origin), to: tx && tx.to, value: tx && tx.value }))) return { ok: false, refused: "step-up-denied" };
      return { ok: true, txHash: demoSignature(operator, "send", JSON.stringify(tx || {})) };
    },
  };
}

// a display address derived deterministically from the operator (NO key material). A real signed-in
// operator's address comes from holo-wdk; here it's a stable stand-in so the demo shows a consistent "you".
export function addressFor(operator) {
  let h = 2166136261 >>> 0; const s = "holo-addr:" + String(operator);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  let hex = ""; let x = h; for (let i = 0; i < 40; i++) { hex += (x & 0xf).toString(16); x = (Math.imul(x, 1103515245) + 12345) >>> 0; }
  return "0x" + hex;
}
function demoSignature(operator, kind, payload) {
  let h = 5381 >>> 0; const s = kind + "|" + operator + "|" + payload;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  let hex = ""; let x = h; for (let i = 0; i < 64; i++) { hex += (x & 0xf).toString(16); x = (Math.imul(x, 1103515245) + 12345) >>> 0; }
  return "0x" + hex;   // demo stand-in; a real operator signs with holo-wdk (secp256k1), key never leaving the device
}

// ── EIP-1193 provider backed by the broker, announced via EIP-6963 — how a live dApp discovers "Hologram".
// The dApp calls provider.request({method, params}); every privileged method routes through the broker's
// gate. window.ethereum-freezing dApps still find it via the 6963 announce event (SEC-2, modern path). ──
export function makeProvider(broker, origin) {
  const listeners = {};
  const provider = {
    isHologram: true,
    async request({ method, params }) {
      params = params || [];
      switch (method) {
        case "eth_chainId": return "0x1";
        case "eth_accounts": case "eth_requestAccounts": {
          const r = await broker.walletConnect(origin);
          if (!r.ok) throw Object.assign(new Error(r.refused), { code: 4001 });
          emit("accountsChanged", [r.address]); return [r.address];
        }
        case "personal_sign": case "eth_sign": {
          const r = await broker.walletSign(origin, params[0]);
          if (!r.ok) throw Object.assign(new Error(r.refused), { code: 4001 });
          return r.signature;
        }
        case "eth_sendTransaction": {
          const r = await broker.walletSend(origin, params[0]);
          if (!r.ok) throw Object.assign(new Error(r.refused), { code: 4001 });
          return r.txHash;
        }
        default: throw Object.assign(new Error("unsupported method: " + method), { code: 4200 });
      }
    },
    on(ev, cb) { (listeners[ev] || (listeners[ev] = [])).push(cb); },
    removeListener(ev, cb) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== cb); },
  };
  function emit(ev, data) { (listeners[ev] || []).forEach((cb) => { try { cb(data); } catch {} }); }
  return provider;
}
// announce the provider the EIP-6963 way (works even when a dApp froze window.ethereum).
export function announceProvider(provider, target = (typeof window !== "undefined" ? window : null)) {
  if (!target) return;
  const info = { uuid: "holo-" + (target.crypto && target.crypto.randomUUID ? target.crypto.randomUUID() : "0000"), name: "Hologram", icon: "data:image/svg+xml,%3Csvg/%3E", rdns: "id.holo.wallet" };
  const detail = Object.freeze({ info, provider });
  const fire = () => target.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  target.addEventListener("eip6963:requestProvider", fire);
  fire();
}
