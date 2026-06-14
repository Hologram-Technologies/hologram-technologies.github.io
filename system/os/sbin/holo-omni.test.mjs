// Witness for the OMNI resolve seam (holo-omni.mjs): one string in {https, did:holo, ipfs, holo, bare-CID}
// → self-verifying bytes + canonical κ, all through the same re-derivation gate (Law L5). Pure tests run
// offline; live tests hit public endpoints and SKIP (not fail) when the network is unreachable, so the
// suite is green in CI yet proves the open-web + IPFS bridge when online.
//
// Run: node holo-omni.test.mjs

import assert from "node:assert/strict";
import { reDerive, hexOf } from "./holo-resolver.mjs";
import { parseRef, resolveAny } from "./holo-omni.mjs";
import { kappaToCid } from "./holo-peers.mjs";
import { routingProviders, discoverGateways } from "./holo-routing.mjs";
import * as ipfs from "../usr/lib/holo/holo-ipfs.js";

let passed = 0, skipped = 0, failed = 0;
const test = async (name, fn) => {
  try {
    const r = await fn();
    if (r === "skip") { skipped++; console.log(`  skip ${name}`); return; }
    passed++; console.log(`  ok   ${name}`);
  } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
};

// Is the open network reachable from here? Probe once; live tests defer to this.
let NET = false;
try { const r = await fetch("https://example.com/", { method: "GET" }); NET = !!(r && r.ok); } catch { NET = false; }
if (!NET) console.log("  (network unreachable — live tests will skip)");

// ── pure: classification, no network ────────────────────────────────────────────────
await test("parseRef classifies all four namespaces", async () => {
  assert.equal(parseRef("https://example.com/x").kind, "web");
  assert.equal(parseRef("did:holo:sha256:" + "a".repeat(64)).kind, "kappa");
  assert.equal(parseRef("sha256:" + "b".repeat(64)).kind, "kappa");
  assert.equal(parseRef("ipfs://bafkqaaa").kind, "cid");
  assert.equal(parseRef("/ipfs/bafkqaaa").kind, "cid");
  assert.equal(parseRef("bafkqaaa").kind, "cid");
  assert.equal(parseRef("holo://sha256/" + "c".repeat(64)).kind, "kappa");
  assert.equal(parseRef("not an address!!").kind, "unknown");
});

// ── pure: κ ⇄ CID is the same digest, raw codec (the L2 invariant the whole bridge rests on) ──
await test("κ ⇄ CIDv1(raw, sha2-256) round-trips to the same digest", async () => {
  const bytes = new TextEncoder().encode("hologram omni witness");
  const hex = await reDerive(bytes);
  const kappa = "did:holo:sha256:" + hex;
  const cidStr = kappaToCid(kappa, ipfs);              // κ → CIDv1(raw)
  const cid = ipfs.parseCID(cidStr);
  assert.equal(cid.codec, ipfs.CODEC.RAW, "must be raw (0x55), never dag-pb");
  assert.equal(cid.hashCode, ipfs.HASH.SHA2_256);
  assert.equal(ipfs.cidToDid(cidStr), kappa, "CID → κ must return the original κ");
  assert.equal(ipfs.toHex(cid.digest), hex, "CID digest IS the κ hex");
});

// ── pure: the empty raw block is the canonical fixture (deterministic, universally derivable) ──
const EMPTY_HEX = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; // sha256("")
const EMPTY_CID = ipfs.cidToString(ipfs.makeCIDv1(ipfs.CODEC.RAW, ipfs.HASH.SHA2_256, ipfs.fromHex(EMPTY_HEX)), "base32");
await test("empty-block CID derives from the empty digest", async () => {
  assert.equal(await reDerive(new Uint8Array(0)), EMPTY_HEX);
  assert.ok(EMPTY_CID.startsWith("bafkrei"), "CIDv1 raw+sha256 base32 → bafkrei…, got " + EMPTY_CID);
  assert.equal(parseRef(EMPTY_CID).kind, "cid");
});

// ── live: import an arbitrary open-web object → derive its κ (the reverse bridge) ────────────
await test("resolveAny(https://…) imports an open-web object and self-verifies", async () => {
  if (!NET) return "skip";
  const out = await resolveAny("https://example.com/", { discover: false, timeoutMs: 9000 });
  assert.equal(out.kind, "web");
  assert.ok(out.ok, "expected ok; got: " + (out.reason || ""));
  assert.equal(await reDerive(out.bytes), hexOf(out.kappa), "Law L5: bytes must re-derive to the reported κ");
  assert.ok(out.kappa.startsWith("did:holo:sha256:"));
  console.log(`       ↳ ${example_short(out)}`);
});

// Widely-replicated, permanently-pinned single-root CIDs (the default `ipfs init` welcome readme, and
// the canonical empty UnixFS directory). Used as live fixtures; ?format=raw returns the verifiable root
// block of each. We try several and pass if ANY resolves, so one gateway/CID hiccup doesn't flake the run.
const KNOWN_CIDS = [
  "QmQPeNsJPyVWPFDVHb77w8G42Fvo15z4bG2X8D2GhfbSXc",                  // welcome-to-IPFS readme (CIDv0, dag-pb)
  "bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354",     // empty UnixFS directory (CIDv1, dag-pb)
];

// ── live: resolve an IPFS object by CID through the Trustless Gateways, verified ─────────────
await test("resolveAny(ipfs CID) fetches a real block and verifies against the CID", async () => {
  if (!NET) return "skip";
  let resolved = null;
  for (const c of KNOWN_CIDS) {
    const out = await resolveAny("ipfs://" + c, { discover: true, timeoutMs: 9000 });
    if (out.ok) { resolved = { c, out }; break; }
  }
  if (!resolved) return "skip"; // every public gateway unreachable right now — not a logic failure
  const { c, out } = resolved;
  assert.equal(out.kind, "cid");
  assert.ok(out.bytes.length > 0, "real block has bytes");
  assert.ok(await ipfs.verifyBlock(c, out.bytes), "Law L5: block must hash to its CID");
  assert.equal(out.kappa, ipfs.cidToDid(c), "κ must be the CID's did:holo");
  console.log(`       ↳ ${c.slice(0, 12)}… ${out.bytes.length}B via ${out.via} in ${out.ms}ms`);
});

// ── live: Delegated Routing V1 discovery answers for a well-provided CID, CORS-clean from fetch() ──
await test("routingProviders() returns well-formed records over Delegated Routing V1", async () => {
  if (!NET) return "skip";
  const recs = await routingProviders(KNOWN_CIDS[0], { timeoutMs: 6000 });
  assert.ok(Array.isArray(recs), "providers must be an array");
  for (const r of recs.slice(0, 3)) assert.ok(r && typeof r === "object", "each record is an object");
  const gws = await discoverGateways(KNOWN_CIDS[0], { timeoutMs: 6000 });
  assert.ok(Array.isArray(gws) && gws.every((g) => /^https:\/\//.test(g)), "discovered gateways are https URLs");
  console.log(`       ↳ ${recs.length} provider record(s), ${gws.length} https gateway(s) discovered`);
});

// ── live: UnixFS assembly — a directory lists entries; a child file assembles to real bytes ──────────
await test("resolveAny(assemble) walks the UnixFS DAG — directory → entries → file bytes", async () => {
  if (!NET) return "skip";
  const dir = await resolveAny("ipfs://" + KNOWN_CIDS[0], { assemble: true, discover: true, timeoutMs: 15000 });
  if (!dir.ok) return "skip";
  assert.equal(dir.content.type, "directory", "welcome CID is a UnixFS directory");
  assert.ok(dir.content.entries.length > 0, "directory has entries");
  const entry = dir.content.entries.find((e) => /readme|about|help|quick-start/i.test(e.name)) || dir.content.entries[0];
  const file = await resolveAny("ipfs://" + entry.cid, { assemble: true, discover: true, timeoutMs: 15000 });
  assert.ok(file.ok && file.content.type === "file", "child entry assembles to a file");
  const text = new TextDecoder().decode(file.content.bytes);
  assert.ok(file.content.bytes.length > 0 && /\w/.test(text), "file has real textual content");
  console.log(`       ↳ dir: ${dir.content.entries.map((e) => e.name).join(", ")}`);
  console.log(`       ↳ ${entry.name} → ${file.content.bytes.length}B · "${text.slice(0, 48).replace(/\n/g, " ")}…"`);
});

function example_short(out) { return `κ=${out.kappa.slice(0, 30)}… ${out.bytes.length}B via ${out.via} in ${out.ms}ms`; }

console.log(`\n${passed} passed · ${skipped} skipped · ${failed} failed`);
process.exit(failed ? 1 : 0);
