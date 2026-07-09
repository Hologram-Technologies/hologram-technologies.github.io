// core/kappa.js — the PURE content-addressing + receipt layer (no wasm, no DOM).
//
// Lifted verbatim (behaviour-identical) from the original Holo Q index.html so that
// BOTH the browser app and the pure-Node witness (tools/q-witness.mjs) import the same
// re-derivation logic. Uses only Web Crypto (crypto.subtle), which exists in the browser
// and in Node ≥ 20 as globalThis.crypto.subtle — so a receipt's κ re-derives identically
// in either runtime (Law L5). The PROV-O receipt body and its did:holo are byte-for-byte
// what the original sealed, so existing receipts keep verifying.

const _enc = new TextEncoder();
const _td = new TextDecoder();

// RFC 8785 JCS — canonical JSON, so a receipt's κ re-derives identically anywhere.
export const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
  : JSON.stringify(v);

export async function sha256hex(u8) {
  const d = await crypto.subtle.digest("SHA-256", u8);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const idBytes = (ids) => new Uint8Array(new Uint32Array(ids).buffer);

export const didHolo     = async (obj) => "did:holo:sha256:" + await sha256hex(_enc.encode(jcs(obj)));
export const kappaText   = async (s)   => "did:holo:sha256:" + await sha256hex(_enc.encode(s || ""));
export const kappaTokens = async (a)   => "did:holo:sha256:" + await sha256hex(idBytes(a));   // the answer's tokens, by content
export const kappaBytes  = async (u8)  => "did:holo:sha256:" + await sha256hex(u8);

export const shortK = (k) => {
  const s = String(k || ""); const ax = s.split(":").slice(0, 2).join(":"); const h = s.split(":").pop();
  return ax + ":" + (h.length > 18 ? h.slice(0, 12) + "…" + h.slice(-4) : h);
};

// SentencePiece byte-fallback tokens (<0xNN>) → their actual bytes, UTF-8 decoded.
export const decodeBytes = (t) => t.replace(/(?:<0x[0-9A-Fa-f]{2}>)+/g, (run) => {
  const b = []; run.replace(/<0x([0-9A-Fa-f]{2})>/g, (_, h) => (b.push(parseInt(h, 16)), ""));
  try { return _td.decode(new Uint8Array(b)); } catch { return ""; }
});
export const clean = (t) => decodeBytes(
  t.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<\/?think>/g, "").replace(/<\|[^>]*\|>/g, "").replace(/<unk>|<s>|<\/s>/g, "")
).replace(/^\s+/, "");

// ── verifiable-inference receipt ────────────────────────────────────────────────
// An answer is a content-addressed, re-derivable transform on the substrate:
//   κ(context) ⊕ κ(prompt) ⊕ κ(model) ⊕ κ(params) ⊕ κ(engine) → κ(output)
// sealed as a PROV-O receipt with its OWN did:holo. Greedy decode is deterministic,
// so anyone re-runs it and reproduces κ(output) byte for byte (Law L5).

// Build the canonical PROV-O receipt body. All κ inputs are already did:holo strings.
// `extraUsed` merges additional provenance (e.g. holo:toolReceipts — the agentic work-trail).
export function receiptBody({ modelKappa, engineKappa, promptKappa, contextKappa, outputKappa, tokenCount, params, conscience, extraUsed }) {
  return {
    "@context": ["http://www.w3.org/ns/prov#", { holo: "https://hologram.os/ns/q#" }],
    "@type": "prov:Activity", "holo:kind": "verifiable-inference",
    "prov:used": { "holo:model": modelKappa, "holo:engine": engineKappa, "holo:prompt": promptKappa, "holo:context": contextKappa, "holo:params": params, ...(extraUsed || {}) },
    "prov:generated": { "holo:outputTokens": outputKappa, "holo:tokenCount": tokenCount },
    "holo:conscience": conscience || { outcome: "unverified" },
  };
}

// Seal a receipt: compute the κ inputs from raw tokens/text, assemble the body, address it.
// `text` is the already-decoded answer; `evaluateText` (optional) is the conscience judge.
export async function sealReceipt({ promptText, ctxIds, turnIds, outIds, text, params, fromMemo, modelKappa, engineKappa, evaluateText, extraUsed }) {
  const [promptKappa, contextKappa, outputKappa] = await Promise.all([
    kappaText(promptText), kappaTokens(ctxIds.concat(turnIds)), kappaTokens(outIds),
  ]);
  let conscience = { outcome: "unverified" };
  try { if (evaluateText) { const v = evaluateText(text); conscience = { outcome: v.outcome, blocked: v.blocked || [], caveats: v.caveats || [], sealed: v.sealed !== false }; } } catch {}
  const body = receiptBody({ modelKappa, engineKappa, promptKappa, contextKappa, outputKappa, tokenCount: outIds.length, params, conscience, extraUsed });
  const id = await didHolo(body);
  return { id, body, text, promptText, ctxIds: ctxIds.slice(), turnIds: turnIds.slice(), outIds: outIds.slice(), params, fromMemo: !!fromMemo };
}

// Integrity: recompute the receipt's did:holo from its body — tamper any byte and it won't match.
export const verifyIntegrity = async (rec) => { const again = await didHolo(rec.body); return { ok: again === rec.id, again }; };
