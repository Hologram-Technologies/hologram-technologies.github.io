#!/usr/bin/env node
// holo-home-reach-witness.mjs — proves ZERO-CONFIG REACH (holo-home-reach): a new device PAIRS (a scoped,
// operator-signed grant — holo-pair) and then RECONCILES the owner's Home chain into its own, with no box,
// no origin, no port. The two decisions the reach owns: the TRUST gate (no valid grant ⇒ no Home, even for
// a chain that would fast-forward) and the RECONCILE policy (adopt / in-sync / behind / diverged / refuse),
// with adopt() being the strand's verify-before-adopt. Drives the real substrate: holo-home over holo-
// strand, the real holo-pair delegation, real enrolled operators.
//
// Checks (all must hold):
//   1 fastForwardAdopts    — a granted peer chain that strictly extends local ⇒ adopted; Home gains it.
//   2 behindKeepsLocal     — local already contains the peer's history ⇒ "behind", local untouched.
//   3 divergedKeepsBoth    — a shared prefix then a fork ⇒ "diverged", longest reported, local untouched.
//   4 inSyncNoop           — identical chains ⇒ "in-sync", nothing adopted.
//   5 refusesTamperedPeer  — a tampered peer chain ⇒ "refuse"; the local Home is untouched.
//   6 ungrantedRefused     — a peer that WOULD fast-forward but presents a bad-audience grant ⇒ refused,
//                            NOT adopted (the zero-config trust gate: only granted devices pull the Home).
//
// Authority: UOR-ADDR · holospaces Laws L1/L5 · UCAN attenuated delegation · rests on #holo-home-reach +
// #holo-home + #holo-strand + #holo-pair. node tools/holo-home-reach-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeHome } from "../os/usr/lib/holo/holo-home.mjs";
import { reconcile, joinFromPeer } from "../os/usr/lib/holo/holo-home-reach.mjs";
import { createPairOffer, mintDeviceGrant, acceptGrant } from "../os/usr/lib/holo/holo-pair.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let store = clone(init); return { load: async () => clone(store), save: async (r) => { store = clone(r); }, dump: () => clone(store) }; };

let tick = 0;
const now = () => `2026-06-24T04:00:${String(tick++).padStart(2, "0")}.000Z`;
const NOW = Date.parse("2026-06-24T04:00:00Z");
const op = await enroll({ label: "roam-owner", passphrase: "correct horse battery staple five" });

const FA = "did:holo:sha256:" + "a".repeat(64);
const FB = "did:holo:sha256:" + "b".repeat(64);
const FX = "did:holo:sha256:" + "1".repeat(64);
const FY = "did:holo:sha256:" + "2".repeat(64);

// ── common prefix (init + file A), then an EXTENSION (+ file B) ──────────────────────────────────────
const pfxBackend = arrayBackend();
const pfx = makeHome({ backend: pfxBackend, now, signer: op });
await pfx.init({ owner: op.kappa, title: "Roam Home" });
await pfx.addFile(FA, "a.md");
const prefixChain = pfxBackend.dump();                 // len 2
await pfx.addFile(FB, "b.md");
const extendedChain = pfxBackend.dump();               // len 3 — strictly extends prefixChain

// ── two forks that SHARE the prefix but diverge at seq 2 ─────────────────────────────────────────────
const fa = makeHome({ backend: arrayBackend(prefixChain), now, signer: op }); await fa.addFile(FX, "x.md");
const fb = makeHome({ backend: arrayBackend(prefixChain), now, signer: op }); await fb.addFile(FY, "y.md");
const chainA = fa._strand.replay({});
const chainB = fb._strand.replay({});

// ── a real device grant from the owner (the "scan a code" handshake) ─────────────────────────────────
const { offer, secrets } = await createPairOffer({ deviceName: "New Phone" });
const { blob } = await mintDeviceGrant(op, offer, { nowMs: NOW });
const grant = (await acceptGrant(secrets, clone(blob), { nowMs: NOW + 1000 })).grant;

// ── 1 · granted peer extends local ⇒ fast-forward adopt ──────────────────────────────────────────────
const local1 = makeHome({ backend: arrayBackend(prefixChain), now });
const r1 = await joinFromPeer(local1, extendedChain, { grant, nowMs: NOW + 1000, expectAud: secrets.deviceKappa });
const h1 = await local1.project();
ok("fastForwardAdopts",
  r1.action === "adopt" && r1.adopted === true && h1.ok && h1.files.length === 2 && h1.files.some((f) => f.ref === FB),
  JSON.stringify({ action: r1.action, files: h1.ok && h1.files.length }));

// ── 2 · local already ahead ⇒ behind, keep local ─────────────────────────────────────────────────────
const r2 = await reconcile(extendedChain, prefixChain);
ok("behindKeepsLocal", r2.action === "behind", JSON.stringify(r2));

// ── 3 · forked chains ⇒ diverged, keep both ──────────────────────────────────────────────────────────
const r3 = await reconcile(chainA, chainB);
ok("divergedKeepsBoth", r3.action === "diverged" && r3.forkAt === 2 && (r3.longest === "local" || r3.longest === "peer"), JSON.stringify(r3));

// ── 4 · identical chains ⇒ in-sync ───────────────────────────────────────────────────────────────────
const r4 = await reconcile(extendedChain, clone(extendedChain));
ok("inSyncNoop", r4.action === "in-sync", JSON.stringify(r4));

// ── 5 · tampered peer ⇒ refuse, local untouched ──────────────────────────────────────────────────────
const local5 = makeHome({ backend: arrayBackend(prefixChain), now });
const before5 = await local5.project();
const tampered = clone(extendedChain); tampered[1]["holstr:payload"].name = "evil.md";
const r5 = await joinFromPeer(local5, tampered, { grant, nowMs: NOW + 1000, expectAud: secrets.deviceKappa });
const after5 = await local5.project();
ok("refusesTamperedPeer",
  r5.action === "refuse" && r5.adopted === false && JSON.stringify(after5.files) === JSON.stringify(before5.files),
  JSON.stringify({ action: r5.action, why: r5.why }));

// ── 6 · a peer that WOULD fast-forward but presents a wrong-audience grant ⇒ refused, NOT adopted ────
const local6 = makeHome({ backend: arrayBackend(prefixChain), now });
const r6 = await joinFromPeer(local6, extendedChain, { grant, nowMs: NOW + 1000, expectAud: "did:holo:sha256:" + "9".repeat(64) });
const after6 = await local6.project();
ok("ungrantedRefused",
  r6.action === "refuse" && r6.adopted === false && /ungranted/.test(r6.why) && after6.files.length === 1,
  JSON.stringify({ action: r6.action, why: r6.why, files: after6.files.length }));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-home-reach — ZERO-CONFIG REACH: a new device pairs (a scoped, operator-signed, revocable grant — holo-pair) and reconciles the owner's Home chain into its own, with no box, no origin, no port. Two decisions: the TRUST gate (no valid delegation ⇒ no Home, even for a chain that would fast-forward) and the RECONCILE policy (adopt fast-forward / in-sync / behind keep-local / diverged keep-both / refuse on a chain that doesn't verify), with adopt() being the strand's verify-before-adopt. The transport is injected; this owns when to trust and when to take.",
  authority: "UOR-ADDR · holospaces Laws L1/L5 · UCAN attenuated delegation · rests on #holo-home-reach + #holo-home + #holo-strand + #holo-pair",
  witnessed,
  covers: witnessed ? ["fast-forward-adopt", "behind-keep-local", "diverged-keep-both", "in-sync-noop", "refuse-tampered-peer", "ungranted-refused"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-home-reach-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-home-reach witness — scan a code, your Home follows (no box, no port, verify-before-adopt)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  a granted device pulls your Home and fast-forwards; ungranted or tampered is refused" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
