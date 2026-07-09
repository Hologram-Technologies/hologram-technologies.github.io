// holo-autofill.mjs — the seamless web2 autofill engine (the Holo Pass content script). Runs INSIDE a
// web frame; the native κ-host injects it on navigation (the only remaining host C++ hook — a thin
// "inject this script into top + sub frames" + a gated credential channel). Everything below is pure JS.
//
// Magical + automated: on a login page it finds the username/password fields, asks the host for a saved
// credential FOR THIS EXACT ORIGIN (anti-phishing, ADR-013 — never a fuzzy/look-alike match), fills them
// React-safely, and on submit offers to save a new login. The page's JS never sees Hologram; the host
// mediates the credential so the secret only lands in the field it belongs to. No typing, no extension.

// ── pure logic (DOM-free, witnessable): associate the password field with its username field ──
// fields: [{ idx, tag, type, name, id, autocomplete }] in document order. Returns {user, pass} idx or null.
export function associateLogin(fields) {
  const pass = fields.filter((f) => f.type === "password");
  if (!pass.length) return null;
  const p = pass[0];
  const userCandidates = fields.filter((f) => f.idx < p.idx && (f.type === "text" || f.type === "email" || /user|email|login|account/i.test((f.name || "") + (f.id || "") + (f.autocomplete || ""))) && f.type !== "password");
  const byAc = userCandidates.find((f) => /username|email/.test(f.autocomplete || ""));
  const user = byAc || userCandidates[userCandidates.length - 1] || null;   // nearest text field above the password
  return { user: user ? user.idx : null, pass: p.idx };
}
// is this a SIGN-UP / change-password form (two password fields)? → do not autofill a saved login there.
export function isSignup(fields) { return fields.filter((f) => f.type === "password").length >= 2; }

// React/Vue-safe value set: use the native setter then dispatch input+change so the framework's state updates.
export function setFieldValue(el, value) {
  try {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value") && Object.getOwnPropertyDescriptor(proto, "value").set;
    if (setter) setter.call(el, value); else el.value = value;
  } catch { el.value = value; }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// snapshot a <form> (or the document) into the field descriptor list the pure logic consumes.
function describe(root) {
  const els = [...root.querySelectorAll("input")].filter((e) => e.type !== "hidden" && e.type !== "submit" && e.type !== "button");
  return els.map((el, idx) => ({ idx, el, tag: el.tagName, type: (el.getAttribute("type") || "text").toLowerCase(), name: el.name, id: el.id, autocomplete: el.getAttribute("autocomplete") }));
}

// ── DOM glue: find login forms, fill, capture-on-submit ──
export function findLoginForms(doc) {
  const forms = [...doc.querySelectorAll("form")];
  const roots = forms.length ? forms : [doc.body || doc];                 // some sites omit <form>
  const out = [];
  for (const root of roots) {
    const fields = describe(root);
    if (isSignup(fields)) continue;
    const a = associateLogin(fields);
    if (a && a.pass != null) out.push({ root, fields, userEl: a.user != null ? fields[a.user].el : null, passEl: fields[a.pass].el });
  }
  return out;
}
export function fillForm(form, { username, secret }) {
  if (form.userEl && username != null) setFieldValue(form.userEl, username);
  if (form.passEl && secret != null) setFieldValue(form.passEl, secret);
  return !!(form.passEl);
}

// install the engine on a document. `origin` is the HOST-VERIFIED frame origin (exact). `getCredential`
// asks the host for a saved login for THIS origin (returns {username,secret}|null — null ⇒ no fill, which
// is what makes a look-alike domain inert). `onSave` is offered a captured login after a submit. `fillTotp`
// (optional) supplies a current 2FA code for a code field. Returns a teardown fn.
// find a one-time-code (2FA) field — autocomplete="one-time-code" or name/id matching otp/2fa/code/totp.
export function findOtpField(doc) {
  const inputs = [...doc.querySelectorAll("input")].filter((e) => e.type !== "hidden" && e.type !== "password");
  return inputs.find((e) => /one-time-code/.test(e.getAttribute("autocomplete") || "") || /\botp\b|2fa|onetime|one-time|totp|authcode|auth[-_]?code|verification|\bcode\b/i.test((e.name || "") + " " + (e.id || "") + " " + (e.getAttribute("aria-label") || ""))) || null;
}

export function installAutofill({ doc = (typeof document !== "undefined" ? document : null), origin, getCredential, getTotp, onSave, autofill = true } = {}) {
  if (!doc || !origin || typeof getCredential !== "function") throw new Error("autofill: missing deps");
  const forms = findLoginForms(doc);
  let filled = false, otpFilled = false;
  async function tryFill() {
    if (!autofill) return;
    if (!filled) { const cred = await getCredential(origin); if (cred) { for (const f of forms) if (fillForm(f, cred)) filled = true; } }
    // 2FA: if a one-time-code field is present and the host has a TOTP for this origin, fill the live code
    if (!otpFilled && typeof getTotp === "function") { const otpEl = findOtpField(doc); if (otpEl) { const code = await getTotp(origin); if (code) { setFieldValue(otpEl, String(code)); otpFilled = true; } } }
  }
  // fill on load AND when the user focuses a credential field (covers late-rendered forms)
  tryFill();
  const onFocus = (e) => { if (e.target && (e.target.type === "password" || forms.some((f) => f.userEl === e.target))) tryFill(); };
  doc.addEventListener("focusin", onFocus, true);
  // capture-on-submit → offer to save (automated "save this login?")
  const onSubmit = (e) => {
    try {
      const root = e.target;
      const f = forms.find((x) => x.root === root) || forms[0];
      if (!f || !f.passEl || !f.passEl.value) return;
      const username = f.userEl ? f.userEl.value : null, secret = f.passEl.value;
      if (typeof onSave === "function") onSave({ origin, username, secret });
    } catch {}
  };
  doc.addEventListener("submit", onSubmit, true);
  return () => { doc.removeEventListener("focusin", onFocus, true); doc.removeEventListener("submit", onSubmit, true); };
}
