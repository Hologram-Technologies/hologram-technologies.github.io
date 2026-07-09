// holo-mail-onboard.gate.mjs - M4 phase-1 gate: provider detection + onboarding state machine (happy path,
// specific error mapping, backfill wait) against a mock bridge. No network.
//   run:  node holo-mail-onboard.gate.mjs
import { detect, isValidEmail, PROVIDERS } from "./holo-mail-providers.mjs";
import { makeOnboarding } from "./holo-mail-onboard.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } };

// ── provider detection ──
ok("Gmail detected + app-password path", detect("me@gmail.com").name === "Gmail" && detect("me@gmail.com").auth === "app-password" && !!detect("me@gmail.com").appPwUrl);
ok("iCloud aliases detected", detect("a@icloud.com").name === "iCloud" && detect("a@me.com").name === "iCloud");
ok("Yahoo + Fastmail detected", detect("a@yahoo.com").name === "Yahoo" && detect("a@fastmail.com").name === "Fastmail");
ok("Microsoft routed to OAuth", detect("a@outlook.com").auth === "oauth" && detect("a@hotmail.com").auth === "oauth");
ok("unknown domain → generic w/ host fields", detect("a@acme.dev").needsHostFields === true && detect("a@acme.dev").name === "Email");
ok("every provider has steps", Object.values(PROVIDERS).every((p) => Array.isArray(p.steps) && p.steps.length));
ok("email validation", isValidEmail("a@b.co") && !isValidEmail("nope") && !isValidEmail("a@b"));

// ── state machine over a mock bridge ──
function mockBridge({ loginResult, throwText, backfillSteps = [40, 100] } = {}) {
  let calls = 0;
  return {
    async login(_args) { if (throwText) throw new Error(throwText); return loginResult; },
    async status() { const pct = backfillSteps[Math.min(calls, backfillSteps.length - 1)]; calls++; return { linked: pct >= 100, accounts: [{ email: "me@gmail.com", provider: "Gmail", backfillPct: pct, health: "ok" }] }; },
  };
}

// guide is instant + no bridge call
{
  const ob = makeOnboarding({ bridge: mockBridge({}) });
  const g = ob.guide("me@gmail.com");
  ok("guide returns provider recipe", g.valid && g.name === "Gmail" && g.steps.length >= 2);
  ok("guide rejects bad email", ob.guide("nope").valid === false);
}

// happy path: login ok → connect ok
{
  const ob = makeOnboarding({ bridge: mockBridge({ loginResult: { ok: true, account: "me@gmail.com" } }) });
  const r = await ob.connect({ email: "me@gmail.com", password: "abcd efgh ijkl mnop" });
  ok("connect succeeds", r.ok === true && r.account === "me@gmail.com");
}

// missing password → specific
{
  const ob = makeOnboarding({ bridge: mockBridge({}) });
  const r = await ob.connect({ email: "me@gmail.com", password: "" });
  ok("missing password → specific fix", r.ok === false && /app-password/i.test(r.fix));
}

// auth failure → "use an app-password"
{
  const ob = makeOnboarding({ bridge: mockBridge({ throwText: "AUTHENTICATIONFAILED invalid credentials" }) });
  const r = await ob.connect({ email: "me@gmail.com", password: "wrong" });
  ok("auth error → app-password fix", r.ok === false && /Password not accepted/.test(r.reason));
}

// network failure → server-unreachable message
{
  const ob = makeOnboarding({ bridge: mockBridge({ throwText: "getaddrinfo ENOTFOUND imap.acme.dev" }) });
  const r = await ob.connect({ email: "me@acme.dev", password: "x", imapHost: "imap.acme.dev" });
  ok("network error → reach-server fix", r.ok === false && /reach the mail server/i.test(r.reason));
}

// waitLinked polls to linked, reports backfill
{
  const seen = [];
  const ob = makeOnboarding({ bridge: mockBridge({ backfillSteps: [30, 70, 100] }) });
  const r = await ob.waitLinked({ intervalMs: 1, timeoutMs: 5000, onProgress: (p) => seen.push(p) });
  ok("waitLinked reaches linked + reports progress", r.linked === true && seen.length >= 1 && r.backfillPct === 100);
}

// waitLinked times out cleanly (never links)
{
  const ob = makeOnboarding({ bridge: { async login() { return { ok: true }; }, async status() { return { linked: false, accounts: [] }; } } });
  const r = await ob.waitLinked({ intervalMs: 1, timeoutMs: 20 });
  ok("waitLinked times out cleanly", r.linked === false && r.timedOut === true);
}

console.log(`\nholo-mail-onboard gate: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
