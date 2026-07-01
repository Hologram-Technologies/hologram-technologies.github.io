// holo-agent-registry.mjs — the ONE place Q discovers + invokes EVERY app's agent surface. Closes the
// "no unified registry" gap the reflection found: today wallet/hub/import surfaces are imported ad-hoc at
// call sites, so Q can't discover them from intent. Here, each surface (made via holo-agent-surface, or any
// {describe,listTools,prepare,invoke}) registers ONCE; Q gets a single flat tool menu and routes a chosen
// tool BY NAME to its owning surface — which still governs it (reads ambient, writes step-up). This is the
// substrate the brain's tool-use layer sits on: toolMenu() → the brain picks → invoke(name,args,ctx).
// Pure registry; surfaces are injected (Node) or browser-loaded (browserRegistry). Same κ axis as the OS.
import { jcs, didHolo } from "./holo-uor.mjs";
import { blake3hex } from "./holo-blake3.mjs";   // the ONE canonical κ hash (§1.2)

const _surfaces = new Map();   // surfaceId → { surface, tools: Set<toolName>, title }

export function register(id, surface) {
  if (!id || !surface || typeof surface.listTools !== "function" || typeof surface.invoke !== "function") return false;
  const tools = new Set(surface.listTools().map((t) => t.name));
  const title = (surface.describe && surface.describe().title) || id;
  _surfaces.set(id, { surface, tools, title });
  return true;
}
export const unregister = (id) => _surfaces.delete(id);
export const surfaces = () => [..._surfaces.keys()];
export const ownerOf = (toolName) => { for (const [id, s] of _surfaces) if (s.tools.has(toolName)) return id; return null; };

// the flat tool catalog across ALL registered surfaces — what Q offers as its tool menu. Each tool is tagged
// with its surface; a re-derivable κ over the whole menu makes "what can Q do right now" a content identity.
export function listAllTools() {
  const out = [];
  for (const [id, s] of _surfaces) for (const t of s.surface.listTools()) out.push({ ...t, surface: id });
  return out;
}
export function toolMenu() {                 // compact form for a brain prompt (name · surface · risk · desc)
  const tools = listAllTools().map((t) => ({ name: t.name, surface: t.surface, risk: t.risk, gated: t.gated, desc: t.desc }));
  return { tools, id: didHolo("blake3", blake3hex(new TextEncoder().encode(jcs(tools)))) };   // κ on the ONE axis (§1.2)
}

// route a tool call BY NAME to its owning surface (default-deny: unknown tool refuses). The surface governs.
export async function invoke(toolName, args = {}, ctx = {}) {
  const id = ownerOf(toolName);
  if (!id) return { ok: false, reason: "no registered surface owns tool: " + toolName };
  return _surfaces.get(id).surface.invoke(toolName, args, ctx);
}
export function prepare(toolName, args = {}) {   // proactive proposal (zero side effects), routed by name
  const id = ownerOf(toolName);
  if (!id) return { ok: false, reason: "no registered surface owns tool: " + toolName };
  const s = _surfaces.get(id).surface;
  return s.prepare ? s.prepare(toolName, args) : { ok: false, reason: "surface has no prepare()" };
}

// browser default: load + register the built-in app surfaces (each fails soft if its seam/app is absent, so
// the registry always lists whatever IS present). Q calls this once; then toolMenu()/invoke() are live.
export async function browserRegistry() {
  const mods = [
    ["files",   "./holo-files-agent.mjs",   "browserFilesAgent"],
    ["control", "./holo-control-agent.mjs", "browserControlAgent"],
    ["inbox",   "./holo-inbox-agent.mjs",   "browserInboxAgent"],
    ["wallet",  "./holo-wallet-agent.mjs",  "browserWalletAgent"],
  ];
  for (const [id, path, fn] of mods) {
    try { const m = await import(path); if (m[fn]) register(id, await m[fn]()); } catch (e) { /* app/seam absent → skip */ }
  }
  return { surfaces: surfaces(), tools: listAllTools().length };
}
export default { register, unregister, surfaces, ownerOf, listAllTools, toolMenu, invoke, prepare, browserRegistry };
