// holo-q-authz.mjs — ADR-0114 S2: the model-acquisition AUTHORIZATION gate.
//
// L5 re-derivation proves INTEGRITY (the exact bytes), never PROVENANCE (whether those bytes should run).
// A correct-but-hostile model hashes to its κ and passes every existing gate. This is the missing ADMISSION
// step: Q may auto-acquire a HuggingFace model only if it is on a SIGNED, κ-addressed skill→model manifest
// (M-of-N, reusing the holo-anchor authority), within hard size/license bounds — or, off-manifest, only
// behind the fail-closed conscience + an explicit one-time host-asserted consent.
//
// Pure + isomorphic; ALL crypto/IO injected (the house idiom). Sits BETWEEN pickSpecialist (pure discovery,
// ADR-0084) and bindSpecialist — never mutating either. The production signature primitive is holo-anchor's
// secp256k1.verify (already witnessed, ADR-0111); the canonicalization is RFC-8785 JCS.
//
// Relates: ADR-0114 (the decision) · ADR-0096 (Function→Model→κ) · ADR-0033 (conscience) · ADR-0111 (anchor).

const UNITS = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

// "1.5B" → 1.5e9. Unknown/absent → Infinity (so a missing cap never silently authorizes).
export function numParams(s) {
  if (s == null) return Infinity;
  if (typeof s === "number") return s;
  const m = String(s).trim().match(/^([\d.]+)\s*([KMBT])?/i);
  if (!m) return Infinity;
  return parseFloat(m[1]) * (UNITS[(m[2] || "").toUpperCase()] || 1);
}

// Minimal RFC-8785-style canonical JSON: sorted object keys, no insignificant whitespace.
export function jcs(v) {
  if (v === null || typeof v === "number" || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
}

function hexToBytes(h) {
  h = String(h); const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

// verifyManifest(m, { sha256hex, verify, fromHex }) -> { ok, reason? }
//   sha256hex(str)->hex (async ok); verify(sigBytes, msgBytes, pubKeyBytes)->bool (prod: secp256k1.verify).
// commitment = sha256(JCS(manifest \ {signatures, commitment, id})) — so swapping ANY authority key, policy,
// or allow-entry changes the commitment and breaks every signature. Threshold M-of-N over the pinned key set.
export async function verifyManifest(m, { sha256hex, verify, fromHex = hexToBytes } = {}) {
  if (!m || !m.authority || !Array.isArray(m.authority.keys) || !m.authority.keys.length)
    return { ok: false, reason: "no authority keys" };
  if (!Array.isArray(m.signatures) || !m.signatures.length)
    return { ok: false, reason: "no signatures" };
  const body = { ...m }; delete body.signatures; delete body.commitment; delete body.id;
  const commit = await sha256hex(jcs(body));
  if (commit !== m.commitment) return { ok: false, reason: "commitment mismatch" };
  const pinned = new Set(m.authority.keys.map((k) => String(k).toLowerCase()));
  const msg = fromHex(m.commitment), signers = new Set();
  for (const s of m.signatures) {
    const key = String(s.key).toLowerCase();
    if (!pinned.has(key) || signers.has(key)) continue;
    try { if (await verify(fromHex(s.sig), msg, fromHex(key))) signers.add(key); } catch { /* a bad sig never counts */ }
  }
  const need = m.authority.threshold | 0;
  return { ok: signers.size >= need, reason: signers.size >= need ? undefined : `${signers.size}/${need} signers` };
}

// authorize(plan, ctx) -> { accept, tier: "pinned"|"repo"|"consent", reason, model? }
//   plan: the pickSpecialist output { task, specialist:{ id, … } | null, … }  (ADR-0084).
//   ctx : { manifest, conscience, detail(repo)->{params,bytes,license}, consent(req)->bool, crypto, verifyManifest? }
// Order is load-bearing: (a) manifest must VERIFY or fail closed; (b) hard caps/license ALWAYS apply, even to a
// listed model; (c) on the signed allowlist → auto-accept (pinned if a κ is pinned, else weaker repo tier);
// (d) off-manifest → policy decides: deny, or conscience + an explicit one-time consent. Never throws; a refusal
// returns accept:false so the caller falls back to the main model (ADR-0084 "never blocks, never fakes").
export async function authorize(plan, ctx = {}) {
  const { manifest, conscience, detail, consent, crypto = {}, verifyManifest: vm = verifyManifest } = ctx;
  if (!plan || !plan.specialist) return { accept: false, tier: "consent", reason: "no specialist in plan" };

  const mv = await vm(manifest, crypto);
  if (!mv.ok) return { accept: false, tier: "consent", reason: "manifest unverified: " + (mv.reason || "") };

  const sk = (manifest.skills || []).find((s) => s.skill === plan.task);
  const pick = plan.specialist;
  const d = await detail(pick.id); // real params, byte size, license — one HF detail fetch

  const cap = numParams((sk && sk.maxParams) || manifest.policy.maxParams);
  if (d.params > cap) return { accept: false, tier: "consent", reason: `over param cap (${d.params}>${cap})` };
  if (d.bytes > manifest.policy.maxBytes) return { accept: false, tier: "consent", reason: "over byte cap" };
  if (!manifest.policy.licenses.includes(d.license)) return { accept: false, tier: "consent", reason: `license ${d.license} not allowed` };

  const entry = sk && Array.isArray(sk.allow) ? sk.allow.find((a) => a.repo === pick.id) : null;
  if (entry) {
    const tier = entry.kappa ? "pinned" : "repo"; // pinned binds the EXACT bytes downstream (pinGuard)
    return { accept: true, tier, reason: "on signed allowlist", model: { ...pick, ...entry, ...d } };
  }

  if (manifest.policy.offManifest === "deny")
    return { accept: false, tier: "consent", reason: "not on allowlist; policy=deny" };

  const granted = consent ? !!(await consent({ skill: plan.task, repo: pick.id, params: d.params, bytes: d.bytes, license: d.license })) : false;
  // Admission is decided HERE, in plain code (manifest + caps + consent) — so it needs NO constitutional amendment:
  // off-manifest requires an explicit grant. The conscience is then consulted as DEFENSE-IN-DEPTH (PII/egress, or a
  // sealed acquisition red-line IF the constitution is later amended) and fails closed when unsealed.
  if (!granted) return { accept: false, tier: "consent", reason: "off-manifest and consent denied" };
  const verdict = conscience.evaluate({ acquiresUnauthorizedModel: !granted, authorizedAcquire: granted });
  if (verdict.outcome === "block")
    return { accept: false, tier: "consent", reason: "conscience blocked: " + verdict.blocked.join(",") };
  return { accept: true, tier: "consent", reason: "off-manifest, user-consented", model: { ...pick, ...d } };
}

// pinGuard(expectedKappa, gotKappa) — the downstream check when tier==="pinned": the streamed .holo MUST
// re-derive to the manifest-pinned κ, not merely be self-consistent (provenance + integrity, end-to-end).
export function pinGuard(expectedKappa, gotKappa) {
  const norm = (k) => String(k).split(":").pop();
  if (norm(expectedKappa) !== norm(gotKappa)) throw new Error("holo-q-authz: pinned κ mismatch — refused");
  return true;
}
