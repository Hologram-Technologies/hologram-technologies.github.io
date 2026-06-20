// holo-privacy.js — Holo Privacy in the browser: machine-readable control over what an AI agent may
// learn about you, across Hologram OS. The agent-facing companion to Holo Terms.
//
// Drop-in:  <script src="_shared/holo-privacy.js"></script>   (exposes window.HoloPrivacy)
//
// Encoded entirely in established W3C privacy vocabulary (no new terms):
//   • you are the W3C VC HOLDER / DPV data subject — REUSING the Holo Terms first-party did:key, so
//     it is one identity across both frameworks;
//   • a DELEGATE agent acts for you but never holds your data — it only receives minimal disclosures;
//   • gate(request) returns a W3C Verifiable Presentation that discloses ONLY the claims your standing
//     disclosure policy authorizes for the stated purpose (IETF SD-JWT salted-digest selective
//     disclosure), opening a consent dialog for anything beyond it — else nothing leaves (default-deny);
//   • a per-frame badge shows, in plain words, how much an agent was shown ("1 of 4 details").
// Every presentation/consent is a content-addressed object, re-derived + proof-verified before honored
// (Law L5). The policy roster is fetched from privacy/policies.json and re-derived — the SAME data
// holo-privacy.mjs seals, so node and browser never drift. Vanilla JS + crypto.subtle, no deps.

(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  if (W.HoloPrivacy) return;
  const isBrowser = typeof document !== "undefined" && typeof location !== "undefined";

  // ── resolve our own location → roster + control-center live relative to it (any page depth) ──
  const SELF = (document.currentScript && document.currentScript.src) || new URL("_shared/holo-privacy.js", location.href).href;
  const POLICIES_URL = new URL("../privacy/policies.json", SELF).href;
  const APP_URL = new URL("../holospace.html?app=org.hologram.HoloPrivacy", SELF).href;

  // ── primitives — IDENTICAL canonicalization + addressing to holo-object/holo-vc (so it re-derives) ──
  const enc = new TextEncoder();
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  const subtle = (W.crypto || crypto).subtle;
  async function sha256(bytes) { return new Uint8Array(await subtle.digest("SHA-256", bytes)); }
  const sha256hex = async (s) => hex(await sha256(enc.encode(s)));
  const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
    : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
    : JSON.stringify(v);
  const A58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58enc(buf) { const d = [0]; for (const byte of buf) { let c = byte; for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } } let s = ""; for (const byte of buf) { if (byte === 0) s += "1"; else break; } for (let i = d.length - 1; i >= 0; i--) s += A58[d[i]]; return s; }
  function b58dec(str) { const b = [0]; for (const ch of str) { let c = A58.indexOf(ch); if (c < 0) throw new Error("bad base58"); for (let i = 0; i < b.length; i++) { c += b[i] * 58; b[i] = c & 0xff; c >>= 8; } while (c) { b.push(c & 0xff); c >>= 8; } } let z = 0; for (const ch of str) { if (ch === "1") z++; else break; } const out = new Uint8Array(z + b.length); for (let i = 0; i < b.length; i++) out[z + i] = b[b.length - 1 - i]; return out; }

  async function address(obj) { const { id, ...content } = obj; return "did:holo:sha256:" + await sha256hex(jcs(content)); }
  async function selfVerifies(obj) { return obj && obj.id === await address(obj); }

  // ── Ed25519 (eddsa-jcs-2022) signer/verifier via WebCrypto — matches holo-vc.mjs byte-for-byte ──
  const ALG = { name: "Ed25519" };
  const concat = (prefix, tail) => { const a = new Uint8Array(prefix.length + tail.length); a.set(prefix, 0); a.set(tail, prefix.length); return a; };
  const didKeyFromPub = (raw32) => "did:key:z" + b58enc(concat([0xed, 0x01], raw32));
  function pubFromDidKey(vm) { const mb = vm.split("#")[0].slice("did:key:".length); if (mb[0] !== "z") throw new Error("did:key must be base58btc"); const dec = b58dec(mb.slice(1)); if (dec[0] !== 0xed || dec[1] !== 0x01) throw new Error("not Ed25519"); return dec.subarray(2); }
  const proofConfig = (doc, vm, created, purpose) => ({ "@context": doc["@context"], type: "DataIntegrityProof", cryptosuite: "eddsa-jcs-2022", created, verificationMethod: vm, proofPurpose: purpose });
  async function hashData(doc, cfg) { return concat([], concat(await sha256(enc.encode(jcs(cfg))), await sha256(enc.encode(jcs(doc))))); }
  async function signDoc(signer, doc, created) {
    const cfg = proofConfig(doc, signer.vm, created || new Date().toISOString(), "assertionMethod");
    const sig = new Uint8Array(await subtle.sign(ALG, signer.privateKey, await hashData(doc, cfg)));
    const { ["@context"]: _c, ...rest } = cfg;
    return { ...rest, proofValue: "z" + b58enc(sig) };
  }
  async function verifyProof(secured) {
    try {
      const { proof } = secured; if (!proof || typeof proof.proofValue !== "string" || proof.proofValue[0] !== "z") return false;
      const { id, proof: _p, ...doc } = secured; const { proofValue, ...rest } = proof;
      const cfg = { "@context": doc["@context"], ...rest };
      const pub = await subtle.importKey("raw", pubFromDidKey(proof.verificationMethod), ALG, true, ["verify"]);
      return subtle.verify(ALG, pub, b58dec(proofValue.slice(1)), await hashData(doc, cfg));
    } catch { return false; }
  }

  const b64e = (u8) => btoa(String.fromCharCode(...u8));
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  // A signing key is a NON-EXTRACTABLE Ed25519 key kept in IndexedDB (F8): it can be USED to sign but
  // its private bytes can never be exported — so even a same-origin attacker cannot exfiltrate your key
  // (only use it while resident, which the passphrase + closures further constrain). WebCrypto keeps a
  // generated PUBLIC key extractable, so we still derive the did:key.
  async function loadOrMintKey(keyId) {
    let rec = null; try { rec = await idbGet("key:" + keyId); } catch {}
    let privateKey, pubRaw;
    if (rec && rec.privateKey && rec.pubRaw) { privateKey = rec.privateKey; pubRaw = new Uint8Array(rec.pubRaw); }
    else {
      const kp = await subtle.generateKey(ALG, false, ["sign", "verify"]);    // private NON-EXTRACTABLE
      privateKey = kp.privateKey; pubRaw = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
      try { await idbPut("key:" + keyId, { privateKey, pubRaw }); } catch {}
    }
    const did = didKeyFromPub(pubRaw); return { did, vm: did + "#" + did.slice("did:key:".length), privateKey };
  }
  // the HOLDER / data subject signs disclosures; the DELEGATE is the agent's acting identity. Both are
  // non-extractable, Holo-Privacy-owned keys (decoupled from the extractable Holo Terms key, by design).
  let _holder = null, _delegate = null;
  async function holder() { return _holder || (_holder = await loadOrMintKey("holder")); }
  async function delegate() { return _delegate || (_delegate = await loadOrMintKey("delegate")); }

  // the W3C vocabularies we speak (same prefixes + @context as holo-privacy.mjs, so objects re-derive).
  const NS = { dpv: "https://w3id.org/dpv#", "dpv-pd": "https://w3id.org/dpv/pd#", odrl: "http://www.w3.org/ns/odrl/2/", hos: "https://hologram.os/ns/privacy#" };
  const VP_CTX = ["https://www.w3.org/ns/credentials/v2", "https://w3id.org/security/data-integrity/v2", NS];

  // ── the disclosure-policy roster: fetch + re-derive every policy κ (Law L5) ───────────────────
  let _roster = null;
  async function roster() {
    if (_roster) return _roster;
    const data = await fetch(POLICIES_URL, { cache: "no-store" }).then((r) => r.json());
    for (const p of data.policies) if (!(await selfVerifies(p))) throw new Error("Holo Privacy: policy " + p.code + " failed to re-derive (Law L5)");
    // fail-closed pin: the policy set must be the exact one the enforcement code is anchored to (Law L5),
    // so a swapped/edited policies.json is detected even if it is internally self-consistent.
    const idx = await rosterIndexId(data.policies);
    if (idx !== data.rosterId || idx !== EXPECTED_ROSTER_ID) throw new Error("Holo Privacy: roster pin mismatch — refusing (policies.json is not the set this code is anchored to)");
    _roster = data; return data;
  }
  const codeOf = (r, code) => r.policies.find((p) => p.code === code);
  // the enforcement code is anchored to this content address of the policy set (holo-privacy.mjs ROSTER_ID).
  const EXPECTED_ROSTER_ID = "did:holo:sha256:9adfd61ad281fa6eed6b1b4f50bfe0b558b197ae3d4b4f842c8e3295a388546d";
  async function rosterIndexId(policies) {
    return address({ "@context": ["https://schema.org/", NS], "@type": ["odrl:Policy", "schema:DataCatalog"], "schema:name": "Holo Privacy disclosure policies", policies: policies.map((p) => ({ code: p.code, id: p.id })) });
  }

  // ── standing stance (default MINIMAL) + active purpose overlays — the user's controls ─────────
  const STANCE_KEY = "holo-privacy:stance", OVERLAY_KEY = "holo-privacy:overlays";
  function standingCode() { try { return localStorage.getItem(STANCE_KEY) || ""; } catch { return ""; } }
  async function standingPolicy() { const r = await roster(); return codeOf(r, standingCode()) || codeOf(r, r.default); }
  function setStanding(code) { try { localStorage.setItem(STANCE_KEY, code); } catch {}; renderBadge(); return code; }
  function activeOverlayCodes() { try { return JSON.parse(localStorage.getItem(OVERLAY_KEY) || "[]"); } catch { return []; } }
  function setOverlay(code, on) { const s = new Set(activeOverlayCodes()); on ? s.add(code) : s.delete(code); try { localStorage.setItem(OVERLAY_KEY, JSON.stringify([...s])); } catch {}; renderBadge(); }
  async function activeOverlays() { const r = await roster(); return activeOverlayCodes().map((c) => codeOf(r, c)).filter(Boolean); }

  // ── the wallet: the personal-data commitment + its openings (the holder's secret) ─────────────
  // SECURITY (red-team hardening): the wallet is ENCRYPTED at rest (AES-GCM). By default the key is a
  // NON-EXTRACTABLE device key in IndexedDB, so a passive localStorage scrape yields ciphertext, not
  // your data; the decrypted wallet lives ONLY in this module's memory (a closure, never on window).
  // Set a passphrase (PBKDF2) for protection that also resists an ACTIVE same-origin attacker. The
  // residual same-origin risk and its real fix (per-app site isolation) are documented in THREAT-MODEL.
  const WALLET_KEY = "holo-privacy:wallet";
  const KNOWN_PD = new Set(["dpv-pd:Name", "dpv-pd:EmailAddress", "dpv-pd:TelephoneNumber", "dpv-pd:Location", "dpv-pd:Age", "dpv-pd:Preference", "dpv-pd:Financial"]);
  const digestClaim = (salt, c) => sha256hex(jcs({ salt, category: c.category, name: c.name, value: c.value }));
  const randomSalt = () => hex(crypto.getRandomValues(new Uint8Array(16)));

  // device key (non-extractable AES-GCM) in IndexedDB + passphrase-derived key (PBKDF2)
  const IDB_DB = "holo-privacy", IDB_STORE = "keys", DEVICE_KEY_ID = "device-aesgcm";
  function idbOpen() { return new Promise((res, rej) => { const r = indexedDB.open(IDB_DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  function idbGet(k) { return idbOpen().then((db) => new Promise((res, rej) => { const t = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); })); }
  function idbPut(k, v) { return idbOpen().then((db) => new Promise((res, rej) => { const tx = db.transaction(IDB_STORE, "readwrite"); tx.objectStore(IDB_STORE).put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); })); }
  async function deviceKey() { let k = await idbGet(DEVICE_KEY_ID).catch(() => null); if (!k) { k = await subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); try { await idbPut(DEVICE_KEY_ID, k); } catch {} } return k; }
  async function passKey(p, salt) { const base = await subtle.importKey("raw", enc.encode(p), "PBKDF2", false, ["deriveKey"]); return subtle.deriveKey({ name: "PBKDF2", salt, iterations: 210000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
  async function aesEnc(key, str) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(str))); return b64e(concat(iv, ct)); }
  async function aesDec(key, b64) { const raw = b64d(b64); return new TextDecoder().decode(await subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, key, raw.subarray(12))); }

  let _walletPlain = null, _passphrase = null;                         // decrypted wallet + passphrase live ONLY here
  async function encryptWallet(w) {
    if (_passphrase) { const salt = crypto.getRandomValues(new Uint8Array(16)); const key = await passKey(_passphrase, salt); localStorage.setItem(WALLET_KEY, JSON.stringify({ mode: "pass", salt: b64e(salt), enc: await aesEnc(key, JSON.stringify(w)) })); }
    else { const key = await deviceKey(); localStorage.setItem(WALLET_KEY, JSON.stringify({ mode: "device", enc: await aesEnc(key, JSON.stringify(w)) })); }
  }
  async function decryptWallet(passphrase) {
    let raw = null; try { raw = JSON.parse(localStorage.getItem(WALLET_KEY) || "null"); } catch {}
    if (!raw) return null;
    if (raw.commitment && raw.openings) { _walletPlain = raw; await encryptWallet(raw); return raw; }   // migrate a legacy cleartext wallet
    if (!raw.enc) return null;
    const key = raw.mode === "pass" ? await passKey(passphrase || _passphrase, b64d(raw.salt)) : await deviceKey();
    return JSON.parse(await aesDec(key, raw.enc));
  }
  async function unlock(passphrase) { try { _walletPlain = await decryptWallet(passphrase); if (passphrase) _passphrase = passphrase; renderBadge(); return _walletPlain; } catch { return null; } }
  async function ensureUnlocked() { if (_walletPlain) return _walletPlain; try { _walletPlain = await decryptWallet(_passphrase); } catch { _walletPlain = null; } return _walletPlain; }
  function lock() { _walletPlain = null; _passphrase = null; }
  function setPassphrase(p) { _passphrase = p || null; }               // next save re-encrypts under it
  function loadWallet() { return _walletPlain; }                       // INTERNAL only — never exposed on the public API
  function walletStored() { try { return !!JSON.parse(localStorage.getItem(WALLET_KEY) || "null"); } catch { return false; } }
  // status()/commitment() are the PUBLIC view: counts + claim NAMES + the (non-secret) commitment — but
  // NEVER the values. So a same-origin frame calling another frame's HoloPrivacy can't dump your data
  // through the API; the plaintext openings live only in this module's closure (_walletPlain). (F1)
  function status() { const w = _walletPlain; return { committed: walletStored(), unlocked: !!w, count: w ? w.openings.length : 0, names: w ? w.openings.map((o) => ({ name: o.name, category: o.category })) : [] }; }
  function commitment() { return _walletPlain ? _walletPlain.commitment : null; }
  async function commitPersonalData(claims) {
    const openings = [];
    for (const c of claims) { const salt = randomSalt(); openings.push({ category: c.category, name: c.name, value: c.value, salt, digest: await digestClaim(salt, c) }); }
    const digests = openings.map((o) => o.digest).sort();
    const commitment = { "@context": ["https://schema.org/", NS], "@type": ["dpv:PersonalData", "schema:Dataset"], "schema:name": "Personal data commitment", count: digests.length, digests };
    commitment.id = await address(commitment);
    const wallet = { commitment, openings }; _walletPlain = wallet; await encryptWallet(wallet); return wallet;
  }

  // ── classification (mirrors holo-privacy.mjs) ─────────────────────────────────────────────────
  function classify(request, overlays) {
    const ov = overlays.find((o) => (o.policy || {}).purpose === request.purpose);
    const allow = new Set(ov ? (ov.policy.allow || []) : []);
    const out = { auto: [], prompt: [], deny: [] };
    for (const c of request.claims || []) out[allow.has(c.category) ? "auto" : KNOWN_PD.has(c.category) ? "prompt" : "deny"].push(c);
    return out;
  }

  // ── selective disclosure = a W3C Verifiable Presentation (with anti-replay binding) ───────────
  const TTL_MS = 5 * 60 * 1000;                                        // a disclosure is fresh for 5 minutes
  async function disclose(h, commitment, openings, { purpose, recipient, policy, reveal = [], issued, expires, nonce, challenge, ttlMs = TTL_MS }) {
    const disclosures = openings.filter((o) => reveal.includes(o.name))
      .map((o) => ({ salt: o.salt, category: o.category, name: o.name, value: o.value, digest: o.digest }))
      .sort((a, b) => (a.digest < b.digest ? -1 : 1));
    const created = issued || new Date().toISOString();
    const doc = { "@context": VP_CTX, "@type": ["VerifiablePresentation", "dpv:PersonalDataHandling"],
      holder: h.did, "dpv:hasDataSubject": h.did, "dpv:hasRecipient": recipient, "dpv:hasPurpose": purpose,
      "dpv:hasLegalBasis": "dpv:Consent", "odrl:hasPolicy": policy, commitment: commitment.id, disclosures,
      issued: created, expires: expires || new Date(Date.parse(created) + ttlMs).toISOString(),
      nonce: nonce || randomSalt(), ...(challenge ? { challenge } : {}) };
    const proof = await signDoc(h, doc, created); const vp = { ...doc, proof }; vp.id = await address(vp); return vp;
  }
  async function verifyDisclosure(vp, commitment, { now } = {}) {
    try {
      if (!vp || !(await selfVerifies(vp)) || !(await verifyProof(vp))) return false;
      if (vp.expires && Date.parse(vp.expires) <= (now ? Date.parse(now) : Date.now())) return false;   // freshness
      if (!commitment || vp.commitment !== commitment.id) return false;
      const committed = new Set(commitment.digests || []);
      for (const d of vp.disclosures || []) { if ((await digestClaim(d.salt, d)) !== d.digest) return false; if (!committed.has(d.digest)) return false; }
      return true;
    } catch { return false; }
  }
  const presentationBindingOk = (vp, { recipient, challenge, now } = {}) => !!vp &&
    !(vp.expires && Date.parse(vp.expires) <= (now ? Date.parse(now) : Date.now())) &&
    (!recipient || vp["dpv:hasRecipient"] === recipient) && (!challenge || vp.challenge === challenge);
  const levelOf = (commitment, vp) => ({ disclosed: (vp.disclosures || []).length, total: commitment.count || (commitment.digests || []).length });

  // ── disclosure log: a content-addressed, hash-chained, self-verifying audit trail (UOR) ───────
  const LOG_CTX = ["https://schema.org/", { prov: "http://www.w3.org/ns/prov#", hos: "https://hologram.os/ns/privacy#", dpv: NS.dpv, odrl: NS.odrl }];
  const LOG_KEY = "holo-privacy:log";
  function loadLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch { return []; } }
  async function appendLog(vp) {
    const log = loadLog(); const prev = log[log.length - 1] || null;
    const e = { "@context": LOG_CTX, "@type": ["prov:Activity", "hos:Disclosure"], prev: prev ? prev.id : null, seq: prev ? prev.seq + 1 : 0,
      presentation: vp.id, "dpv:hasRecipient": vp["dpv:hasRecipient"], "dpv:hasPurpose": vp["dpv:hasPurpose"],
      disclosed: (vp.disclosures || []).map((d) => d.name).sort(), at: vp.issued || new Date().toISOString() };
    e.id = await address(e); log.push(e); try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch {}; return e;
  }
  async function verifyLog(entries) {
    entries = entries || loadLog();
    for (let i = 0; i < entries.length; i++) { const e = entries[i]; if (!e || !(await selfVerifies(e))) return false; if (e.seq !== i) return false; if (e.prev !== (i === 0 ? null : entries[i - 1].id)) return false; }
    return true;
  }

  // ── consent ledger (per recipient) — DPV Consent VCs the data subject signed ──────────────────
  const LEDGER_KEY = "holo-privacy:consents";
  function loadLedger() { try { return JSON.parse(localStorage.getItem(LEDGER_KEY) || "{}"); } catch { return {}; } }
  function saveLedger(m) { try { localStorage.setItem(LEDGER_KEY, JSON.stringify(m)); } catch {} }
  async function makeConsent(h, { recipient, purpose, policy, categories }) {
    const doc = { "@context": VP_CTX, "@type": ["VerifiableCredential", "dpv:Consent"], issuer: h.did, issued: new Date().toISOString(),
      credentialSubject: { "@type": "dpv:PersonalDataHandling", "dpv:hasDataSubject": h.did, "dpv:hasRecipient": recipient, "dpv:hasPurpose": purpose, "dpv:hasLegalBasis": "dpv:Consent", "odrl:hasPolicy": policy, "dpv:hasPersonalData": [...categories].sort() } };
    const proof = await signDoc(h, doc); const rec = { ...doc, proof }; rec.id = await address(rec); return rec;
  }
  function revoke(recipient) { const m = loadLedger(); delete m[recipient]; saveLedger(m); renderBadge(); }

  // ── the GATE — an agent asks to disclose for a purpose; returns the minimal Verifiable Presentation ──
  // request = { purpose (dpv:…), recipient (agent/app id), claims:[{category,name}], reveal?:[name] }.
  // Returns { vp, level, consent } or null (nothing authorized / denied) — default-deny.
  async function gate(request = {}) {
    try {
      const wallet = await ensureUnlocked(); if (!wallet) return null;        // locked / no personal data ⇒ default-deny
      const h = await holder(); const stance = await standingPolicy(); const overlays = await activeOverlays();
      const claims = (request.claims || []).map((c) => ({ category: c.category, name: c.name }));
      const cls = classify({ purpose: request.purpose, claims }, overlays);
      let approved = [];
      if (cls.prompt.length || cls.deny.length) { const d = await showConsent(request, stance, cls); if (!d) return null; approved = d.approved; }
      const granted = [...cls.auto, ...approved];
      // names to reveal: requested reveal ∩ granted, defaulting to all granted; prefer derived claims
      // (e.g. age_over_18) over raw values when the stance/overlay says so (MINIMAL-VERIFY / IDENTITY).
      const preferDerived = (stance.policy && stance.policy.preferDerived) || overlays.some((o) => o.policy && o.policy.preferDerived && o.policy.purpose === request.purpose);
      let names = granted.map((c) => c.name);
      if (request.reveal) names = names.filter((n) => request.reveal.includes(n));
      const reveal = resolveReveal(wallet.openings, names, preferDerived);
      if (!reveal.length) return null;
      const policy = stance.id;
      const vp = await disclose(h, wallet.commitment, wallet.openings, { purpose: request.purpose, recipient: request.recipient, policy, reveal });
      const categories = [...new Set(reveal.map((n) => (wallet.openings.find((o) => o.name === n) || {}).category).filter(Boolean))];
      const consent = await makeConsent(h, { recipient: request.recipient, purpose: request.purpose, policy, categories });
      const m = loadLedger(); m[request.recipient] = { consent, purpose: request.purpose, reveal, level: levelOf(wallet.commitment, vp), at: Date.now(), vpId: vp.id }; saveLedger(m);
      await appendLog(vp);                                                    // record it in the self-verifying UOR audit chain
      renderBadge();
      return { vp, level: levelOf(wallet.commitment, vp), consent };
    } catch (e) { console.warn("HoloPrivacy.gate", e); return null; }   // fail closed (default-deny)
  }
  // prefer a derived boolean claim (name + "_over_18", "_is_*") over the raw one when minimising.
  function resolveReveal(openings, names, preferDerived) {
    const have = new Set(openings.map((o) => o.name));
    const out = [];
    for (const n of names) {
      if (preferDerived) { const derived = openings.find((o) => o.name.startsWith(n + "_") || (o.name !== n && o.category === (openings.find((x) => x.name === n) || {}).category && typeof o.value === "boolean")); if (derived) { out.push(derived.name); continue; } }
      if (have.has(n)) out.push(n);
    }
    return [...new Set(out)];
  }

  // ── consent dialog (you decide what an agent may be shown) ────────────────────────────────────
  const PURPOSE_LABEL = { "dpv:ServiceProvision": "deliver the service you asked for", "dpv:CommunicationManagement": "reach you", "dpv:IdentityVerification": "verify something about you", "dpv:Payment": "pay for something you asked for", "dpv:Personalisation": "personalise things for you" };
  const PD_LABEL = { "dpv-pd:Name": "your name", "dpv-pd:EmailAddress": "your email", "dpv-pd:TelephoneNumber": "your phone number", "dpv-pd:Location": "your location", "dpv-pd:Age": "your age", "dpv-pd:Preference": "your preferences", "dpv-pd:Financial": "a payment detail" };
  const claimLabel = (c) => PD_LABEL[c.category] || c.name;
  function showConsent(request, stance, cls) {
    return new Promise((resolve) => {
      ensureCss();
      const back = el("div", "holo-pri-back on"); const card = el("div", "holo-pri-card");
      const who = esc(request.recipient || "An agent"); const why = esc(PURPOSE_LABEL[request.purpose] || "act for you");
      const prompts = cls.prompt.map((c, i) => `<label class="hp-row"><input type="checkbox" data-i="${i}"><span class="hp-rl">show <b>${esc(claimLabel(c))}</b></span></label>`).join("");
      const denies = cls.deny.length ? `<div class="hp-deny"><div class="hp-dh">Outside what I recognize</div>${cls.deny.map((c) => `<div class="hp-drow">${who} asked for <b>${esc(c.category)}</b> — not a category I can disclose.</div>`).join("")}</div>` : "";
      card.innerHTML = `
        <div class="hp-hd"><span class="hp-shield">${SHIELD}</span><div><div class="hp-t">${who} wants to ${why}</div>
          <div class="hp-sub">Your stance: <b title="${esc(stance["schema:description"] || "")}">${esc(stance["schema:name"] || stance.code)}</b>. It needs your OK to show:</div></div></div>
        <div class="hp-bd">${prompts || '<p class="hp-none">nothing beyond what you already allow.</p>'}${denies}</div>
        <div class="hp-ft"><a class="hp-link" href="${APP_URL}" target="_top">Holo Privacy ↗</a><span class="hp-sp"></span>
          <button class="hp-btn" data-act="deny">Show nothing</button><button class="hp-btn cta" data-act="allow">Show selected</button></div>`;
      back.appendChild(card); document.body.appendChild(back);
      const close = (approved) => { back.remove(); resolve(approved ? { approved } : null); };
      card.querySelector('[data-act="deny"]').onclick = () => close([]);
      card.querySelector('[data-act="allow"]').onclick = () => close([...card.querySelectorAll(".hp-row input:checked")].map((x) => cls.prompt[+x.dataset.i]));
      back.addEventListener("click", (e) => { if (e.target === back) close([]); });
    });
  }

  // ── the per-frame badge (how much an agent here was shown, in plain words) ────────────────────
  const SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><circle cx="12" cy="11" r="2.4" stroke="#7ee7c7"/><path d="M12 13.4V16" stroke="#7ee7c7"/></svg>';
  const STANCE_SHORT = { MINIMAL: "Privacy", "MINIMAL-VERIFY": "Privacy · proof" };
  let _cssAdded = false;
  function ensureCss() { if (_cssAdded || !isBrowser) return; _cssAdded = true; const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s); }
  // The HOST surfaces ONE shield per focused app (holo-gov.js): when it sets the active app, the badge
  // + panel reflect THAT app's disclosures — not the shell's. In a bare app frame this stays null and
  // we fall back to the page's own identity (meta / title), so the per-frame badge still works alone.
  let _activeApp = null;
  function setActiveApp(a) { _activeApp = a || null; renderBadge(); }
  const appIdOf = () => (_activeApp && (_activeApp.did || _activeApp.id || _activeApp.name))
    || ((document.querySelector('meta[name="holo-app-id"]') || {}).content) || (document.title || "this app");
  async function renderBadge() {
    if (!isBrowser || W.__holoPrivacyBadge === false) return;
    ensureCss();
    let btn = document.getElementById("holo-privacy-btn");
    if (!btn) { btn = document.createElement("button"); btn.id = "holo-privacy-btn"; btn.type = "button"; btn.title = "Holo Privacy — what agents may learn about you"; btn.innerHTML = SHIELD + '<span class="hp-code"></span>'; btn.onclick = togglePanel; document.body.appendChild(btn); }
    let code = standingCode(); if (!code) { try { code = (await roster()).default; } catch { code = "MINIMAL"; } }
    btn.querySelector(".hp-code").textContent = STANCE_SHORT[code] || code;
  }
  let _panel = null;
  async function togglePanel() {
    if (_panel) { _panel.remove(); _panel = null; return; }
    ensureCss();
    const r = await roster().catch(() => null);
    const stance = (r && (codeOf(r, standingCode()) || codeOf(r, r.default))) || null;
    const wallet = walletStored(); const recipient = appIdOf(); const entry = loadLedger()[recipient];
    const shown = entry ? `${entry.level.disclosed} of ${entry.level.total} details` : "nothing yet";
    const overlays = activeOverlayCodes();
    _panel = el("div", "holo-privacy-panel on");
    _panel.innerHTML = `
      <div class="hp-ph"><span class="hp-shield">${SHIELD}</span><div><div class="hp-pt">Holo Privacy</div><div class="hp-psub">data subject: you</div></div></div>
      <div class="hp-pb">
        <div class="hp-k">Your stance</div><div class="hp-v"><b>${esc(stance ? stance["schema:name"] : "Share the minimum")}</b></div>
        <div class="hp-desc">${esc(stance ? stance["schema:description"] : "")}</div>
        <div class="hp-k" style="margin-top:9px">Shown to this agent</div><div class="hp-v">${esc(shown)}${entry ? ` · for ${esc((PURPOSE_LABEL[entry.purpose] || entry.purpose))}` : ""}</div>
        ${overlays.length ? `<div class="hp-k" style="margin-top:9px">Allowed purposes</div><div class="hp-v">${overlays.map(esc).join(", ")}</div>` : ""}
        ${wallet ? "" : '<div class="hp-warn">No personal data set up yet — open Holo Privacy to add what an agent could draw on.</div>'}
      </div>
      <div class="hp-pf"><a class="hp-link" href="${APP_URL}" target="_top">Manage ↗</a><span class="hp-sp"></span>${entry ? '<button class="hp-btn" id="hp-revoke">Revoke</button>' : ""}</div>`;
    document.body.appendChild(_panel);
    const rv = _panel.querySelector("#hp-revoke"); if (rv) rv.onclick = () => { revoke(recipient); togglePanel(); };
    const off = (e) => { if (_panel && !_panel.contains(e.target) && e.target.id !== "holo-privacy-btn" && !e.target.closest("#holo-privacy-btn")) { _panel.remove(); _panel = null; document.removeEventListener("click", off, true); } };
    setTimeout(() => document.addEventListener("click", off, true), 0);
  }

  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const CSS = `
  #holo-privacy-btn{position:fixed;right:10px;bottom:10px;z-index:2147482300;display:inline-flex;align-items:center;gap:6px;
    height:30px;padding:0 10px 0 8px;border-radius:999px;border:1px solid #233040;background:#0d1117e6;color:#9fb0bd;
    cursor:pointer;backdrop-filter:blur(6px);box-shadow:0 4px 14px rgba(0,0,0,.4);font:600 var(--holo-text-sm, 0.688rem) ui-monospace,monospace}
  #holo-privacy-btn:hover{color:#e6edf3;border-color:#3a4452}
  #holo-privacy-btn svg{width:14px;height:14px;flex:0 0 auto}
  #holo-privacy-btn .hp-code{letter-spacing:.02em}
  .holo-privacy-panel{position:fixed;right:10px;bottom:48px;z-index:2147482301;width:min(330px,92vw);
    background:#0d1117;color:#e6edf3;border:1px solid #28323d;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.55);
    font:var(--holo-text-sm, 1rem)/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
  .holo-privacy-panel .hp-ph,.holo-pri-card .hp-hd{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #1b2128;background:#11161d}
  .hp-shield{color:#5fd0b0;display:inline-flex}.hp-shield svg{width:22px;height:22px}
  .hp-pt,.hp-t{font-weight:700}.hp-psub,.hp-sub{color:#8b949e;font-size:var(--holo-text-sm,1rem)}
  .holo-privacy-panel .hp-pb{padding:12px 14px}
  .hp-k{color:#8b949e;font-size:var(--holo-text-sm,1rem);text-transform:uppercase;letter-spacing:.06em}
  .hp-v{margin:2px 0}.hp-desc{color:#8b949e;font-size:var(--holo-text-sm,1rem)}
  .hp-warn{margin-top:10px;color:#e0b352;font-size:var(--holo-text-sm,1rem);border-top:1px dashed #2a323c;padding-top:8px}
  .holo-privacy-panel .hp-pf,.holo-pri-card .hp-ft{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid #1b2128}
  .hp-link{color:#79c0ff;text-decoration:none;font-size:var(--holo-text-sm,1rem)}.hp-link:hover{text-decoration:underline}.hp-sp{flex:1}
  .hp-btn{font:var(--holo-text-sm, 1rem) ui-sans-serif;min-height:34px;padding:0 13px;border-radius:8px;border:1px solid #28323d;background:#161b22;color:#c9d1d9;cursor:pointer}
  .hp-btn:hover{border-color:#3a4452;color:#fff}.hp-btn.cta{color:#04121f;background:#2dd4bf;border-color:#2dd4bf;font-weight:600}
  .holo-pri-back{position:fixed;inset:0;z-index:2147483400;background:#04070caa;backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:18px}
  .holo-pri-card{width:min(440px,96vw);background:#0d1117;color:#e6edf3;border:1px solid #28323d;border-radius:14px;
    box-shadow:0 24px 70px rgba(0,0,0,.6);font:var(--holo-text-sm, 1rem)/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
  .holo-pri-card .hp-bd{padding:12px 16px;max-height:50vh;overflow:auto}
  .hp-none{color:#8b949e}
  .hp-row{display:flex;align-items:flex-start;gap:9px;padding:8px 10px;margin:5px 0;border:1px solid #222b35;border-radius:9px;cursor:pointer}
  .hp-row:hover{border-color:#3a4452}.hp-row input{margin-top:3px;width:16px;height:16px;accent-color:#2dd4bf}.hp-rl{flex:1}
  .hp-deny{margin-top:10px;border-top:1px dashed #2a323c;padding-top:9px}
  .hp-dh{color:#f0a05a;font-size:var(--holo-text-sm,1rem);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
  .hp-drow{color:#9aa6b2;font-size:var(--holo-text-sm,1rem);margin:3px 0}
  @media (max-width:520px){#holo-privacy-btn{right:8px;bottom:8px}.holo-privacy-panel{right:8px;left:8px;width:auto}}
  @media print{#holo-privacy-btn,.holo-privacy-panel,.holo-pri-back{display:none!important}}`;

  // ── broker client: talk to a Holo Privacy holder on a DIFFERENT ORIGIN (full isolation) ──────
  // The only way a same-origin app can be kept out of your wallet is to put the wallet on a SECOND
  // ORIGIN: a same-origin policy then blocks the app from that origin's storage AND from the broker
  // frame's DOM/closures. brokerClient(origin) mounts a cross-origin <iframe src=origin/privacy-
  // broker.html> and proxies the API to it over postMessage (origin-checked). The app only ever
  // receives a minimal Verifiable Presentation; the wallet + keys never leave the broker origin.
  // (Deploy: serve privacy-broker.html from a distinct origin — subdomain / port / partition.)
  function brokerClient(brokerOrigin, opts = {}) {
    const origin = String(brokerOrigin).replace(/\/$/, "");
    const url = origin + (opts.path || "/privacy-broker.html") + "?allow=" + encodeURIComponent(location.origin);
    let frame = document.querySelector("iframe[data-holo-privacy-broker]");
    if (!frame) {
      frame = document.createElement("iframe"); frame.setAttribute("data-holo-privacy-broker", origin);
      frame.style.cssText = opts.style || "position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0";
      frame.src = url; document.body.appendChild(frame);
    }
    const ready = new Promise((res) => {
      const on = (e) => { if (e.source === frame.contentWindow && e.data && e.data.type === "holo-privacy:ready") { window.removeEventListener("message", on); res(); } };
      window.addEventListener("message", on);
    });
    let seq = 0; const pending = new Map();
    window.addEventListener("message", (e) => {
      if (e.origin !== origin || e.source !== frame.contentWindow) return;        // only trust the broker origin
      const d = e.data; if (!d || d.type !== "holo-privacy:res") return;
      const p = pending.get(d.id); if (!p) return; pending.delete(d.id);
      d.error ? p.rej(new Error(d.error)) : p.res(d.result);
    });
    const call = async (method, args, meta) => { await ready; return new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); frame.contentWindow.postMessage({ type: "holo-privacy:rpc", id, method, args, meta }, origin); }); };
    return {
      origin, frame,
      status: () => call("status"), commitment: () => call("commitment"),
      commitPersonalData: (claims) => call("commitPersonalData", claims),
      setStanding: (c) => call("setStanding", c), setOverlay: (c, on) => call("setOverlay", [c, on]),
      unlock: (p) => call("unlock", p),
      // recipient is taken from `meta` (the trusted host's assertion of the app's launched identity),
      // not from anything the untrusted app can forge in the request body.
      gate: (request, meta) => call("gate", request, meta),
      ledger: () => call("ledger"), log: () => call("log"), verifyLog: () => call("verifyLog"),
    };
  }

  // ── host client: an app frame routes disclosure UP to the HOST's privacy gate (full enforcement) ──
  // Symmetric to Holo Terms: just as the host clamps an app's capabilities at mount, the host is the
  // ONE place a disclosure can be minted — it owns the wallet/keys; the app frame holds nothing. An app
  // (or the SDK) calls hostClient().gate(request); the host (holo-gov.js) re-stamps the recipient from
  // what it actually mounted (un-forgeable) and gates under the USER's standing stance (default-deny).
  // No-op when not framed (top === self) — then the in-frame gate above is already the authority.
  function hostClient() {
    const top = W.top; if (!top || top === W) return null;
    let seq = 0; const pending = new Map();
    W.addEventListener("message", (e) => { const d = e.data; if (!d || d.type !== "holo-privacy:res") return; const p = pending.get(d.id); if (!p) return; pending.delete(d.id); d.error ? p.rej(new Error(d.error)) : p.res(d.result); });
    const call = (method, args) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); top.postMessage({ type: "holo-privacy:rpc", id, method, args }, "*"); setTimeout(() => { if (pending.has(id)) { pending.delete(id); res(null); } }, 8000); });
    return { gate: (request) => call("gate", request), status: () => call("status") };
  }

  // ── public API ────────────────────────────────────────────────────────────────────────────────
  W.HoloPrivacy = {
    brokerClient, hostClient, setActiveApp,
    gate, disclose, verifyDisclosure, presentationBindingOk, classify, commitPersonalData, levelOf,
    roster, standing: standingCode, setStanding, standingPolicy, activeOverlayCodes, setOverlay, activeOverlays,
    status, commitment, walletStored, unlock, lock, setPassphrase, ledger: loadLedger, revoke,
    log: loadLog, verifyLog,
    dataSubject: async () => (await holder()).did, delegate: async () => (await delegate()).did,
    openControlCenter: () => { try { (W.top || W).location.href = APP_URL; } catch { location.href = APP_URL; } },
  };

  if (isBrowser) (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", () => renderBadge()) : renderBadge());
})();
