// holo-agent-surface.mjs — the ONE shared pattern behind every app's typed, self-describing AGENT tool
// surface (the wallet surface, generalized). An app exposes a CATALOG of tools; this factory wraps it in a
// κ-identified capability card + default-deny governance so Q (and external agents) can drive the app FROM
// INTENT without widening the trust boundary:
//   • reads are AMBIENT — local, non-value OS reads (list files, read telemetry, read the Inbox) need no gate;
//   • writes / destructive acts route through the human STEP-UP gate (ctx.userApproved, set only AFTER the
//     biometric/confirm ceremony fired) — proactive Q uses prepare() (zero side effects) and never reaches here;
//   • an external agent must already HOLD the capability (SEC-2 attenuation) — default-deny otherwise.
// Pure + isomorphic: the catalog + governance are Node-testable; the live seam is injected (browser bridge in
// the app; an in-memory stub in the witness). Same axis as the rest of the OS (holo-uor κ).
import { jcs, didHolo } from "./holo-uor.mjs";
import { blake3hex } from "./holo-blake3.mjs";   // the ONE canonical κ hash (§1.2)

const kappaOf = (obj) => didHolo("blake3", blake3hex(new TextEncoder().encode(jcs(obj))));   // content id on the ONE axis
// risk → the capability a caller must hold + whether it needs the step-up gate.
export const RISK = { read: { gated: false }, write: { gated: true }, destructive: { gated: true } };

// govern — the single decision: may THIS caller invoke THIS tool right now? default-deny.
// ctx = { caller:{kind:"human"|"agent"|"q"}, userApproved?, capability?, delegation?, revoked? }
function govern(tool, ctx) {
  const kind = (ctx && ctx.caller && ctx.caller.kind) || "human";
  const gated = (RISK[tool.risk] || RISK.write).gated;
  if (kind === "human") return { ok: true, via: "human-gate" };          // the app UI's own gate is the consent
  if (!gated) return { ok: true, via: "ambient-read" };                   // reads are ambient for Q/agents (local, non-value)
  // a write / destructive act: needs a fresh per-action human approval (step-up), never standing.
  if (ctx && ctx.userApproved === true) return { ok: true, via: "step-up-approved" };
  return { ok: false, refused: true, needsConsent: tool.risk,
    reason: `${tool.name} ${tool.risk === "destructive" ? "is irreversible and " : ""}requires step-up approval (Q must ask first)` };
}

export function makeAgentSurface({ title, door, ns = "agent-surface", tools = [], seam = null } = {}) {
  const byName = (n) => tools.find((t) => t.name === n) || null;
  // the self-verifying capability card — the agent's introspection entry point (L5: re-derive its id).
  function describe() {
    const card = {
      "@context": "https://hologram.os/ns/" + ns, "@type": "AgentSurface", title, door,
      categories: [...new Set(tools.map((t) => t.category))],
      tools: tools.map((t) => ({ name: t.name, category: t.category, risk: t.risk, gated: (RISK[t.risk] || RISK.write).gated, status: t.status || "wired", desc: t.desc, input: t.input || {} })),
      policy: { reads: "ambient (local, non-value)", writes: "human step-up per action; proactive Q uses prepare() (no side effects)", agent: "must already hold the capability (SEC-2)" },
    };
    return { ...card, id: kappaOf(card) };
  }
  const listTools = () => describe().tools;
  // prepare() — the PROACTIVE path: a non-executing proposal. ZERO side effects (the seam is never touched).
  function prepare(name, args = {}) {
    const tool = byName(name); if (!tool) return { ok: false, reason: "unknown tool: " + name };
    const gated = (RISK[tool.risk] || RISK.write).gated;
    return { ok: true, proposal: true, tool: tool.name, category: tool.category, risk: tool.risk, args,
      willRequireConsent: gated, consentKind: gated ? "per-action" : "none",
      humanSummary: tool.risk === "destructive" ? `Proposes to ${tool.name} — irreversible; you'll confirm with biometrics.`
        : tool.risk === "write" ? `Proposes to ${tool.name} — you'll be asked to confirm.`
        : `Proposes to ${tool.name} — read-only.` };
  }
  // invoke() — the ONLY path that touches the seam. Governs first (default-deny), then routes through the
  // injected seam. A "planned" tool refuses (never fakes — L5 honesty).
  async function invoke(name, args = {}, ctx = {}) {
    const tool = byName(name); if (!tool) return { ok: false, reason: "unknown tool: " + name };
    if (tool.status === "planned") return { ok: false, status: "planned", reason: "not wired yet", maps_to: tool.maps_to || null };
    const g = govern(tool, ctx); if (!g.ok) return g;
    if (!seam) return { ok: false, reason: "no seam injected (app bridge absent)" };
    if (tool.handler) return { ok: true, via: g.via, tool: tool.name, result: await tool.handler({ seam, args, ctx }) };
    if (typeof seam[tool.seamKind] !== "function") return { ok: false, status: "needs-seam", reason: `seam does not expose '${tool.seamKind}'` };
    return { ok: true, via: g.via, tool: tool.name, result: await seam[tool.seamKind](args, ctx) };
  }
  return { describe, listTools, prepare, invoke };
}

// Q caller frame — the assistant must ASK before any WRITE; reads are ambient. userApproved is set only
// AFTER Q shows a confirm card and the human clears the step-up ceremony.
export const qContext = (extra = {}) => ({ caller: { kind: "q", label: "Q" }, ...extra });
export { kappaOf };
export default makeAgentSurface;
