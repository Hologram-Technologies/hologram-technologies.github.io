// holo-mail-onboard.mjs - the onboarding flow logic: detect provider → collect credential → connect via the
// bridge → wait until linked, mapping every failure to a SPECIFIC, fixable message (never a generic error).
// Pure + injectable ({ bridge }) so it Node-gates against a mock bridge; the UI drives it, the browser wires
// the real bridge (email-bridge :8793). Creds pass straight to the loopback bridge and never leave the device.
import { detect, isValidEmail } from "./holo-mail-providers.mjs";

// Turn any bridge failure into { reason, fix } a human can act on.
function classifyError(errText) {
  const s = String(errText || "").toLowerCase();
  if (/auth|invalid credential|login failed|password|535|authenticationfailed/.test(s))
    return { reason: "Password not accepted", fix: "Use an app-password (not your normal password). Follow the steps above to create one." };
  if (/oauth|basic auth|disabled|not enabled/.test(s))
    return { reason: "This provider needs secure sign-in", fix: "Sign in with the provider (OAuth) instead of a password." };
  if (/timeout|etimedout|econnrefused|enotfound|dns|getaddrinfo|network|socket/.test(s))
    return { reason: "Couldn't reach the mail server", fix: "Check the address, or add your IMAP/SMTP server details below." };
  return { reason: "Couldn't connect", fix: String(errText || "Please try again.") };
}

// makeOnboarding({ bridge })
//   bridge: { login({email,password,imapHost?,imapPort?,smtpHost?,smtpPort?}) -> {ok, linked?, ...} | throws,
//             status() -> { linked, accounts:[{email,provider,backfillPct,health}] } }
export function makeOnboarding({ bridge } = {}) {
  // guide(email) - instant, no round-trip: what to show for this address.
  function guide(email) {
    if (!isValidEmail(email)) return { valid: false };
    return { valid: true, ...detect(email) };
  }

  // connect({email,password,host,port}) - attempt the login; returns {ok} or {ok:false, reason, fix}.
  async function connect({ email, password, imapHost, imapPort, smtpHost, smtpPort } = {}) {
    if (!isValidEmail(email)) return { ok: false, reason: "That doesn't look like an email address", fix: "Enter a full address like you@example.com." };
    if (!password) return { ok: false, reason: "Missing app-password", fix: "Paste the app-password you created." };
    const opt = {};
    if (imapHost) opt.imapHost = imapHost; if (imapPort) opt.imapPort = Number(imapPort);
    if (smtpHost) opt.smtpHost = smtpHost; if (smtpPort) opt.smtpPort = Number(smtpPort);
    try {
      const r = await bridge.login({ email, password, ...opt });
      if (r && (r.ok || r.linked)) return { ok: true, account: r.account || email };
      return { ok: false, ...classifyError((r && (r.error || r.reason)) || "login failed") };
    } catch (e) {
      return { ok: false, ...classifyError(e && e.message) };
    }
  }

  // waitLinked({ timeoutMs, onProgress }) - poll status until linked; report backfill %. Resolves
  // { linked, account, backfillPct } or { linked:false, timedOut:true }.
  async function waitLinked({ timeoutMs = 30000, intervalMs = 700, onProgress = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    const start = Date.now();
    for (;;) {
      let st; try { st = await bridge.status(); } catch { st = null; }
      const acct = st && st.accounts && st.accounts[0];
      if (onProgress && acct) { try { onProgress(acct.backfillPct || 0); } catch {} }
      if (st && st.linked) return { linked: true, account: acct ? acct.email : null, backfillPct: acct ? acct.backfillPct || 0 : 0, health: acct ? acct.health : null };
      if (Date.now() - start > timeoutMs) return { linked: false, timedOut: true };
      await sleep(intervalMs);
    }
  }

  const status = () => bridge.status();

  return { guide, connect, waitLinked, status, classifyError };
}

export default { makeOnboarding };
