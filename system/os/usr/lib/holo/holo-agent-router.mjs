// holo-agent-router.mjs — Q's TOOL-USE loop over the unified registry. Given a user turn that isn't a plain
// open/nav/build (those go through classifyIntent), decide whether it maps to a registered tool and, if so,
// act under governance:
//   • a READ runs AMBIENTLY and returns its result for grounding the answer;
//   • a WRITE / DESTRUCTIVE never auto-executes — it returns a PROPOSAL (prepare()) for the human step-up;
//   • no clear tool → { tool: null } and the caller just converses.
// The picker is PLUGGABLE (the established baseline→silent-upgrade pattern): the live brain function-calls
// against toolMenu() (brain.pickTool); a deterministic token-overlap FLOOR runs when no brain is bound, and
// is intentionally CONSERVATIVE (favours converse over a wrong tool). Pure + isomorphic — brain injected.
import * as registry from "./holo-agent-registry.mjs";

const STOP = new Set("the a an and or my your our this that these those it its what whats how why who when where do does did i me we you q to of for on in at is are be can could would should will want need please show tell give get make let".split(" "));
const toks = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

// FLOOR picker: score each tool by how many of its name+desc keywords the turn mentions; a distinctive
// tool-noun (the part after the underscore — "attention","clear","balance") counts double. Pick the best
// only if it clears a bar (≥2) AND beats the runner-up — else null (converse). Deterministic, no model.
export function floorPick(text, menu, profileTerms = []) {
  const tt = new Set(toks(text)); if (!tt.size) return null;
  const pset = new Set((profileTerms || []).map((t) => String(t).toLowerCase()).filter((w) => w.length > 2));
  let best = null, bestScore = 0, second = 0;
  for (const t of menu) {
    const kw = new Set(toks(t.name.replace(/_/g, " ")).concat(toks(t.desc || "")));   // text scoring (unchanged)
    let score = 0; for (const w of tt) if (kw.has(w)) score++;
    const noun = t.name.split("_").slice(1).join(" ");
    if (noun && tt.has(noun)) score++;                      // distinctive verb/noun → extra weight
    // PROFILE TIEBREAK: a small (<1) nudge toward tools on a surface/topic you actually use — matched against
    // name+desc+SURFACE+category (a SEPARATE set, so text scoring is byte-identical / backward-compatible).
    // Capped below 1 so it can NEVER alone push a non-match over the ≥2 bar — the floor stays conservative:
    // text governs WHETHER a tool fires, profile only orders WHICH among qualified/ambiguous ones (incl.
    // resolving an otherwise-ambiguous tie that would converse into the tool you use). Disambiguates, never fabricates.
    let pboost = 0;
    if (pset.size) { const pkw = new Set([...kw, ...toks(t.surface || ""), ...toks(t.category || "")]); for (const w of pkw) { if (pset.has(w)) { pboost = 0.6; break; } } }
    const total = score + pboost;
    if (total > bestScore) { second = bestScore; bestScore = total; best = t.name; }
    else if (total > second) second = total;
  }
  return (bestScore >= 2 && bestScore > second) ? best : null;
}

// routeToTool(text, {brain, ctx}) → { tool, ran?, result?, proposal? } | { tool: null }
// brain (optional) = { pickTool(text, menu) → toolName|null }  — the live LLM function-call; floor otherwise.
export async function routeToTool(text, { brain = null, ctx = {} } = {}) {
  const menu = registry.toolMenu().tools;
  if (!menu.length) return { tool: null };
  let name = null;
  if (brain && typeof brain.pickTool === "function") { try { name = await brain.pickTool(text, menu); } catch (e) { name = null; } }
  // the floor leans toward the surfaces you actually use (window.HoloProfile) — a tiebreak, never a trigger.
  if (!name) { let pt = []; try { pt = (typeof window !== "undefined" && window.HoloProfile && window.HoloProfile.terms && window.HoloProfile.terms()) || []; } catch (e) {} name = floorPick(text, menu, pt); }
  const meta = name && menu.find((t) => t.name === name);
  if (!meta) return { tool: null };                         // nothing maps → converse
  if (!meta.gated) {                                        // READ → run ambiently, return for grounding
    const result = await registry.invoke(name, {}, ctx);
    return { tool: name, surface: meta.surface, risk: meta.risk, ran: true, result };
  }
  // WRITE / DESTRUCTIVE → propose + require step-up; NEVER auto-execute from a bare turn.
  return { tool: name, surface: meta.surface, risk: meta.risk, ran: false, proposal: registry.prepare(name, {}) };
}
export default routeToTool;
