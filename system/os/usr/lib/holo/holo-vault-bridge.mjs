// holo-vault-bridge.mjs — the capability bridge between a SANDBOXED Holo Pass app frame and the
// privileged vault handle (holo-vault). The app is a projection: it NEVER receives the operator secret,
// the identity key, or another app's data (holo-apps §2.9). It may only invoke a NARROWED surface, and
// surfacing a secret routes through the host step-up (consent-bearing, SEC-2). Transport: postMessage.
//
// Two halves: vaultSurface()/installVaultBridge() run in the PRIVILEGED context (the shell, holding the
// unlocked handle); holoVaultClient() runs in the SANDBOXED app and speaks the same protocol.

const RNG = globalThis.crypto;

// ── strong password generator (uniform, no modulo bias; excludes ambiguous glyphs; class coverage) ──
const SETS = { lower: "abcdefghijkmnpqrstuvwxyz", upper: "ABCDEFGHJKLMNPQRSTUVWXYZ", digits: "23456789", symbols: "!@#$%^&*()-_=+[]{}" };
function pick(alphabet, n) { const out = []; const max = Math.floor(256 / alphabet.length) * alphabet.length; while (out.length < n) { const b = RNG.getRandomValues(new Uint8Array(Math.max(8, n))); for (const x of b) { if (x < max) { out.push(alphabet[x % alphabet.length]); if (out.length === n) break; } } } return out; }
export function generatePassword({ length = 20, lower = true, upper = true, digits = true, symbols = true } = {}) {
  const classes = [["lower", lower], ["upper", upper], ["digits", digits], ["symbols", symbols]].filter(([, on]) => on).map(([k]) => SETS[k]);
  if (!classes.length || length < classes.length) throw new Error("generatePassword: bad params");
  const all = classes.join("");
  const chars = classes.map((c) => pick(c, 1)[0]);                 // guarantee ≥1 from each selected class
  chars.push(...pick(all, length - chars.length));
  // Fisher–Yates shuffle with uniform indices so class-coverage chars aren't positionally predictable
  for (let i = chars.length - 1; i > 0; i--) { const max = Math.floor(256 / (i + 1)) * (i + 1); let j; do { j = RNG.getRandomValues(new Uint8Array(1))[0]; } while (j >= max); j %= (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

// the NARROWED surface a Holo Pass app may invoke over the unlocked handle. NO method returns the
// operator secret or identity key; `reveal` is the ONLY path to a stored secret and it is step-up gated.
export function vaultSurface(handle, { credentialId } = {}) {
  return {
    list: async () => handle.list(),                               // metadata only (no secrets)
    put: async (entry) => handle.put(entry || {}),                 // {origin,kind,username,secret,label}
    remove: async (id) => handle.remove(id),
    reveal: async (id) => handle.revealSecret(id, { credentialId }), // step-up gated; fail-closed
    generate: (opts) => generatePassword(opts || {}),
    head: () => handle.headKappa(),
  };
}
const ALLOWED = new Set(["list", "put", "remove", "reveal", "generate", "head"]);

// PRIVILEGED side: serve holo-vault:* requests from app frames via the surface. Refuse any verb not in
// the narrowed allow-list (capability attenuation, SEC-2). Optionally bind to an expected app origin.
export function installVaultBridge(win, surface, { appOrigin = null, getSurface = null } = {}) {
  const onMsg = async (e) => {
    const d = e && e.data; if (!d || typeof d.t !== "string" || !d.t.startsWith("holo-vault:")) return;
    const verb = d.t.slice("holo-vault:".length);
    if (verb === "reply") return;
    const reply = (msg) => { try { (e.source || win).postMessage({ t: "holo-vault:reply", id: d.id, ...msg }, "*"); } catch {} };
    if (appOrigin && e.origin && e.origin !== appOrigin) return reply({ ok: false, error: "origin not permitted" });
    if (!ALLOWED.has(verb) || typeof surface[verb] !== "function" && !getSurface) return reply({ ok: false, error: "verb not permitted: " + verb });
    try { const s = getSurface ? await getSurface() : surface; if (!s || typeof s[verb] !== "function") return reply({ ok: false, error: "vault locked" }); const result = await s[verb](d.arg); reply({ ok: true, result }); }
    catch (err) { reply({ ok: false, error: String((err && err.message) || err) }); }   // fail-closed (e.g. reveal denied)
  };
  win.addEventListener("message", onMsg);
  return () => win.removeEventListener("message", onMsg);
}

// SANDBOXED side: a tiny promise client the Holo Pass app uses to call the bridge (default target=parent).
export function holoVaultClient(target = (typeof window !== "undefined" ? window.parent : null), timeoutMs = 30000) {
  let seq = 0; const pend = new Map();
  if (typeof window !== "undefined") window.addEventListener("message", (e) => { const d = e.data; if (d && d.t === "holo-vault:reply" && pend.has(d.id)) { const { res, rej } = pend.get(d.id); pend.delete(d.id); d.ok ? res(d.result) : rej(new Error(d.error || "vault error")); } });
  const call = (verb, arg) => new Promise((res, rej) => { const id = ++seq; pend.set(id, { res, rej }); try { target.postMessage({ t: "holo-vault:" + verb, id, arg }, "*"); } catch (e) { rej(e); } setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error("vault timeout")); } }, timeoutMs); });
  return {
    list: () => call("list"), put: (entry) => call("put", entry), remove: (id) => call("remove", id),
    reveal: (id) => call("reveal", id), generate: (opts) => call("generate", opts), head: () => call("head"),
  };
}
