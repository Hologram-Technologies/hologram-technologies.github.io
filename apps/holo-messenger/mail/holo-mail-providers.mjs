// holo-mail-providers.mjs - client-side provider registry for effortless onboarding. Maps an email domain
// → how to connect: provider name, auth path (app-password vs oauth), the exact app-password page, and a
// short guided recipe. The bridge owns the transport truth (host/port via providerFor); this owns the UX
// truth (what to show the human). Pure + dependency-free (Node + browser).
//
// Auth reality (2026): app-passwords still work for Gmail/iCloud/Yahoo/Fastmail/most IMAP. Microsoft
// deprecated basic-auth IMAP → it needs OAuth (XOAUTH2). We mark that honestly so onboarding routes right.

export const PROVIDERS = {
  "gmail.com":      { name: "Gmail",    auth: "app-password", appPwUrl: "https://myaccount.google.com/apppasswords",
    steps: ["Turn on 2-Step Verification (required for app passwords).", "Open Google App passwords (button below).", "Create one for Mail and paste the 16-character code here."] },
  "googlemail.com": { name: "Gmail",    auth: "app-password", appPwUrl: "https://myaccount.google.com/apppasswords",
    steps: ["Turn on 2-Step Verification (required for app passwords).", "Open Google App passwords (button below).", "Create one for Mail and paste the code here."] },
  "icloud.com":     { name: "iCloud",   auth: "app-password", appPwUrl: "https://account.apple.com/account/manage",
    steps: ["Open your Apple Account (button below).", "Under Sign-In & Security, choose App-Specific Passwords.", "Generate one and paste it here."] },
  "me.com":         { name: "iCloud",   auth: "app-password", appPwUrl: "https://account.apple.com/account/manage",
    steps: ["Open your Apple Account (button below).", "Under Sign-In & Security, choose App-Specific Passwords.", "Generate one and paste it here."] },
  "mac.com":        { name: "iCloud",   auth: "app-password", appPwUrl: "https://account.apple.com/account/manage",
    steps: ["Open your Apple Account (button below).", "Choose App-Specific Passwords.", "Generate one and paste it here."] },
  "yahoo.com":      { name: "Yahoo",    auth: "app-password", appPwUrl: "https://login.yahoo.com/account/security",
    steps: ["Open Yahoo Account Security (button below).", "Generate an app password for Mail.", "Paste it here."] },
  "fastmail.com":   { name: "Fastmail", auth: "app-password", appPwUrl: "https://www.fastmail.com/settings/security/devicekeys",
    steps: ["Open Fastmail app passwords (button below).", "Create one with IMAP + SMTP access.", "Paste it here."] },
  "outlook.com":    { name: "Outlook",  auth: "oauth", appPwUrl: "https://account.microsoft.com/security",
    steps: ["Microsoft needs a secure sign-in (OAuth).", "Click Sign in with Microsoft and approve access."] },
  "hotmail.com":    { name: "Outlook",  auth: "oauth", appPwUrl: "https://account.microsoft.com/security",
    steps: ["Microsoft needs a secure sign-in (OAuth).", "Click Sign in with Microsoft and approve access."] },
  "live.com":       { name: "Outlook",  auth: "oauth", appPwUrl: "https://account.microsoft.com/security",
    steps: ["Microsoft needs a secure sign-in (OAuth).", "Click Sign in with Microsoft and approve access."] },
};

const GENERIC = {
  name: "Email", auth: "app-password", appPwUrl: null,
  steps: ["Enter your mail password (or an app password if your provider requires one).", "If it doesn't connect, add your IMAP/SMTP server below."],
  needsHostFields: true,
};

export function domainOf(email) {
  const m = String(email || "").trim().toLowerCase().match(/@([^@\s]+)$/);
  return m ? m[1] : "";
}

// detect(email) → the guidance for this address. Unknown domains get a generic IMAP recipe with host fields.
export function detect(email) {
  const dom = domainOf(email);
  const p = PROVIDERS[dom];
  if (p) return { domain: dom, ...p, needsHostFields: false };
  return { domain: dom, ...GENERIC };
}

// isValidEmail - cheap gate before we bother the bridge.
export const isValidEmail = (email) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || "").trim());

export default { PROVIDERS, detect, domainOf, isValidEmail };
