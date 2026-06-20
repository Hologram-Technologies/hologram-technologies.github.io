#!/usr/bin/env node
// holo-ipfs-bounds-witness.mjs — PROVE SEC-8 (Product-Security §13.5): "Every allocation driven by
// untrusted input is bounded by actual payload or fixed quota, never by declared count." The IPFS path
// gateway parses CIDs embedded in UNTRUSTED DAG-PB/CAR blocks fetched from public gateways. A CID carries
// a DECLARED multihash length (a varint on the wire). If the parser trusts that length, a hostile block
// can declare an oversized digest and drive the parse offset past the bytes actually present — the caller
// then over-reads the next block. This witness drives the REAL exported parsers (os/usr/lib/holo/holo-ipfs.js)
// and asserts the declared length is bounded by ACTUAL payload: a valid CID parses, and a CID whose declared
// multihash length exceeds the bytes present is REFUSED (not advanced over, not silently short-read).
//
//   node tools/holo-ipfs-bounds-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { OS_LIB } from "./holo-paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ipfs = await import(pathToFileURL(join(OS_LIB, "holo-ipfs.js")));
const { parseCID, parseCIDPrefix, makeCIDv1, varintEncode, concat } = ipfs;

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok, d = "") => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}${d ? "  (" + d + ")" : ""}`); };
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const RAW = 0x55, SHA2_256 = 0x12;
const digest32 = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 1) & 0xff);
const validCid = makeCIDv1(RAW, SHA2_256, digest32).bytes;   // a real CIDv1 (raw · sha2-256)

// ── 1 · no regression: a valid CID parses, bounded length, full digest ──
{
  const p = parseCIDPrefix(validCid, 0);
  rec("valid CID: parseCIDPrefix returns the exact consumed length + full digest", p.length === validCid.length && p.cid.digest.length === 32);
  const c = parseCID(validCid);
  rec("valid CID: parseCID round-trips the 32-byte sha2-256 digest", c.digest.length === 32 && c.hashSize === 32);
  // embedded inside a larger (untrusted) buffer: it must consume ONLY the CID, not the trailing bytes
  const embedded = concat(validCid, Uint8Array.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11]));
  const pe = parseCIDPrefix(embedded, 0);
  rec("valid CID embedded in a larger block: consumes exactly the CID, not the trailing bytes", pe.length === validCid.length);
}

// ── 2 · the SEC-8 property: a DECLARED multihash length that exceeds the bytes present is REFUSED ──
// craft: varint(version=1) ‖ varint(codec=raw) ‖ varint(hashCode=sha2-256) ‖ varint(hashSize=HUGE) ‖ few bytes
const DECLARED = 100000, PRESENT = 8;
const hostile = concat(varintEncode(1), varintEncode(RAW), varintEncode(SHA2_256), varintEncode(DECLARED), new Uint8Array(PRESENT));
rec("non-vacuous: the hostile CID DECLARES far more digest than is present", DECLARED > PRESENT && hostile.length < DECLARED);

const ePrefix = throws(() => parseCIDPrefix(hostile, 0));
rec("parseCIDPrefix REFUSES a declared length past the payload (bounded by actual bytes, never declared count)", !!ePrefix && /truncat/i.test(ePrefix.message));
rec("the refusal is EXPLICIT — it states declared vs present (never a silent over-advance)", !!ePrefix && /\d+ bytes/.test(ePrefix.message) && new RegExp(String(DECLARED)).test(ePrefix.message));

const eCid = throws(() => parseCID(hostile));
rec("parseCID REFUSES the same hostile length (the two CID parsers agree — no asymmetric trust)", !!eCid && /truncat/i.test(eCid.message));

// ── 3 · boundary: declared length == bytes present is accepted; declared length == present+1 is refused ──
{
  const exact = concat(varintEncode(1), varintEncode(RAW), varintEncode(SHA2_256), varintEncode(32), digest32);
  rec("boundary: declared length == actual digest length is accepted", parseCIDPrefix(exact, 0).cid.digest.length === 32);
  const over = concat(varintEncode(1), varintEncode(RAW), varintEncode(SHA2_256), varintEncode(33), digest32);   // declares 33, only 32 present
  rec("boundary: declared length one byte past the payload is refused (off-by-one is caught)", !!throws(() => parseCIDPrefix(over, 0)));
}

const witnessed = failed === 0;
writeFileSync(join(here, "holo-ipfs-bounds-witness.result.json"), JSON.stringify({
  spec: "SEC-8 — the IPFS CID parsers (os/usr/lib/holo/holo-ipfs.js) bound a DECLARED multihash length by the ACTUAL payload present, never by the declared count: a valid CID parses and consumes exactly its bytes, while a CID whose declared multihash length exceeds the bytes present is explicitly refused (so a hostile DAG-PB/CAR block cannot drive the parse offset past the payload and make the caller over-read).",
  authority: "holospaces docs/13-Product-Security §13.5 SEC-8 (every allocation driven by untrusted input is bounded by actual payload or fixed quota, never by declared count) · IPFS Trustless Gateway / dag-pb / CAR · multiformats CID — parsers os/usr/lib/holo/holo-ipfs.js (parseCID, parseCIDPrefix)",
  witnessed,
  covers: ["sec-8", "declared-length-bounded-by-payload", "no-over-read", "cid-parser-symmetry"],
  note: "Proven against the real exported parsers (no reimplementation). parseCIDPrefix previously trusted the declared multihash length (computed end = off + declared, no payload check) while parseCID guarded it — this witness pins both to the actual-payload bound.",
  checks, passed, failed,
}, null, 2) + "\n");

console.log(`\nholo-ipfs-bounds-witness: ${passed} passed, ${failed} failed  (SEC-8 witnessed=${witnessed})`);
process.exit(witnessed ? 0 : 1);
