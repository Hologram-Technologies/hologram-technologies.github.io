// holo-nav.mjs — the ONE navigation model. It fixes wall #4: today the three surfaces (mobile home,
// desktop shell, app frame) navigate differently and the app frame is a dead end with no back/home. This is
// a tiny state machine over the player that gives EVERY surface the same model: home(the wall) ⇄ open(play)
// with a back-history, continue resumes the exact state, and home() ALWAYS returns to the wall — a
// guaranteed escape, so she can never get stuck. The three surfaces become skins: each wires just a back
// button, a home button, and a render to onChange. Abstract complexity → one seam; deliver simplicity.
//
// Pure + deterministic (node-witnessable). The player (committed) does the κ-verified play/continue/wall;
// this only sequences views. node-, SW- and DOM-safe.
//
//   makeNav({ player, wallKappas }) →
//     open(κ, opts) → view      · cont(κ, stateκ, opts) → view   (opts: { kind, surface, produce, regions })
//     back() → view             · home() → view (the wall, always)
//     canBack() → bool          · current() → view               · onChange(cb) → unsubscribe
//     history() → view[]
//   view = { kind:"home", wall:[poster] } | { kind, kappa, session, resumed? }

export function makeNav({ player, wallKappas = [] } = {}) {
  if (!player) throw new Error("holo-nav: needs { player }");
  const history = [];
  const subs = new Set();
  let view = { kind: "home", wall: player.wall(wallKappas) };

  const emit = () => { for (const cb of subs) { try { cb(view); } catch (e) {} } };

  async function open(kappa, opts = {}) {
    const session = await player.play(kappa, opts);          // verify-before-play (L5), instant if cached
    history.push(view);                                       // remember where we were
    view = { kind: opts.kind || "app", kappa, session };
    emit(); return view;
  }

  async function cont(kappa, stateKappa, opts = {}) {
    const session = await player.cont(kappa, stateKappa, opts);
    history.push(view);
    view = { kind: opts.kind || "app", kappa: stateKappa || kappa, session, resumed: true };
    emit(); return view;
  }

  function back() {
    if (history.length === 0) return home();                 // nothing behind ⇒ go home (never a dead end)
    view = history.pop();
    emit(); return view;
  }

  function home() {
    history.length = 0;
    view = { kind: "home", wall: player.wall(wallKappas) };   // always reconstructable, always reachable
    emit(); return view;
  }

  const canBack = () => history.length > 0;
  const current = () => view;
  const onChange = (cb) => { subs.add(cb); return () => subs.delete(cb); };

  return { open, cont, back, home, canBack, current, onChange, history: () => history.slice() };
}

export default { makeNav };
