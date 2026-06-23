// holo-consent.mjs — the human-layer CONSENT POLICY. It removes the worst non-technical-user wall: a
// legalese consent card before EVERY app open (holo-terms.js). The substrate is unchanged — default-deny,
// the constitutional admission (holo-admit) and the cryptographic step-up proof (holo-stepup) all still
// hold. This module changes only the SURFACE: it decides, per declared capability, whether to interrupt the
// user at all, when, and in what words.
//
//   AMBIENT  — the app using its own data / compute / its own surface. Auto-granted SILENTLY (no card).
//   SENSITIVE— something that truly touches her (camera, mic, location, money, another app's data, her
//              files/contacts, notifications, sharing activity). Asked ONLY at the moment of use, in ONE
//              plain sentence, no jargon. Backed by holo-stepup when she says yes.
//   PROHIBITED/unknown — refused outright (not prompted, not granted).
//
// So my mother opens any app and it just opens; she is asked, in plain words, only when it matters — like
// iOS, never like a constitution. Pure + deterministic (node-witnessable); the surface (holo-terms) calls it.

// words a non-technical user should NEVER see in a consent prompt (the witness asserts none leak).
export const JARGON = ["delegate", "attest", "attestation", "grant", "term", "terms", "capability", "permission", "scope", "principal", "seal", "did", "kappa", "credential", "constitution", "sovereign", "wallet"];

// the taxonomy: each known capability → its sensitivity, plain-language copy, and when to ask.
// `when:"use"` = lazily, the first time the app actually does it (never on open).
const CAPS = {
  // ambient — the app's own doing; no interruption
  read:        { level: "ambient" },                 // read its own data
  storage:     { level: "ambient" },
  render:      { level: "ambient" },
  compute:     { level: "ambient" },
  converse:    { level: "ambient" },                 // talk to Q
  network:     { level: "ambient" },                 // reach its own origin/peers (κ-verified anyway)
  // sensitive — touches her; plain words, at use
  camera:        { level: "sensitive", when: "use", plain: "use your camera" },
  microphone:    { level: "sensitive", when: "use", plain: "use your microphone" },
  location:      { level: "sensitive", when: "use", plain: "see your location" },
  "wallet:spend":{ level: "sensitive", when: "use", plain: "send money — you approve each payment" },
  "read-foreign":{ level: "sensitive", when: "use", plain: "see another app's information" },
  files:         { level: "sensitive", when: "use", plain: "open your files" },
  contacts:      { level: "sensitive", when: "use", plain: "see your contacts" },
  notify:        { level: "sensitive", when: "use", plain: "send you notifications" },
  contribute:    { level: "sensitive", when: "use", plain: "share a little of your activity to improve itself" },
};

// classify(cap) → { level, when?, plain? }. Unknown capabilities are PROHIBITED (fail-closed surface).
export function classify(cap) {
  const c = CAPS[cap];
  if (!c) return { level: "prohibited" };
  if (c.level === "ambient") return { level: "ambient" };
  return { level: "sensitive", when: c.when || "use", plain: c.plain };
}

// consentPlan(caps, { appName }) → { autoGrant:[cap], ask:[{cap, plain, when}], refuse:[cap] }.
// On OPEN nothing is asked (every sensitive prompt defers to use) — so an app always just opens.
export function consentPlan(caps = [], { appName = "this app" } = {}) {
  const autoGrant = [], ask = [], refuse = [];
  for (const cap of caps) {
    const c = classify(cap);
    if (c.level === "ambient") autoGrant.push(cap);
    else if (c.level === "sensitive") ask.push({ cap, when: c.when, plain: c.plain });
    else refuse.push(cap);
  }
  return { app: appName, autoGrant, ask, refuse };
}

export default { classify, consentPlan, JARGON };
