// core/keymap.js — the keyboard map as a data table (LibreChat's native set): Alt+N new chat,
// Alt+S toggle sidebar, Alt+W focus the input, Ctrl/⌘+Enter send, Esc stop generation,
// Ctrl/⌘+K model menu. `/` and `@` composer menus live in ui/composer.js (they are caret-local).

export const BINDINGS = [
  { combo: "Alt+N", action: "newChat", label: "New chat" },
  { combo: "Alt+S", action: "toggleNav", label: "Toggle sidebar" },
  { combo: "Alt+W", action: "focusInput", label: "Focus message box" },
  { combo: "Ctrl+Enter", action: "send", label: "Send message" },
  { combo: "Escape", action: "stop", label: "Stop generating" },
  { combo: "Ctrl+K", action: "modelMenu", label: "Choose model" },
];

export function installKeymap(handlers) {
  const onKey = (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const fire = (name) => { const fn = handlers[name]; if (fn) { e.preventDefault(); fn(e); } };
    if (e.altKey && !ctrl && !e.shiftKey) {
      if (e.code === "KeyN") return fire("newChat");
      if (e.code === "KeyS") return fire("toggleNav");
      if (e.code === "KeyW") return fire("focusInput");
    }
    if (ctrl && e.key === "Enter") return fire("send");
    if (ctrl && !e.shiftKey && e.code === "KeyK") return fire("modelMenu");
    if (e.key === "Escape") { const fn = handlers.stop; if (fn) fn(e); }   // don't preventDefault — Esc also closes menus
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}
