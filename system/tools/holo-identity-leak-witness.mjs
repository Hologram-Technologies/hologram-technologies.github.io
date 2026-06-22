// holo-identity-leak-witness.mjs — the identity-κ boundary gate (Boundary A, frame). Proves the operator's
// replayable session assertion is NOT readable by a same-origin app, using the REAL session primitives.
//
// Audit finding (S0): openSession() returns a cleartext token { operator(κ), pub, sig, ... } and the shell/
// greeter dropped it into plaintext sessionStorage["holo.session"]. Every app mounts `allow-same-origin`
// (load-bearing — the shell injects Q/Sound/"+"/Playground via f.contentDocument, shell.html), so it shares
// all OS-origin storage ⇒ any app read operator κ + pub + replayable sig. The private key never leaked; the
// identity + a replayable assertion did. Spec: an app is "reachable only through a capability-scoped bridge."
//
// Fix (S1+S2, DISPLAY-SPLIT): persist a NON-secret presentation (operator κ + label, never pub/sig) for
// display + the full token AES-GCM-WRAPPED at rest (the same path that wraps the private key); the replayable
// assertion is re-derived only by a TEE/biometric unlock (resumeSession, Law L5). This witness drives the REAL
// presentationOf()/wrapSession() and asserts the invariant. Gate orientation = SAFETY: exit 0 = safe.
//
// Browser proof of the live iframe semantics (allow-same-origin app cannot read the assertion) is S4 on
// holo-serve-fhs; this is the Node proof of the storage-content invariant the fix changes.

import { ephemeral, openSession, presentationOf, wrapSession } from "../os/usr/lib/holo/holo-identity.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};
let pass = 0, fail = 0, kn = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56);
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); checks[(slug(name) || "check") + "-" + (++kn)] = !!cond; console.log((cond ? "  ok  " : " FAIL ") + name + (extra ? "  — " + extra : "")); };

// A same-origin storage stand-in — the surface an `allow-same-origin` app shares with the shell.
const makeStore = () => { const m = new Map(); const s = { setItem: (k, v) => m.set(k, String(v)), getItem: (k) => (m.has(k) ? m.get(k) : null), keys: () => [...m.keys()] }; return s; };

// THE shell's persistence today (S1+S2) — the real display-split: presentation cleartext + token wrapped.
async function persistSession(token, store, secret = "tee-released-secret") {
  store.setItem("holo.identity", JSON.stringify(presentationOf(token)));               // non-secret (operator + label)
  store.setItem("holo.session.wrapped", JSON.stringify(await wrapSession(token, secret)));  // app-opaque (pub/sig sealed)
}
// The pre-fix persistence — kept ONLY as a negative control, to prove this witness still detects a leak.
const legacyPersist = (token, store) => store.setItem("holo.session", JSON.stringify(token));

// EXACTLY what a hostile same-origin app runs: scan EVERY readable key for the replayable assertion.
function adversaryFindsAssertion(store) {
  for (const k of store.keys()) {
    let o = null; try { o = JSON.parse(store.getItem(k) || "null"); } catch {}
    if (o && o.operator && o.pub && o.sig) return { key: k, operator: o.operator };
  }
  return null;
}

async function main() {
  console.log("holo-identity-leak-witness · identity-κ boundary (frame) · display-split\n");

  const principal = await ephemeral({ label: "audit-operator" });
  const token = await openSession(principal, { session: "primeos" });
  ok("session token is real and carries the sensitive identity fields", /^did:holo:sha256:[0-9a-f]{64}$/.test(token.operator) && !!token.pub && !!token.sig, "operator/pub/sig present");

  // Precondition (static): apps mount allow-same-origin (NON-GOAL to change — carries ambient injection).
  let shellSrc = "";
  try { shellSrc = readFileSync(join(here, "../os/usr/share/frame/shell.html"), "utf8"); } catch {}
  ok("precondition: apps mount `allow-same-origin` (share OS-origin storage)", /sandbox:\s*"allow-scripts allow-same-origin/.test(shellSrc), "load-bearing; not removed by this fix");

  // ── THE INVARIANT: the live (display-split) persistence exposes no replayable assertion ──────────────
  const live = makeStore();
  await persistSession(token, live);
  const found = adversaryFindsAssertion(live);
  ok("an app CANNOT read operator κ + pub + sig from the persisted session", found === null,
     found ? "LEAK in " + found.key : "keys app-readable: " + live.keys().join(", "));

  // the presentation is the intended minimal disclosure — operator + label, NEVER pub/sig.
  const pres = JSON.parse(live.getItem("holo.identity"));
  ok("the presentation carries operator + label but NOT pub/sig (minimal disclosure)", !!pres.operator && !("pub" in pres) && !("sig" in pres), "operator + label only");
  // the wrapped token is opaque — no identity fields in the clear.
  const wrapped = JSON.parse(live.getItem("holo.session.wrapped"));
  ok("the wrapped token exposes nothing in the clear (app-opaque)", !wrapped.operator && !wrapped.pub && !wrapped.sig && wrapped.alg === "AES-GCM", "ciphertext only");

  // ── NEGATIVE CONTROL: the pre-fix cleartext persistence DOES leak (proves this test detects leaks) ──
  const legacy = makeStore();
  legacyPersist(token, legacy);
  ok("control: the pre-fix cleartext persistence is correctly detected as a leak", adversaryFindsAssertion(legacy) !== null, "test discriminates");

  const result = {
    "@type": "holo:WitnessResult", witness: "holo-identity-leak", step: "S2",
    boundary: "A/frame", model: "display-split", appReadableKeys: live.keys(),
    leakPresent: found !== null, gateOrientation: "safety (exit0=safe)",
    pass, fail, total: pass + fail, ok: fail === 0, checks,
  };
  writeFileSync(join(here, "holo-identity-leak-witness.result.json"), JSON.stringify(result, null, 2));
  console.log(`\n${fail === 0 ? "✅ PASS" : "❌ FAIL"}  ${pass}/${pass + fail}  ·  ${fail === 0 ? "no operator assertion reachable from app-readable storage" : "operator assertion still reachable"}`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("witness threw:", e); process.exit(1); });
