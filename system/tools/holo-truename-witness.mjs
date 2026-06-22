#!/usr/bin/env node
// holo-truename-witness.mjs — TRUENAMES: every κ becomes human-friendly AND globally
// reachable, without breaking Law L1. Proves the whole spine in pure Node:
//   · proquint codec — bijective, matches the canonical reference vectors
//   · edge-name — self-described slug + κ-derived proquint tail, deterministic
//   · Law L5 on names — a truename re-derives + verifies; it CANNOT lie
//   · κ → IPv6 — CGA/ULA-style, RFC 5952-canonical, round-trips (the WHERE axis)
//   · κ ⇄ CID — identity preserved across the IPv6/IPFS locator view
//   · Law L1 — name/IPv6/CID are labels; the κ stays the sole @id, address() intact
//
// Authority: proquint · RFC 4291/5952/4193/3972/7217/8305 · multiformats · W3C
//   DID Core / schema.org / SKOS · holospaces Law L1/L2/L5.
//   node tools/holo-truename-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as PQ from "../os/usr/lib/holo/holo-proquint.mjs";
import { seal, address } from "../os/usr/lib/holo/holo-object.mjs";
import { truenameOf, slugOf, tailOfKappa, parseTruename, matchesTruename, kappaMatchesPrefix } from "../os/usr/lib/holo/holo-truename.mjs";
import { kappaToIPv6, formatIPv6, parseIPv6, kappaToIPv6Bytes, kappaToCID, cidToKappaDid, kappaToMultiaddr } from "../os/usr/lib/holo/holo-locator.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const hexOf = (k) => String(k).split(":").pop();
const toHex = (u8) => { let s = ""; for (const x of u8) s += x.toString(16).padStart(2, "0"); return s; };

// ── 1 · PROQUINT — the canonical reference vectors (IP address → proquint) ──
const VEC = {
  "127.0.0.1": "lusab-babad", "63.84.220.193": "gutih-tugad", "63.118.7.35": "gutuk-bisog",
  "140.98.193.141": "mudof-sakat", "64.255.6.200": "haguz-biram", "128.30.52.45": "mabiv-gibot",
  "147.67.119.2": "natag-lisaf", "212.58.253.68": "tibup-zujah", "216.35.68.215": "tobog-higil",
  "216.68.232.21": "todah-vobij", "198.81.129.136": "sinid-makam", "12.110.110.204": "budov-kuras",
};
const ipBytes = (ip) => Uint8Array.from(ip.split(".").map(Number));
let vecOk = true;
for (const [ip, q] of Object.entries(VEC)) if (PQ.encode(ipBytes(ip)) !== q || toHex(PQ.decode(q)) !== toHex(ipBytes(ip))) vecOk = false;
ok("proquint-matches-canonical-vectors", vecOk, "lusab-babad et al.");

// ── 2 · PROQUINT — bijective over many widths (deterministic round-trip) ──
let rt = true;
for (let i = 0; i < 1000; i++) {
  const len = 2 * (1 + (i % 8));                       // 2..16 bytes (even)
  const u = new Uint8Array(len);
  for (let j = 0; j < len; j++) u[j] = (i * 131 + j * 197 + 7) & 0xff;   // deterministic, no RNG
  if (toHex(PQ.decode(PQ.encode(u))) !== toHex(u)) { rt = false; break; }
}
ok("proquint-bijective-round-trip", rt && PQ.isProquint("lusab-babad") && !PQ.isProquint("zzz"));

// ── a real κ-object (app-like), sealed to its content identity ──
const amp = seal({
  "@context": "https://schema.org/", "@type": ["schema:SoftwareApplication", "schema:WebApplication"],
  "schema:name": "Holo Amp", "schema:identifier": "org.hologram.HoloAmp",
  "schema:applicationCategory": "Music", "schema:description": "the κ-native music app",
});
const ampHex = hexOf(amp.id);

// ── 3 · EDGE-NAME — self-described + deterministic ──
const tn = truenameOf(amp);
ok("truename-self-described-deterministic",
  tn === truenameOf(amp) && tn.startsWith("holo-amp~") && PQ.isProquint(tn.split("~")[1]),
  tn);

// ── 4 · EDGE-NAME re-derives to the κ (the tail IS the κ prefix) ──
const p = parseTruename(tn);
ok("truename-tail-is-kappa-prefix", !!p && ampHex.startsWith(p.prefixHex) && kappaMatchesPrefix(amp.id, p.prefixHex), p && p.prefixHex);

// ── 5 · LAW L5 — a truename CANNOT lie ──
const impostor = seal({ "@context": "https://schema.org/", "@type": "schema:SoftwareApplication", "schema:name": "Holo Amp" }); // same name, different content → different κ
const tamperedTail = tn.replace(/~(\w+)/, "~babad");                       // wrong κ prefix
const wrongSlug = tn.replace(/^[a-z0-9-]+~/, "evil~");                     // wrong self-description
ok("L5-name-cannot-lie",
  matchesTruename(amp, tn) === true &&
  matchesTruename(amp, tamperedTail) === false &&
  matchesTruename(amp, wrongSlug) === false &&
  matchesTruename(impostor, tn) === false);                               // impostor can't wear Amp's truename

// ── 6 · κ → IPv6 — CGA/ULA-style, deterministic, RFC 5952-canonical, round-trips ──
const v6 = kappaToIPv6(amp.id);
const canonical = formatIPv6(parseIPv6(v6)) === v6;                        // already canonical (idempotent)
const roundtrips = toHex(parseIPv6(v6)) === toHex(kappaToIPv6Bytes(amp.id));
const isULA = v6.toLowerCase().startsWith("fd");
const prefixFromKappa = toHex(kappaToIPv6Bytes(amp.id).subarray(1, 6)) === ampHex.slice(0, 10);  // 40-bit GID = κ[0:5]
ok("kappa-to-ipv6-cga-rfc5952", canonical && roundtrips && isULA && prefixFromKappa && v6 === kappaToIPv6(amp.id), v6);

// ── 7 · κ ⇄ CID — identity preserved across the locator view ──
const cid = kappaToCID(amp.id);
ok("kappa-cid-identity-preserved", cidToKappaDid(cid) === amp.id, cid);

// ── 8 · MULTIADDR — dual-stack-ready, multiformats-native ──
const ma = kappaToMultiaddr(amp.id);
ok("multiaddr-ip6-ipfs-form", /^\/ip6\/[0-9a-f:]+\/tcp\/4001\/ipfs\/.+/.test(ma) && ma.includes(cid), ma);

// ── 9 · LAW L1 — name/IPv6/CID are LABELS; the κ is the only identity ──
ok("L1-kappa-is-sole-identity",
  tn !== amp.id && v6 !== amp.id && cid !== amp.id &&
  address(amp) === amp.id &&                                              // address() unaffected by naming
  amp["@id"] === undefined);                                             // a name never became @id

// ── the user's original opaque κ, made friendly + reachable (illustration) ──
const RAW = "bb5fde48d9dc00c97ba68c42088538d660c2a0509d60210a934eb4a4ab1d0c36";
const rawDid = "did:holo:sha256:" + RAW;
const demo = { tail: tailOfKappa(rawDid), ipv6: kappaToIPv6(rawDid), cid: kappaToCID(rawDid), multiaddr: kappaToMultiaddr(rawDid) };

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "proquint codec — bijective; matches the canonical reference vectors (127.0.0.1 → lusab-babad); the SAME codec encodes a κ-tail and an IPv6 address",
    "edge-name — a self-described slug (re-projected from the object's attributes) + a κ-derived proquint tail; deterministic",
    "the truename tail decodes to the κ's leading bits (the resolver's candidate filter)",
    "LAW L5 — a truename re-derives BOTH slug and κ-prefix and admits only on exact match; a tampered tail, a wrong slug, and an impostor object are all refused — a name cannot lie",
    "κ → IPv6 — CGA/ULA-style (RFC 3972/4193/7217) hash-derived address; RFC 5952-canonical text (≡ Law L2); deterministic; round-trips",
    "κ ⇄ CIDv1 (raw, sha2-256) — identity preserved across the IPv6/IPFS locator view (cidToDid === the κ)",
    "multiaddr — /ip6/<addr>/tcp/4001/ipfs/<CID>, dual-stack-ready, multiformats-native",
    "LAW L1 — truename, IPv6, and CID are labels/locators; the κ stays the sole @id; address() is unaffected",
  ],
  example: { kappa: amp.id, truename: tn, ipv6: v6, cid, multiaddr: ma },
  rawDemo: { kappa: rawDid, ...demo },
  checks, failed: fail,
  authority: "proquint · RFC 4291/5952/4193/3972/7217/8305 · multiformats (multiaddr/CID) · W3C DID Core / schema.org / SKOS · IETF RFC 8785 (JCS) · holospaces Law L1/L2/L5",
};
writeFileSync(join(here, "holo-truename-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Truename witness — human-friendly, IPv6-reachable κ\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  a named object — "Holo Amp"`);
console.log(`    κ          ${amp.id}`);
console.log(`    truename   ${tn}`);
console.log(`    IPv6       ${v6}`);
console.log(`    multiaddr  ${ma}`);
console.log(`\n  the original opaque κ, made friendly + reachable`);
console.log(`    κ          holo://${RAW}`);
console.log(`    tail       ~${demo.tail}`);
console.log(`    IPv6       ${demo.ipv6}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
