// holo-omni-unified.mjs — ONE door over every omni leg. resolveUnified(input) classifies a string and
// routes it to the right resolver, but EVERY leg returns the SAME envelope: a sealed, κ-addressed object.
//
//   onion (Tor v3 .onion address)                     → resolveOnion (holo-omni-onion.mjs)  → κ-card
//   web3 (ENS · 0x account/asset/tx · base58 · CAIP) → resolveWeb3  (holo-omni-web3.mjs)  → κ-card
//   web · ipfs · κ-app · κ-file                       → resolveAny  (holo-omni.mjs)        → κ + bytes
//   natural language (a question)                     → kind:"nl"   (the caller hands it to Q)
//   nothing matches                                   → kind:"unknown"
//
// classifyUnified(input) does the same routing WITHOUT touching the network, so the UI can show an instant
// "what is this?" chip before the resolve completes. Pure ESM, no DOM. This file is the thin seam the
// magical bar sits on: paste anything → one verified κ-object → render → Q-act.

import { resolveAny, parseRef } from "./holo-omni.mjs";
import { parseWeb3Ref, resolveWeb3 } from "./holo-omni-web3.mjs";
import { parseOnionRef, resolveOnion } from "./holo-omni-onion.mjs";

// classifyUnified(input) → { lane, kind, label } — instant, no network.
//   lane: "onion" | "web3" | "object" | "nl" | "unknown"
export function classifyUnified(input) {
  const s = String(input || "").trim();
  if (!s) return { lane: "unknown", kind: "empty", label: "—" };
  // Onion first: the .onion suffix is unambiguous, and a v3 host is 56 base32 chars that no other parser
  // would claim (parseRef would fall through to "unknown"). Validation happens in resolveOnion, not here.
  if (parseOnionRef(s)) return { lane: "onion", kind: "onion", label: "Tor onion service" };
  const w = parseWeb3Ref(s);
  if (w) return { lane: "web3", kind: w.kind, label: WEB3_LABEL[w.kind] || "web3 address" };
  const r = parseRef(s);
  if (r.kind === "web")   return { lane: "object", kind: "web",   label: "web URL" };
  if (r.kind === "kappa") return { lane: "object", kind: "kappa", label: "κ address" };
  if (r.kind === "cid")   return { lane: "object", kind: "cid",   label: "IPFS object" };
  // unknown to every address parser. A query with whitespace, a trailing '?', or no address shape is
  // natural language → Q. A lone unrecognised token is genuinely unknown.
  if (/\s/.test(s) || /\?$/.test(s) || (s.length > 2 && !/^[\w:/.+=-]+$/.test(s))) return { lane: "nl", kind: "nl", label: "ask Q" };
  return { lane: "unknown", kind: "unknown", label: "unrecognised" };
}
const WEB3_LABEL = {
  "ens-name": "ENS / SNS name", "evm-account": "EVM account", "evm-tx": "EVM transaction",
  "sol-account": "Solana account", "sol-tx": "Solana transaction", "caip-account": "CAIP account", "caip-chain": "CAIP chain",
};

// resolveUnified(input, cfg) → a uniform envelope:
//   { ok, lane, kind, subkind?, kappa?, caip?, card?, bytes?, content?, cid?, via?, receipt?, ms, reason? }
// cfg is passed through: web3 reads honour cfg.{allow,mine,caller}; object reads honour resolveAny's cfg
//   (fetchImpl, gateways, discover, assemble, cache, timeoutMs).
export async function resolveUnified(input, cfg = {}) {
  const t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : 0;
  const ms = () => (t0 ? Math.round((performance.now ? performance.now() : 0) - t0) : 0);
  const cls = classifyUnified(input);

  if (cls.lane === "onion") {
    const r = await resolveOnion(input, cfg);
    return { ...r, lane: "onion", kind: cls.kind, label: cls.label, ms: r.ms != null ? r.ms : ms() };
  }
  if (cls.lane === "web3") {
    const r = await resolveWeb3(input, cfg);
    return { ...r, lane: "web3", kind: cls.kind, label: cls.label, ms: r.ms != null ? r.ms : ms() };
  }
  if (cls.lane === "object") {
    const r = await resolveAny(input, { assemble: true, ...cfg });
    return { ...r, lane: "object", label: cls.label, ms: r.ms != null ? r.ms : ms() };
  }
  if (cls.lane === "nl") {
    // The unifier does not own a model — it tags the input so the caller routes it to Q (recall/ask/fuse).
    return { ok: true, lane: "nl", kind: "nl", label: cls.label, query: String(input).trim(), ms: ms() };
  }
  return { ok: false, lane: "unknown", kind: "unknown", reason: "unrecognised address: " + String(input).trim(), ms: ms() };
}

export default { classifyUnified, resolveUnified };
