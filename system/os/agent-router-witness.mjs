// Witness Q's TOOL-USE loop over the registry: a turn maps to a registered tool (deterministic FLOOR, no
// model), a READ runs ambiently, a WRITE/DESTRUCTIVE returns a step-up PROPOSAL (never auto-runs), and an
// unrelated turn → converse (tool:null). Plus: a brain picker OVERRIDES the floor (the live-LLM upgrade path).
import { register } from "./usr/lib/holo/holo-agent-registry.mjs";
import { routeToTool, floorPick } from "./usr/lib/holo/holo-agent-router.mjs";
import { makeFilesAgent } from "./usr/lib/holo/holo-files-agent.mjs";
import { makeControlAgent } from "./usr/lib/holo/holo-control-agent.mjs";
import { makeInboxAgent } from "./usr/lib/holo/holo-inbox-agent.mjs";
import { qContext } from "./usr/lib/holo/holo-agent-surface.mjs";

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
const stub = (names) => { const c = []; const s = { _c: c }; for (const n of names) s[n] = async () => { c.push(n); return { served: n }; }; return s; };
register("files",   makeFilesAgent(stub(["list","search","open","shareKappa","save","move","remove"])));
register("control", makeControlAgent(stub(["status","salient","signals","throttle","pause","isolate"])));
register("inbox",   makeInboxAgent(stub(["list","unread","notify","markRead","clear"])));

// READ intent → runs ambiently (Q caller, no approval), grounding result returned
const a = await routeToTool("what needs my attention", { ctx: qContext() });
ok(a.tool === "control_attention" && a.ran === true && a.result && a.result.ok, `"what needs my attention" → ${a.tool} RAN ambiently (read)`);

// DESTRUCTIVE intent → proposal only, NOT executed
const b = await routeToTool("clear my inbox", { ctx: qContext() });
ok(b.tool === "inbox_clear" && b.ran === false && b.proposal && b.proposal.willRequireConsent, `"clear my inbox" → ${b.tool} PROPOSED (step-up), not auto-run`);

// unrelated turn → converse (no tool)
const c = await routeToTool("tell me a joke about cats", { ctx: qContext() });
ok(c.tool === null, `"tell me a joke…" → no tool (converse)`);

// another read-ish that should match files search/list (conservative floor still routes a clear one)
const d = await routeToTool("search my files for the budget", { ctx: qContext() });
ok(d.tool && d.surface === "files", `"search my files…" → ${d.tool} (files surface)`);

// the floor is conservative: a vague turn doesn't force a tool
ok(floorPick("hello there", []) === null && floorPick("how are you today", [{ name: "files_open", desc: "Open a file" }]) === null, "vague turns → floor returns null (favours converse over a wrong tool)");

// BRAIN picker OVERRIDES the floor (live-LLM function-call upgrade path)
const brain = { pickTool: async () => "inbox_unread" };
const e = await routeToTool("anything new?", { brain, ctx: qContext() });
ok(e.tool === "inbox_unread" && e.ran === true, `brain picker overrides floor → ${e.tool} (the live-LLM upgrade path)`);

console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: Q's tool-use loop — read runs ambiently, write proposes (step-up), unrelated converses, brain upgrades the floor"}`);
process.exit(fail ? 1 : 0);
