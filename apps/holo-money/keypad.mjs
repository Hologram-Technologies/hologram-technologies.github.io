// hm-keypad — the ONE amount keypad shared by Exchange · Send · Request.
// A giant readout + 3×4 grid. No input element: money entry is a gesture, not a form.
// createKeypad({ onChange }) → { el, value(), set(v), reset() }; value is a decimal string.

export function createKeypad({ onChange = () => {}, maxLen = 12 } = {}) {
  let v = "";
  const el = document.createElement("div");
  el.className = "hm-keypad";
  const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];
  el.innerHTML = KEYS.map((k) => `<button type="button" data-k="${k}" aria-label="${k === "⌫" ? "Delete" : k}">${k}</button>`).join("");

  function press(k) {
    if (k === "⌫") v = v.slice(0, -1);
    else if (k === ".") { if (!v.includes(".")) v = (v || "0") + "."; }
    else if (v.length < maxLen) {
      if (v === "0") v = k;                       // no leading zeros
      else v += k;
      const [, dec] = v.split(".");
      if (dec && dec.length > 8) v = v.slice(0, -1);   // 8 decimals max
    }
    onChange(v);
  }
  el.addEventListener("click", (e) => { const k = e.target?.dataset?.k; if (k) press(k); });
  // physical keyboard works too (desktop carriage)
  el.tabIndex = 0;
  el.addEventListener("keydown", (e) => {
    if (/^[0-9.]$/.test(e.key)) { press(e.key); e.preventDefault(); }
    if (e.key === "Backspace") { press("⌫"); e.preventDefault(); }
  });

  return {
    el,
    value: () => v,
    number: () => { const f = parseFloat(v); return Number.isFinite(f) && f > 0 ? f : null; },
    set(nv) { v = String(nv ?? ""); onChange(v); },
    reset() { v = ""; onChange(v); },
  };
}

// shared readout formatter — big number, dimmed trailing dot state
export function readout(v) {
  if (!v) return "0";
  return v.endsWith(".") ? v.slice(0, -1) + "." : v;
}
