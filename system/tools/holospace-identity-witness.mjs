// holospace-identity-witness.mjs — proves the sovereign-holospace identity+TEE layer: owner-binding, seal under
// the operator's TEE-derived key, only-the-owner-opens, tamper-refuse, deterministic seal, guest ephemeral +
// claim, and the TEE gate is FAIL-CLOSED. Pure node. Run: node holospace-identity-witness.mjs
import {
  ownHolospace, ownerOf, isOwnedBy, sealState, openState, gateAction, guestHolospace, claimGuest,
} from "../os/usr/lib/holo/holospace-identity.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const enc = (s) => new TextEncoder().encode(s);
const eq = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

// two TEE-authorized operators (their DID κ) + the TEE secrets their biometric would yield, on this device.
const A = "did:holo:sha256:" + "a".repeat(64), Asecret = "tee-secret-A", dev = "device-1";
const B = "did:holo:sha256:" + "b".repeat(64), Bsecret = "tee-secret-B";
const spec = { "@type": "holospace.v1", name: "alpine-dev", machine: "did:holo:blake3:" + "1".repeat(64) };
const state = enc("the booted machine's snapshot bytes (would be Workspace.suspend())");

// 1. ownership
const m = ownHolospace(spec, A);
ok(ownerOf(m) === A && isOwnedBy(m, A) && !isOwnedBy(m, B), "a holospace is owned by its operator DID");

// 2. seal → open round-trip under operator A's TEE-derived key
const blob = await sealState(state, A, Asecret, dev);
const opened = await openState(blob, A, Asecret, dev);
ok(eq(opened, state), "state seals under A's TEE key and opens back identical");

// 3. only the owner opens — B's key (different operator AND secret) cannot
ok(await openState(blob, B, Bsecret, dev) === null, "a different operator cannot open A's holospace (wrong TEE key → null)");
ok(await openState(blob, A, "wrong-secret", dev) === null, "A with the WRONG biometric secret cannot open it");
ok(await openState(blob, A, Asecret, "other-device") === null, "A on a different device cannot open it (device-bound salt)");

// 4. tamper-refuse (AES-GCM auth + L5)
const t = blob.slice(); t[t.length - 1] ^= 0xff;
ok(await openState(t, A, Asecret, dev) === null, "a tampered seal is refused (AES-GCM auth)");

// 5. deterministic seal (κ-memo: identical owner+secret+plaintext → identical bytes, so dedup holds)
const blob2 = await sealState(state, A, Asecret, dev);
ok(eq(blob, blob2), "the seal is deterministic (κ-memo preserved for dedup)");

// 6. guests — ephemeral, UNSEALED
const g = await guestHolospace(spec);
ok(g.sealed === false && /^did:holo:sha256:/.test(ownerOf(g.manifest)) && ownerOf(g.manifest) !== A,
   "a guest holospace is owned by a fresh ephemeral DID and is NOT sealed");

// 7. claim — sign in (TEE) → the guest overlay is re-sealed under operator A; A opens, B can't
const overlay = enc("guest's work in the live session");
const claimed = await claimGuest(overlay, spec, A, Asecret, dev);
ok(isOwnedBy(claimed.manifest, A), "claimed holospace is now owned by A");
ok(eq(await openState(claimed.sealed, A, Asecret, dev), overlay), "A opens the claimed overlay (work survived)");
ok(await openState(claimed.sealed, B, Bsecret, dev) === null, "B cannot open A's claimed holospace");

// 8. the TEE gate is FAIL-CLOSED — no TEE present (node) ⇒ gateAction throws, never a weaker path
let threw = false;
try { await gateAction({ kind: "mount-device-files", holospaceKappa: "did:holo:blake3:" + "9".repeat(64), operator: A }); }
catch (e) { threw = true; }
ok(threw, "a privileged op (gateAction) is FAIL-CLOSED without a real TEE — TEE authorisation is mandatory");

console.log(`\nholospace-identity-witness: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
