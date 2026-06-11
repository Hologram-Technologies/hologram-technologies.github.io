# ADR-048: Holo Settle — verifiable settlement (pay agents against proven work)

**Status:** Accepted — witnessed: `settle-witness.mjs` is green and `w3c:A58-holo-settle` is a row in
`w3c-conformance.jsonld`; the `holo-settle` spec row is in `specs.json`; the settlement index is the 11th
root of the repository graph. The capstone of the agent stack — it composes the work receipt (ADR-045,
which already composes 034·039·042·033) into one settleable object. Builds on the UOR envelope +
`verifyDeep` (ADR-025) and the signature layer (`holo-vc.mjs`).

**Context.** Verifiable orchestration (ADR-045) gives an answer that carries its own proof of provenance.
The last question is the economic one: **how do the agents get paid, trustlessly?** Project NANDA's
payment model is **x402-NP** (the x402 protocol adapted for NANDA Points): a paid tool rejects a call
lacking payment, the payer runs `initiateTransaction` → obtains a `txId`, and retries with that proof.
The proof is a **trusted `txId`** — a reference to a transaction in a ledger you must trust — and it
proves a tool was *called*, not that the *work* was correctly done. Output you can verify is the
precondition for paying for it; the receipt makes that verification possible.

**Decision.** **Settlement is conditioned on the re-derivation of the work receipt — pay against proven
work, not claimed work.** Three binding rules:

1. **A settlement is a content-addressed escrow** (`holo-settle.mjs`, `settlement`). A payer-signed
   `schema:Order` that commits, by content address (`prov:used` Merkle link), to the exact work receipt
   and to a **split** — each contributing agent's share, derived deterministically from the receipt (by
   contribution) and bound to its operational did **and** its NANDA identity κ. The conditions are named:
   the receipt re-derives, every step was authorized, every step was conscience-accepted.
2. **Release is a pure function of re-derivation** (`settle`). Anyone — the payer, the payee, a relay —
   runs `settle(receipt, order)`; it releases a voucher per payee **only if** the order is valid *and*
   `verifyDeep(receipt)` holds *and* every step passes `authorizeStep` (ADR-042) *and* no step's
   conscience verdict is a block (ADR-033). **Tampered or unproven work releases nothing.** No escrow
   agent decides whether the work was done — the work's content address *is* the proof, so neither side
   can cheat: the payer cannot withhold payment for verifiably-done work, and the payee cannot claim
   payment for work not done.
3. **The voucher is the content-addressed txId** (`redeem`). A voucher is a `schema:Invoice` whose κ is
   the payment id — idempotent, so the same receipt+order always yields the same voucher (no
   double-spend on the same work). The payee redeems with **no trusted intermediary**: re-derive the
   voucher, verify the payer's signed order, re-derive the work receipt, and confirm the amount is in the
   order's split. x402-NP-compatible fields let a NANDA payments client read it.

**Consequences.**

- **The trustless agent economy, witnessed.** `node holo-settle.mjs build` commissions the demo
  collaboration and settles it — 10000 NP split `6666/3334` by contribution (the 2-step agent vs the
  1-step agent), with the tampered-receipt case releasing nothing. The witness proves
  release-on-proven-work, conservation (the split sums exactly to the total), identity binding,
  composition of the receipt's guarantees (a tampered delegation or verdict withholds payment), voucher
  tamper-refusal, idempotence, trustless redeem, and x402-NP compatibility.
- **The whole stack in one settleable object.** A settlement commits to a receipt that commits to
  identity (034) ⊕ reputation (039) ⊕ authorization (042) ⊕ conscience (033) ⊕ the computation (045).
  Paying releases value only when *all* of it re-derives.
- **Production wiring.** The voucher models the release; in production it redeems against a real rail —
  NANDA Points (x402-NP), Lightning (L402), or an on-chain transfer through Holo Wallet's default-deny,
  human-approval signing seam — keyed on the voucher κ. The data model and the release condition are
  production-shaped; only the rail is mocked offline.

**External authorities.** Project NANDA payments
([nanda-payments](https://github.com/projnanda/nanda-payments), x402-NP) +
[x402](https://github.com/coinbase/x402); W3C [schema.org](https://schema.org/) (Order/Invoice/
MonetaryAmount) + [VC Data Integrity](https://www.w3.org/TR/vc-data-integrity/) +
[PROV-O](https://www.w3.org/TR/prov-o/); Law L5 (verification by re-derivation).
