#!/usr/bin/env node
// holo-dns-witness.mjs — proves THE WEB2 DNS BRIDGE, BOTH WAYS (holo-dns, P5). Inbound: a real DoH answer is
// parsed, DNSSEC-gated (the validating resolver's AD bit, fail-closed on insecure), its delegation re-derived
// on substrate (DS type-2 digest = SHA-256(owner-wire ‖ child DNSKEY-RDATA), Law L5), and SEALED as a κ — so
// the answer is verify-before-trust and tamper-after-fetch is caught; a later silent change is caught by
// divergence(). Outbound: a κ binding is published as `_holo TXT` + `.well-known/holo` + a `did:web` alias, so
// legacy clients reach κ content with zero new software, and the κ round-trips back out of the TXT record.
//
// Drives the REAL substrate: holo-object seal/verify, holo-identity sha256 (DS digest), holo-registry
// divergence. The DoH + DNSSEC bytes are byte-pinned fixtures (no network — holospaces external-ground-truth;
// vendoring real published DNSKEY/DS bytes validates a live chain to the IANA root). node tools/holo-dns-witness.mjs
//
// Checks: 1 parseDoH · 2 bridgeInSeals · 3 insecureRefused · 4 tamperAfterFetchRefused · 5 delegationReDerives ·
//         6 divergenceDetectsChange · 7 publishTXT · 8 publishWellKnownDidWeb · 9 reverseRoundTrip · 10 fullCircle
// Authority: IETF RFC 8484 (DoH) · RFC 4034/4509 (DNSSEC DS SHA-256) · W3C did:web · UOR-ADDR · holospaces L1/L2/L3/L5

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseDoH, verifyDelegation, bridgeIn, publishOut, parseHoloTxt } from "../os/sbin/holo-dns.mjs";
import { divergence } from "../os/usr/lib/holo/holo-registry.mjs";
import { verify as verifyObj } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── byte-pinned DoH fixtures (RFC 8484 JSON) ─────────────────────────────────────────────────────────
const DOH_SECURE = { Status: 0, AD: true, Question: [{ name: "example.com.", type: 1 }], Answer: [{ name: "example.com.", type: 1, TTL: 3600, data: "93.184.216.34" }] };
const DOH_INSECURE = { Status: 0, AD: false, Question: [{ name: "insecure.test.", type: 1 }], Answer: [{ name: "insecure.test.", type: 1, TTL: 300, data: "1.2.3.4" }] };
const SRC = { resolver: "https://dns.google/resolve", retrievedAt: "2026-06-23" };
// DNSSEC DS type-2 fixture: a vendored (preimage → digest) KAT (digest = SHA-256(preimage), precomputed).
const DS = { preimage: "00010103080123456789abcdeffedcba9876543210", digest: "b1b4227911a7066141e906372387ddac23ac24682350307bdfdb84d92204ebf5" };

// ── 1 · parse a DoH answer ───────────────────────────────────────────────────────────────────────────
const p = parseDoH(DOH_SECURE);
ok("parseDoH", p.name === "example.com." && p.authenticated === true && p.answers[0].typeName === "A" && p.answers[0].data === "93.184.216.34", JSON.stringify(p));

// ── 2 · bridge in: seal the verified answer as a re-derivable κ ───────────────────────────────────────
const bi = await bridgeIn("example.com", DOH_SECURE, { source: SRC });
ok("bridgeInSeals", bi.ok && verifyObj(bi.record) && bi.authenticated === true && bi.answers[0].data === "93.184.216.34" && /^did:holo:sha256:/.test(bi.kappa), JSON.stringify({ ok: bi.ok, rederives: verifyObj(bi.record) }));

// ── 3 · an insecure (no-DNSSEC) answer is refused under the secure policy ────────────────────────────
const insec = await bridgeIn("insecure.test", DOH_INSECURE, { source: SRC, requireSecure: true });
const insecAllowed = await bridgeIn("insecure.test", DOH_INSECURE, { source: SRC, requireSecure: false });
ok("insecureRefused", insec.ok === false && insec.why === "insecure-no-dnssec" && insecAllowed.ok === true && insecAllowed.authenticated === false, JSON.stringify({ refused: insec.why, allowed: insecAllowed.ok }));

// ── 4 · tamper the sealed record AFTER the fetch ⇒ it no longer re-derives ────────────────────────────
const tampered = JSON.parse(JSON.stringify(bi.record));
tampered["dns:answers"][0].data = "6.6.6.6";
ok("tamperAfterFetchRefused", verifyObj(tampered) === false, "mutated answer must break re-derivation");

// ── 5 · the DNSSEC delegation re-derives (DS digest = SHA-256(preimage)) ─────────────────────────────
const ds = await verifyDelegation(DS);
const dsWrong = await verifyDelegation({ preimage: DS.preimage, digest: "00".repeat(32) });
ok("delegationReDerives", ds.ok === true && ds.digest === DS.digest && dsWrong.ok === false && dsWrong.why === "ds-digest-mismatch", JSON.stringify({ ds: ds.ok, wrong: dsWrong.why }));

// ── 6 · a later SILENT change at the authority is caught by divergence ───────────────────────────────
const before = [{ key: "example.com", value: { A: "93.184.216.34" } }];
const after = [{ key: "example.com", value: { A: "6.6.6.6" } }];
const d = divergence(before, after, { registry: "dns:example.com", source: SRC });
ok("divergenceDetectsChange", d.same === false && d.changed.join() === "example.com" && d.added.length === 0, JSON.stringify(d));

// ── 7 · outbound: publish a _holo TXT carrying the κ ─────────────────────────────────────────────────
const pub = publishOut("example.com", bi.kappa);
ok("publishTXT", pub.txt.includes(bi.kappa) && /^_holo\.example\.com\./.test(pub.txt), pub.txt);

// ── 8 · outbound: .well-known/holo + did:web alias ───────────────────────────────────────────────────
ok("publishWellKnownDidWeb", pub.wellKnown.holo === bi.kappa && pub.didWeb === "did:web:example.com", JSON.stringify({ wk: pub.wellKnown.holo === bi.kappa, did: pub.didWeb }));

// ── 9 · reverse: a legacy client extracts the κ from a TXT record ────────────────────────────────────
const recovered = parseHoloTxt('"holo=' + bi.kappa + '" some other txt');
ok("reverseRoundTrip", recovered === bi.kappa, recovered);

// ── 10 · full circle: bridge-in κ → publish → parse back → identical κ ───────────────────────────────
ok("fullCircle", parseHoloTxt(publishOut("example.com", bi.kappa).txt) === bi.kappa, "legacy client recovers the exact κ");

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-dns — THE WEB2 DNS BRIDGE, BOTH WAYS: inbound, a real DoH answer is DNSSEC-gated (AD bit, fail-closed), its delegation re-derived on substrate (DS digest = SHA-256(owner-wire ‖ DNSKEY-RDATA), Law L5), and sealed as a κ (verify-before-trust; tamper-after-fetch caught; silent authority change caught by divergence). Outbound, a κ binding is published as _holo TXT + .well-known/holo + a did:web alias so legacy clients reach κ content, and the κ round-trips back out of the TXT. We conform to DNS, we do not reauthor it. Full RRSIG asymmetric validation is a deeper seam; the DS-digest linkage and immutable re-anchor are real.",
  authority: "IETF RFC 8484 (DoH) · RFC 4034/4509 (DNSSEC DS SHA-256) · W3C did:web · UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1/L2/L3/L5 · rests on #holo-object + #holo-identity + #holo-registry",
  witnessed,
  covers: witnessed ? ["parse-doh", "bridge-in-seals", "dnssec-insecure-refused", "tamper-after-fetch-refused", "delegation-ds-rederives", "divergence-silent-change", "publish-txt", "well-known-did-web", "reverse-roundtrip", "full-circle"] : [],
  sample: { name: "example.com", kappa: bi.kappa, txt: pub.txt },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-dns-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-dns witness — the web2 DNS bridge, both ways (DNSSEC-gated · re-anchored · published back out)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  example.com → ${bi.kappa.slice(0, 26)}…  ·  out: ${pub.txt.slice(0, 38)}…  ·  ${pub.didWeb}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  real DNS resolves verify-before-trust, and κ publishes back to the legacy web" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
