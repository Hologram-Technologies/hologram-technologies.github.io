#!/usr/bin/env node
// holo-strand-feed-witness.mjs — proves the human-readable view of the ONE spine: a single chronological
// feed across resume / ingest / audit / rules, most-recent-first, each row carrying a plain summary and
// its provenance (entry κ, signed flag, seq). This is what makes "one spine" felt — Q answers "what did
// I do?" from the single chain. Drives the real holo-strand + a real enrolled holo-identity signer.
//
// Checks (all must hold):
//   1 feedSpansAllKinds  — one feed includes session/ingest/audit/ruleset entries from the single spine.
//   2 mostRecentFirst    — rows are reverse-chronological (newest seq first).
//   3 humanSummaries     — each row has a plain-language summary (not a raw kind token) + entry κ + signed.
//   4 kindFilter         — filtering by kinds returns only those kinds.
//   5 digestHeadline     — digest() is a one-sentence headline naming the latest act.
//   6 emptyIsHonest      — an empty spine yields an empty feed and an honest digest.
//
// Authority: UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-strand + #holo-identity.
// node tools/holo-strand-feed-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { activityFeed, digest } from "../os/usr/lib/holo/holo-strand-feed.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tick = 0; const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "feed-tester", passphrase: "correct horse battery feed" });
const strand = makeStrand({ now, signer: op });
await strand.append({ kind: "session.open", payload: { host: "primeos" } });
await strand.append({ kind: "ingest", payload: { name: "acme.txt", kind: "text", source: "did:holo:sha256:" + "a".repeat(64) } });
await strand.append({ kind: "audit", payload: { act: "wallet.send", level: "value", reason: "Send 0.4 ETH on base to 0xabc" } });
await strand.append({ kind: "ruleset", payload: { rulesetKappa: "did:holo:sha256:" + "b".repeat(64), ruleset: { name: "base" } } });

const feed = activityFeed(strand);

// 1 · one feed spans all kinds
const kindsSeen = new Set(feed.map((r) => r.kind));
ok("feedSpansAllKinds", ["session.open", "ingest", "audit", "ruleset"].every((k) => kindsSeen.has(k)) && feed.length === 4, JSON.stringify([...kindsSeen]));

// 2 · most-recent-first
ok("mostRecentFirst", feed[0].seq === 3 && feed[feed.length - 1].seq === 0, feed.map((r) => r.seq).join(","));

// 3 · human summaries + provenance on every row
ok("humanSummaries",
  feed.every((r) => typeof r.summary === "string" && r.summary !== r.kind && /^did:holo:sha256:[0-9a-f]{64}$/.test(r.kappa) && r.signed === true),
  JSON.stringify(feed.map((r) => r.summary)));

// 4 · kind filter
const onlyAudit = activityFeed(strand, { kinds: ["audit"] });
ok("kindFilter", onlyAudit.length === 1 && onlyAudit[0].kind === "audit" && /Approved/.test(onlyAudit[0].summary), JSON.stringify(onlyAudit));

// 5 · digest headline
const d = digest(strand);
ok("digestHeadline", /4 things on your spine/.test(d) && /Adopted the rules/.test(d), d);

// 6 · empty spine is honest
const empty = makeStrand({ now });
ok("emptyIsHonest", activityFeed(empty).length === 0 && /empty/.test(digest(empty)), digest(empty));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-strand feed — the human-readable view of the ONE spine: a single most-recent-first feed across resume/ingest/audit/rules, each row a plain summary plus provenance (entry κ, signed, seq), and a one-sentence digest. Makes 'one spine' felt — Q answers 'what did I do?' from the single chain. Pure, additive, projection-only.",
  authority: "UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-strand + #holo-identity",
  witnessed,
  covers: witnessed ? ["spans-all-kinds", "recent-first", "human-summaries", "kind-filter", "digest", "empty-honest"] : [],
  sample: { digest: digest(strand), feed: feed.map((r) => `${r.seq} ${r.summary}`) },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-strand-feed-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-strand witness — FEED (the human-readable view of the one spine)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  digest: ${digest(strand)}`);
feed.forEach((r) => console.log(`   #${r.seq}  ${r.summary}`));
console.log(`\n  ${witnessed ? "WITNESSED ✓  one spine, one human-readable history" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
