#!/usr/bin/env node
// holo-fediverse-fold-witness.mjs — STEP B (cont.): fold the FEDIVERSE adapter (a genuine {create,get}
// Language: ActivityPub Notes) onto the ONE capability-typed registry. Proves the folded path yields a
// BIT-IDENTICAL κ to the bespoke noteExpression path, is typed as a transport Language, and round-trips (L5).
// Authority: ADAM Language · the objective seam · Law: bit-identity.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeNode } from "../os/usr/lib/holo/holo-node.mjs";
import { noteExpression, foldActivityPub } from "../os/usr/lib/holo/holo-ad4m-fediverse.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tick = 0; const now = () => `2026-06-27T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const me = await enroll({ label: "fedi-fold", passphrase: "federate on κ" });
const note = { type: "Note", id: "https://mastodon.example/@ana/1", attributedTo: "https://mastodon.example/@ana", content: "hello from the fediverse" };
const prov = { actor: "https://mastodon.example/@ana", activity: "Create" };

// Path A — BESPOKE: noteExpression directly
const A = noteExpression(note, prov).id;

// Path B — FOLDED: through the ONE registry
const node = makeNode({ signer: me, now });
const folded = foldActivityPub(node);
const B = node.languages.express("activitypub", { note, prov }).url;

ok("fediverseFoldBitIdentical", A === B && String(A).startsWith("did:holo:"), `A==B=${A === B}`);
ok("fediverseIsTransportLanguage", node.languages.byCapability("transport").some((L) => L.name === "activitypub") && folded[0] === "activitypub", JSON.stringify(node.languages.byCapability("transport").map((L) => L.name)));
const rt = node.languages.get(B);
ok("fediverseRoundTrips", rt && rt.id === B && rt["ad4m:language"] === "activitypub", "express→get re-verifies (L5)");

await forget(me.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-fediverse-fold (ADAM convergence Step B) — the fediverse adapter (ActivityPub Notes, a genuine {create,get} transport Language) folded onto the ONE registry produces a BIT-IDENTICAL κ to the bespoke noteExpression path, is capability-typed (transport), and round-trips (L5). Five real adapters now fold: web/web3/ai + activitypub + (storage via ingest pending).",
  authority: "ADAM Language · objective seam · Law: bit-identity",
  witnessed, parityA: A, parityB: B, checks, failed: fail,
};
writeFileSync(join(here, "holo-fediverse-fold-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-fediverse-fold — STEP B: fold the fediverse adapter (bit-identical)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — activitypub folded, κ bit-identical` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
