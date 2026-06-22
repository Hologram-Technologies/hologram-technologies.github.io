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
export function floorPick(text, menu) {
  const tt = new Set(toks(text)); if (!tt.size) return null;
  let best = null, bestScore = 0, second = 0;
  for (const t of menu) {
    const kw = new Set(toks(t.name.replace(/_/g, " ")).concat(toks(t.desc || "")));
    let score = 0; for (const w of tt) if (kw.has(w)) score++;
    const noun = t.name.split("_").slice(1).join(" ");
    if (noun && tt.has(noun)) score++;                      // distinctive verb/noun → extra weight
    if (score > bestScore) { second = bestScore; bestScore = score; best = t.name; }
    else if (score > second) second = score;
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
  if (!name) name = floorPick(text, menu);
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
