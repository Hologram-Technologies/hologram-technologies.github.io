// holo-onboarding.mjs — the guest-first BOOT POLICY. It removes wall #2 (a name + biometric identity wall
// before she sees anything) and wall #6 ("Sign in" → unfamiliar crypto auth). The principle: she JUST
// STARTS. First run lands straight in the experience on a silently-created guest — no name, no biometric, no
// "sign in", no jargon. Identity is DEFERRED, never removed: it surfaces only when an action genuinely
// benefits from it (keep across devices, spend money, be "from you"), in one plain sentence — and those acts
// really do create a real, sovereign identity (we defer, we never deceive). A guest has the full LOCAL
// experience; identity only adds cross-device sync, money, and attributable action.
//
// The substrate is unchanged — holo-identity still mints guests and enrolls sovereign principals; this
// module only decides WHEN to ask and IN WHAT WORDS. Pure + deterministic (node-witnessable); login.html /
// identity.html adopt it.

// actions that genuinely require a real (non-guest) identity — and HONESTLY so. Everything else is local.
const BENEFIT = {
  "persist-across-devices": "Want to keep this on your other devices?",
  "spend":                  "Set up payments so you can buy things?",
  "sign-as-you":            "Want this to be from you, by name?",
  "publish-as-you":         "Share this as you, so people know it's yours?",
  "recover":                "Set a way to get back in if you ever lose this device?",
};

// bootPlan({ hasUsers }) → what the user meets on boot. NEVER a setup wall: first run is a silent guest
// that lands in the experience; a returning user resumes. No prompts either way.
export function bootPlan({ hasUsers = false } = {}) {
  return hasUsers
    ? { mode: "resume", land: "experience", prompts: [] }
    : { mode: "guest", land: "experience", prompts: [] };
}

// needsIdentity(action) → does this action genuinely require a real identity? Everyday actions: no.
export function needsIdentity(action) { return Object.prototype.hasOwnProperty.call(BENEFIT, action); }

// upgradeCopy(action) → the plain-words, jargon-free question to ask when a beneficial action is reached
// (only then — never on boot). Returns null for everyday actions (they never ask).
export function upgradeCopy(action) { return BENEFIT[action] || null; }

// guestCapable(action) → can a guest do this locally, with no identity? Everyday: yes. Beneficial: no
// (those honestly create a real identity — the deferral is not a lie).
export function guestCapable(action) { return !needsIdentity(action); }

export default { bootPlan, needsIdentity, upgradeCopy, guestCapable };
