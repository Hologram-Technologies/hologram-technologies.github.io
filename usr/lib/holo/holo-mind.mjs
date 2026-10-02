// holo-mind.mjs — Holo Mind (ADR-0081) PHASE 0: the AMBIENT AGENTIC LOOP, no learning yet.
// Agency lifted out of one app into one OS service: a human and an agent enter through the SAME verb
// surface and seal the SAME receipt. This is the re-derivable CORE — intent → plan → act → seal — and
// nothing else. ISOMORPHIC by design (Node · browser · service worker): sealing rides the ONE canonical
// primitive holo-uor.mjs (pure-JS sync SHA-256, no Buffer/node:crypto), so the κ a receipt re-derives to
// is byte-identical to the Node holo-object.mjs envelope (witnessed: sealEquivalence). Every side-effecting
// faculty (plan, the conscience gate, tool dispatch) is INJECTED, so the identical core runs in the
// browser (real model · window.HoloConscience · window.HoloMCP) and in the Node witness (deterministic
// stubs) — the holo-prov.js pattern. The substrate gives the magic: each action is a κ-transform
//   κ(intent) ⊕ κ(verb) ⊕ κ(policy) → κ(action-receipt)
// sealed as a self-verifying PROV-O object that re-derives byte-for-byte (Law L5) — the Holo Forge / Holo Q
// receipt idiom (ADR-0051/0052) one transform over. The LIVE shell wiring is holo-mind-ui.js.
//
// Phase 0 scope, honest: the verified core + roster composition + action receipts. The LEARNING
// κ-transform (the trace corpus + governed self-evolution, ADR-0081 Decision 3) is Phase 2; the soul's
// drives + output-court coherence are Phase 3. See docs/specs/holo-mind-implementation.md.

import { jcs, sha256hex, sriOf, mbSha256 } from "./holo-uor.mjs";

export const DEFAULT_ARM = 4, MAX_ARM = 8;                 // mirrors Holo Q's mcphub: a local model can't juggle 30 schemas — pick
const HOLO = { holo: "https://hologram.os/ns/mind#" };     // the only minted term-space (non-reusable), over schema.org/PROV-O

// ── the UOR envelope, isomorphic + byte-identical to holo-object.mjs (ADR-025) ──────────────────────
// We do NOT import holo-object.mjs: it uses Buffer (Node-only). These reproduce its sealing on holo-uor
// (the pure-JS axis), so the SAME content seals to the SAME did:holo on every runtime (proven by the
// sealEquivalence witness check against holo-object's canonical address()).
const UOR_CONTEXT = Object.freeze([
  "https://www.w3.org/ns/did/v1", "https://w3id.org/security/data-integrity/v2",
  { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", dcterms: "http://purl.org/dc/terms/",
    rel: "schema:additionalType", links: { "@id": "schema:hasPart", "@container": "@set" } },
]);
const _enc = new TextEncoder(), _dec = new TextDecoder();
const hexOf = (did) => String(did).split(":").pop();

export const address = (obj) => { const { id, alsoKnownAs, ...content } = obj; return `did:holo:sha256:${sha256hex(jcs(content))}`; };
export const seal = (obj) => ({ ...obj, id: address(obj) });        // stamp the derived id
export const verify = (obj) => obj.id === address(obj);             // Law L5: re-derive, compare

// a content-addressed store: hex → canonical UTF-8 bytes (a Map works in Node AND the browser).
const put = (store, obj) => { const s = seal(obj); store.set(hexOf(s.id), _enc.encode(jcs(s))); return s; };
export const resolve = (store, did) => { const b = store.get(hexOf(did)); return b ? JSON.parse(_dec.decode(b)) : null; };
export const linkTo = (store, rel, child) => {
  const bytes = store.get(hexOf(child.id));
  return { id: child.id, rel, "@type": child["@type"], digestSRI: sriOf(bytes), digestMultibase: mbSha256(bytes) };
};
export function makeObject(store, { type, context = [], links = [], ...props }) {
  return put(store, { "@context": [...UOR_CONTEXT, ...context], "@type": type, ...props, ...(links.length ? { links } : {}) });
}
// verifyDeep — re-derive the whole DAG (Law L5 at every level); a tampered byte anywhere is refused.
export function verifyDeep(store, obj, depth = 0) {
  if (!verify(obj)) return { ok: false, at: obj.id, why: "id does not re-derive", depth };
  let maxDepth = depth;
  for (const link of obj.links || []) {
    const bytes = store.get(hexOf(link.id));
    if (!bytes) return { ok: false, at: link.id, why: "unresolved link", depth };
    if (sriOf(bytes) !== link.digestSRI) return { ok: false, at: link.id, why: "link digest mismatch", depth };
    const child = JSON.parse(_dec.decode(bytes));
    if (child.id !== link.id) return { ok: false, at: link.id, why: "id/link mismatch", depth };
    const r = verifyDeep(store, child, depth + 1);
    if (!r.ok) return r;
    maxDepth = Math.max(maxDepth, r.depth);
  }
  return { ok: true, depth: maxDepth };
}

// markReachable(store, roots, {skipRels}) — the GC mark phase: every κ reachable from `roots` by following
// an object's forward references — its typed `links` (minus any `skipRels`) AND every κ in its non-link
// fields (intentKappa / receiptKappa / effectKappa …, found generically, no hardcoded field list). The
// `skipRels` is the crux for APPEND-ONLY chains: a chain links EVERY predecessor, so plain reachability
// keeps the whole history — skipping the predecessor rels (prov:wasInformedBy / prov:wasRevisionOf) lets a
// sweep keep a recent WINDOW and evict the older prefix, deliberately leaving a dangling "horizon" link
// (the GC boundary). Pure + content-only; the complement is garbage a sweep evicts WITHOUT breaking any
// kept object's re-derivation (a kept object commits to its non-skipped refs, which are, by construction, marked).
export function markReachable(store, roots = [], { skipRels = [] } = {}) {
  const keep = new Set(); const stack = [...roots]; const skip = new Set(skipRels);
  const REF = /did:holo:sha256:[0-9a-f]{64}/g;
  while (stack.length) {
    const k = stack.pop(); if (!k) continue; const hex = hexOf(k); if (keep.has(hex)) continue;
    keep.add(hex); const bytes = store.get(hex); if (!bytes) continue;
    let obj; try { obj = JSON.parse(typeof bytes === "string" ? bytes : _dec.decode(bytes)); } catch { continue; }
    for (const l of obj.links || []) if (l && !skip.has(l.rel)) stack.push(l.id);   // typed links, minus skipped rels
    const { links, ...rest } = obj; const s = JSON.stringify(rest); let m;          // κ in non-link fields
    while ((m = REF.exec(s))) stack.push(m[0]);
  }
  return keep;
}

// ── the ambient loop ─────────────────────────────────────────────────────────────────────────────
// composeRoster — ONE verb surface from the three doors that already exist (ADR-0047 MCP · ADR-0049
// agents · ADR-0035 skills). Pure: the browser maps the real /.well-known/* + window.HoloMCP into this
// shape, the witness injects fixtures. De-dup by bare name (first door wins — small models address tools
// by name), capped at `max`. Mints NOTHING: every roster name ORIGINATES from an input door (Law L4).
export function composeRoster({ mcp = [], agents = [], skills = [] } = {}, { max = MAX_ARM } = {}) {
  const tag = (arr, source) => (arr || []).map((v) => ({ name: v.name, description: v.description || "", source }));
  const all = [...tag(mcp, "mcp"), ...tag(agents, "agents"), ...tag(skills, "skills")];
  const seen = new Set(); const out = [];
  for (const v of all) { if (!v.name || seen.has(v.name)) continue; seen.add(v.name); out.push(v); }
  return out.slice(0, max);
}

// memoKey — Law L3: identical ask ⊕ context ⊕ roster addresses the SAME plan → O(1) replay, no re-plan.
export const memoKey = (intentKappa, contextKappa, roster) =>
  sha256hex(jcs({ i: intentKappa, c: contextKappa || null, r: (roster || []).map((v) => v.name) }));

// sealIntent — `source` is anima's GoalStack origin (user|self|curiosity|environment). Timestamp-free → L5.
export function sealIntent(store, { utterance, source = "user", contextKappa = null }) {
  return makeObject(store, {
    type: ["holo:Intent", "prov:Entity"], context: [HOLO],
    "holo:utterance": String(utterance), "holo:source": source,
    ...(contextKappa ? { "holo:contextKappa": contextKappa } : {}),
  });
}

// sealActionReceipt — the PROV-O work receipt (ADR-0045 shape): prov:used {intent + verb under a policy
// verdict} → prov:generated {effect}. `actor` (human|agent) is the ONLY thing that differs between a
// human's action and an agent's — the structure is identical (the symmetry requirement).
export function sealActionReceipt(store, { intent, step, verdict, actor = "agent", effect = null, prior = null }) {
  const links = [linkTo(store, "prov:used", intent)];
  if (prior) links.push(linkTo(store, "prov:wasInformedBy", prior));
  return makeObject(store, {
    type: ["holo:ActionReceipt", "prov:Activity"], context: [HOLO],
    "holo:actor": actor, "holo:verb": step.verb, "holo:argsKappa": step.argsKappa || null,
    "prov:wasAssociatedWith": step.identity || actor,
    "holo:policyOutcome": verdict.outcome,                 // accept | caveat | block
    "prov:generated": { "holo:effectKappa": effect }, links,
  });
}

// ── model-driven planning (real planning, the QVAC seam) ───────────────────────────────────────
// The OS does not own the model: it BORROWS one as an injected `sampler` (async ({prompt,maxTokens})
// → text), exactly as holo-mcp.mjs's `ctx.sampler` and the conscience's `samplerJudge` do. Holo Q's
// QVAC engine registers itself as that sampler (window.HoloMind.setSampler, see holo-mind-ui.js); the
// MCP `ask_model` tool is the auto-discovered fallback. The planner gives the model the roster as tools
// and reads back tool calls — the Qwen2.5 function-calling convention Holo Q's core/tools.js already
// speaks. These three are PURE (model injected) → witnessed with a stub sampler.

// planPrompt — present the request + the armed roster as callable tools; ask for tool calls.
export function planPrompt(intent, roster) {
  const utter = intent["holo:utterance"] || intent.utterance || "";
  const tools = (roster || []).map((v) => `- ${v.name}: ${v.description || ""}`).join("\n");
  return `You are the planner for an action loop. Choose tools to fulfil the request, using ONLY the tools listed.\n`
    + `Available tools:\n${tools}\n\nRequest: ${utter}\n\n`
    + `Reply with one tool call per line as <tool_call>{"name":"<tool>","arguments":{…}}</tool_call>. `
    + `Use no tool call if none fits.`;
}

// parsePlan — read the model's tool calls into steps. A verb is accepted ONLY if it ORIGINATES from the
// roster (Law L4 — the model cannot invent a verb); unknown names and malformed JSON are dropped.
export function parsePlan(text, roster) {
  const names = new Set((roster || []).map((v) => v.name));
  const steps = [];
  const re = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
  let m;
  while ((m = re.exec(String(text)))) {
    try { const c = JSON.parse(m[1]); if (c && names.has(c.name)) steps.push({ verb: c.name, args: c.arguments || {}, decision: {} }); } catch {}
  }
  if (!steps.length) {                                   // tolerate a bare {"name","arguments"} object
    const m2 = String(text).match(/\{[\s\S]*?"name"[\s\S]*?\}/);
    if (m2) { try { const c = JSON.parse(m2[0]); if (names.has(c.name)) steps.push({ verb: c.name, args: c.arguments || {}, decision: {} }); } catch {} }
  }
  return steps;
}

// modelPlan — the real planner: ask the injected model, parse its tool calls into steps.
export async function modelPlan(intent, roster, sampler, { maxTokens = 256 } = {}) {
  if (typeof sampler !== "function") return [];
  const out = await sampler({ prompt: planPrompt(intent, roster), maxTokens });
  return parsePlan(out, roster);
}

// runLoop — intent → plan → act → seal. `deps` injected (the isomorphism seam):
//   store · roster · plan(intent,roster)→steps · gate(decision)→verdict · dispatch(step)→effect · memo
// A blocked step seals NOTHING and dispatches NOTHING (self-discipline as a structural property — there
// is no path from intent to effect that skips the conscience). Returns the run summary + the receipt chain.
export async function runLoop({ utterance, source = "user", contextKappa = null, actor = "agent" }, deps) {
  const { store, roster, plan, gate, dispatch, memo = new Map() } = deps;
  const intent = sealIntent(store, { utterance, source, contextKappa });

  const key = memoKey(intent.id, contextKappa, roster);
  let steps, memoHit = false;
  if (memo.has(key)) { steps = memo.get(key); memoHit = true; }
  else { steps = await plan(intent, roster); memo.set(key, steps); }

  const receiptIds = []; const results = []; const refused = [];
  let prior = null;
  for (const step of steps) {
    const verdict = await gate({ verb: step.verb, actor, ...(step.decision || {}) });
    if (verdict.outcome === "block") { refused.push({ verb: step.verb, verdict }); continue; }
    const effect = await dispatch(step);
    const receipt = sealActionReceipt(store, { intent, step, verdict, actor, effect, prior });
    receiptIds.push(receipt.id); results.push(effect); prior = receipt;
  }
  return { intentId: intent.id, receiptIds, results, refused, memoHit, root: prior ? prior.id : null };
}
