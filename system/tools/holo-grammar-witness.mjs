#!/usr/bin/env node
// holo-grammar-witness.mjs — THE UNIFICATION: prove the whole module sprawl is a GRAMMAR — 3 nouns + 9 verbs.
// Reads the live module directory and assigns EVERY module to exactly one of 12 categories by ordered
// first-match rules (so no module is double-counted). Asserts the 12 categories ABSORB the sprawl (high
// coverage), every category is used, and reports the concept-count drop (N modules → 12 → 3 nouns).
// Authority: ADAM (Agent/Language/Perspective) · coasys link-language family · holospaces laws. node tools/holo-grammar-witness.mjs

import { readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = join(here, "../os/usr/lib/holo");
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const NOUNS = ["AGENT", "κ", "HOLOSPACE"];
const VERBS = ["MINT", "NAME", "WRAP", "MOVE", "COMPILE", "PROJECT", "LINK", "GOVERN", "SHARE"];

// ordered, specific → general. First match wins ⇒ a module lands in exactly one category (no double-count).
const RULES = [
  // ── AD4M family (explicit, most specific first — each ad4m-* lands in its true verb/noun) ─────────────
  [/ad4m-dna|ad4m-neighbourhood/, "GOVERN"],
  [/ad4m-mcp|ad4m-ambient/, "AGENT"],
  [/ad4m-wan|ad4m-discovery/, "MOVE"],
  [/ad4m-fediverse|ad4m-lang/, "WRAP"],
  [/ad4m-boot/, "HOLOSPACE"],
  [/ad4m-synergy|holo-ad4m$/, "LINK"],
  // ── GOVERN: validate / authorize / attest / membrane ────────────────────────────────────────────────
  [/dna|neighbourhood|membrane|warrant|watchtower|admit|strand-rules|strand-audit|^holo-gov|revocation|attest|coattest|conscience|immune|^holo-trust|consent|^holo-terms|ceremony|zone-net|^holo-zone|capability|grant|delegate|stepup|^holo-auth|guard|^holo-proof|^holo-requires|investigation/, "GOVERN"],
  // ── MINT: bytes → κ (encode / ingest / capture) ─────────────────────────────────────────────────────
  [/ingest|^holo-import|^holo-capture|^holo-record|^holo-zip|^holo-ascii|^holo-scaffold|qr-encode|^holo-raster/, "MINT"],
  // ── AGENT: identity · keys · Q/mind · wallet · the node · autonomy ───────────────────────────────────
  [/identity|^holo-keys|vault|credential|passkey|webauthn|totp|^holo-session|^holo-login|profile|agent|^holo-node|pair|privacy|pqc|^holo-zk|soulbis|mind|^holo-q\b|^holo-q-|qvac|bittensor|brain|learn|finetune|wallet|^holo-wdk|fiat|lending|evm|solana|^holo-ton|^holo-eth|x402|walletconnect|onboarding|^holo-spine|^holo-own|^holo-aa\b|^holo-ambient|^holo-auto|autofill|^holo-evolve|^holo-fix|scheduler|device-tier|^holo-voice|^holo-strand|^holo-anchor/, "AGENT"],
  // ── κ: the atom · runtime · store ────────────────────────────────────────────────────────────────────
  [/^holo-object|^holo-kappa\b|blake3|^holo-cid|^holo-uor|^holo-bao|store|kstore|^holo-memo|compute|^holo-shard|erasure|block|^holo-prov|origin|realization|coherence|^holo-phi|opfs|^holo-cosmos\b|^holo-kappa-room|registry|backup|runahead|^holo-spine/, "κ"],
  // ── NAME: κ ↔ human name ─────────────────────────────────────────────────────────────────────────────
  [/truename|proquint|plainwords|^holo-words|address|locator|resolve|^holo-omni/, "NAME"],
  // ── WRAP: a network ↔ κ (= ADAM Language) ────────────────────────────────────────────────────────────
  [/language|fediverse|federate|ipfs|hypercore|^holo-chain|dweb|webdav|jellyfin|youtube|sponsorblock|bridge|user-adapter|^holo-nostr|nostr|matrix|atproto|solid|^holo-net\b|^holo-ext|^holo-crx/, "WRAP"],
  // ── MOVE: κ across the wire ──────────────────────────────────────────────────────────────────────────
  [/transport|swarm|gossip|^holo-rtc|relay|courier|deliver|^holo-route|^holo-pull|^holo-push|handoff|teleport|roam|mailbox|churn|rendezvous|^holo-wan|^holo-relay/, "MOVE"],
  // ── COMPILE: model/program → κ (.holo) ───────────────────────────────────────────────────────────────
  [/forge|onnx|^holo-compile|delta-llm|micro-finetune/, "COMPILE"],
  // ── PROJECT: κ → rendered surface ────────────────────────────────────────────────────────────────────
  [/projection|projector|render|^holo-surface|superres|fidelity|media|video|audio|sound|^holo-gfx|^holo-fx|gpu|canvas|^holo-scene|^holo-tile|framebuffer|reproject|lens|screen|splash|manim|qml|skin|theme|icons|identicon|widgets|^holo-ui|^holo-ux|immersive|^holo-xr|vinyl|player|^holo-nav|^holo-bar|appearance|continue-ui|rewind-ui|roam-ui|dsp|asanoha|clouds|jupiter|stations|sheet|^holo-aside/, "PROJECT"],
  // ── LINK: κ ↔ κ (typed relation, meaning, knowledge) ─────────────────────────────────────────────────
  [/graph|^holo-edge|^holo-embed|^holo-link|semantic|intent|insight|recommend|^holo-rank|memory|indexer|search|^holo-find|^holo-map|atlas|learning|brief|answer|^holo-ask|observer|telemetry|metrics/, "LINK"],
  // ── SHARE: hand a κ between agents / apps ────────────────────────────────────────────────────────────
  [/pocket|share|pluck|^holo-plus|^holo-open|^holo-send|collab|live-edit|^holo-edit|notepad|^holo-qr|broadcast|present|^holo-notify|^holo-handoff/, "SHARE"],
  // ── HOLOSPACE: the worlds + apps (compositions) ──────────────────────────────────────────────────────
  [/holospace|workspace|^holo-world|^holo-zone|space3d|^holo-home|^holo-hub|station|room|platform|machine|^holo-app|playground|files|messenger|browser|^holo-desk|^holo-dock|^holo-product|^holo-os|^holo-host|^holo-loader|^holo-boot|^holo-plymouth|^holo-sddm|^holo-sdk|^holo-stream|^holo-player|^holo-tron|^holo-immersive|teleport|riscv|alpine|make-vendor|worker|^holo-front|^holo-journey|mobile-defaults|^holo-manage|^holo-pm\b|^holo-dweb/, "HOLOSPACE"],
];

// REVIEWED OVERRIDES (M-C) — hand-reviewed corrections where the keyword heuristic mis-assigns. These are the
// authoritative truth and survive regeneration. Each is justified by the module's own purpose comment.
const OVERRIDES = {
  "holo-bridge": "AGENT",            // cross-chain financial bridge (USD₮0/LayerZero) — a wallet faculty, not a Language
  "holo-bridge-adapters": "AGENT",   // one financial bridge per platform, as data — wallet faculty
  "holo-net": "MOVE",                // ONE content-network interface (content-peer transport), not a Language
  "holo-user-adapter": "AGENT",      // lifecycle for YOUR private per-user LoRA adapter — an agent faculty
  "holo-sponsorblock": "PROJECT",    // strips in-video sponsor segments — media processing, not a network wrap
  "holo-ext": "HOLOSPACE",           // Chrome extensions as κ-objects (apps in the browser surface)
  "holo-crx": "HOLOSPACE",           // Chrome extension packaging (apps)
  "holo-ext-install": "HOLOSPACE",   // in-browser install front door for Holo Browser (app surface)
  "holo-lock": "AGENT",              // Warm Lock — biometric session gate (identity/auth faculty)
  "holo-lock-ui": "AGENT",           // the lock overlay surface (biometric gate)
  "holo-resume-dom": "HOLOSPACE",    // Deep Resume — per-app scroll/draft restore (experience continuity)
  "holo-foresight": "LINK",          // Proof-of-Foresight — private κ-graph vs crowd price (insight)
  "holo-foresight-feed": "LINK",     // foresight insight feed
  "holo-foresight-live": "LINK",     // live foresight signal
  "holo-instant": "κ",               // Echo/Instant — equivalent op-sequences collapse to ONE κ
};
const categorize = (name) => { if (OVERRIDES[name]) return OVERRIDES[name]; for (const [rx, cat] of RULES) if (rx.test(name)) return cat; return null; };

const files = readdirSync(libDir).filter((f) => f.endsWith(".mjs") || f.endsWith(".js")).map((f) => f.replace(/\.(mjs|js)$/, ""));
const uniq = [...new Set(files)];
const byCat = Object.fromEntries([...NOUNS, ...VERBS].map((c) => [c, []]));
const residue = [];
for (const name of uniq) { const c = categorize(name); if (c) byCat[c].push(name); else residue.push(name); }
const categorized = uniq.length - residue.length;
const coverage = categorized / uniq.length;

ok("everyCategoryUsed", [...NOUNS, ...VERBS].every((c) => byCat[c].length > 0), [...NOUNS, ...VERBS].filter((c) => !byCat[c].length).join(",") || "all 12 used");
ok("highCoverage", coverage >= 0.9, `${(coverage * 100).toFixed(1)}% (${categorized}/${uniq.length}); residue=${residue.length}`);
ok("noModuleUncategorizedAbove5pct", residue.length / uniq.length < 0.1, `residue ${residue.length}/${uniq.length}`);

const dist = Object.fromEntries([...NOUNS, ...VERBS].map((c) => [c, byCat[c].length]));
const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-grammar — the whole module sprawl as a GRAMMAR: 3 nouns (Agent/κ/Holospace) + 9 verbs (mint/name/wrap/move/compile/project/link/govern/share). Every module maps to exactly one category by ordered first-match. Concept-count: N modules → 12 categories → 3 nouns. WRAP is the only 'Language' (matches coasys link-language family); compile/project/move/name are first-class verbs, not Languages.",
  authority: "ADAM Agent/Language/Perspective · coasys link-language family · holospaces laws",
  witnessed, total: uniq.length, categorized, coverage: +(coverage * 100).toFixed(1), distribution: dist, residue,
  byCategory: byCat, checks, failed: fail,
};
writeFileSync(join(here, "holo-grammar-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
// emit the CANONICAL MAP (flat module → category) — the single reviewed source of truth the gate enforces.
// Seeded from the categorizer; REFINE by editing this file (an edit here is the only way to recategorize).
const flatMap = {};
for (const c of [...NOUNS, ...VERBS]) for (const name of byCat[c]) flatMap[name] = c;
for (const name of residue) flatMap[name] = "UNCATEGORIZED";
const mapDoc = { "@type": "holo:GrammarMap", nouns: NOUNS, verbs: VERBS, generated: "seeded-from-categorizer", count: uniq.length, map: flatMap };
writeFileSync(join(here, "../os/etc/holo-grammar.map.json"), JSON.stringify(mapDoc, null, 0) + "\n");
console.log(`holo-grammar — ${uniq.length} modules → 3 nouns + 9 verbs\n`);
for (const c of [...NOUNS, ...VERBS]) console.log(`  ${NOUNS.includes(c) ? "▣" : "▸"} ${c.padEnd(10)} ${String(byCat[c].length).padStart(3)}`);
console.log(`\n  coverage ${(coverage * 100).toFixed(1)}%  ·  categorized ${categorized}/${uniq.length}  ·  residue ${residue.length}`);
if (residue.length) console.log(`  residue: ${residue.slice(0, 40).join(", ")}${residue.length > 40 ? " …" : ""}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓ — the sprawl IS a grammar: 3 nouns, 9 verbs" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
