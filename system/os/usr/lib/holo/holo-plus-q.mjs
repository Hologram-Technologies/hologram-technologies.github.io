// holo-plus-q.mjs — "The + Everywhere" A4: Q FUSION. This is what makes the "+" part of Q rather than a side
// panel. Whatever you drop — and the insights it yields — becomes a GROUNDING TURN on Q's context bus, so Q's next
// answer is informed by it without you re-explaining. And the two doors converge: saying "add this" (voice, through
// Moonshine ASR) and clicking the "+" (text) both terminate in ONE grounding, fused into the SAME Q conversation.
// Voice and text are one path. The grounding is itself a content-addressed κ-object (auditable, re-derivable),
// citing the brief / investigation / insight κs so Q can trace every claim back. Pure + injectable (qBus injected
// → Node-witnessable); the browser binds qBus to the live Q (holo-q-app) and listens for the popover's result.

import { sha256hex, didHolo, jcs } from "./holo-uor.mjs";

const SHA = "sha256";
const enc = new TextEncoder();
const HOLO_CONTEXT = { holo: "https://hologram.os/ns#", schema: "http://schema.org/", prov: "http://www.w3.org/ns/prov#" };

// groundingFrom(result, context) → a sealed holo:Grounding κ-object. DETERMINISTIC over (result, context): the text
// door and the voice door, given the same result + conversation, produce the IDENTICAL grounding κ — that identity
// IS the convergence proof. Cites brief/investigation/insight κs so Q (and an auditor) can trace every claim.
export function groundingFrom(result = {}, context = null, { hash = sha256hex } = {}) {
  const insights = ((result.insights) || []).map((i) => i["@id"]);
  const items = (result.brief && result.brief["holo:items"]) || result.insights || [];
  const top = items[0] || null;
  const sources = result.sources || [];
  const conv = (context && context.qConversationId) || null;
  const briefK = (result.brief && result.brief["@id"]) || null;
  const invK = (result.investigation && result.investigation["holo:root"]) || null;

  const n = insights.length, m = sources.length;
  const summary = n
    ? `Added to context: ${n} insight${n > 1 ? "s" : ""} from ${m} source${m === 1 ? "" : "s"}.` + (top ? ` Most relevant: ${top["schema:text"]}` : "")
    : `Added a source to context (${result.graph ? (result.graph["holo:stats"].entities) : 0} entities); nothing flagged yet.`;

  const canonical = { t: "grounding", conv, brief: briefK, investigation: invK, insights: [...insights].sort() };
  const kappa = didHolo(SHA, hash(enc.encode(jcs(canonical))));
  return {
    "@context": HOLO_CONTEXT, "@id": kappa, "@type": ["holo:Grounding", "schema:Message"],
    "holo:conversation": conv, "holo:brief": briefK, "holo:investigation": invK,
    "holo:insights": insights, "holo:sources": sources, "schema:text": summary, via: "the+", kappa,
  };
}

// isAddIntent(transcript) → does this utterance mean "bring this into Q's context"? The voice door. Deterministic
// recognizer the real Moonshine ASR feeds (Q's NLU can refine in production). Matches "add this", "look at this",
// "what do you make of this", "analyse this", "add to context"; rejects unrelated commands.
const ADD_RE = /\badd to context\b|\b(?:add|attach|ingest|include|consider|analy[sz]e|look at|take a look at|what do you (?:make|think) of|check out)\b[^.?!]*\bthis\b/i;
export const isAddIntent = (transcript) => ADD_RE.test(String(transcript || ""));

// fuseToQ({ result, context, qBus }) → push the grounding onto Q's context bus. qBus is the injected seam: any of
// addGrounding/addContext/ground (the holo-q-app bridge exposes one). Returns { grounding, delivered }. Graceful:
// no bus → grounding still returned (delivered:false), never throws. This is the SINGLE convergence point both
// doors (voice + text) call — same result+context ⇒ same grounding ⇒ one turn in the conversation.
export async function fuseToQ({ result, context = null, qBus = null, hash = sha256hex } = {}) {
  const grounding = groundingFrom(result, context, { hash });
  let delivered = false;
  if (qBus) {
    const fn = qBus.addGrounding || qBus.addContext || qBus.ground;
    if (typeof fn === "function") { try { await fn.call(qBus, grounding); delivered = true; } catch { delivered = false; } }
  }
  return { grounding, delivered };
}

// ── browser binding: both doors → fuseToQ → the live Q (holo-q-app). One grounding, one conversation. ──
export function detectQBus(win = (typeof window !== "undefined" ? window : null)) {
  if (!win) return null;
  const q = win.Q || win.HoloQ || (win.HoloQApp && win.HoloQApp.q);
  if (q && (typeof q.addGrounding === "function" || typeof q.addContext === "function" || typeof q.ground === "function")) return q;
  return null;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  const W = window;
  if (!W.HoloPlusQ) {
    let lastResult = null, lastContext = null;
    // TEXT DOOR: the popover's result becomes grounding.
    document.addEventListener("holo-plus-result", async (e) => {
      const d = e.detail || {}; lastResult = d.result; lastContext = (d.result && d.result.context) || null;
      const out = await fuseToQ({ result: d.result, context: lastContext, qBus: detectQBus(W) });
      document.documentElement.dispatchEvent(new W.CustomEvent("holo-plus-grounded", { detail: { grounding: out.grounding, delivered: out.delivered } }));
    });
    // VOICE DOOR: "add this" about the most-recent "+" result → the SAME fusion.
    const handleVoice = async (transcript) => {
      if (!isAddIntent(transcript) || !lastResult) return { matched: false };
      const out = await fuseToQ({ result: lastResult, context: lastContext, qBus: detectQBus(W) });
      return { matched: true, ...out };
    };
    W.HoloPlusQ = { fuseToQ, groundingFrom, isAddIntent, handleVoice, detectQBus, get lastResult() { return lastResult; } };
  }
}

export default { groundingFrom, isAddIntent, fuseToQ, detectQBus };
