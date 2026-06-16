// holo-playground-forces.mjs — Holo Playground 3.0, Stage 2: whole-screen FORCES. When Playground is armed you
// can unleash a "tornado" or an "earthquake" (and more) that ravage the screen apart object by object — pure
// child's delight. A force is NOT a special case in the κ model: it is just an automated driver of the SAME
// ephemeral play session (ADR-0110, Stage 1). It sets transforms on the live elements frame by frame and NEVER
// seals — so a screen you scatter and dismiss is byte-unchanged (Reset), and Freeze after a force bakes the final
// arrangement through the ONE primitive. Forces obey the L5 play rule for free by riding the session.
//
// THE TWO HALVES (the Atlas discipline):
//   PURE physics (witnessed) — a force is a pure FIELD function over an object's centroid plus a pure INTEGRATOR
//     (gravity · damping · floor/wall collision · spin). Deterministic given a fixed dt; a Node witness drives a
//     whole simulated force over a mock session with NO rAF, NO random, NO browser, and proves it's ephemeral.
//   createForceEngine (browser-only) — reads each object's live rect once, seeds particles from the session's
//     current transform, ticks the pure integrator on requestAnimationFrame, writes each frame through
//     session.setTransform (tracked ⇒ Freeze/Reset just work), drives optional text-shatter, and settles. It
//     uses Math.random / rAF / Date.now (runtime, not a witness), so it is never exercised in the pure witness.

// ── pure FIELD functions: force per unit at a particle's current centroid. env carries {w,h,eye,strength,t}. ──
export const zeroForce = () => ({ fx: 0, fy: 0 });

// a vortex: a strong tangential swirl around the eye plus a faint inward pull — the tornado.
export function vortexForce(p, env) {
  const cx = p.cx0 + p.x, cy = p.cy0 + p.y;
  let dx = cx - env.eye.x, dy = cy - env.eye.y;
  const d = Math.hypot(dx, dy) || 1;
  const tx = -dy / d, ty = dx / d;                         // unit tangent (counter-clockwise), ⟂ to the radius
  const swirl = (env.strength || 1000) * Math.min(1, 220 / d);   // stronger near the eye, capped
  const inward = -0.08 * (env.strength || 1000);          // gentle pull toward the eye so objects orbit, not escape
  return { fx: tx * swirl + (dx / d) * inward, fy: ty * swirl + (dy / d) * inward };
}

// a radial field toward (sign<0) or away from (sign>0) the eye — black hole, magnet, repulsor. mode caps falloff.
export function radialForce(p, env, sign = -1, mode = "inverse") {
  const cx = p.cx0 + p.x, cy = p.cy0 + p.y;
  let dx = cx - env.eye.x, dy = cy - env.eye.y;
  const d = Math.hypot(dx, dy) || 1;
  const falloff = mode === "linear" ? d : Math.max(60, d) ;   // linear = magnet (∝ d), inverse = black hole (1/d capped)
  const mag = mode === "linear" ? (env.strength || 6) * falloff : (env.strength || 2000) * (1 / falloff);
  return { fx: Math.sign(sign) * (dx / d) * mag, fy: Math.sign(sign) * (dy / d) * mag };
}

// ── pure INTEGRATOR: advance ONE particle one step. p = {el?, x,y,vx,vy,rot,vrot, cx0,cy0,w,h}. Returns a new p. ──
// x,y are the play-transform offset from the element's home; cx0,cy0 are the centroid at zero offset; w,h its size.
export function integrate(p, env, spec, dt) {
  const field = spec.field || zeroForce;
  const f = field(p, env);
  const g = spec.gravity || { x: 0, y: 0 };
  const damp = spec.damping == null ? 0.99 : spec.damping;
  const rest = spec.restitution == null ? 0.3 : spec.restitution;
  let { x, y, vx, vy, rot = 0, vrot = 0 } = p;
  vx = (vx + (f.fx + g.x) * dt) * damp;
  vy = (vy + (f.fy + g.y) * dt) * damp;
  x += vx * dt; y += vy * dt;
  const halfW = (p.w || 0) / 2, halfH = (p.h || 0) / 2;
  if (spec.floor) {                                          // pile on the viewport floor (the earthquake settle)
    const bottom = p.cy0 + y + halfH;
    if (bottom > env.h) { y = env.h - p.cy0 - halfH; vy = -vy * rest; vx *= 0.7; vrot *= 0.6; }
  }
  if (spec.ceiling) {                                        // for gravity-flip (objects rise and bonk the top)
    const top = p.cy0 + y - halfH;
    if (top < 0) { y = halfH - p.cy0; vy = -vy * rest; vx *= 0.7; }
  }
  if (spec.walls) {
    const left = p.cx0 + x - halfW, right = p.cx0 + x + halfW;
    if (left < 0) { x = halfW - p.cx0; vx = -vx * rest; }
    if (right > env.w) { x = env.w - halfW - p.cx0; vx = -vx * rest; }
  }
  if (spec.spin) rot += vrot * dt;
  return { ...p, x, y, vx, vy, rot, vrot };
}

// ── the data-driven FORCE REGISTRY. A new force is a DATA entry (a field + integrator config), not engine code. ──
// spec(env) returns the integrator config; `shatterText` opts a force into the word-by-word text flourish; `burst`
// seeds an initial random velocity (confetti); `strength` is merged into env for the field functions.
export const FORCES = [
  { id: "tornado",      label: "Tornado",      icon: "🌪", shatterText: true, spec: () => ({ field: vortexForce, gravity: { x: 0, y: -30 }, damping: 0.992, spin: true, duration: 4200, strength: 1500 }) },
  { id: "earthquake",   label: "Earthquake",   icon: "🫨", spec: () => ({ field: zeroForce, gravity: { x: 0, y: 1700 }, damping: 0.985, floor: true, walls: true, spin: true, shake: 26, duration: 3600, restitution: 0.34 }) },
  { id: "black-hole",   label: "Black hole",   icon: "🕳", shatterText: true, spec: () => ({ field: (p, e) => radialForce(p, e, -1, "inverse"), damping: 0.99, spin: true, duration: 5200, strength: 2400 }) },
  { id: "magnet",       label: "Magnet",       icon: "🧲", spec: () => ({ field: (p, e) => radialForce(p, e, -1, "linear"), damping: 0.86, duration: 4200, strength: 7 }) },
  { id: "confetti",     label: "Confetti",     icon: "🎉", spec: () => ({ field: zeroForce, gravity: { x: 0, y: 1100 }, damping: 0.995, walls: true, duration: 3600, burst: 760, spin: true }) },
  { id: "gravity-flip", label: "Gravity flip", icon: "🙃", spec: () => ({ field: zeroForce, gravity: { x: 0, y: -1100 }, damping: 0.99, ceiling: true, walls: true, spin: true, duration: 4200 }) },
];
export const forceById = (id) => FORCES.find((f) => f.id === id) || null;

// is an element a text block worth shattering (has text, isn't mostly nested elements)?
export function isTextish(el) {
  try {
    if (!el || el.nodeType !== 1) return false;
    const txt = (el.textContent || "").trim();
    if (txt.length < 2 || !/\s/.test(txt)) return false;     // need at least two words to shatter
    const kids = el.children ? el.children.length : 0;
    return kids <= 1;                                        // a leaf-ish text node, not a container
  } catch (e) { return false; }
}

// ── createForceEngine — the browser driver. Drives the ephemeral session; never seals. ──────────────────────
// { doc, win, session, getObjects()->el[], shatter?, onTick?, onEnd?(id) }. start(id) unleashes a force; stop()
// halts and settles in place; both reassemble any shattered text BEFORE returning (so nothing transient bakes).
export function createForceEngine({ doc, win, session, getObjects, shatter = null, onTick = () => {}, onEnd = () => {} } = {}) {
  if (!win || !doc) return { start: () => {}, stop: () => {}, isRunning: () => false };
  let raf = 0, running = null, parts = [], env = null, t0 = 0, shards = [];
  const now = () => (win.performance && win.performance.now ? win.performance.now() : Date.now());

  function start(forceId) {
    stop();
    const F = forceById(forceId); if (!F) return;
    const objs = (getObjects ? getObjects() : []) || []; if (!objs.length) return;
    const w = win.innerWidth || 1280, h = win.innerHeight || 800;
    env = { w, h, eye: { x: w / 2, y: h * 0.42 }, t: 0, strength: 1000 };
    const spec = F.spec(env); env.strength = spec.strength || env.strength;
    parts = objs.map((el) => {
      let r; try { r = el.getBoundingClientRect(); } catch (e) { r = { left: 0, top: 0, width: 40, height: 24 }; }
      const base = session.transformOf(el);
      const burst = spec.burst || 0;
      return { el, x: base.x, y: base.y, rot: base.rot || 0,
        vx: (Math.random() - 0.5) * (burst || 60), vy: -Math.random() * (burst || 0), vrot: (Math.random() - 0.5) * 220,
        cx0: r.left + r.width / 2 - base.x, cy0: r.top + r.height / 2 - base.y, w: r.width, h: r.height };
    });
    if (F.shatterText && shatter) { shards = []; for (const p of parts) { if (isTextish(p.el)) { const s = shatter.shatter(p.el); if (s) shards.push(s); } } }
    if (session.setMuted) session.setMuted(true);            // don't rebuild the dock 60fps while the force runs
    running = { F, spec }; t0 = now(); loop();
  }
  function loop() { raf = win.requestAnimationFrame(tick); }
  function tick() {
    if (!running) return;
    const dt = 1 / 60; env.t += dt; env.eye.x += Math.sin(env.t * 1.3) * 1.4;   // the eye drifts so the swirl wanders
    const elapsed = now() - t0;
    const shake = running.spec.shake ? running.spec.shake * Math.max(0, 1 - elapsed / running.spec.duration) : 0;
    parts = parts.map((p) => {
      const np = integrate(p, env, running.spec, dt);
      const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
      try { session.setTransform(np.el, { x: np.x + sx, y: np.y + sy, rot: np.rot }); } catch (e) {}
      moveShard(np);
      return np;
    });
    try { onTick(); } catch (e) {}
    if (elapsed > running.spec.duration) { settle(); return; }
    loop();
  }
  // a shard layer rides its source object's motion (it overlays the now-hidden original).
  function moveShard(p) { const s = shards.find((s) => s.el === p.el); if (s && s.layer) { try { s.layer.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.rot}deg)`; } catch (e) {} } }
  function settle() {
    for (const p of parts) { try { session.setTransform(p.el, { x: p.x, y: p.y, rot: p.rot }); } catch (e) {} }   // final write, no shake
    finish();
  }
  function stop() { if (!running && !raf) return; for (const p of parts) { try { session.setTransform(p.el, { x: p.x, y: p.y, rot: p.rot }); } catch (e) {} } finish(); }
  function finish() {
    if (raf) { try { win.cancelAnimationFrame(raf); } catch (e) {} raf = 0; }
    if (shatter) for (const s of shards) { try { shatter.reassemble(s); } catch (e) {} }   // restore originals BEFORE any Freeze/Reset
    shards = []; const r = running; running = null;
    if (session.setMuted) session.setMuted(false);
    if (r) { try { onEnd(r.F.id); } catch (e) {} }            // one dock render now that the arrangement is final + pending
  }
  return { start, stop, isRunning: () => !!running, describe: () => ({ is: "the ephemeral force engine — automates the play session frame by frame, never seals (Freeze/Reset apply unchanged)" }) };
}

export default { zeroForce, vortexForce, radialForce, integrate, FORCES, forceById, isTextish, createForceEngine };
