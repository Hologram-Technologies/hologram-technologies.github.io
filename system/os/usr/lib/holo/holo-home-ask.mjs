// holo-home-ask.mjs — ASK, the Home pillar. CasaOS has no first-class assistant; Holo Home does. This is
// the "just ask" surface for your personal cloud: one typed/spoken turn — "find my trip photos", "open
// Atlas", "what can you tell me about my stuff" — routed through the SAME seams the taps use. It follows
// the unified agent-registry contract { describe, listTools, prepare, invoke }, exactly like holo-stream-
// agent, and reaches the Home modules already built: the manifest (holo-home) for files/apps, and the one
// open path for opening. Two privacy invariants make it safe:
//
//   • bounded to YOUR manifest — find_files only returns manifest-listed files; open_app only opens a
//     PINNED app. Q cannot conjure a file you don't have or open something that isn't yours.
//   • grounding is references, never bytes — ask_grounding returns the κ-refs Q may ground on, never file
//     contents. Q resolves those refs locally; your data never leaves the device to answer a question.
//
// All tools are ambient (read / low-risk navigation), like pressing play. Fail-soft: no manifest, or a
// broken one, yields a clean "unavailable", never a throw. Anchored on: holo-home + the one open path.

export function makeHomeAsk({ home = null, open = null } = {}) {
  const TOOLS = [
    { name: "find_files",    risk: "read", gated: false, desc: "find your files by name" },
    { name: "open_app",      risk: "low",  gated: false, desc: "open one of your apps" },
    { name: "ask_grounding", risk: "read", gated: false, desc: "what I may use to answer about your stuff — references only, never your file contents" },
  ];
  const describe = () => ({ title: "Your stuff", id: "home" });
  const listTools = () => TOOLS.map((t) => ({ ...t }));
  const prepare = (name, args = {}) => { const t = TOOLS.find((x) => x.name === name); return t ? { ok: true, tool: name, args, summary: t.desc } : { ok: false, reason: "unknown tool" }; };

  async function invoke(name, args = {}) {
    try {
      if (!home || typeof home.project !== "function") return { ok: false, reason: "your stuff is unavailable here" };
      const h = await home.project();
      if (!h.ok) return { ok: false, reason: "unavailable" };                 // fail-soft on a broken manifest

      if (name === "find_files") {
        const q = String(args.query || args.q || args.name || "").trim().toLowerCase();
        const files = h.files
          .filter((f) => !q || String(f.name || "").toLowerCase().includes(q))
          .map((f) => ({ ref: f.ref, name: f.name }));                        // refs + names only — bounded to the manifest
        return { ok: true, files };
      }
      if (name === "open_app") {
        const q = String(args.query || args.ref || args.name || "").trim().toLowerCase();
        if (!q) return { ok: false, reason: "say which app to open" };
        const app = h.apps.find((a) => String(a.ref).toLowerCase() === q || String(a.ref).toLowerCase().includes(q));
        if (!app) return { ok: false, reason: "that app isn't in your apps" }; // can't open what isn't pinned
        if (typeof open !== "function") return { ok: false, reason: "open unavailable here" };
        const result = await open(app.ref);                                   // THE one open path
        return { ok: true, opened: app.ref, result };
      }
      if (name === "ask_grounding") {
        return { ok: true, context: (h.ask.context || []).slice(), note: "references only; contents stay on device" };
      }
    } catch (e) { return { ok: false, reason: (e && e.message) || "tool error" }; }
    return { ok: false, reason: "unknown tool: " + name };
  }

  return { describe, listTools, prepare, invoke };
}

// the registry surface — register("home", await browserHomeAsk()). Wires the live manifest + one open path.
export async function browserHomeAsk() {
  const w = (typeof window !== "undefined" ? window : globalThis);
  return makeHomeAsk({ home: w.HoloHome || null, open: typeof w.HoloOpen === "function" ? w.HoloOpen : null });
}

export default { makeHomeAsk, browserHomeAsk };
