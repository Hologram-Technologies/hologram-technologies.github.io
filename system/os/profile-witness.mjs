// P2 witness: the user PROFILE distills from accreted memory records into a versioned, re-derivable κ.
// Proves: interests reflect usage (recency + up-votes), down-votes → avoid, profile κ re-derives (L5),
// tamper fails verify, distillation is DETERMINISTIC (same records → same κ; different records → different κ),
// and the Q-upgrade seam overrides interests yet falls back to baseline on any failure. 100% local + pure.
import { distillProfile, verifyProfile, profileTerms, makeQProfiler } from "./usr/lib/holo/holo-profile.mjs";

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
const rec = (kind, text, vote) => ({ "holmem:kind": kind, "holmem:text": text, ...(vote ? { "holmem:vote": vote } : {}) });

// a usage history: jazz/guitar/music intents, an up-vote on jazz, a down-vote on crypto
const records = [
  rec("intent", "play some jazz music"),
  rec("intent", "tabs for a guitar solo"),
  rec("intent", "recommend a jazz album"),
  rec("feedback", "loved the jazz recommendation", "up"),
  rec("intent", "what is a crypto airdrop"),
  rec("feedback", "not interested in crypto spam", "down"),
  rec("intent", "best jazz guitar players"),
];

const p = distillProfile(records);
ok(p["holo:interests"].includes("jazz") && p["holo:interests"].includes("guitar"), `interests reflect usage: [${p["holo:interests"].slice(0,5).join(", ")}]`);
ok(p["holo:avoid"].includes("crypto") && !p["holo:interests"].includes("crypto"), `down-voted "crypto" → avoid, not interests`);
ok(p["holo:recentIntents"].length && p["holo:observations"] === 7, `recentIntents captured, ${p["holo:observations"]} observations`);
ok(p.kappa && p.kappa.startsWith("did:holo:sha256:"), `profile has a κ (${p.kappa.slice(0,26)}…)`);

// L5: re-derives, tamper fails
ok(verifyProfile(p), "verifyProfile: κ re-derives over the canonical body (L5)");
const tampered = { ...p, "holo:interests": [...p["holo:interests"], "injected"] };
ok(!verifyProfile(tampered), "tampered profile (added interest) → verify FAILS (L5)");

// determinism: same records → same κ; a different history → different κ
ok(distillProfile(records).kappa === p.kappa, "deterministic: same records → same profile κ");
const other = distillProfile([rec("intent", "rust async runtime"), rec("intent", "wasm simd benchmark"), rec("feedback", "great rust tip", "up")]);
ok(other.kappa !== p.kappa && other["holo:interests"].includes("rust"), "different usage → different profile κ (interests=rust/wasm)");

// profileTerms — the flat signal surfaces feed to ranking
ok(profileTerms(p).includes("jazz"), `profileTerms exposes the interest signal for ranking`);

// Q upgrade seam: a mock brain overrides interests
const qprof = makeQProfiler({ generate: async () => '{"interests":["modular synthesis","jazz harmony"],"background":"musician","intentions":["learn improv"]}' });
const pq = await qprof.distill(records);
ok(pq["holo:method"] === "q-v1" && pq["holo:interests"].includes("modular synthesis") && pq["holo:background"] === "musician" && verifyProfile(pq), "Q-profiler overrides interests + adds background, κ still re-derives");
// fallback: a broken brain → baseline
const qbad = makeQProfiler({ generate: async () => "not json" });
const pb = await qbad.distill(records);
ok(pb["holo:method"] === "baseline-v1" && pb.kappa === p.kappa, "Q failure → silent fallback to the deterministic baseline");

console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: the profile distills from usage, re-derives (L5), is deterministic + tamper-refusing, Q-upgradable, 100% local"}`);
process.exit(fail ? 1 : 0);
