// holo-openbank.mjs — bank-account aggregation (Open Banking AIS, read-only) as ONE κ.
//
// First principles (abstract the complexity, deliver the simplicity):
//   • A bank connection IS a κ. Consent is a signed, content-addressed object the operator owns
//     (kappaOf below) — not a token in a TPP's database. Revoke = delete the κ. Audit = read it.
//   • One door, default-deny. This module holds NO biometric and NO access token in cleartext beside
//     the consent: the access token lives in the injected sealed `store` (where wallet keys live);
//     the authority acts (grant / reconfirm / revoke) are bound to the consent κ and gated by the
//     OPERATOR's own biometric through holo-stepup-gate (injected as `gate`) — never faked here.
//   • Reads attenuate (holospaces SEC-2). listAccounts / getBalance / getTransactions never move value
//     and never trigger a biometric; they are legible to the wallet UI and to Q-with-a-standing-grant,
//     and to NOBODY else (boundary: raw bank data never crosses the wallet trust boundary — outward,
//     only a scoped `BalanceAtLeast` disclosure is mintable). See holo-identity-boundary-audit.
//   • The 90-day SCA moved TPP-side (FCA/EBA RTS Art.10a, 2022): reconfirm() extends the window with a
//     single operator biometric and NEVER touches beginConnect — no bank redirect. That legal fact is
//     what lets aggregation feel permanent. First connect per bank still needs the bank's own SCA.
//
// Pure + isomorphic: aggregator, clock (`now`), store, and the step-up `gate` are injected, so the whole
// orchestration (mint → seal → read → reconfirm → revoke → disclose) is provable under Node with no TEE,
// no network, no funds. The browser wires the real Yapily/TrueLayer adapter, the sealed store, and the
// host-side holo-stepup-gate; the witness wires in-memory stubs.

import { blake3hex } from "./holo-blake3.mjs";
import { sha256 } from "./wdk-crypto/wdk-crypto.bundle.mjs";

const te = new TextEncoder();
const HEXC = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, "0"));
const hex = (u) => { let s = ""; for (let i = 0; i < u.length; i++) s += HEXC[u[i]]; return s; };
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
  : JSON.stringify(v);
// §1.2 BLAKE3-only: the consent's κ mints under BLAKE3 — identical scheme to holo-wallet-agent.kappaOf, so ids stay comparable across the wallet.
export const kappaOf = (obj) => "did:holo:blake3:" + blake3hex(te.encode(canon(obj)));
// legacy dual-read: consents sealed under the prior sha256 scheme must still verify/open.
const kappaOfSha256 = (obj) => "did:holo:sha256:" + hex(sha256(te.encode(canon(obj)))); // legacy dual-read

const DAY = 86400000;
const WINDOW_MS = 90 * DAY;      // PSD2 consent window
const PREWARN_MS = 7 * DAY;      // Q raises the one-tap reconfirm this far ahead of expiry
const iso = (ms) => new Date(ms).toISOString();

// ── the consent κ. `consentRef` is the aggregator's opaque id; the ACCESS TOKEN is NOT in here — it is
//    sealed in `store` keyed by the consent κ. Re-deriving kappaOf(consentBody) MUST reproduce the id, so
//    any tamper (swapped bank, widened scope) changes the κ and is caught host-side at the gate. ──────────
function buildConsent({ bankId, scope, operator, aggregator, consentRef, nowMs }) {
  const grantedAt = nowMs, expiresAt = nowMs + WINDOW_MS, reconfirmAt = expiresAt - PREWARN_MS;
  const body = {
    "@type": "OpenBankingConsent",
    bankId, scope: [...scope].sort(), operator, aggregator, consentRef,
    grantedAt: iso(grantedAt), expiresAt: iso(expiresAt), reconfirmAt: iso(reconfirmAt),
  };
  return { ...body, id: kappaOf(body) };
}
const bodyOf = (c) => { const { id, ...rest } = c; return rest; };
// a consent is intact iff its κ re-derives — the same L5 self-verification the capability card uses.
// legacy dual-read: accept EITHER the BLAKE3 (canonical) or the prior sha256 κ so pre-migration consents still open.
export const verifyConsent = (c) => !!c && (c.id === kappaOf(bodyOf(c)) || c.id === kappaOfSha256(bodyOf(c)));

const DEFAULT_SCOPE = ["accounts", "balances", "transactions"];   // AIS read-only

// ── step-up kinds (authority class — NEVER suppressed; bound to the consent κ as payload). The classifier
//    here is the single source of truth the witness asserts; holo-stepup.mjs registers the same kinds. ──
export const STEPUP_KIND = {
  grant: "bank.consent.grant",
  reconfirm: "bank.consent.reconfirm",
  revoke: "bank.consent.revoke",
};
const AUTHORITY_KINDS = new Set(Object.values(STEPUP_KIND));
// read seam kinds — value never moves, so they MUST NOT trigger a biometric.
export const READ_KINDS = ["bankAccounts", "bankBalance", "bankTransactions"];
export const isBiometricKind = (kind) => AUTHORITY_KINDS.has(kind);

// ── governance — may THIS caller do THIS now? Mirrors holo-wallet-agent.govern. default-deny. ───────────
//   human  → the gate IS the consent.   q → reads need a standing bank-read grant; authority always per-action.
//   agent  → NOT offered a connect/reconfirm path at all (authority acts are never agent-reachable).
function governRead(caller, ctx) {
  const kind = caller?.kind || "human";
  if (kind === "human") return { ok: true, via: "human" };
  if (kind === "q") return ctx.bankReadGrant === true
    ? { ok: true, via: "q-standing-read-grant" }
    : { ok: false, refused: true, needsConsent: "read", reason: "Q must ask: no standing bank-read consent" };
  return { ok: false, refused: true, reason: "bank reads are wallet/Q-only (boundary)" };
}
function governAuthority(caller, ctx) {
  const kind = caller?.kind || "human";
  if (kind === "human") return { ok: true, via: "human" };
  if (kind === "q") return ctx.userApproved === true
    ? { ok: true, via: "q-per-action-approval" }
    : { ok: false, refused: true, needsConsent: "authority", reason: "Q must ask: bank consent needs explicit approval" };
  return { ok: false, refused: true, reason: "agents may never grant/reconfirm/revoke a bank consent" };
}

// ── the aggregator contract (adapter-agnostic; Yapily/TrueLayer implement it) ──────────────────────────
//   beginConnect(bankId,{scope}) -> { scaUrl, pendingRef }
//   completeConnect(pendingRef, callbackParams) -> { consentRef, token }
//   listAccounts(token) -> [{ accountId, name, type, ccy }]
//   getBalance(token, accountId) -> { amount, ccy, asOf }
//   getTransactions(token, accountId, {limit}) -> [{ id, amount, ccy, date, desc }]
//   reconfirm(consentRef, token) -> { token }            // TPP-side; NO bank redirect
//   revoke(consentRef, token) -> { ok }

export function makeOpenBank({ aggregator, store, now = () => Date.now(), gate = null, operator, onChange = null } = {}) {
  if (!aggregator) throw new Error("holo-openbank: an aggregator adapter is required");
  if (!store) throw new Error("holo-openbank: a sealed store is required");
  if (!operator) throw new Error("holo-openbank: the operator κ is required");

  // fire-and-forget local-mutation notice so a composer (e.g. the wallet) can roam the change. A failure to
  // roam must NEVER fail the bank op, so it is swallowed. ev = { kind:"grant"|"reconfirm"|"revoke", id, prevId? }.
  const emit = async (ev) => { try { await onChange?.(ev); } catch {} };

  // store layout:  consent:<κ> -> consent body (no token)   |   token:<κ> -> sealed access token
  const consentKey = (id) => "consent:" + id;
  const tokenKey = (id) => "token:" + id;
  const listConsents = async () => Promise.all(
    (await store.keys()).filter((k) => k.startsWith("consent:")).map((k) => store.get(k)));

  // run an authority act through the injected gate, bound to the consent κ. Fail-closed: no {ok:true} ⇒ stop.
  async function gateAuthority(kind, id, reason) {
    if (!gate) return { ok: true, via: "no-gate(test)" };   // witness/Node may omit the gate
    const g = await gate({ kind, payload: id, operator, reason });
    return g && g.ok ? { ok: true, token: g.token } : { ok: false, reason: (g && g.reason) || "step-up denied" };
  }

  return {
    kappaOf, verifyConsent, isBiometricKind, STEPUP_KIND, READ_KINDS,

    // 1) begin — hand back the bank's own SCA url (app-to-app / CIBA). No κ yet; nothing is trusted.
    async beginConnect(bankId, { scope = DEFAULT_SCOPE } = {}) {
      const { scaUrl, pendingRef } = await aggregator.beginConnect(bankId, { scope });
      return { scaUrl, pendingRef, bankId, scope };
    },

    // 2) complete — the bank returned from SCA. Mint the consent κ, gate the LOCAL grant with one biometric
    //    (bound to that κ), then seal the token. Default-deny: a gate denial mints nothing.
    async completeConnect(pendingRef, callbackParams, { bankId, scope = DEFAULT_SCOPE, caller = { kind: "human" }, ctx = {} } = {}) {
      const gov = governAuthority(caller, ctx);
      if (!gov.ok) return gov;
      const { consentRef, token } = await aggregator.completeConnect(pendingRef, callbackParams);
      const consent = buildConsent({ bankId, scope, operator, aggregator: aggregator.id, consentRef, nowMs: now() });
      const gated = await gateAuthority(STEPUP_KIND.grant, consent.id, `Connect ${bankId}`);
      if (!gated.ok) return { ok: false, refused: true, reason: gated.reason };
      await store.set(consentKey(consent.id), consent);
      await store.set(tokenKey(consent.id), token);          // sealed; never returned to callers
      await emit({ kind: "grant", id: consent.id });
      return { ok: true, via: gov.via, id: consent.id, consent };
    },

    // 3) reads — across ALL consents, value never moves, never a biometric. Q needs a standing grant.
    async listAccounts({ caller = { kind: "human" }, ctx = {} } = {}) {
      const gov = governRead(caller, ctx); if (!gov.ok) return gov;
      const out = [];
      for (const c of await listConsents()) {
        const token = await store.get(tokenKey(c.id));
        const accts = await aggregator.listAccounts(token);
        for (const a of accts) out.push({ ...a, bankId: c.bankId, consent: c.id });
      }
      return { ok: true, via: gov.via, accounts: out };
    },
    async getBalance(accountId, { consent: id, caller = { kind: "human" }, ctx = {} } = {}) {
      const gov = governRead(caller, ctx); if (!gov.ok) return gov;
      const token = await store.get(tokenKey(id));
      return { ok: true, via: gov.via, balance: await aggregator.getBalance(token, accountId) };
    },
    async getTransactions(accountId, { consent: id, limit = 50, caller = { kind: "human" }, ctx = {} } = {}) {
      const gov = governRead(caller, ctx); if (!gov.ok) return gov;
      const token = await store.get(tokenKey(id));
      return { ok: true, via: gov.via, transactions: await aggregator.getTransactions(token, accountId, { limit }) };
    },

    // 4) reconfirm — the 90-day TPP-side extension. ONE biometric, bound to the κ, NO beginConnect.
    async reconfirm(id, { caller = { kind: "human" }, ctx = {} } = {}) {
      const gov = governAuthority(caller, ctx); if (!gov.ok) return gov;
      const prev = await store.get(consentKey(id));
      if (!prev || !verifyConsent(prev)) return { ok: false, reason: "unknown or tampered consent" };
      const gated = await gateAuthority(STEPUP_KIND.reconfirm, id, `Reconfirm ${prev.bankId}`);
      if (!gated.ok) return { ok: false, refused: true, reason: gated.reason };
      const token = await store.get(tokenKey(id));
      const { token: newToken } = await aggregator.reconfirm(prev.consentRef, token);
      // re-mint with a fresh window; same bank/scope/ref ⇒ a NEW κ (the window is part of the κ).
      const consent = buildConsent({ bankId: prev.bankId, scope: prev.scope, operator, aggregator: aggregator.id, consentRef: prev.consentRef, nowMs: now() });
      await store.del(consentKey(id)); await store.del(tokenKey(id));
      await store.set(consentKey(consent.id), consent);
      await store.set(tokenKey(consent.id), newToken || token);
      await emit({ kind: "reconfirm", id: consent.id, prevId: id });   // κ changed: composer must retire prevId
      return { ok: true, via: gov.via, id: consent.id, consent };
    },

    // 5) revoke — drop the κ and the sealed token; tell the aggregator. Reads after this refuse.
    async revoke(id, { caller = { kind: "human" }, ctx = {} } = {}) {
      const gov = governAuthority(caller, ctx); if (!gov.ok) return gov;
      const prev = await store.get(consentKey(id));
      if (!prev) return { ok: false, reason: "unknown consent" };
      const gated = await gateAuthority(STEPUP_KIND.revoke, id, `Disconnect ${prev.bankId}`);
      if (!gated.ok) return { ok: false, refused: true, reason: gated.reason };
      const token = await store.get(tokenKey(id));
      try { await aggregator.revoke(prev.consentRef, token); } catch { /* local revoke is authoritative */ }
      await store.del(consentKey(id)); await store.del(tokenKey(id));
      await emit({ kind: "revoke", id });
      return { ok: true, via: gov.via, revoked: id };
    },

    // 6) Q's proactive watch — which consents are within the pre-warn window? (zero side effects; no read.)
    async dueForReconfirm() {
      const nowMs = now();
      const due = (await listConsents()).filter((c) => Date.parse(c.reconfirmAt) <= nowMs)
        .map((c) => ({ id: c.id, bankId: c.bankId, expiresAt: c.expiresAt }));
      return { ok: true, due };
    },

    // 7) boundary — the ONLY thing mintable OUTWARD. A scoped predicate, never raw data; an external caller
    //    gets a yes/no, never the statement. (Selective disclosure — holo-sovereign-credentials.)
    async discloseAtLeast(accountId, { consent: id, ccy, threshold } = {}) {
      const token = await store.get(tokenKey(id));
      const bal = await aggregator.getBalance(token, accountId);
      const holds = bal.ccy === ccy && Number(bal.amount) >= Number(threshold);
      const claim = { "@type": "BalanceAtLeast", ccy, threshold: String(threshold), holds, operator };
      return { ...claim, id: kappaOf(claim) };   // a verifiable scoped credential — NO amount, NO txns
    },
  };
}

export default makeOpenBank;
