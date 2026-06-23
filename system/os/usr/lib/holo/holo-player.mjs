// holo-player.mjs — THE ONE PLAYER. The unification: in Hologram everything is a κ that PLAYS — an app, a
// chat, a document, a space, the home wall. They all go through ONE play() path; only the delta producer
// differs (a render loop for a surface, a token decoder for a chat). This is the Netflix-grade model made
// literal over the one self-verifying substrate: a POSTER is a cheap, content-derived projection (no mount,
// no network); PLAY verifies-before-mount (Law L5 — a tampered κ refuses) and drives the thing's delta
// stream; a cached κ replays O(1) (instant); CONTINUE resumes the exact prior κ-state; the WALL is
// personalized by a private profile re-rank. Apps and the LLM coexist on ONE budgeted scheduler, so the orb
// renders while Q generates and the frame rate holds. One seam; every holo-native experience plays through it.
//
// Composes the committed, node-witnessed streaming primitives (cac7848). Browser glue (resolve = the
// substrate resolver, mount = the projection, rank = holo-profile) is INJECTED, so the player's logic is
// witnessed in Node and the SAME player drives the real OS. node-, SW- and DOM-safe.

import { makeComputeMemo } from "./holo-compute-memo.mjs";
import { makeMeter } from "./holo-stream-meter.mjs";
import { makeScheduler } from "./holo-scheduler.mjs";
import { makeDeltaLoop } from "./holo-delta-render.mjs";
import { makeDeltaDecoder } from "./holo-delta-llm.mjs";

// makePlayer({ resolve, mount?, rank?, now?, budgetMs? })
//   resolve : async (κ) → bytes | null   — the substrate resolver (already L5-verified; null = refuse)
//   mount   : async (κ, bytes, surface) → handle   — the projection mount (optional; default = κ handle)
//   rank    : (posters[]) → posters[]    — the profile re-rank for the wall (optional; default = identity)
export function makePlayer({ resolve, mount = null, rank = null, now = null, budgetMs = 8.33 } = {}) {
  if (typeof resolve !== "function") throw new Error("holo-player: needs resolve(κ)→bytes|null");
  const memo = makeComputeMemo({ cap: 8192 });               // the shared compute memo (instant replay)
  const meter = makeMeter({ window: 240 });                  // one meter across the whole experience
  const scheduler = makeScheduler({ now: now || (() => Date.now()), budgetMs });   // the one loop
  const sessions = new Map();

  // poster(κ) — a cheap, deterministic, content-derived projection (a hue + sigil from the κ). No resolve,
  // no mount: a wall of thousands of posters costs nothing and leaks no content (Law L1 — the κ IS identity).
  function poster(kappa) {
    const h = String(kappa).split(":").pop();
    return { kappa, hue: parseInt(h.slice(0, 2), 16), tone: parseInt(h.slice(2, 4), 16), sigil: h.slice(0, 6) };
  }

  // play(κ, opts) — the one path. Verify-before-mount, then drive the kind's delta stream on the shared
  // scheduler. kind ∈ {app, doc, space, chat}; render kinds use a delta loop, chat uses the delta decoder.
  async function play(kappa, { kind = "app", surface = null, produce = null, regions = null } = {}) {
    const bytes = await resolve(kappa);
    if (!bytes) throw new Error(`holo-player: refuse — ${kappa} did not verify (Law L5)`);   // verify-before-play
    const handle = mount ? await mount(kappa, bytes, surface) : { kappa };
    const id = String(kappa) + ":" + kind;
    let driver, pump;
    if (kind === "chat") {
      const dec = makeDeltaDecoder({ memo, meter }); driver = dec; let p = 0;
      pump = async () => { if (!produce || !regions || p >= regions.length) return { idle: true }; await dec.step(kappa, regions[p], produce); p++; };
    } else {
      const loop = makeDeltaLoop({ memo, meter, transform: produce || (async () => new Uint8Array(0)) }); driver = loop;
      pump = async () => { if (!regions) return { idle: true }; await loop.frame(regions); };   // unchanged regions short-circuit O(1)
    }
    const unreg = scheduler.register({ id, priority: kind === "app" ? 0 : (kind === "chat" ? 1 : 0), pump, kind });
    const session = { kappa, kind, handle, driver, stop() { unreg(); sessions.delete(id); } };
    sessions.set(id, session);
    return session;
  }

  // continue(κ, priorStateκ) — resume the exact prior κ-state (play the saved state). The same operation as
  // play; only the κ differs (the resumed state instead of the cold app).
  async function cont(kappa, priorStateKappa, opts = {}) { return play(priorStateKappa || kappa, opts); }

  // wall(κs) — the home wall: posters, personalized by the profile re-rank (private, deterministic). The
  // personalization is a re-order over shared posters — only the order is "hers", the posters are shared.
  function wall(kappas) {
    const posters = kappas.map(poster);
    return rank ? rank(posters) : posters;
  }

  return { poster, play, cont, wall, tick: (o) => scheduler.tick(o), sessions: () => [...sessions.values()], memo, meter, scheduler };
}

export default { makePlayer };
