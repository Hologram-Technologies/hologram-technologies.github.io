// holo-files-agent.mjs — the Files app's typed agent surface, so Q can drive files FROM INTENT ("open my
// budget", "find the trip photos", "share this by link") instead of the user navigating. Reads are ambient;
// writes (save/move) and destructive acts (delete) route through the human step-up gate. The live seam is the
// in-app Files service (holo-files / holo-desk:tree), injected by the app; the witness uses an in-memory stub.
import { makeAgentSurface, qContext } from "./holo-agent-surface.mjs";

export const TOOLS = [
  { name: "files_list",   category: "files", risk: "read", seamKind: "list",   input: { path: "string?" }, desc: "List entries in a folder (default: Home). Read-only." },
  { name: "files_search", category: "files", risk: "read", seamKind: "search", input: { query: "string" }, desc: "Find files/folders by name or content. Read-only." },
  { name: "files_open",   category: "files", risk: "read", seamKind: "open",   input: { path: "string" }, desc: "Open a file/folder in the Files app (or its default app). No mutation." },
  { name: "files_share",  category: "files", risk: "read", seamKind: "shareKappa", input: { path: "string" }, desc: "Mint a content-address (κ) share link for a file — serverless, verifiable. Read-only." },
  { name: "files_save",   category: "files", risk: "write", seamKind: "save",  input: { path: "string", bytes: "any" }, desc: "Write/overwrite a file. Human step-up." },
  { name: "files_move",   category: "files", risk: "write", seamKind: "move",  input: { from: "string", to: "string" }, desc: "Move/rename a file or folder. Human step-up." },
  { name: "files_delete", category: "files", risk: "destructive", seamKind: "remove", input: { path: "string" }, desc: "Delete a file/folder. Irreversible — human step-up." },
];

export function makeFilesAgent(seam) {
  return makeAgentSurface({ title: "Files — agent tools", door: "holo-files service (step-up on write)", ns: "files-agent", tools: TOOLS, seam });
}
export async function browserFilesAgent() {
  const seam = (await import("./holo-files.js").catch(() => null)) || (typeof window !== "undefined" && window.HoloFiles) || null;
  return makeFilesAgent(seam && (seam.agentSeam || seam.seam || seam));
}
export { qContext };
export default makeFilesAgent;
