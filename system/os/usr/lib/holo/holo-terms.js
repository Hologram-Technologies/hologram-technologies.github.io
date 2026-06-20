// holo-terms.js — Holo Terms in the browser: MyTerms (IEEE 7012-2025) enforced across Hologram OS.
//
// Drop-in:  <script src="_shared/holo-terms.js"></script>   (exposes window.HoloTerms)
//
// Two roles, one self-contained module (vanilla JS + crypto.subtle, no deps, no CDN):
//   • HOST GATE — a projection (holospace.html / a launcher) calls `await HoloTerms.gate(def)`
//     BEFORE mounting an app. It returns the EFFECTIVE capability set (declared ∩ what the first
//     party granted under their standing term), opening a consent dialog for sensitive/egress
//     requests. The host hands that set to holo-launch.mount → the iframe sandbox/allow enforce it.
//     Default-deny: nothing is granted that wasn't agreed; a forged/tampered record ⇒ bare sandbox.
//   • PER-FRAME BADGE — a small shield in any holospace showing the active term + what THIS app was
//     granted, with a link to the Holo Terms control center.
//
// The first party is the OS user: one Ed25519 did:key, minted once + persisted. The second party is
// the app (its did:holo). An agreement RECORD is a W3C Verifiable Credential (eddsa-jcs-2022) the
// user signs; its identity is its own content address; it is re-derived + proof-verified (Law L5)
// before any grant is honored. The roster is fetched from terms/roster.json and re-derived too — the
// SAME content-addressed data holo-terms.mjs seals, so policy never drifts between node and browser.

(function () {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  if (W.HoloTerms) return;
  const isBrowser = typeof document !== "undefined" && typeof location !== "undefined";

  // ── resolve our own location → roster + control-center live relative to it (any page depth) ──
  const SELF = (document.currentScript && document.currentScript.src) || new URL("_shared/holo-terms.js", location.href).href;
  const ROSTER_URL = new URL("../terms/roster.json", SELF).href;        // os/terms/roster.json
  const TERMS_APP_URL = new URL("../holospace.html?app=org.hologram.HoloTerms", SELF).href;

  // ── primitives (the same canonicalization + addressing the substrate uses) ───────────────────
  const enc = new TextEncoder();
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  const subtle = (W.crypto || crypto).subtle;
  async function sha256(bytes) { return new Uint8Array(await subtle.digest("SHA-256", bytes)); }
  // RFC 8785 JSON Canonicalization Scheme — identical to holo-uor.jcs.
  const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
    : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
    : JSON.stringify(v);
  // multibase base58btc (Bitcoin alphabet) — for did:key + proofValue (matches holo-vc.mjs).
  const A58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58enc(buf) { const d = [0]; for (const byte of buf) { let c = byte; for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } } let s = ""; for (const byte of buf) { if (byte === 0) s += "1"; else break; } for (let i = d.length - 1; i >= 0; i--) s += A58[d[i]]; return s; }
  function b58dec(str) { const b = [0]; for (const ch of str) { let c = A58.indexOf(ch); if (c < 0) throw new Error("bad base58"); for (let i = 0; i < b.length; i++) { c += b[i] * 58; b[i] = c & 0xff; c >>= 8; } while (c) { b.push(c & 0xff); c >>= 8; } } let z = 0; for (const ch of str) { if (ch === "1") z++; else break; } const out = new Uint8Array(z + b.length); for (let i = 0; i < b.length; i++) out[z + i] = b[b.length - 1 - i]; return out; }

  // did:holo content address (holo-object.address): did:holo:sha256:H(jcs(content without id)).
  async function address(obj) { const { id, ...content } = obj; return "did:holo:sha256:" + hex(await sha256(enc.encode(jcs(content)))); }
  async function selfVerifies(obj) { return obj && obj.id === await address(obj); }

  // ── Ed25519 (eddsa-jcs-2022) signer/verifier via WebCrypto — matches holo-vc.mjs byte-for-byte ──
  const ALG = { name: "Ed25519" };
  const didKeyFromPub = (raw32) => "did:key:z" + b58enc(concat([0xed, 0x01], raw32));
  function concat(prefix, tail) { const a = new Uint8Array(prefix.length + tail.length); a.set(prefix, 0); a.set(tail, prefix.length); return a; }
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

  // ── first-party identity: one Ed25519 did:key, minted once + persisted (localStorage) ────────
  const ID_KEY = "holo-terms:first-party";
  let _signer = null;
  async function signer() {
    if (_signer) return _signer;
    let saved = null; try { saved = JSON.parse(localStorage.getItem(ID_KEY) || "null"); } catch {}
    let priv, pubRaw;
    if (saved && saved.pkcs8) {
      priv = await subtle.importKey("pkcs8", b64d(saved.pkcs8), ALG, true, ["sign"]);
      pubRaw = b64d(saved.pubRaw);
    } else {
      const kp = await subtle.generateKey(ALG, true, ["sign", "verify"]);
      priv = kp.privateKey; pubRaw = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
      const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", priv));
      try { localStorage.setItem(ID_KEY, JSON.stringify({ pkcs8: b64e(pkcs8), pubRaw: b64e(pubRaw), at: Date.now() })); } catch {}
    }
    const did = didKeyFromPub(pubRaw); _signer = { did, vm: did + "#" + did.slice("did:key:".length), privateKey: priv };
    return _signer;
  }
  const b64e = (u8) => btoa(String.fromCharCode(...u8));
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // ── the roster: fetch terms/roster.json + re-derive every agreement κ (Law L5) ───────────────
  let _roster = null;
  async function roster() {
    if (_roster) return _roster;
    const data = await fetch(ROSTER_URL, { cache: "no-store" }).then((r) => r.json());
    for (const a of data.agreements) if (!(await selfVerifies(a))) throw new Error("Holo Terms: roster agreement " + a.code + " failed to re-derive (Law L5)");
    _roster = data; return data;
  }
  const codeOf = (r, code) => r.agreements.find((a) => a.code === code);

  // ── standing term (the user's proposed terms) — default SD-BASE, changeable ───────────────────
  const TERM_KEY = "holo-terms:standing";
  function standingCode() { try { return localStorage.getItem(TERM_KEY) || ""; } catch { return ""; } }
  async function standingAgreement() { const r = await roster(); return codeOf(r, standingCode()) || codeOf(r, r.default); }
  function setStandingTerm(code) { try { localStorage.setItem(TERM_KEY, code); } catch {}; renderBadge(); return code; }

  // ── classification + effective intersection (read the agreement's machine-readable policy) ───
  const capRefs = (declared = {}) => [
    ...(declared.storage || []).map((v) => ({ type: "storage", value: v })),
    ...(declared.channels || []).map((v) => ({ type: "channel", value: v })),
    ...(declared.permissions || []).map((v) => ({ type: "permission", value: v })),
    ...(declared.purpose || []).map((v) => ({ type: "purpose", value: v })),
  ];
  function classify(agreement, declared, appId, opts = {}) {
    const pol = agreement.policy || {}; const held = new Set(opts.heldPurposes || []);
    const out = { auto: [], prompt: [], deny: [] };
    for (const ref of capRefs(declared)) {
      let cls;
      if (ref.type === "storage") cls = ref.value === appId ? "auto" : (pol.crossStorage === "auto" ? "auto" : "prompt");
      else if (ref.type === "channel") cls = pol.channels === "auto" ? "auto" : "prompt";
      else if (ref.type === "permission") cls = (pol.autoPermissions || []).includes(ref.value) ? "auto" : (pol.promptPermissions || []).includes(ref.value) ? "prompt" : "deny";
      else if (ref.type === "purpose") cls = ((pol.purposes || []).includes(ref.value) || held.has(ref.value)) ? "auto" : "deny";
      else cls = "deny";
      out[cls].push(ref);
    }
    return out;
  }
  const normalizeGrants = (g = []) => [...g].map((x) => ({ type: x.type, value: x.value })).sort((a, b) => (a.type + a.value < b.type + b.value ? -1 : 1));
  function effective(declared = {}, grants = []) {
    const has = (t) => { const s = new Set(grants.filter((g) => g.type === t).map((g) => g.value)); return (v) => s.has(v); };
    const hs = has("storage"), hc = has("channel"), hp = has("permission"), hpu = has("purpose");
    return {
      storage: (declared.storage || []).filter(hs), channels: (declared.channels || []).filter(hc),
      permissions: (declared.permissions || []).filter(hp), purpose: (declared.purpose || []).filter(hpu),
    };
  }

  // ── agreement records: a signed VC per app, content-addressed, stored + verified (Law L5) ────
  const REC_CTX = ["https://www.w3.org/ns/credentials/v2", "https://w3id.org/security/data-integrity/v2", { hos: "https://hologram.os/ns/terms#" }];
  const RECS_KEY = "holo-terms:records";
  const idOf = (def) => def.id || def["schema:identifier"] || def.name || "app";
  function loadRecords() { try { return JSON.parse(localStorage.getItem(RECS_KEY) || "{}"); } catch { return {}; } }
  function saveRecords(m) { try { localStorage.setItem(RECS_KEY, JSON.stringify(m)); } catch {} }
  async function makeRecord(grants, secondParty, termId) {
    const s = await signer();
    const doc = { "@context": REC_CTX, "@type": ["VerifiableCredential", "hos:TermsAgreement"], issuer: s.did, issued: new Date().toISOString(), credentialSubject: { secondParty, term: termId, grants: normalizeGrants(grants) } };
    const proof = await signDoc(s, doc);
    const sealed = { ...doc, proof }; sealed.id = await address(sealed); return sealed;
  }
  async function verifyRecord(rec) { try { return !!rec && await selfVerifies(rec) && await verifyProof(rec); } catch { return false; } }
  async function agreementFor(appId) { const rec = loadRecords()[appId]; return rec && await verifyRecord(rec) ? rec : null; }
  async function revoke(appId) { const m = loadRecords(); delete m[appId]; saveRecords(m); renderBadge(); }
  function heldPurposesFor(appId) {                  // PDC overlays the user accepted for this app
    const rec = loadRecords()[appId]; return rec ? (rec.credentialSubject.grants || []).filter((g) => g.type === "purpose").map((g) => g.value) : [];
  }

  // ── the host GATE — called before mounting; returns effective capabilities ───────────────────
  async function gate(def) {
    try {
      const declared = (def && def.capabilities) || {};
      if (capRefs(declared).length === 0) return {};                  // requests nothing → bare sandbox
      const appId = idOf(def); const term = await standingAgreement();
      let record = await agreementFor(appId);
      if (!record || record.credentialSubject.term !== term.id) {
        const cls = classify(term, declared, appId, { heldPurposes: heldPurposesFor(appId) });
        let approved = [];
        if (cls.prompt.length || cls.deny.length) { const d = await showConsent(def, term, cls); approved = d ? d.approved : []; }
        const grants = [...cls.auto, ...approved];
        record = await makeRecord(grants, appId, term.id);
        const m = loadRecords(); m[appId] = record; saveRecords(m);
      }
      if (!(await verifyRecord(record))) return {};                    // Law L5: forged ⇒ default-deny
      return effective(declared, record.credentialSubject.grants);
    } catch (e) { console.warn("HoloTerms.gate", e); return {}; }      // fail closed (default-deny)
  }

  // ── batched GATE — one consent for a whole holospace (First Light) ────────────────────────────
  // gateAll(defs) gates several apps at once for a templated open: apps already agreed (or that ask
  // nothing) resolve silently; the rest are folded into ONE "Agree to all" card instead of a stack of
  // them. The records written are byte-identical to gate()'s — same term, same grants, same Law-L5
  // verification — so governance is UNCHANGED, only the surface is consolidated. Returns appId → caps.
  async function gateAll(defs) {
    const out = {};
    try {
      const term = await standingAgreement();
      const pending = [];
      for (const def of (defs || [])) {
        const declared = (def && def.capabilities) || {};
        const appId = idOf(def);
        if (capRefs(declared).length === 0) { out[appId] = {}; continue; }     // asks nothing → bare sandbox
        let record = await agreementFor(appId);
        if (record && record.credentialSubject.term === term.id) {              // already agreed under this term → silent
          out[appId] = (await verifyRecord(record)) ? effective(declared, record.credentialSubject.grants) : {};
          continue;
        }
        const cls = classify(term, declared, appId, { heldPurposes: heldPurposesFor(appId) });
        if (!cls.prompt.length && !cls.deny.length) {                           // only the basics → record + grant silently
          record = await makeRecord([...cls.auto], appId, term.id);
          const m = loadRecords(); m[appId] = record; saveRecords(m);
          out[appId] = effective(declared, record.credentialSubject.grants);
        } else {
          pending.push({ def, appId, declared, cls });                          // needs a human decision → batch it
        }
      }
      if (pending.length) {
        const decision = await showConsentAll(pending, term);
        for (const p of pending) {
          const approved = (decision && decision.approvedByApp && decision.approvedByApp[p.appId]) || [];
          const record = await makeRecord([...p.cls.auto, ...approved], p.appId, term.id);
          const m = loadRecords(); m[p.appId] = record; saveRecords(m);
          out[p.appId] = (await verifyRecord(record)) ? effective(p.declared, record.credentialSubject.grants) : {};
        }
      }
    } catch (e) { console.warn("HoloTerms.gateAll", e); }
    return out;
  }

  // ── consent dialog (first party proposes) ────────────────────────────────────────────────────
  const PERM_LABEL = { "display-capture": "see your screen", camera: "use your camera", microphone: "use your microphone",
    geolocation: "read your location", "clipboard-read": "read your clipboard", "clipboard-write": "write to your clipboard",
    midi: "use MIDI devices", usb: "use USB devices", serial: "use serial devices", bluetooth: "use Bluetooth", "xr-spatial-tracking": "track you in XR" };
  const refLabel = (r) => r.type === "permission" ? (PERM_LABEL[r.value] || r.value)
    : r.type === "channel" ? ("share over “" + r.value + "”") : r.type === "storage" ? ("read another app’s data (" + r.value + ")")
    : r.type === "purpose" ? ("contribute your data for " + r.value.replace(/-/g, " ")) : r.value;

  function showConsent(def, term, cls) {
    return new Promise((resolve) => {
      ensureCss();
      const back = el("div", "holo-terms-back on");
      const card = el("div", "holo-terms-card");
      const name = (def && def.name) || idOf(def);
      const prompts = cls.prompt.map((r, i) => `<label class="ht-row"><input type="checkbox" data-i="${i}" ${r.type === "permission" ? "" : ""}><span class="ht-rl"><b>${esc(name)}</b> wants to ${esc(refLabel(r))}</span></label>`).join("");
      const denies = cls.deny.length ? `<div class="ht-deny"><div class="ht-dh">Refused by your terms</div>${cls.deny.map((r) => `<div class="ht-drow">${esc(name)} asked to ${esc(refLabel(r))} — your <b>${esc(term.code)}</b> terms don’t allow this.${r.type === "purpose" ? " Add a data-contribution agreement in Holo Terms to permit it." : ""}</div>`).join("")}</div>` : "";
      card.innerHTML = `
        <div class="ht-hd"><span class="ht-shield">${SHIELD}</span><div><div class="ht-t">Your terms for ${esc(name)}</div>
          <div class="ht-sub">You propose <b title="${esc(term["schema:description"] || "")}">${esc(term.code)} · ${esc(term["schema:name"] || "")}</b>. ${esc(name)} is the second party.</div></div></div>
        <div class="ht-bd">
          <p class="ht-lead">Granted automatically: its own storage and basic display. It additionally requests:</p>
          ${prompts || '<p class="ht-none">nothing beyond the basics.</p>'}
          ${denies}
        </div>
        <div class="ht-ft">
          <a class="ht-link" href="${TERMS_APP_URL}" target="_top">Holo Terms ↗</a>
          <span class="ht-sp"></span>
          <button class="ht-btn" data-act="deny">Deny extras</button>
          <button class="ht-btn cta" data-act="allow">Agree</button>
        </div>`;
      back.appendChild(card); document.body.appendChild(back);
      const close = (approved) => { back.remove(); resolve({ approved }); };
      card.querySelector('[data-act="deny"]').onclick = () => close([]);
      card.querySelector('[data-act="allow"]').onclick = () => {
        const approved = [...card.querySelectorAll(".ht-row input:checked")].map((c) => cls.prompt[+c.dataset.i]);
        close(approved);
      };
      back.addEventListener("click", (e) => { if (e.target === back) close([]); });
    });
  }

  // showConsentAll(pending, term) — ONE card covering every app in a holospace that needs a decision.
  // Each app gets its own labelled section (name + the extras it requests as checkboxes + any refusals);
  // "Agree to all" approves every checked row across all apps in a single action. Returns the approvals
  // grouped by appId, so gateAll writes one record per app — identical to agreeing to each individually.
  function showConsentAll(pending, term) {
    return new Promise((resolve) => {
      ensureCss();
      const back = el("div", "holo-terms-back on");
      const card = el("div", "holo-terms-card");
      const n = pending.length;
      const sections = pending.map((p, pi) => {
        const name = (p.def && p.def.name) || p.appId;
        const prompts = p.cls.prompt.map((r, i) => `<label class="ht-row"><input type="checkbox" data-p="${pi}" data-i="${i}" checked><span class="ht-rl"><b>${esc(name)}</b> wants to ${esc(refLabel(r))}</span></label>`).join("");
        const denies = p.cls.deny.length ? `<div class="ht-deny"><div class="ht-dh">Refused by your terms</div>${p.cls.deny.map((r) => `<div class="ht-drow">${esc(name)} asked to ${esc(refLabel(r))} — your <b>${esc(term.code)}</b> terms don’t allow this.</div>`).join("")}</div>` : "";
        return `<div class="ht-appsec"><div class="ht-appname">${esc(name)}</div>${prompts || '<p class="ht-none">nothing beyond the basics.</p>'}${denies}</div>`;
      }).join("");
      card.innerHTML = `
        <div class="ht-hd"><span class="ht-shield">${SHIELD}</span><div><div class="ht-t">Your terms for this holospace</div>
          <div class="ht-sub">You propose <b title="${esc(term["schema:description"] || "")}">${esc(term.code)} · ${esc(term["schema:name"] || "")}</b> for ${n} app${n === 1 ? "" : "s"} opening together. Each is the second party.</div></div></div>
        <div class="ht-bd">
          <p class="ht-lead">Granted automatically: each app’s own storage and basic display. They additionally request:</p>
          ${sections}
        </div>
        <div class="ht-ft">
          <a class="ht-link" href="${TERMS_APP_URL}" target="_top">Holo Terms ↗</a>
          <span class="ht-sp"></span>
          <button class="ht-btn" data-act="deny">Deny extras</button>
          <button class="ht-btn cta" data-act="allow">Agree to all</button>
        </div>`;
      back.appendChild(card); document.body.appendChild(back);
      const close = (approvedByApp) => { back.remove(); resolve({ approvedByApp }); };
      const denyAll = () => { const by = {}; pending.forEach((p) => { by[p.appId] = []; }); close(by); };
      card.querySelector('[data-act="deny"]').onclick = denyAll;
      card.querySelector('[data-act="allow"]').onclick = () => {
        const by = {}; pending.forEach((p) => { by[p.appId] = []; });
        card.querySelectorAll(".ht-row input:checked").forEach((c) => { const p = pending[+c.dataset.p]; if (p) by[p.appId].push(p.cls.prompt[+c.dataset.i]); });
        close(by);
      };
      back.addEventListener("click", (e) => { if (e.target === back) denyAll(); });
    });
  }

  // ── the per-frame badge (shield: active term + this app's grants) ────────────────────────────
  const SHIELD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4" stroke="#7ee787"/></svg>';
  let _cssAdded = false;
  function ensureCss() {
    if (_cssAdded || !isBrowser) return; _cssAdded = true;
    const s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s);
  }
  async function renderBadge() {
    // The standing-terms shield is removed from the shell chrome — terms still apply by default and
    // are managed via the Terms app / the per-app panel (togglePanel). Clear any badge already mounted.
    if (!isBrowser) return;
    const ex = document.getElementById("holo-terms-btn"); if (ex) ex.remove();
  }
  // The HOST (holo-gov.js) sets the focused app so this shield reflects what THAT app was granted, not
  // the shell. Null in a bare app frame ⇒ fall back to the page's own identity (the standalone badge).
  let _activeApp = null;
  function setActiveApp(a) { _activeApp = a || null; renderBadge(); }
  let _panel = null;
  async function togglePanel() {
    if (_panel) { _panel.remove(); _panel = null; return; }
    ensureCss();
    const r = await roster().catch(() => null);
    const term = (r && (codeOf(r, standingCode()) || codeOf(r, r.default))) || null;
    const appId = _activeApp ? idOf(_activeApp)
      : idOf({ id: (document.querySelector('meta[name="holo-app-id"]') || {}).content, name: document.title });
    const rec = loadRecords()[appId];
    const grants = rec ? rec.credentialSubject.grants : [];
    const grantText = grants.length ? grants.map((g) => refLabel(g)).map(esc).join(", ") : "its own storage only";
    _panel = el("div", "holo-terms-panel on");
    _panel.innerHTML = `
      <div class="ht-ph"><span class="ht-shield">${SHIELD}</span><div><div class="ht-pt">Holo Terms</div>
        <div class="ht-psub">first party: you</div></div></div>
      <div class="ht-pb">
        <div class="ht-k">Your standing term</div>
        <div class="ht-v"><b>${esc(term ? term.code : "SD-BASE")}</b> · ${esc(term ? term["schema:name"] : "")}</div>
        <div class="ht-desc">${esc(term ? term["schema:description"] : "")}</div>
        <div class="ht-k" style="margin-top:9px">This app is granted</div>
        <div class="ht-v">${grantText}</div>
      </div>
      <div class="ht-pf"><a class="ht-link" href="${TERMS_APP_URL}" target="_top">Manage all terms ↗</a><span class="ht-sp"></span>${rec ? '<button class="ht-btn" id="ht-revoke">Revoke</button>' : ""}</div>`;
    document.body.appendChild(_panel);
    const rv = _panel.querySelector("#ht-revoke"); if (rv) rv.onclick = async () => { await revoke(appId); togglePanel(); };
    const off = (e) => { if (_panel && !_panel.contains(e.target) && e.target.id !== "holo-terms-btn" && !e.target.closest("#holo-terms-btn")) { _panel.remove(); _panel = null; document.removeEventListener("click", off, true); } };
    setTimeout(() => document.addEventListener("click", off, true), 0);
  }

  const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const CSS = `
  #holo-terms-btn{position:fixed;left:10px;bottom:10px;z-index:2147482300;display:inline-flex;align-items:center;gap:6px;
    height:30px;padding:0 10px 0 8px;border-radius:999px;border:1px solid #2b3440;background:#0d1117e6;color:#9fb0bd;
    cursor:pointer;backdrop-filter:blur(6px);box-shadow:0 4px 14px rgba(0,0,0,.4);font:600 var(--holo-text-sm, 1rem) ui-monospace,monospace}
  #holo-terms-btn:hover{color:#e6edf3;border-color:#3a4452}
  #holo-terms-btn svg{width:16px;height:16px;flex:0 0 auto}
  #holo-terms-btn .ht-code{letter-spacing:.03em}
  .holo-terms-panel{position:fixed;left:10px;bottom:48px;z-index:2147482301;width:min(320px,92vw);
    background:#0d1117;color:#e6edf3;border:1px solid #28323d;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.55);
    font:var(--holo-text-sm, 1rem)/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
  .holo-terms-panel .ht-ph,.holo-terms-card .ht-hd{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #1b2128;background:#11161d}
  .ht-shield{color:#b07cc6;display:inline-flex}.ht-shield svg{width:22px;height:22px}
  .ht-pt,.ht-t{font-weight:700}.ht-psub,.ht-sub{color:#8b949e;font-size:var(--holo-text-sm,1rem)}
  .holo-terms-panel .ht-pb{padding:12px 14px}
  .ht-k{color:#8b949e;font-size:var(--holo-text-sm,1rem);text-transform:uppercase;letter-spacing:.06em}
  .ht-v{margin:2px 0 2px}.ht-desc{color:#8b949e;font-size:var(--holo-text-sm,1rem)}
  .holo-terms-panel .ht-pf,.holo-terms-card .ht-ft{display:flex;align-items:center;gap:8px;padding:10px 14px;border-top:1px solid #1b2128}
  .ht-link{color:#79c0ff;text-decoration:none;font-size:var(--holo-text-sm,1rem)}.ht-link:hover{text-decoration:underline}.ht-sp{flex:1}
  .ht-btn{font:var(--holo-text-sm, 1rem) ui-sans-serif;min-height:34px;padding:0 13px;border-radius:8px;border:1px solid #28323d;background:#161b22;color:#c9d1d9;cursor:pointer}
  .ht-btn:hover{border-color:#3a4452;color:#fff}.ht-btn.cta{color:#04121f;background:#2dd4bf;border-color:#2dd4bf;font-weight:600}
  .holo-terms-back{position:fixed;inset:0;z-index:2147483400;background:#04070caa;backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:18px}
  .holo-terms-card{width:min(440px,96vw);background:#0d1117;color:#e6edf3;border:1px solid #28323d;border-radius:14px;
    box-shadow:0 24px 70px rgba(0,0,0,.6);font:var(--holo-text-sm, 1rem)/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
  .holo-terms-card .ht-bd{padding:12px 16px;max-height:50vh;overflow:auto}
  .ht-lead{margin:.2rem 0 .7rem;color:#c9d1d9}.ht-none{color:#8b949e}
  .ht-row{display:flex;align-items:flex-start;gap:9px;padding:8px 10px;margin:5px 0;border:1px solid #222b35;border-radius:9px;cursor:pointer}
  .ht-row:hover{border-color:#3a4452}.ht-row input{margin-top:3px;width:16px;height:16px;accent-color:#2dd4bf}
  .ht-rl{flex:1}
  .ht-deny{margin-top:10px;border-top:1px dashed #2a323c;padding-top:9px}
  .ht-dh{color:#f0a05a;font-size:var(--holo-text-sm,1rem);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
  .ht-drow{color:#9aa6b2;font-size:var(--holo-text-sm,1rem);margin:3px 0}
  .ht-appsec{padding:9px 0;border-top:1px solid #1c2530}.ht-appsec:first-of-type{border-top:0}
  .ht-appname{font-weight:600;color:#e6edf3;margin:0 0 5px;font-size:var(--holo-text-sm,1rem)}
  @media (max-width:520px){#holo-terms-btn{left:8px;bottom:8px}.holo-terms-panel{left:8px;right:8px;width:auto}}
  @media print{#holo-terms-btn,.holo-terms-panel,.holo-terms-back{display:none!important}}`;

  // ── public API ────────────────────────────────────────────────────────────────────────────────
  W.HoloTerms = {
    gate, gateAll, effective, classify, capRefs, setActiveApp,
    roster, standingTerm: standingCode, setStandingTerm, standingAgreement,
    agreementFor, records: loadRecords, revoke, firstParty: async () => (await signer()).did,
    makeRecord, verifyRecord, openControlCenter: () => { try { (W.top || W).location.href = TERMS_APP_URL; } catch { location.href = TERMS_APP_URL; } },
  };

  if (isBrowser) (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", () => renderBadge()) : renderBadge());
})();
