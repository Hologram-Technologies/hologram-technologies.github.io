// holo-playground-games.mjs — Holo Playground 3.0, Stage 3: MINI-GAMES played ON the screen's own objects. The
// elements you can drag and blow around become the pieces of a tiny game — Whack them as they pop, or Match the
// pairs. Pure delight, and pure in the κ sense too: a game is the MOST ephemeral activity in Playground. It runs
// in its OWN throwaway play session (separate from the surface's editable session), so nothing a game does can
// ever be sealed — quitting restores the screen exactly, and a game can never accidentally bake into a κ.
//
// THE TWO HALVES (the Atlas discipline):
//   PURE game LOGIC (witnessed) — deterministic state machines over opaque object indices. Whack uses a seeded
//     LCG (no Math.random, no Date) so its pop sequence + scoring are reproducible in the Node witness; Match is
//     a pure pairing machine over a key vector. No DOM, no timers.
//   createGameHost (browser-only) — binds a chosen game to the live objects: an ephemeral HUD (score · quit), a
//     tap router, and animation through a PRIVATE play session (scale a popped object, hide a matched pair). On
//     quit it resets that private session, so the surface returns untouched. It never calls the surface sealer.

import { createPlaySession } from "./holo-playground-canvas.mjs";

// ── pure: Whack — objects pop up in a seeded order; tap the one that's up to score, miss otherwise. ──────────
export function createWhackLogic({ count = 6, rounds = 12, seed = 1 } = {}) {
  let s = (seed >>> 0) || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;   // deterministic LCG in [0,1)
  let score = 0, misses = 0, round = 0, up = -1, over = false;
  function popNext() {
    if (round >= rounds || count <= 0) { up = -1; over = true; return -1; }
    round++; up = Math.floor(rnd() * count) % count; return up;
  }
  function tap(i) {
    if (over) return { hit: false, over: true };
    if (i === up) { score++; up = -1; return { hit: true, score }; }
    misses++; return { hit: false, score };
  }
  return { popNext, tap, state: () => ({ score, misses, round, rounds, up, over }), isOver: () => over };
}

// ── pure: Match — pick two objects; equal keys clear the pair and score; win when all pairs are cleared. ─────
export function createMatchLogic({ keys = [] } = {}) {
  const matched = new Set(); let picks = []; let score = 0;
  const pairable = keys.length - (keys.length % 2);
  function isWon() { return pairable > 0 && matched.size >= pairable; }
  function pick(i) {
    if (i < 0 || i >= keys.length || matched.has(i) || picks.includes(i)) return { ignored: true };
    picks.push(i);
    if (picks.length < 2) return { picked: i, pending: true };
    const [a, b] = picks; picks = [];
    if (a !== b && keys[a] === keys[b]) { matched.add(a); matched.add(b); score++; return { match: [a, b], score, won: isWon() }; }
    return { miss: [a, b], score };
  }
  return { pick, state: () => ({ matched: [...matched], picks: [...picks], score }), isWon };
}

// ── the data-driven GAME REGISTRY — a new game is a data entry, not host code. ──────────────────────────────
export const GAMES = [
  { id: "whack", label: "Whack", icon: "🔨", min: 2 },
  { id: "match", label: "Match", icon: "🃏", min: 4 },
];
export const gameById = (id) => GAMES.find((g) => g.id === id) || null;

// a stable "type" signature so Match pairs visually-similar objects (tag + first class).
export function objectKey(el) {
  try { const tag = (el.localName || el.nodeName || "x").toLowerCase(); const cls = (String(el.className || "").trim().split(/\s+/)[0] || ""); return tag + "." + cls; }
  catch (e) { return "x"; }
}

// ── createGameHost — browser-only. Drives a game over the live objects via a PRIVATE ephemeral session. ──────
// { doc, win, getObjects()->el[], label } → { start(id), stop(), isRunning() }. Never seals anything, ever.
export function createGameHost({ doc, win, getObjects, label = (en) => en } = {}) {
  if (!doc || !win || typeof doc.createElement !== "function") return { start: () => false, stop: () => {}, isRunning: () => false };
  const gameSession = createPlaySession();      // PRIVATE: a game's moves live here, NOT in the surface's editable session
  let objs = [], hud = null, running = null, timer = 0, game = null;

  function ensureStyle() {
    if (doc.getElementById("holo-pg-game-style")) return;
    const st = doc.createElement("style"); st.id = "holo-pg-game-style"; st.setAttribute("data-holo-ephemeral", "");
    st.textContent = `
      .holo-pg-hud{position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483602;display:flex;gap:14px;align-items:center;
        padding:11px 18px;border-radius:999px;background:var(--holo-surface,#14161b);border:1px solid var(--holo-accent,#5b8cff);
        color:var(--holo-ink,#eef2f6);box-shadow:0 14px 38px rgba(0,0,0,.5);font:1rem system-ui,sans-serif}
      .holo-pg-hud b{font-variant-numeric:tabular-nums}
      .holo-pg-hud button{min-height:36px;padding:6px 14px;border-radius:999px;border:1px solid var(--holo-border,#2a2f3a);background:transparent;color:inherit;cursor:pointer;font:inherit}
      .holo-pg-hud button:hover{background:color-mix(in srgb,var(--holo-accent,#5b8cff) 22%,transparent)}
      .holo-pg-pop{outline:3px solid var(--holo-accent,#5b8cff)!important;outline-offset:3px;z-index:5;position:relative}
      .holo-pg-pick{outline:3px dashed var(--holo-accent,#5b8cff)!important;outline-offset:3px}`;
    (doc.head || doc.documentElement).appendChild(st);
  }
  function setHud(html) { if (!hud) { hud = doc.createElement("div"); hud.className = "holo-pg-hud"; hud.setAttribute("data-holo-ephemeral", ""); (doc.body || doc.documentElement).appendChild(hud); } hud.innerHTML = html; const q = hud.querySelector("[data-quit]"); if (q) q.onclick = () => stop(); }
  const idxOf = (el) => { let n = el; while (n && objs.indexOf(n) < 0) n = n.parentElement; return objs.indexOf(n); };

  function start(id) {
    stop();
    const G = gameById(id); if (!G) return false;
    objs = (getObjects ? getObjects() : []) || [];
    if (objs.length < (G.min || 2)) { ensureStyle(); setHud(`<span>${label("Need more objects to play")} ${G.icon}</span><button data-quit>${label("OK")}</button>`); win.setTimeout(stop, 1600); return false; }
    ensureStyle();
    running = G;
    if (id === "whack") startWhack(); else if (id === "match") startMatch();
    doc.addEventListener("pointerdown", onTap, true);
    return true;
  }
  function onTap(e) {
    if (!running) return;
    if (e.target && e.target.closest && e.target.closest(".holo-pg-hud")) return;   // let the HUD buttons work
    const i = idxOf(e.target); if (i < 0) return;
    e.preventDefault(); e.stopPropagation();
    if (running.id === "whack") tapWhack(i); else if (running.id === "match") tapMatch(i);
  }

  // ── Whack ──
  function startWhack() {
    game = createWhackLogic({ count: objs.length, rounds: Math.max(8, objs.length * 2) });
    renderWhack(); pop();
    timer = win.setInterval(pop, 850);
  }
  function pop() {
    clearPop();
    const up = game.popNext();
    if (up < 0) { endGame(); return; }
    const el = objs[up]; if (el) { try { el.classList.add("holo-pg-pop"); } catch (e) {} gameSession.setTransform(el, { scale: 1.28 }); }
    renderWhack();
  }
  function clearPop() { for (const el of objs) { try { el.classList.remove("holo-pg-pop"); } catch (e) {} } gameSession.reset(); }
  function tapWhack(i) { const r = game.tap(i); if (r.hit) { try { objs[i].classList.remove("holo-pg-pop"); } catch (e) {} gameSession.reset(); } renderWhack(); }
  function renderWhack() { const s = game.state(); setHud(`<span>🔨 ${label("Whack")}</span><span>${label("Score")} <b>${s.score}</b></span><span>${label("Round")} <b>${s.round}/${s.rounds}</b></span><button data-quit>${label("Quit")}</button>`); }

  // ── Match ──
  function startMatch() { game = createMatchLogic({ keys: objs.map(objectKey) }); renderMatch(); }
  function tapMatch(i) {
    const before = game.state().picks.slice();
    const r = game.pick(i); if (r.ignored) return;
    const el = objs[i];
    if (r.pending) { try { el.classList.add("holo-pg-pick"); } catch (e) {} }
    else if (r.match) { for (const k of r.match) { try { objs[k].classList.remove("holo-pg-pick"); } catch (e) {} gameSession.hide(objs[k]); } if (r.won) { renderMatch(); win.setTimeout(endGame, 600); return; } }
    else if (r.miss) { renderMatch(); win.setTimeout(() => { for (const k of r.miss) { try { objs[k].classList.remove("holo-pg-pick"); } catch (e) {} } }, 500); }
    renderMatch();
  }
  function renderMatch() { const s = game.state(); setHud(`<span>🃏 ${label("Match")}</span><span>${label("Pairs")} <b>${s.matched.length / 2}</b></span>${game.isWon() ? `<b>${label("You win!")}</b>` : ""}<button data-quit>${label("Quit")}</button>`); }

  function endGame() {
    if (timer) { win.clearInterval(timer); timer = 0; }
    const s = game ? game.state() : { score: 0 };
    setHud(`<span>${running ? running.icon : "✦"} ${label("Done")}</span><span>${label("Score")} <b>${s.score || s.matched && s.matched.length / 2 || 0}</b></span><button data-quit>${label("Close")}</button>`);
    doc.removeEventListener("pointerdown", onTap, true);
    running = null;   // the HUD lingers with the score until Close; the private session is reset on stop()
  }
  function stop() {
    if (timer) { win.clearInterval(timer); timer = 0; }
    doc.removeEventListener("pointerdown", onTap, true);
    try { for (const el of objs) { el.classList && el.classList.remove("holo-pg-pop", "holo-pg-pick"); } } catch (e) {}
    try { gameSession.reset(); } catch (e) {}     // restore EVERY object a game touched — the surface is untouched, nothing sealed
    if (hud) { try { hud.remove(); } catch (e) {} hud = null; }
    running = null; game = null; objs = [];
  }
  return { start, stop, isRunning: () => !!running, describe: () => ({ is: "mini-games on the screen's objects — run in a PRIVATE ephemeral session, never seal, quit restores the surface" }) };
}

export default { createWhackLogic, createMatchLogic, GAMES, gameById, objectKey, createGameHost };
