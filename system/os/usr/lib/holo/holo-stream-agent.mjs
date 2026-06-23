// holo-stream-agent.mjs — "just ask": the streaming spine as Q tools (S6). Registers ONE surface into the
// unified agent registry so a spoken/typed turn — "open my research space", "continue where I left off",
// "share this" — routes through the SAME seams the taps use: window.HoloOpen (S2, the one open path),
// window.HoloContinue (S1, Continue watching), and the ♥ Share carriage. No new open logic — Q just reaches
// the streaming spine through the tool router it already runs. All three are low-risk navigation (ungated:
// they run ambiently, like pressing play), never a destructive write.
//
// The surface contract is the registry's: { describe, listTools, prepare, invoke }. Pure-ish (reads the
// window seams at call time); node-witnessable by stubbing the seams. Fail-soft: a missing seam → a clean
// "unavailable", never a throw.

const W = () => (typeof window !== "undefined" ? window : globalThis);
const doc = () => (typeof document !== "undefined" ? document : null);

const TOOLS = [
  { name: "play_open", risk: "low", gated: false, desc: "open or play an app, space, page, or link by name — press play and it runs" },
  { name: "continue_watching", risk: "low", gated: false, desc: "continue watching — resume the last thing you had open, pick up where you left off" },
  { name: "share_current", risk: "low", gated: false, desc: "share this — get a link to the current app or holospace" },
];

export function describe() { return { title: "Hologram", id: "stream" }; }
export function listTools() { return TOOLS.map((t) => ({ ...t })); }
export function prepare(name, args = {}) { const t = TOOLS.find((x) => x.name === name); return t ? { ok: true, tool: name, args, summary: t.desc } : { ok: false, reason: "unknown tool" }; }

export async function invoke(name, args = {}, ctx = {}) {
  const w = W();
  try {
    if (name === "play_open") {
      const q = String(args.query || args.ref || args.q || args.name || "").trim();
      if (!q) return { ok: false, reason: "nothing to open — say what to open" };
      if (!w.HoloOpen) return { ok: false, reason: "open unavailable here" };
      await w.HoloOpen(q);
      return { ok: true, opened: q };
    }
    if (name === "continue_watching") {
      const C = w.HoloContinue;
      const items = (C && typeof C.items === "function" && C.items()) || [];
      if (!items.length) return { ok: false, reason: "nothing recent to continue yet" };
      const pick = args.query ? (items.find((i) => String(i.title || "").toLowerCase().includes(String(args.query).toLowerCase())) || items[0]) : items[0];
      if (C.open) await C.open(pick); else if (w.HoloOpen) await w.HoloOpen(pick.addr);
      return { ok: true, resumed: pick.title };
    }
    if (name === "share_current") {
      const d = doc(); const btn = d && d.getElementById("share-btn");
      if (!btn) return { ok: false, reason: "share unavailable here" };
      btn.click();
      return { ok: true, opened: "share" };
    }
  } catch (e) { return { ok: false, reason: (e && e.message) || "tool error" }; }
  return { ok: false, reason: "unknown tool: " + name };
}

// the registry surface — register("stream", await browserStreamAgent()).
export async function browserStreamAgent() { return { describe, listTools, prepare, invoke }; }

export default { describe, listTools, prepare, invoke, browserStreamAgent };
