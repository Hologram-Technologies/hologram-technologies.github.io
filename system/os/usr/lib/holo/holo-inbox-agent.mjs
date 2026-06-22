// holo-inbox-agent.mjs — the Inbox's typed agent surface, so Q can READ the Inbox as fuel ("what did I
// miss?", "any letters from Q?") and act on it FROM INTENT — not just post one-way. Reads (list/unread) are
// ambient; mark-read is a light write; CLEAR is destructive → human step-up (matches the Authority confirm
// card for irreversible acts). The live seam is window.HoloNotify, injected by the shell; witness = a stub.
import { makeAgentSurface, qContext } from "./holo-agent-surface.mjs";

export const TOOLS = [
  { name: "inbox_list",      category: "inbox", risk: "read", seamKind: "list",     input: { category: "string?" }, desc: "List notifications/letters (action·update·letter). Read-only." },
  { name: "inbox_unread",    category: "inbox", risk: "read", seamKind: "unread",   input: {}, desc: "Unread count + the most salient items. Read-only." },
  { name: "inbox_post",      category: "inbox", risk: "write", seamKind: "notify",  input: { title: "string", body: "string?", category: "string?" }, desc: "Post a notification/letter to the Inbox. Light write." },
  { name: "inbox_mark_read", category: "inbox", risk: "write", seamKind: "markRead", input: { id: "string" }, desc: "Mark an item read. Human step-up." },
  { name: "inbox_clear",     category: "inbox", risk: "destructive", seamKind: "clear", input: {}, desc: "Clear the Inbox — irreversible. Human step-up (confirm card)." },
];

export function makeInboxAgent(seam) {
  return makeAgentSurface({ title: "Inbox — agent tools", door: "holo-notify (step-up on clear)", ns: "inbox-agent", tools: TOOLS, seam });
}
export async function browserInboxAgent() {
  const seam = (typeof window !== "undefined" && window.HoloNotify) || null;
  return makeInboxAgent(seam && (seam.agentSeam || seam.seam || seam));
}
export { qContext };
export default makeInboxAgent;
