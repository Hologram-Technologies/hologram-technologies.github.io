// holo-control-agent.mjs — the Control app's typed agent surface, so Q can answer "what needs my attention?"
// and act on the OS signal plane ("ease that edge") FROM INTENT. Reads (status/health/signals) are ambient;
// governance acts (throttle/pause/isolate an edge) move AUTHORITY → human step-up gate. The live seam is the
// telemetry/spine bridge (HoloSpine / HoloTap), injected by the app; the witness uses an in-memory stub.
import { makeAgentSurface, qContext } from "./holo-agent-surface.mjs";

export const TOOLS = [
  { name: "control_status",   category: "control", risk: "read", seamKind: "status",  input: {}, desc: "System pulse: coherence, health, active edges. Read-only." },
  { name: "control_attention", category: "control", risk: "read", seamKind: "salient", input: {}, desc: "What needs attention now — ranked anomalies/notices. Read-only." },
  { name: "control_signals",  category: "control", risk: "read", seamKind: "signals", input: { edge: "string?" }, desc: "Live signal stream for an edge (or all). Read-only." },
  { name: "control_throttle", category: "control", risk: "write", seamKind: "throttle", input: { edge: "string", rate: "number" }, desc: "Throttle an edge's rate. Human step-up." },
  { name: "control_pause",    category: "control", risk: "write", seamKind: "pause",    input: { edge: "string" }, desc: "Pause an edge. Human step-up." },
  { name: "control_isolate",  category: "control", risk: "destructive", seamKind: "isolate", input: { edge: "string" }, desc: "Isolate (cut) an edge — disrupts its traffic. Human step-up." },
];

export function makeControlAgent(seam) {
  return makeAgentSurface({ title: "Control — agent tools", door: "HoloSpine/telemetry (step-up on govern)", ns: "control-agent", tools: TOOLS, seam });
}
export async function browserControlAgent() {
  const seam = (typeof window !== "undefined" && (window.HoloControl || window.HoloSpine)) || null;
  return makeControlAgent(seam && (seam.agentSeam || seam.seam || seam));
}
export { qContext };
export default makeControlAgent;
