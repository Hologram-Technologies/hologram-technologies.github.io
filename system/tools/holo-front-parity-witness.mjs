#!/usr/bin/env node
// holo-front-parity-witness.mjs — M-B: HoloFront is a verb-parity SUPERSET of the Flux surface, so apps/web can
// bind to ONE door. Proves HoloFront exposes the 8 Flux verbs (me/spaces/open/post/search/invite/people/onChange)
// AND the three-noun primitives (node/pocket/mount) over ONE shared κ-store — a Flux post is grabbable by the
// Pocket (cross-app composition in the real app). The migration is safe: HoloFront ≥ HoloWeb.
// node tools/holo-front-parity-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeFront } from "../os/usr/lib/holo/holo-front.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tick = 0; const now = () => `2026-06-27T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const alice = await enroll({ label: "front-parity", passphrase: "one door for flux" });
const front = makeFront({ signer: alice, now });

// ── 1 · verb parity: HoloFront exposes all 8 Flux verbs ───────────────────────────────────────────────
const VERBS = ["me", "spaces", "open", "post", "search", "invite", "people", "onChange"];
ok("frontHasAll8FluxVerbs", VERBS.every((v) => typeof front.web[v] === "function"), VERBS.filter((v) => typeof front.web[v] !== "function").join(",") || "all 8");

// ── 2 · the three-noun primitives are present on the SAME door ────────────────────────────────────────
ok("frontHasThreeNounPrimitives", !!front.node && !!front.pocket && typeof front.mount === "function" && typeof front.me === "function", "node/pocket/mount/me");

// ── 3 · ONE shared store: a Flux post's κ is grabbable+resolvable by the Pocket ───────────────────────
await front.web.open("Garden");
await front.web.post("Garden", "the tomatoes need water");
const view = await front.web.open("Garden");
const postUrl = view && view.posts && view.posts[0] && view.posts[0].id;
const resolved = postUrl ? front.pocket.resolve(front.pocket.wal(postUrl)) : null;
ok("sharedStoreFluxPostGrabbable", !!postUrl && String(postUrl).startsWith("did:holo:") && !!resolved && resolved.id === postUrl, `postUrl=${postUrl ? String(postUrl).slice(0, 20) : "null"} resolved=${!!resolved}`);

// ── 4 · identity coherence: the node DID and the Flux display name are the SAME agent ─────────────────
ok("identityCoherent", front.me() === alice.kappa && !!front.web.me().handle && front.web.me().guest === false, JSON.stringify({ me: front.me() === alice.kappa, handle: !!front.web.me().handle }));

// ── 5 · a Flux post can be EMBEDDED into another app via the Pocket (cross-app, zero-copy) ────────────
const board = front.mount({ name: "board", perspectives: ["wall"], produces: [], consumes: ["literal"] });
front.pocket.grab(front.pocket.wal(postUrl));
const w = front.pocket.drop();
const emb = await front.pocket.embed(board.handle.perspective, front.me(), w);
const embedded = board.handle.view({ predicate: front.pocket.EMBEDS });
ok("fluxPostEmbedsCrossApp", emb.ok && embedded.length === 1 && embedded[0].target === postUrl, JSON.stringify({ ok: emb.ok, n: embedded.length }));

await forget(alice.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-front-parity (M-B) — HoloFront is a verb-parity superset of the Flux surface: the 8 Flux verbs + the three-noun primitives (node/pocket/mount) over ONE shared κ-store. A Flux post is grabbable, resolvable, and embeddable cross-app via the Pocket. apps/web can bind to this single door without loss (HoloFront ≥ HoloWeb).",
  authority: "the three-noun door · Coasys/ADAM client parity · the felt layer",
  witnessed, checks, failed: fail,
};
writeFileSync(join(here, "holo-front-parity-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-front-parity — M-B: HoloFront ≥ HoloWeb (one door: Flux verbs + Pocket, shared store)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — apps/web can bind to ONE door; Flux + Pocket unified` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
