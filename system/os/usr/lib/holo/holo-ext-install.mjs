// holo-ext-install.mjs — the in-browser install FRONT DOOR for Holo Browser.
//
// First principles. holo-crx.js gives the κ-addressed CRX FORMAT (parse/verify/analyze); holo-ext.js
// runs the in-tab MV3 SUBSET; browser-sw.js enforces it. What was MISSING is the front door: the one
// gesture a user makes — land on a Chrome Web Store page, click "Add" — turned into a verified
// holo://κ extension with zero ceremony. This module is that seam, and nothing else. It abstracts the
// complexity (id detection → CRX fetch → re-derivation → publisher binding → verdict) behind two calls.
//
// Two correctness fixes over the raw holo-crx path, both rooted in the same law (κ = identity):
//   1) IDENTITY FROM THE SIGNED crx_id. A Web-Store-served CRX3 carries MULTIPLE AsymmetricKeyProofs
//      (the publisher's AND Google's). holo-crx.parseCrx takes rsa[0], which may be Google's key, so
//      the derived extension id is wrong. The extension id IS hexToExtId(crx_id) — the id the publisher
//      SIGNED into signed_header_data. We derive identity from there, then REQUIRE a key-proof whose
//      SubjectPublicKeyInfo hashes to that crx_id and whose signature verifies (true publisher binding).
//   2) HONEST ROUTING. analyzeManifest already labels native-only APIs. The front door uses that to
//      route: a "runs-in-tab" extension installs straight into the in-tab ExtensionManager + seam; a
//      "needs-native" one (debugger/webRequest/nativeMessaging — e.g. Claude) is admitted as a κ-object
//      but flagged for the native Chromium engine, never silently half-run.
//
// Pure, dependency-free ES module (browser + worker + Node ≥18). Reuses the substrate — never forks it:
//   • holo-crx.js — parseWebStoreId, webStoreCrxUrl, readManifest, analyzeManifest, hexToExtId, kappaOf.
//   • holo-ext.js — ExtensionManager (the in-tab registry + seam projection).
//   • holo-ipfs.js — sha256/toHex/toBytes (κ utils).
// WebCrypto (crypto.subtle) verifies the publisher RSA signature. Authorities mirrored (cited, not
// restated): Chromium components/crx_file (CrxFileHeader / AsymmetricKeyProof / SignedData, crx_id),
// the extension-id derivation, and Law L5 (verify-by-re-derivation).

import { parseWebStoreId, webStoreCrxUrl, readManifest, analyzeManifest, hexToExtId, kappaOf } from "./holo-crx.js";
import { ExtensionManager } from "./holo-ext.js";
import { sha256, toBytes, toHex } from "./holo-ipfs.js";

export const VERSION = "holo-ext-install 1.0";
const CRX_MAGIC = [0x43, 0x72, 0x32, 0x34];          // "Cr24"
const SIG_CONTEXT = (() => { const s = "CRX3 SignedData"; const b = new Uint8Array(s.length + 1); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; })();
const concat = (...a) => { let n = 0; for (const x of a) n += x.length; const o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const le32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
const rdLe32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// minimal protobuf field walk (varint + length-delimited; large field numbers ok) — same grammar as holo-crx.
function* pbFields(buf, start = 0, end = buf.length) {
  let off = start;
  while (off < end) {
    let key = 0, shift = 0, b;
    do { b = buf[off++]; key += (b & 0x7f) * Math.pow(2, shift); shift += 7; } while (b & 0x80);
    const field = Math.floor(key / 8), wire = key & 7;
    if (wire === 0) { let v = 0, s = 0, c; do { c = buf[off++]; v += (c & 0x7f) * Math.pow(2, s); s += 7; } while (c & 0x80); yield { field, wire, value: v }; }
    else if (wire === 2) { let len = 0, s = 0, c; do { c = buf[off++]; len += (c & 0x7f) * Math.pow(2, s); s += 7; } while (c & 0x80); yield { field, wire, value: buf.subarray(off, off + len) }; off += len; }
    else if (wire === 5) { yield { field, wire, value: buf.subarray(off, off + 4) }; off += 4; }
    else if (wire === 1) { yield { field, wire, value: buf.subarray(off, off + 8) }; off += 8; }
    else throw new Error("crx: bad protobuf wire " + wire);
  }
}
function proof(msg) { let publicKey = null, signature = null; for (const g of pbFields(msg)) { if (g.field === 1 && g.wire === 2) publicKey = g.value; else if (g.field === 2 && g.wire === 2) signature = g.value; } return { publicKey, signature }; }

// ── parse ALL key-proofs (not just rsa[0]) + the signed crx_id ────────────────────────
export function parseCrxProofs(bytes) {
  const b = toBytes(bytes);
  if (!(b[0] === CRX_MAGIC[0] && b[1] === CRX_MAGIC[1] && b[2] === CRX_MAGIC[2] && b[3] === CRX_MAGIC[3])) throw new Error("not a CRX (missing Cr24 magic)");
  if (rdLe32(b, 4) !== 3) throw new Error("unsupported CRX version (only CRX3)");
  const headerSize = rdLe32(b, 8);
  const header = b.subarray(12, 12 + headerSize);
  const archive = b.subarray(12 + headerSize);
  const rsa = [], ecdsa = []; let signedHeaderData = null;
  for (const f of pbFields(header)) {
    if (f.field === 2 && f.wire === 2) rsa.push({ alg: "rsa", ...proof(f.value) });
    else if (f.field === 3 && f.wire === 2) ecdsa.push({ alg: "ecdsa", ...proof(f.value) });
    else if (f.field === 10000 && f.wire === 2) signedHeaderData = f.value;
  }
  let crxId = null;
  if (signedHeaderData) for (const g of pbFields(signedHeaderData)) if (g.field === 1 && g.wire === 2) crxId = g.value;
  return { proofs: [...rsa, ...ecdsa], rsa, ecdsa, signedHeaderData, crxId, archive, kappa: kappaOf(b) };
}

// ── pick the PUBLISHER proof: the key whose sha256(spki)[:16] == the signed crx_id ────
export async function selectPublisherProof(proofs, crxId) {
  if (!crxId) return null;
  const want = toHex(crxId);
  for (const p of proofs) {
    if (!p.publicKey) continue;
    const id16 = toHex((await sha256(p.publicKey)).subarray(0, 16));
    if (id16 === want) return p;
  }
  return null;
}

// ── verifyStrict — κ re-derivation (L5) + TRUE publisher binding via crx_id ───────────
// Returns the AUTHORITATIVE extension id (from crx_id, the id the publisher signed), the κ, and whether
// a matching publisher key-proof's signature verifies. expectedKappa makes install a re-derivation check.
export async function verifyStrict(bytes, expectedKappa = null) {
  const b = toBytes(bytes);
  let info; try { info = parseCrxProofs(b); } catch (e) { return { ok: false, reason: String(e.message || e) }; }
  const kappa = info.kappa;
  const kappaMatches = expectedKappa ? kappa === String(expectedKappa).toLowerCase() : null;
  const extensionId = info.crxId ? hexToExtId(toHex(info.crxId)) : null;   // identity = the SIGNED crx_id
  const pub = await selectPublisherProof(info.proofs, info.crxId);
  let signatureOk = null, publisherBound = false;
  if (pub && pub.alg === "rsa" && pub.publicKey && pub.signature && info.signedHeaderData && globalThis.crypto?.subtle) {
    try {
      const key = await crypto.subtle.importKey("spki", pub.publicKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      const payload = concat(SIG_CONTEXT, le32(info.signedHeaderData.length), info.signedHeaderData, info.archive);
      signatureOk = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, pub.signature, payload);
      publisherBound = signatureOk === true;     // a key that BOTH hashes to crx_id AND signed the body
    } catch { signatureOk = false; }
  }
  const ok = (expectedKappa ? kappaMatches : true) && publisherBound;
  return { ok, kappa, kappaMatches, extensionId, signatureOk, publisherBound, proofCount: info.proofs.length, did: "did:holo:blake3:" + kappa };
}

// ── detect — is this URL a Chrome Web Store detail page we can install from? ──────────
export function detectWebStore(url) {
  const id = parseWebStoreId(url);
  return id ? { isWebStore: true, extensionId: id, url: String(url) } : { isWebStore: false };
}

// ── the FRONT DOOR — a CWS url → a verified, classified κ-object, optionally installed ─
// One call. fetchImpl is injectable (governed egress / proxy in the OS; global fetch in Node). When the
// extension "runs-in-tab" and a manager is supplied, it is installed + the seam bundle is returned ready
// to post to browser-sw.js. When it "needs-native", it is admitted as a κ-object and flagged for the
// native Chromium engine — never silently half-run (Claude lands here: debugger + nativeMessaging).
export async function installFromWebStore(input, { manager = null, fetchImpl, prodversion = "131.0.0.0", expectedKappa = null } = {}) {
  const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) throw new Error("no fetch available (supply fetchImpl)");
  const id = parseWebStoreId(input);
  if (!id) throw new Error("not a Chrome Web Store extension URL/id: " + input);

  const dl = webStoreCrxUrl(id, { prodversion });
  const resp = await f(dl, { redirect: "follow" });
  if (!resp.ok) throw new Error("CRX download failed: HTTP " + resp.status);
  const bytes = new Uint8Array(await resp.arrayBuffer());

  const v = await verifyStrict(bytes, expectedKappa);
  if (!v.ok) throw new Error("install refused (Law L5): " + (v.reason || (v.kappaMatches === false ? "κ re-derivation failed" : !v.publisherBound ? "no publisher key-proof binds the signed crx_id" : "verification failed")));

  const manifest = await readManifest(bytes);
  const analysis = analyzeManifest(manifest);
  const runnable = analysis.verdict === "runs-in-tab";

  let seamBundle = null, installed = false;
  if (runnable && manager) {
    // hand the verified bytes to the in-tab registry; correct its id to the authoritative crx_id id.
    const rec = await manager.install(bytes, { expectedKappa: v.kappa, source: "webstore:" + id });
    if (v.extensionId && rec.id !== v.extensionId) { manager.remove(rec.id); rec.id = v.extensionId; manager.exts.set(rec.id, rec); }
    installed = true;
    seamBundle = manager.seamBundle();
  }

  return {
    ok: true, requestedId: id, extensionId: v.extensionId, kappa: v.kappa, did: v.did, holoUrl: "holo://" + v.kappa,
    name: analysis.name, version: analysis.version, verdict: analysis.verdict, reason: analysis.reason,
    runnable, needsNative: analysis.verdict === "needs-native", featureSupport: analysis.featureSupport,
    publisherBound: v.publisherBound, signatureOk: v.signatureOk, proofCount: v.proofCount,
    installed, seamBundle, downloadUrl: dl,
  };
}

// ── selfTest — KATs proving the two fixes + the round-trip, no network ─────────────────
export async function selfTest() {
  const checks = []; const ok = (c, m) => { checks.push({ ok: !!c, msg: m }); return !!c; };

  // detect: a real CWS url → the right id; a non-store url → not a store.
  const d = detectWebStore("https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn");
  ok(d.isWebStore && d.extensionId === "fcoeoabgfenejglbffodgkkbkcdhcgfn", "detectWebStore: Claude CWS url → fcoe… id");
  ok(detectWebStore("https://example.com/").isWebStore === false, "detectWebStore: a non-store url is not installable");

  if (globalThis.crypto?.subtle) {
    const { buildCrx3 } = await import("./holo-crx.js");
    // build a real single-proof CRX (publisher = us).
    const manifest = { manifest_version: 3, name: "Holo Test Ext", version: "2.0", permissions: ["declarativeNetRequest", "storage"], host_permissions: ["<all_urls>"], action: { default_title: "x" } };
    const { crx, kappa, extensionId, publicKey } = await buildCrx3({ "manifest.json": JSON.stringify(manifest) });

    // verifyStrict derives identity from crx_id and binds the publisher proof.
    const v = await verifyStrict(crx, kappa);
    ok(v.ok && v.publisherBound && v.signatureOk === true, "verifyStrict: κ re-derives + publisher proof binds the signed crx_id (Law L5)");
    ok(v.extensionId === extensionId, "verifyStrict: extension id derives from the SIGNED crx_id (matches the publisher key)");

    // FIX #1 — multi-proof: prepend a DECOY rsa proof; identity must still be the publisher's (crx_id), not the decoy.
    const info = parseCrxProofs(crx);
    const decoyKp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
    const decoySpki = new Uint8Array(await crypto.subtle.exportKey("spki", decoyKp.publicKey));
    const decoyId = toHex((await sha256(decoySpki)).subarray(0, 16));
    const realId = toHex(info.crxId);
    ok(decoyId !== realId, "test setup: the decoy key derives a DIFFERENT id than the publisher");
    const picked = await selectPublisherProof([{ alg: "rsa", publicKey: decoySpki, signature: new Uint8Array(8) }, info.rsa[0]], info.crxId);
    ok(picked && toHex((await sha256(picked.publicKey)).subarray(0, 16)) === realId, "selectPublisherProof: picks the proof matching crx_id, ignoring a decoy (FIX for CWS multi-proof CRXs)");

    // round-trip install into the in-tab manager for a runnable extension.
    const mgr = new ExtensionManager();
    let installed = false;
    try {
      const rec = await mgr.install(crx, { expectedKappa: kappa });
      installed = rec.kappa === kappa;
    } catch { installed = false; }
    ok(installed, "ExtensionManager.install accepts the verified κ-object (runs-in-tab path)");

    // tamper → verifyStrict must REFUSE.
    const tampered = crx.slice(); tampered[tampered.length - 5] ^= 1;
    const vt = await verifyStrict(tampered, kappa);
    ok(vt.ok === false, "verifyStrict REFUSES a tampered CRX (κ and/or publisher binding fails — Law L5)");
  }
  return { ok: checks.every((c) => c.ok), checks };
}
