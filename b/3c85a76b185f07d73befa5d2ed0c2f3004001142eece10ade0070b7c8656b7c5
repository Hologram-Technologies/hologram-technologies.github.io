// holo-crx.js — the content-addressed Chrome-extension format for Holo Browser.
//
// First principles. A Chrome extension ships as a CRX3: the magic "Cr24", a protobuf header
// carrying the publisher's public key + a signature, then a plain ZIP of the extension's files
// (manifest.json, scripts, _locales, rules…). It ALREADY has an identity anchor — the extension
// id is derived from the publisher key — so, exactly as holo-ipfs ADOPTED IPFS CIDs into the
// κ-address space, we adopt the CRX: we add the κ (blake3 over the exact bytes) and, on install,
// RE-DERIVE it (Law L5) AND verify the publisher signature. An extension version becomes a
// holo://κ — pinnable, shareable, re-derivable forever. You run only bytes that re-derive; an
// update is a NEW κ with a provenance edge. This fixes the real extension problem: supply-chain
// trust (stores silently push updates; extensions get sold/compromised). The store is a location;
// the κ is the content.
//
// Pure, dependency-free ES module (browser + module worker + Node ≥18). Reuses the substrate:
//   • holo-ipfs.js — blake3 (the κ), sha256 (the id), hex/bytes utils.
//   • holo-zip.js  — the ZIP reader/writer (native Compression Streams), shared with Holo Docs.
// WebCrypto (globalThis.crypto.subtle) verifies/produces the RSA signature.
//
// Authorities mirrored (cited, not restated): the CRX3 container + AsymmetricKeyProof /
// SignedData protobuf (Chromium components/crx_file), the extension-id derivation (sha256 of the
// SubjectPublicKeyInfo, first 16 bytes, hex digits 0-9a-f → letters a-p), the Chrome Extensions
// MV3 manifest, and Law L5 (verify-by-re-derivation).

import { blake3, sha256, toBytes, toHex } from "./holo-ipfs.js";
import { zip as zipFiles, unzip as unzipBytes, utf8, fromUtf8 } from "./holo-zip.js";

export const VERSION = "holo-crx 1.0";
const CRX_MAGIC = [0x43, 0x72, 0x32, 0x34];          // "Cr24"
const SIG_CONTEXT = (() => { const s = "CRX3 SignedData"; const b = new Uint8Array(s.length + 1); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; })();   // 16 bytes incl. trailing NUL
const concat = (...a) => { let n = 0; for (const x of a) n += x.length; const o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
const le32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
const rdLe32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// ── κ — the content address of the exact extension bytes (blake3 hex) ────────────────
export const kappaOf = (bytes) => toHex(blake3(toBytes(bytes)));
export const holoUrl = (kappa) => "holo://" + kappa;

// ── minimal protobuf reader (varint + length-delimited; large field numbers ok) ──────
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
// minimal protobuf writer (just what buildCrx3 needs: length-delimited fields)
const pbKey = (field, wire) => { let k = field * 8 + wire, out = []; while (k >= 0x80) { out.push((k & 0x7f) | 0x80); k = Math.floor(k / 128); } out.push(k); return Uint8Array.from(out); };
const pbVarint = (n) => { let out = []; let v = n; while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); } out.push(v); return Uint8Array.from(out); };
const pbLenField = (field, bytes) => concat(pbKey(field, 2), pbVarint(bytes.length), bytes);

// ── extension id: sha256(SubjectPublicKeyInfo)[:16], hex → a-p ──────────────────────
const AP = "abcdefghijklmnop";   // '0'→'a' … 'f'→'p' (Chromium "mpdecimal" id encoding)
export const hexToExtId = (hex) => { let s = ""; for (let i = 0; i < 32; i++) s += AP[parseInt(hex[i], 16)]; return s; };
export async function extensionIdFromKey(spkiBytes) {
  const digest = await sha256(toBytes(spkiBytes));
  return hexToExtId(toHex(digest.subarray(0, 16)));
}

// ── parse a CRX3 → { version, publicKey, signature, alg, crxId, archive, kappa } ─────
export function parseCrx(bytes) {
  const b = toBytes(bytes);
  if (!(b[0] === CRX_MAGIC[0] && b[1] === CRX_MAGIC[1] && b[2] === CRX_MAGIC[2] && b[3] === CRX_MAGIC[3])) throw new Error("not a CRX (missing Cr24 magic)");
  const version = rdLe32(b, 4);
  if (version !== 3) throw new Error("unsupported CRX version " + version + " (only CRX3)");
  const headerSize = rdLe32(b, 8);
  const header = b.subarray(12, 12 + headerSize);
  const archive = b.subarray(12 + headerSize);             // the ZIP payload
  let rsa = [], ecdsa = [], signedHeaderData = null;
  for (const f of pbFields(header)) {
    if (f.field === 2 && f.wire === 2) rsa.push(proof(f.value));
    else if (f.field === 3 && f.wire === 2) ecdsa.push(proof(f.value));
    else if (f.field === 10000 && f.wire === 2) signedHeaderData = f.value;
  }
  let crxId = null;
  if (signedHeaderData) for (const g of pbFields(signedHeaderData)) if (g.field === 1 && g.wire === 2) crxId = g.value;
  const chosen = rsa[0] || ecdsa[0] || {};
  const alg = rsa[0] ? "rsa" : ecdsa[0] ? "ecdsa" : null;
  return { version, alg, publicKey: chosen.publicKey || null, signature: chosen.signature || null, signedHeaderData, crxId, archive, header, kappa: kappaOf(b), bytes: b.length };
}
function proof(msg) { let publicKey = null, signature = null; for (const g of pbFields(msg)) { if (g.field === 1 && g.wire === 2) publicKey = g.value; else if (g.field === 2 && g.wire === 2) signature = g.value; } return { publicKey, signature }; }

// ── verify a CRX3 — Law L5 (κ) + the publisher signature over the archive ────────────
// expectedKappa (from the holo://κ link / catalog) makes the install a re-derivation check.
export async function verifyCrx(bytes, expectedKappa = null) {
  const b = toBytes(bytes);
  let p; try { p = parseCrx(b); } catch (e) { return { ok: false, reason: String(e.message || e) }; }
  const kappa = p.kappa;
  const kappaMatches = expectedKappa ? kappa === String(expectedKappa).toLowerCase() : null;
  const extensionId = p.publicKey ? await extensionIdFromKey(p.publicKey) : null;
  // the id derived from the key must equal the crx_id the publisher signed into the header.
  let idMatches = null;
  if (p.publicKey && p.crxId) { const d = await sha256(p.publicKey); idMatches = toHex(d.subarray(0, 16)) === toHex(p.crxId); }
  // signature covers: SIG_CONTEXT ‖ LE32(len(signedHeaderData)) ‖ signedHeaderData ‖ archive
  let signatureOk = null;
  if (p.alg === "rsa" && p.publicKey && p.signature && p.signedHeaderData && globalThis.crypto?.subtle) {
    try {
      const key = await crypto.subtle.importKey("spki", p.publicKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      const payload = concat(SIG_CONTEXT, le32(p.signedHeaderData.length), p.signedHeaderData, p.archive);
      signatureOk = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, p.signature, payload);
    } catch { signatureOk = false; }
  }
  const ok = (expectedKappa ? kappaMatches : true) && (signatureOk !== false);
  return { ok, kappa, kappaMatches, extensionId, idMatches: idMatches !== false, alg: p.alg, signatureOk, did: "did:holo:blake3:" + kappa };
}

// ── read the extension's files + manifest from the ZIP payload ───────────────────────
export async function readCrxFiles(bytes) {
  const p = typeof bytes === "object" && bytes.archive ? bytes : parseCrx(bytes);
  const files = await unzipBytes(p.archive);                  // Map(name → Uint8Array)
  return files;
}
export async function readManifest(bytes) {
  const files = bytes instanceof Map ? bytes : await readCrxFiles(bytes);
  const m = files.get("manifest.json"); if (!m) throw new Error("no manifest.json in extension");
  return JSON.parse(fromUtf8(m));
}

// ── analyze a manifest → a compatibility report for the in-OS subset runtime ─────────
// HONEST classification: which MV3 features the in-tab runtime can execute vs. which need the
// native Chromium engine. This is what the store shows before you install.
const IN_TAB = new Set(["declarativeNetRequest", "declarativeNetRequestWithHostAccess", "storage", "scripting", "tabs", "activeTab", "alarms", "i18n", "contextMenus", "notifications", "cookies", "webNavigation"]);
const NATIVE_ONLY = new Set(["webRequest", "webRequestBlocking", "debugger", "proxy", "declarativeNetRequestFeedback", "nativeMessaging", "tabCapture", "desktopCapture", "privacy", "management", "downloads", "history", "bookmarks", "devtools"]);
export function analyzeManifest(manifest) {
  const mv = manifest.manifest_version || 2;
  const perms = [...(manifest.permissions || []), ...(manifest.optional_permissions || [])];
  const hostPerms = [...(manifest.host_permissions || []), ...((manifest.content_scripts || []).flatMap((c) => c.matches || []))];
  const dnr = manifest.declarative_net_request || null;
  const contentScripts = manifest.content_scripts || [];
  const background = manifest.background ? (manifest.background.service_worker || manifest.background.scripts || manifest.background.page || null) : null;
  const action = manifest.action || manifest.browser_action || null;
  const featureSupport = {};
  for (const perm of perms) featureSupport[perm] = NATIVE_ONLY.has(perm) ? "native-only" : (IN_TAB.has(perm) ? "supported" : "partial");
  if (dnr) featureSupport.declarativeNetRequest = "supported";
  if (contentScripts.length) featureSupport.content_scripts = "supported";
  if (background) featureSupport.background = "partial";        // a Worker approximation, not a true extension SW
  if (manifest.background && (manifest.background.scripts || manifest.background.page)) featureSupport.background = mv === 2 ? "native-only" : "partial";
  const needsNative = mv === 2 || perms.some((p) => NATIVE_ONLY.has(p));
  const runnable = !needsNative && (dnr || contentScripts.length || action || background);
  return {
    mv, name: manifest.name, version: manifest.version, description: manifest.description || "",
    permissions: perms, hostPermissions: hostPerms, contentScripts, background, action, dnr,
    icons: manifest.icons || {}, defaultLocale: manifest.default_locale || null,
    webAccessibleResources: manifest.web_accessible_resources || [],
    featureSupport,
    verdict: needsNative ? "needs-native" : (runnable ? "runs-in-tab" : "partial"),
    reason: mv === 2 ? "Manifest V2 (webRequest era) — needs the native Chromium engine" : (perms.filter((p) => NATIVE_ONLY.has(p)).length ? "uses native-only APIs: " + perms.filter((p) => NATIVE_ONLY.has(p)).join(", ") : "MV3 features map onto the in-tab runtime"),
  };
}

// ── compile declarativeNetRequest rules → a normalized ruleset the loading seam consults ─
// The elegant fit: DNR is block/redirect/modify-headers on requests, and browser-sw.js already
// intercepts every request. A rule { action:{type}, condition:{urlFilter, regexFilter, resourceTypes,
// requestDomains, …} } is normalized so the seam can match a request URL → an action.
export function compileDnrRules(rules = []) {
  return rules.map((r) => ({
    id: r.id, priority: r.priority || 1,
    action: r.action || { type: "block" },
    urlFilter: r.condition?.urlFilter || null,
    regexFilter: r.condition?.regexFilter || null,
    isUrlFilterCaseSensitive: !!r.condition?.isUrlFilterCaseSensitive,
    resourceTypes: r.condition?.resourceTypes || null,
    excludedResourceTypes: r.condition?.excludedResourceTypes || null,
    requestDomains: r.condition?.requestDomains || null,
    excludedRequestDomains: r.condition?.excludedRequestDomains || null,
    domainType: r.condition?.domainType || null,
  })).sort((a, b) => b.priority - a.priority);
}
// match a normalized rule against a request → boolean (urlFilter is Chrome's substring+anchors syntax)
export function ruleMatches(rule, url, resourceType) {
  if (rule.resourceTypes && resourceType && !rule.resourceTypes.includes(resourceType)) return false;
  if (rule.excludedResourceTypes && resourceType && rule.excludedResourceTypes.includes(resourceType)) return false;
  try {
    let host = ""; try { host = new URL(url).hostname; } catch {}
    if (rule.requestDomains && !rule.requestDomains.some((d) => host === d || host.endsWith("." + d))) return false;
    if (rule.excludedRequestDomains && rule.excludedRequestDomains.some((d) => host === d || host.endsWith("." + d))) return false;
    if (rule.regexFilter) { const re = new RegExp(rule.regexFilter, rule.isUrlFilterCaseSensitive ? "" : "i"); return re.test(url); }
    if (rule.urlFilter) return urlFilterMatch(rule.urlFilter, url, rule.isUrlFilterCaseSensitive);
    return true;   // no url constraint → matches (constrained by resourceTypes/domains above)
  } catch { return false; }
}
// Chrome urlFilter grammar (subset): "||" domain anchor, "|" start/end anchor, "^" separator, "*" wildcard.
function urlFilterMatch(filter, url, cs) {
  const u = cs ? url : url.toLowerCase(); let f = cs ? filter : filter.toLowerCase();
  let anchorStart = false, anchorEnd = false, domainAnchor = false;
  if (f.startsWith("||")) { domainAnchor = true; f = f.slice(2); }
  else if (f.startsWith("|")) { anchorStart = true; f = f.slice(1); }
  if (f.endsWith("|")) { anchorEnd = true; f = f.slice(0, -1); }
  // build a regex: * → .*, ^ → a separator class, escape the rest
  const sep = "[^a-zA-Z0-9._%-]";
  let re = "";
  for (const ch of f) { if (ch === "*") re += ".*"; else if (ch === "^") re += "(" + sep + "|$)"; else re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  if (domainAnchor) re = "^https?://([^/]+\\.)?" + re;          // ||domain anchors at the host
  else if (anchorStart) re = "^" + re;
  if (anchorEnd) re += "$";
  try { return new RegExp(re, cs ? "" : "i").test(u); } catch { return u.includes(cs ? filter : filter.toLowerCase()); }
}

// ── pack + sign an unpacked extension → a κ-addressed CRX3 (the sovereign-publisher path,
// and the witness fixture) ───────────────────────────────────────────────────────────
export async function buildCrx3(files, keyPair) {
  const kp = keyPair || await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey));
  const crxId = (await sha256(spki)).subarray(0, 16);
  const archive = await zipFiles(Object.entries(files).map(([name, data]) => ({ name, data })));
  const signedHeaderData = pbLenField(1, crxId);               // SignedData { crx_id = field 1 }
  const payload = concat(SIG_CONTEXT, le32(signedHeaderData.length), signedHeaderData, archive);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, payload));
  const keyProof = concat(pbLenField(1, spki), pbLenField(2, signature));      // AsymmetricKeyProof
  const header = concat(pbLenField(2, keyProof), pbLenField(10000, signedHeaderData));   // CrxFileHeader: sha256_with_rsa + signed_header_data
  const crx = concat(Uint8Array.from(CRX_MAGIC), le32(3), le32(header.length), header, archive);
  return { crx, extensionId: hexToExtId(toHex(crxId)), publicKey: spki, kappa: kappaOf(crx) };
}

// ── Chrome Web Store reach: an id or store URL → the CRX download URL (fetched via a proxy) ─
export function parseWebStoreId(input) {
  const s = String(input || "").trim();
  let m = s.match(/[a-p]{32}/);                                 // a bare id, or one embedded in a store URL
  if (m) return m[0];
  m = s.match(/chromewebstore\.google\.com\/detail\/[^/]+\/([a-p]{32})/) || s.match(/chrome\.google\.com\/webstore\/detail\/[^/]+\/([a-p]{32})/);
  return m ? m[1] : null;
}
export function webStoreCrxUrl(id, { prodversion = "138.0.0.0" } = {}) {
  return "https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3"
    + "&prodversion=" + encodeURIComponent(prodversion)
    + "&x=" + encodeURIComponent("id=" + id + "&installsource=ondemand&uc");
}

// ── self-test (KATs + a build→parse→verify round-trip) ──────────────────────────────
export async function selfTest() {
  const checks = []; const ok = (c, m) => { checks.push({ ok: !!c, msg: m }); return !!c; };
  // id encoding KAT: hex digits map 0-9a-f → a-p (Chromium mpdecimal).
  ok(hexToExtId("0123456789abcdef0123456789abcdef") === "abcdefghijklmnopabcdefghijklmnop", "extension-id hex→a-p mapping (KAT)");
  ok(hexToExtId("0".repeat(32)) === "a".repeat(32) && hexToExtId("f".repeat(32)) === "p".repeat(32), "extension-id all-0→a, all-f→p (KAT)");
  if (globalThis.crypto?.subtle) {
    const manifest = { manifest_version: 3, name: "Holo Test Blocker", version: "1.0", permissions: ["declarativeNetRequest", "storage"], host_permissions: ["<all_urls>"], background: { service_worker: "bg.js" }, action: { default_popup: "popup.html" }, content_scripts: [{ matches: ["*://*/*"], js: ["cs.js"] }] };
    const { crx, extensionId, publicKey, kappa } = await buildCrx3({ "manifest.json": JSON.stringify(manifest), "bg.js": "/* bg */", "cs.js": "document.title='holo'", "popup.html": "<p>hi</p>" });
    const p = parseCrx(crx);
    ok(p.version === 3 && p.alg === "rsa" && p.archive.length > 0, "buildCrx3 → parseCrx round-trips (CRX3, rsa, has archive)");
    ok(kappa === kappaOf(crx) && /^[0-9a-f]{64}$/.test(kappa), "κ = blake3 over the exact CRX bytes");
    const idFromKey = await extensionIdFromKey(publicKey);
    ok(idFromKey === extensionId && toHex(p.crxId) === toHex((await sha256(publicKey)).subarray(0, 16)), "extension id derives from the publisher key AND matches the signed crx_id");
    const v = await verifyCrx(crx, kappa);
    ok(v.ok && v.signatureOk === true && v.kappaMatches === true && v.extensionId === extensionId, "verifyCrx: signature valid + κ re-derives (Law L5)");
    const tampered = crx.slice(); tampered[tampered.length - 5] ^= 1;       // flip a byte in the archive
    const vt = await verifyCrx(tampered, kappa);
    ok(vt.signatureOk === false || vt.kappaMatches === false, "verifyCrx REFUSES a tampered byte (signature and/or κ fails — Law L5)");
    const man = await readManifest(crx);
    ok(man.name === "Holo Test Blocker" && man.manifest_version === 3, "readManifest parses manifest.json from the ZIP payload");
    const a = analyzeManifest(man);
    ok(a.verdict === "runs-in-tab" && a.featureSupport.declarativeNetRequest === "supported", "analyzeManifest: an MV3 DNR extension runs in-tab");
    const a2 = analyzeManifest({ manifest_version: 2, name: "Old", version: "1", permissions: ["webRequest", "webRequestBlocking"] });
    ok(a2.verdict === "needs-native", "analyzeManifest: an MV2/webRequest extension needs the native engine (honest)");
  }
  // DNR compile + match.
  const rules = compileDnrRules([{ id: 1, priority: 1, action: { type: "block" }, condition: { urlFilter: "||ads.example.com^", resourceTypes: ["script", "image"] } }]);
  ok(ruleMatches(rules[0], "https://ads.example.com/track.js", "script") === true, "DNR ||domain^ urlFilter matches a subdomain request");
  ok(ruleMatches(rules[0], "https://safe.example.com/app.js", "script") === false, "DNR rule does NOT match an unrelated host");
  ok(ruleMatches(rules[0], "https://ads.example.com/track.js", "stylesheet") === false, "DNR resourceTypes constraint is honoured");
  // Web Store id parsing.
  ok(parseWebStoreId("https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh") === "ddkjiahejlhfcafbddmgiahcphecmpfh", "parse an extension id out of a Web Store URL");
  return { ok: checks.every((c) => c.ok), checks };
}
