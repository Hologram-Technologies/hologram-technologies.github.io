// gmail-serverless.mjs — 100% SERVERLESS in-browser Gmail connector (OAuth 2.0 PKCE + Gmail REST API).
//
// No server of ours: the browser runs the OAuth PKCE dance directly with Google, holds the tokens DEVICE-LOCAL
// (the app vaults them, TEE-sealed), and calls gmail.googleapis.com (CORS-enabled — verified reachable from the
// live github.io origin) to read + send. Emits the messenger's existing EMAIL ingest shape → κ, so the whole
// mail subsystem (reader, attachments, Q mail-AI) works unchanged. Same rail-class as Telegram: an OPEN, sanctioned
// API with no origin gate and no ban-risk (unlike WhatsApp — see [[holo-messenger-whatsapp-serverless]]).
//
// The `client_id` is an APP credential (embedded, not secret): the operator registers a Google Cloud OAuth
// "Web application" client (console.cloud.google.com) with the github.io page as an Authorized JS origin +
// redirect URI, then drops the id into localStorage `holo.gmail.clientId` — a one-time step like Telegram's
// api_id. The ACCESS/REFRESH TOKENS are the secret; they live only on-device and are never transmitted to us.
// (Extends to Outlook/Graph + JMAP by the same pattern; Gmail first.)

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "openid", "email", "profile",
].join(" ");
const AUTH_EP = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_EP = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decodeB64url = (s) => { try { return new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))); } catch { return ""; } };
async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

// ── OAuth (browser-direct PKCE; no server) ───────────────────────────────────────────────────────────────────
// beginLogin → { url, verifier, state }: open `url` (popup/redirect); keep verifier+state for the exchange.
export async function beginGmailLogin({ clientId, redirectUri }) {
  const { verifier, challenge } = await pkce();
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const url = AUTH_EP + "?" + new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES,
    code_challenge: challenge, code_challenge_method: "S256", state, access_type: "offline", prompt: "consent", include_granted_scopes: "true",
  });
  return { url, verifier, state };
}
// completeLogin (after Google redirects back with ?code): exchange the code → tokens (CORS POST, no secret — PKCE).
export async function completeGmailLogin({ clientId, redirectUri, code, verifier }) {
  const r = await fetch(TOKEN_EP, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, grant_type: "authorization_code", code, code_verifier: verifier }) });
  if (!r.ok) throw new Error("gmail token exchange failed " + r.status + " " + (await r.text()).slice(0, 140));
  return await r.json();   // { access_token, refresh_token, expires_in, token_type, scope }
}
export async function refreshGmailToken({ clientId, refreshToken }) {
  const r = await fetch(TOKEN_EP, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, grant_type: "refresh_token", refresh_token: refreshToken }) });
  if (!r.ok) throw new Error("gmail refresh failed " + r.status);
  return await r.json();
}

// ── the connector (registerConnector contract) ───────────────────────────────────────────────────────────────
export function createGmailConnector({ token, refresh, clientId }) {
  let accessToken = token;
  const authHdr = () => ({ authorization: "Bearer " + accessToken });
  // auto-refresh on 401 (tokens expire ~1h)
  const api = async (path, opts = {}) => {
    let r = await fetch(API + path, { ...opts, headers: { ...authHdr(), ...(opts.headers || {}) } });
    if (r.status === 401 && refresh && clientId) {
      try { const t = await refreshGmailToken({ clientId, refreshToken: refresh }); if (t.access_token) { accessToken = t.access_token; try { window.dispatchEvent(new CustomEvent("holo-gmail-token", { detail: { access_token: accessToken } })); } catch {} } } catch {}
      r = await fetch(API + path, { ...opts, headers: { ...authHdr(), ...(opts.headers || {}) } });
    }
    return r;
  };
  let _ingest = null;
  const header = (hs, name) => (hs.find((h) => h.name.toLowerCase() === name) || {}).value || "";
  const walk = (part, acc) => {
    if (!part) return;
    if (part.parts) part.parts.forEach((p) => walk(p, acc));
    const mime = part.mimeType || "";
    if (mime === "text/plain" && part.body && part.body.data) acc.plain += decodeB64url(part.body.data);
    else if (mime === "text/html" && part.body && part.body.data) acc.html += decodeB64url(part.body.data);
    else if (part.filename && part.body && part.body.attachmentId) acc.attachments.push({ id: part.body.attachmentId, name: part.filename, mime, size: part.body.size });
  };
  // one Gmail API message → the messenger's email ingest shape (κ)
  const toIngest = (full) => {
    const hs = (full.payload && full.payload.headers) || [];
    const from = header(hs, "from"), subject = header(hs, "subject"), date = header(hs, "date");
    const fromEmail = (from.match(/<([^>]+)>/) || [])[1] || from;
    const fromName = from.replace(/<[^>]+>/, "").replace(/"/g, "").trim() || fromEmail;
    const acc = { plain: "", html: "", attachments: [] }; walk(full.payload, acc);
    return {
      platform: "gmail", jid: full.threadId || fromEmail, chat: fromName || fromEmail, sender: fromName || fromEmail,
      text: full.snippet || acc.plain.slice(0, 240), subject,
      sentAt: date ? Date.parse(date) : (Number(full.internalDate) || Date.now()),
      fromMe: false, extId: "email:msg:" + full.id, group: false,
      _html: acc.html, _attachments: acc.attachments,   // (T-followup: html→putBlob κ grain + htmlRef; attachments lazy)
    };
  };
  return {
    platform: "gmail", label: "Gmail", echoes: true,
    start(a) { _ingest = a.ingest; },
    // pull recent inbox → κ. Gate: real mail threads populate the inbox.
    async pull({ max = 25 } = {}) {
      let n = 0;
      try {
        const list = await (await api("/messages?maxResults=" + max + "&q=in:inbox")).json();
        for (const m of (list.messages || [])) {
          const full = await (await api("/messages/" + m.id + "?format=full")).json();
          if (full && full.payload) { try { _ingest(toIngest(full)); n++; } catch {} }
        }
      } catch (e) { try { window.__gmailErr = String(e); } catch {} }
      return n;
    },
    // send a reply/new mail (RFC 822 → base64url → messages.send)
    async send({ chat, text, subject }) {
      try {
        const raw = "To: " + chat + "\r\nSubject: " + (subject || "(no subject)") + "\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" + String(text ?? "");
        const b64 = btoa(unescape(encodeURIComponent(raw))).replace(/\+/g, "-").replace(/\//g, "_");
        const r = await api("/messages/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ raw: b64 }) });
        return r.ok;
      } catch { return false; }
    },
    _toIngest: toIngest,   // exported for unit-verification without a live account
  };
}
