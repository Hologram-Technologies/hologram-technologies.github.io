// holo-api-core.mjs — the UNIFIED REST API every holospace exposes at /~<app>/api. The egress/ingress
// twin of the MCP layer: where MCP is JSON-RPC for agents, this is a resource-oriented HTTP surface for
// the open web — humans, external API-gated apps, and agents alike — over the SAME κ-store and registry
// (no parallel infrastructure, Law L4). Every byte that crosses it is a SELF-VERIFYING UOR object: the
// consumer re-derives its κ (Law L5), so trust comes with the data, not from the server.
//
//   GET  /              → the service descriptor: OpenAPI 3.1 ⊕ JSON-LD (the REST twin of holo_describe)
//   GET  /o/<κ>         → EGRESS one κ-object (resolve + verify). 402 if gated.
//   POST /o             → INGRESS one object → its κ (the server re-derives it, Law L2). 201 + Location.
//   GET  /stream        → EGRESS a STREAM of κ-objects (SSE or NDJSON). 402 if gated — pay per κ-stream.
//   POST /stream        → INGRESS an NDJSON stream of objects → their κ's.
//   GET  /price         → the price list (token · fiat) for the gated routes.
//   POST /settle        → present a payment proof → a self-verifying ENTITLEMENT (unlocks the gate).
//
// ISOMORPHIC: imports only the browser-safe holo-object, so the SAME bytes serve this API in Node, a
// Service Worker (serverless), and any edge. Storage/resolve/forge/clock are INJECTED via ctx.
//
// MONETISATION: HTTP 402 Payment Required (the open-web paywall) + a self-verifying entitlement. The
// token rail is substrate-native (a content-addressed voucher you re-derive); fiat is a pluggable
// adapter. Pay-per-κ-object-stream → seamless monetisation of any holo-native app.

import { makeObject, verify as verifyObject, jcs, address } from "../holo-object.mjs";

export const API_VERSION = "1.0.0";
// PLASMA — the stablecoin-native settlement rail (ADR-0068): a gas-abstracted EVM chain whose default
// unit is USD₮0 (a dollar stablecoin, 6 decimals). The values mirror the sealed chain descriptor
// (eip155:9745); any token contract is accepted, USD₮0 is the default. This is how a κ-stream is paid
// for in real dollars (or any token) — settled by Holo Wallet, never by this server.
export const PLASMA = { rail: "plasma", chain: "plasma", chainId: 9745, token: "0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb", decimals: 6, currency: "USD₮0" };
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => { const a = new Uint8Array(String(s).length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(s.substr(i * 2, 2), 16); return a; };
const utf8 = (s) => new TextEncoder().encode(s);
const json = (obj, status = 200, extra = {}) => ({ status, headers: { "content-type": "application/ld+json", "access-control-allow-origin": "*", ...extra }, body: typeof obj === "string" ? obj : jcs(obj) });
const err = (status, code, msg, extra = {}) => json({ "@type": "schema:Error", ...extra, error: code, message: msg }, status);   // explicit code/msg win over a spread challenge

// ── the standardized service descriptor: OpenAPI 3.1 paths ⊕ a JSON-LD service object (hypermedia) ──
export function apiDescriptor(appId, registry, price) {
  const base = `/~${appId}/api`;
  return {
    "@context": ["https://schema.org", { holo: "https://hologram.os/ns#" }],
    "@type": ["schema:WebAPI", "holo:KappaStreamApi"],
    "schema:name": (registry && registry.server && registry.server.title) || appId,
    "schema:identifier": (registry && registry.server && registry.server.name) || ("hologram-os/" + appId),
    "holo:apiVersion": API_VERSION,
    "holo:objectModel": "did:holo (content-addressed, self-verifying — re-derive to verify, Law L5)",
    "holo:price": price || null,
    "schema:potentialAction": [
      { "@type": "schema:ConsumeAction", "holo:rel": "egress-object", "schema:target": `${base}/o/{kappa}`, method: "GET", gated: !!price },
      { "@type": "schema:ConsumeAction", "holo:rel": "egress-stream", "schema:target": `${base}/stream`, method: "GET", gated: !!price, formats: ["text/event-stream", "application/x-ndjson"] },
      { "@type": "schema:CreateAction", "holo:rel": "ingress-object", "schema:target": `${base}/o`, method: "POST" },
      { "@type": "schema:CreateAction", "holo:rel": "ingress-stream", "schema:target": `${base}/stream`, method: "POST", accepts: "application/x-ndjson" },
    ],
    openapi: {
      openapi: "3.1.0",
      info: { title: `${appId} κ-stream API`, version: API_VERSION, description: "Unified κ-addressed object REST API — self-verifying UOR objects (Law L5)." },
      paths: {
        [`${base}/o/{kappa}`]: { get: { summary: "Egress one κ-object", parameters: [{ name: "kappa", in: "path", required: true, schema: { type: "string" } }], responses: { 200: { description: "a self-verifying UOR object" }, 402: { description: "payment required" }, 404: {} } } },
        [`${base}/o`]: { post: { summary: "Ingress one object → its κ", responses: { 201: { description: "created; Location: /o/<κ>" } } } },
        [`${base}/stream`]: { get: { summary: "Egress a κ-object stream (SSE/NDJSON)", responses: { 200: {}, 402: {} } }, post: { summary: "Ingress an NDJSON object stream", responses: { 200: {} } } },
        [`${base}/price`]: { get: { summary: "Price list", responses: { 200: {} } } },
        [`${base}/settle`]: { post: { summary: "Settle payment → entitlement", responses: { 200: {} } } },
      },
    },
  };
}

// ── HTTP 402 monetisation — a self-verifying ENTITLEMENT unlocks a gated route ──
// challenge(appId, price, resource) → the 402 body an external app/agent acts on.
export const challenge = (appId, price, resource) => ({
  "@type": "holo:PaymentRequired", error: "payment_required",
  message: "pay per κ-object stream to consume this resource",
  app: appId, resource: resource || "*", price,
  settle: `/~${appId}/api/settle`, accepts: ["plasma-stablecoin", "holo-permit", "fiat-intent"],
  // PAY block — the exact stablecoin/token transfer to make through Holo Wallet on Plasma (gas-abstracted).
  // The payee address is the app's declared payout (price.payee); the amount is price.amount in minor units.
  ...(price && price.payee ? { pay: { rail: "plasma", chain: PLASMA.chain, chainId: PLASMA.chainId, token: price.token || PLASMA.token, decimals: price.decimals ?? PLASMA.decimals, currency: price.token ? (price.currency || "token") : PLASMA.currency, to: price.payee, amountMinor: Number(price.amount || 0), resource: resource || "*" } } : {}),
  // SIGN a κ-bound permit: { "@type":"holo:PaymentPermit", app, resource, amount, unit, nonce, deadline, payer(ed25519 pubkey hex), sig(ed25519 over jcs of the permit minus sig) }.
  permit: { "@type": "holo:PaymentPermit", app: appId, resource: resource || "*", amount: price && price.amount, unit: price && price.unit, nonce: "<unique>", deadline: "<ms-epoch>", payer: "<ed25519-pubkey-hex>", sig: "<ed25519-hex>" },
  present: "Authorization: Holo <entitlement>   (single-use: present the signed permit directly, or POST it to /settle for a time-boxed entitlement)",
});
// ── (a) κ-BOUND SIGNED PERMIT — the real token rail. The payer SIGNS an authorization binding the
// app + resource κ + amount + a fresh nonce + a deadline; the server VERIFIES the signature LOCALLY
// (ed25519, no node, no chain) — the same verify-by-re-derivation law applied to money. No trusted
// "amount" field: the bytes are signed by the payer's key, so they can't be forged or inflated.
const permitMessage = (permit) => { const { sig, ...rest } = permit || {}; return utf8(jcs(rest)); };
// defaultVerifyPermitSig(permit) → bool. ed25519 over jcs(permit minus sig), payer = pubkey hex.
// Lazy-imports the vendored isomorphic crypto (node-free; works in the browser + Service Worker).
export async function defaultVerifyPermitSig(permit) {
  try {
    if (!permit || typeof permit.payer !== "string" || typeof permit.sig !== "string") return false;
    const { ed25519 } = await import("../wdk-crypto/wdk-crypto.bundle.mjs");
    return ed25519.verify(unhex(permit.sig), permitMessage(permit), unhex(permit.payer));
  } catch { return false; }
}
// verifyPermit(permit, { app, resource, price, now, verifySig }) → bool. Structure + κ-binding +
// amount ≥ price + deadline + a valid payer SIGNATURE. The signature verifier is pluggable (ctx) so an
// EVM/secp256k1 (EIP-712) rail can be added without touching the core; the default is ed25519.
export async function verifyPermit(permit, { app, resource, price, now = 0, verifySig = defaultVerifyPermitSig } = {}) {
  if (!permit || typeof permit !== "object") return false;
  const t = permit["@type"] || permit.type || "";
  if (!(t === "holo:PaymentPermit" || (Array.isArray(t) ? t.includes("holo:PaymentPermit") : false))) return false;
  if (permit.app && app && permit.app !== app && permit.app !== "*") return false;     // κ-bound to the app
  if (permit.resource && permit.resource !== "*" && resource && permit.resource !== resource) return false;   // and the resource κ
  if (price && Number(permit.amount || 0) < Number(price.amount || 0)) return false;   // amount ≥ price
  if (permit.deadline && now && Number(permit.deadline) < Number(now)) return false;   // not expired
  return await verifySig(permit);                                                       // a valid payer signature
}

// verifyPlasma(proof, { resource, price, settlement }) → bool. The STABLECOIN/TOKEN rail: a Plasma
// transfer (settled by Holo Wallet, never this server) whose proof binds the chain + token + payee +
// amount + the resource κ it pays for. On-chain finality is a pluggable confirm (settlement.plasma —
// an RPC adapter); without one we accept the wallet-attested transfer (honest: the wallet is the
// default-deny human-approval authority, and the tx is single-use by its hash in the spend ledger).
export async function verifyPlasma(proof, { resource, price, settlement = {} } = {}) {
  if (!proof || typeof proof !== "object" || typeof proof.txHash !== "string") return false;
  const t = proof["@type"] || proof.type || "";
  if (!(t === "holo:PlasmaSettlement" || (Array.isArray(t) && t.includes("holo:PlasmaSettlement")))) return false;
  if (Number(proof.chainId) !== PLASMA.chainId) return false;                          // the Plasma chain
  if (price) {
    if (price.payee && proof.to !== price.payee) return false;                         // paid the app's payout address
    if ((price.token || PLASMA.token) !== proof.token) return false;                   // the agreed token (USD₮0 default)
    if (Number(proof.amountMinor || 0) < Number(price.amount || 0)) return false;      // amount ≥ price
  }
  if (proof.resource && proof.resource !== "*" && resource && proof.resource !== resource) return false;   // κ-bound
  if (typeof settlement.plasma === "function") return !!(await settlement.plasma(proof));   // optional on-chain confirm
  return true;
}

// ── (b) CONTENT-ADDRESSED SPEND LEDGER — single-use replay protection without a trusted server. Each
// consumed permit is recorded as a self-verifying holo:Spend object that CHAINS to the previous head
// (prev → tamper-evident append-only log, like a Holo Own title chain / Holo Prov). Spending the same
// permit twice is refused (already_spent). The key is payer:nonce (a permit's unforgeable identity).
// Pluggable: the default lives in the injected store; a durable κ-store / relay / Holo Settle can back it.
export function makeSpendLedger(store) {
  const seen = (store && store.__spends) || new Set();
  if (store && !store.__spends) try { store.__spends = seen; } catch {}
  let head = (store && store.__spendHead) || null, seq = (store && store.__spendSeq) || 0;
  const keyOf = (p) => p.txHash ? "plasma:" + p.txHash : `${p.payer}:${p.nonce}`;   // a Plasma tx OR a signed permit
  return {
    spent: (proof) => seen.has(keyOf(proof)),
    async record(proof, { resource } = {}) {
      const k = keyOf(proof);
      if (seen.has(k)) return { ok: false, error: "already_spent" };
      const entry = makeObject(new Map(), { type: ["holo:Spend", "prov:Entity"], "schema:name": "Holo κ-stream spend",
        app: proof.app, resource: resource || proof.resource, amount: proof.amount ?? proof.amountMinor, payer: proof.payer, ref: k,
        prev: head, seq });                                              // chain → tamper-evident append-only ledger
      seen.add(k); head = entry.id; seq += 1;
      if (store) { try { store.__spendHead = head; store.__spendSeq = seq; if (store.set) store.set(entry.id, entry); } catch {} }
      return { ok: true, entry, head };
    },
    head: () => head,
  };
}

// verifyEntitlement(ent, { app, resource, now }) → bool. PURE (isomorphic): the entitlement is a
// self-verifying UOR object (Law L5); we re-derive its id, then check scope + resource + expiry.
export function verifyEntitlement(ent, { app, resource, now = 0 } = {}) {
  if (!ent || typeof ent !== "object") return false;
  if (!verifyObject(ent)) return false;                                   // Law L5 — the entitlement re-derives to its κ
  if (ent.app && app && ent.app !== app && ent.app !== "*") return false;
  if (ent.resource && ent.resource !== "*" && resource && ent.resource !== resource) return false;
  if (ent.expires && now && Number(ent.expires) < Number(now)) return false;
  return true;
}
// mintEntitlement(store, { app, scope, resource, price, payment, issued, ttl, settlement, ledger, verifySig })
// → a self-verifying time-boxed entitlement, paid for by a SIGNED κ-bound permit (verified locally) that
// is CONSUMED single-use in the spend ledger; or by a pluggable fiat adapter. No trusted-amount voucher.
export async function mintEntitlement(store, { app, scope = "*", resource = "*", price, payment = {}, issued = 0, ttl = 3600000, settlement = {}, ledger, verifySig } = {}) {
  let paid = null;
  const led = ledger || makeSpendLedger(store);
  if (payment.plasma) {                                                   // REAL stablecoin/token rail (Plasma, via Holo Wallet)
    if (!(await verifyPlasma(payment.plasma, { resource, price, settlement }))) return { ok: false, error: "plasma_unverified" };
    if (led.spent(payment.plasma)) return { ok: false, error: "already_spent" };   // a tx pays once
    const rec = await led.record(payment.plasma, { resource });
    if (!rec.ok) return { ok: false, error: rec.error };
    paid = { rail: "plasma", proof: payment.plasma.txHash, amount: Number(payment.plasma.amountMinor || 0), currency: payment.plasma.currency || PLASMA.currency, payer: payment.plasma.payer };
  } else if (payment.permit) {                                            // substrate-native signed token rail (gasless)
    if (!(await verifyPermit(payment.permit, { app, resource: payment.permit.resource, price, now: issued, verifySig }))) return { ok: false, error: "permit_invalid" };
    if (led.spent(payment.permit)) return { ok: false, error: "already_spent" };   // single-use (replay)
    const rec = await led.record(payment.permit, { resource });
    if (!rec.ok) return { ok: false, error: rec.error };
    paid = { rail: "token", proof: rec.entry.id, amount: Number(payment.permit.amount || 0), payer: payment.permit.payer };
  } else if (payment.rail === "fiat" && typeof settlement.fiat === "function") {   // pluggable fiat adapter
    const r = await settlement.fiat({ app, price, payment }); if (r && r.ok) paid = { rail: "fiat", proof: r.receipt || "fiat", amount: r.amount };
  }
  if (!paid) return { ok: false, error: "payment_not_verified" };
  const ent = makeObject(store || new Map(), { type: ["holo:Entitlement", "prov:Entity"],
    "schema:name": "Holo κ-stream entitlement", app, scope, resource,
    price: price || null, paid, issued, expires: issued + ttl });
  return { ok: true, entitlement: ent };
}

// ── the router. reqLike: { method, path (relative to /api, e.g. "/o/did:holo:…"), query, headers,
// body (parsed) }. ctx: { appId, registry, resolve(uri)→obj, store, app (forge), price, settlement,
// stream(query)→async iterable of objects, now }. Returns { status, headers, body } OR, for streams,
// { status, headers, iterator: asyncGenerator<object> } so the transport renders SSE or NDJSON.
export async function handleApi(reqLike, ctx) {
  const { method = "GET", headers = {} } = reqLike;
  const path = (reqLike.path || "/").replace(/\/+$/, "") || "/";
  const appId = ctx.appId || "app";
  const price = ctx.price || null;

  if (method === "OPTIONS") return { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,authorization,x-payment,accept" } };
  if (path === "/" ) return json(apiDescriptor(appId, ctx.registry, price));
  if (path === "/price") return json({ "@type": "holo:PriceList", app: appId, price, accepts: ["holo-voucher", "x402-token", "fiat-intent"] });

  const ledger = ctx.ledger || makeSpendLedger(ctx.store);                // the content-addressed spend ledger (shared by gate + settle)
  // gate(resource) → null if allowed, else a 402. Accepts EITHER a time-boxed entitlement (re-presented)
  // OR a single-use signed κ-bound permit (verified locally + CONSUMED once in the spend ledger). The
  // permit path is literal pay-per-κ-object-stream; a replayed permit is refused (already_spent).
  const gate = async (resource) => {
    if (!price) return null;                                              // ungated app
    let proof = null;
    const auth = headers.authorization || headers.Authorization || "";
    const xp = headers["x-payment"] || headers["X-Payment"] || "";
    const raw = auth.startsWith("Holo ") ? auth.slice(5) : (xp || "");
    if (raw) { try { proof = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { proof = null; } }
    const t = proof && (proof["@type"] || proof.type);
    const isType = (n) => t === n || (Array.isArray(t) && t.includes(n));
    if (isType("holo:PlasmaSettlement")) {                               // real stablecoin/token tx → consume once
      if (!(await verifyPlasma(proof, { resource, price, settlement: ctx.settlement || {} }))) return err(402, "payment_required", "invalid Plasma settlement", challenge(appId, price, resource));
      if (ledger.spent(proof)) return err(402, "already_spent", "this payment was already used (replay)", challenge(appId, price, resource));
      await ledger.record(proof, { resource });
      return null;
    }
    if (isType("holo:PaymentPermit")) {                                  // single-use signed permit → consume once
      if (!(await verifyPermit(proof, { app: appId, resource, price, now: ctx.now || 0, verifySig: ctx.verifyPermitSig }))) return err(402, "payment_required", "invalid permit", challenge(appId, price, resource));
      if (ledger.spent(proof)) return err(402, "already_spent", "permit already spent (replay)", challenge(appId, price, resource));
      await ledger.record(proof, { resource });
      return null;
    }
    return verifyEntitlement(proof, { app: appId, resource, now: ctx.now || 0 }) ? null
      : err(402, "payment_required", "pay per κ-object stream", challenge(appId, price, resource));
  };

  // SETTLE — present a SIGNED permit (or fiat proof), receive a self-verifying entitlement. The permit is
  // verified locally (ed25519) AND consumed single-use in the spend ledger (token rail real; fiat pluggable).
  if (path === "/settle" && method === "POST") {
    const b = reqLike.body || {};
    const r = await mintEntitlement(ctx.store, { app: appId, scope: b.scope || "*", resource: b.resource || "*", price, payment: b.payment || {}, issued: ctx.now || 0, ttl: b.ttl || 3600000, settlement: ctx.settlement || {}, ledger, verifySig: ctx.verifyPermitSig });
    return r.ok ? json({ "@type": "holo:Receipt", ok: true, entitlement: r.entitlement, spendHead: ledger.head(), present: "Authorization: Holo <entitlement>" }) : err(402, r.error || "payment_not_verified", "no valid payment proof", challenge(appId, price));
  }

  // EGRESS one κ-object
  const mo = path.match(/^\/o\/(.+)$/);
  if (mo && method === "GET") {
    const kappa = decodeURIComponent(mo[1]);
    const g = await gate(kappa); if (g) return g;
    const obj = ctx.resolve ? await ctx.resolve(kappa) : (ctx.store ? await resolveFromStore(ctx.store, kappa) : null);
    if (!obj) return err(404, "not_found", "no κ-object: " + kappa);
    return json(obj, 200, { "x-holo-kappa": obj.id || kappa, "x-holo-verify": String(verifyObject(obj)) });
  }
  // INGRESS one object → its κ (the server re-derives the address, Law L2)
  if (path === "/o" && method === "POST") {
    const obj = await ingest(ctx.store, reqLike.body);
    if (!obj) return err(400, "bad_object", "POST /o requires a JSON object body");
    return json({ "@type": "holo:Ingested", id: obj.id, verified: verifyObject(obj) }, 201, { location: `/~${appId}/api/o/${encodeURIComponent(obj.id)}` });
  }
  // EGRESS / INGRESS a stream
  if (path === "/stream") {
    if (method === "GET") {
      const g = await gate("*"); if (g) return g;
      const src = ctx.stream ? ctx.stream(reqLike.query || {}) : defaultStream(ctx);
      return { status: 200, headers: { "access-control-allow-origin": "*" }, iterator: src };   // transport → SSE or NDJSON
    }
    if (method === "POST") {                                             // NDJSON body → seal+store each
      const lines = String(reqLike.body || "").split("\n").map((l) => l.trim()).filter(Boolean);
      const ingested = [];
      for (const l of lines) { try { const o = await ingest(ctx.store, JSON.parse(l)); if (o) ingested.push(o.id); } catch {} }
      return json({ "@type": "holo:IngestedStream", count: ingested.length, ids: ingested }, 200);
    }
  }
  return err(404, "no_route", `${method} ${path} — see GET /~${appId}/api`);
}

// ingest(store, obj) → seal (if no id) + persist by κ; returns the stored self-verifying object.
async function ingest(store, obj) {
  if (!obj || typeof obj !== "object") return null;
  const sealed = (obj.id && verifyObject(obj)) ? obj : makeObject(store || new Map(), { type: obj["@type"] || obj.type || ["schema:CreativeWork", "prov:Entity"], ...stripMeta(obj) });
  if (store && store.put) { try { await store.put(new TextEncoder().encode(jcs(sealed))); } catch {} }
  if (store && store.set) { try { store.set(sealed.id, sealed); } catch {} }
  return sealed;
}
const stripMeta = (o) => { const { id, "@id": _i, type, "@type": _t, ...rest } = o; return rest; };
async function resolveFromStore(store, kappa) {
  if (store.get) { try { const b = await store.get(kappa); if (b) { const o = typeof b === "string" ? JSON.parse(b) : (b instanceof Uint8Array ? JSON.parse(new TextDecoder().decode(b)) : b); return o; } } catch {} }
  if (store instanceof Map) return store.get(kappa) || null;
  return null;
}
async function* defaultStream(ctx) {                                      // default egress: the app's published resources, each self-verifying
  for (const r of (ctx.registry && ctx.registry.resources) || []) {
    const o = ctx.resolve ? await ctx.resolve(r.uri) : null;
    if (o) yield o;
  }
}

// makeApiServer({ appId, registry, resolve, store, app, price, settlement, stream, now }) → { handle }.
export function makeApiServer(opts = {}) {
  return { opts, handle: (reqLike) => handleApi(reqLike, opts), descriptor: () => apiDescriptor(opts.appId, opts.registry, opts.price) };
}

// renderNdjson(iterator) / renderSse(iterator) — transport helpers to turn the κ-object iterator into
// an HTTP body string (Node/dev) or to feed a stream. Each line/event is one self-verifying object.
export async function collectNdjson(iterator) { let out = ""; for await (const o of iterator) out += jcs(o) + "\n"; return out; }
export async function collectSse(iterator) { let out = ""; for await (const o of iterator) out += `data: ${jcs(o)}\n\n`; return out; }
