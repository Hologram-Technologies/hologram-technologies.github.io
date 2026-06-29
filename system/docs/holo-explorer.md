# HOLO EXPLORER — Your Whole Device, As a Living κ-Brain (Canonical Spec)

## The one magical moment (this is the vision — everything serves it)
A user installs Hologram. First boot. By the time the desktop paints, one quiet line fades in:
"Mapping your world — 84,210 files." They open Explorer. Their entire life is already there —
every file, photo, document, download — not a dumb list, but a living, searchable, self-verifying
map of everything they own. They type "the lease I signed last spring" → it's on screen in
200ms. They ask aloud "what was I working on with Maria?" → a constellation lights up. They set
up nothing. They click no "scan" button. It was already done. And tomorrow it knows more.

That is the whole product: open the lid, your world is already mapped, sovereign, instant, and
it sharpens while you sleep. Abstract every piece of machinery below it. The user sees one
familiar window that just works.

## Design laws — the "it just works" contract (violating any one breaks the magic)
1. ZERO setup. No buttons, no wizard, no "grant access" friction beyond the OS-level prompt the
   user already expects. The first scan starts itself on first boot.
2. NEVER blocks. First paint, login, and desktop are never delayed by indexing (honor boot-smoke
   gate, login-never-blank, single-boot-tab, warm-resident). The brain is a background citizen.
3. ALWAYS instant to the eye. The tree is usable in <1s on every boot. Heavy work streams behind
   a quiet progress chip — never a modal, never a spinner-wall.
4. EXHAUSTIVE. Every readable file on every mounted volume, or it's logged and visibly skipped —
   never silently dropped. The user can trust "everything is in here."
5. FAMILIAR first, magical second. It opens looking like the Explorer/Finder they already know.
   The graph, the search, the brain are one keystroke away — not in the user's face on second one.
6. SOVEREIGN + VERIFIABLE. 100% on-device (L1). Every node re-derivable from its κ (L5). Nothing
   egresses without an explicit capability.
7. SELF-HEALING + INCREMENTAL. Warm boots are delta-only. A crash mid-scan resumes. Corruption
   is detected by re-derivation and re-fetched.
8. IT'S JUST THE WEB. The whole surface is a normal Hologram holospace app talking to normal
   holo:// URLs. No bespoke IPC the user or a future maintainer has to reason about.

## CEF-NATIVE SPINE — 100% integrated, no bolt-ons (the architectural keystone)
Everything heavy lives in the native CEF/Tauri host; the browser side only ever fetches holo://.
This is what makes it seamless AND fast: the Explorer app is dumb and familiar; the host does the
work and serves results through the κ scheme the host already trusts.

- THE SCANNER LIVES IN THE HOST, NOT THE PAGE.
  New native module `device_scan.rs` in `holo-apps/apps/tauri/src-tauri/`, started from
  `hologram_lib::run()` immediately AFTER `store()` (lib.rs:28) and BEFORE the window opens, as a
  detached task — and mirrored as a CEF deferred task in `cef-host/src/main.cc RunMain` (the same
  2.5s deferred-task seam already used for lens/bench), so boot latency (HoloProcUptimeMs) is
  untouched. This is the ONLY genuinely new native code; everything else is wiring.
- SERVED THROUGH THE κ SCHEME — no new bridge. Extend `cef-host/src/kappa_scheme.cc
  KappaSchemeHandler` so the browser reads the index and any file's bytes as ordinary holo://
  URLs, dual-axis-verified exactly like the sealed OS image. The Explorer app does
  `fetch("holo://device/...")` — that's it. Familiar web platform, zero special-case JS.
  - `holo://device/closure` → the live device manifest (see device-closure.json below)
  - `holo://blake3/<hex>` → any file's verified bytes (Bao-streamed for large files)
  - `holo://device/graph/...` → hypergraph slices, `holo://device/search?q=...` → ranked hits
- PROGRESS IS A STREAM, not a poll. Host emits `device-scan:progress` over the same
  BroadcastChannel pattern the shell uses for `holo-desk:tree`. The chip is live, the tree
  back-fills as κs land.
- BYTES LAND IN THE NATIVE STORE. Content goes into `hologram-store-native` (`put`, SHARDED >64KiB,
  PINNED roots) — the redb CAS the host already owns. OPFS store (`opfs_put/get/gc`) mirrors only
  what the page itself authors. One CAS, one GC, one trust boundary.

## PLANE 1 — IDENTITY INDEX (must finish; fast; exhaustive)
Every file becomes a self-verifying κ + a manifest row. This is the "your whole device is here" guarantee.
- ADDRESS: reuse `address_bytes()/blake3_kappa()` (hologram-archive/src/address.rs) → `blake3:<hex>`.
  Large files: Bao (`kappa-route/src/bao.rs`, 1KiB chunks) for a verified root κ without holding
  the body; `kappa_from_fingerprint()` seeds the κ from the digest alone. Identical content dedups
  to one κ for free.
- TIERED for instant-feel + exhaustiveness:
  - Tier 0 (instant): `stat-κ` from (path,size,mtime,dev,inode). Tree renders NOW from this.
  - Tier 1 (background, authoritative): full content κ via the worker pool (rayon, cores-1, mmap),
    replacing the provisional id. Saturate disk read bandwidth.
- INCREMENTAL (this is what makes warm boots feel like magic): persist a (path,size,mtime)→κ
  redb table. First boot = full sweep. Every later boot re-hashes ONLY changed files → index
  "current" in ~1s. Reuse the versioned-release/self-heal + atomic-reseal pattern for the manifest.
- RUNTIME MANIFEST — `device-closure.json` (mirror os-closure.json exactly, generated at runtime,
  itself κ-sealed, old root kept for rollback):
  { "@context":"https://hologram.os/ns/device-closure","name":"<device>","algo":"blake3",
    "generatedAt":"<iso>","files":N,"uniqueKappa":M,"bytes":T,
    "closure": { "<abs-path>": {"kappa":"blake3:…","bytes":N,"mtime":…,"mime":"…",
                 "volume":"…","source":"device"} } }
  Exhaustive over files; bytes are a lazy cache (ingest on first read, evictable via GC; the
  manifest row survives eviction — re-fetch on demand).
- WATCHER: `notify`-crate FS watcher (reuse the CEF hot-reload / live-anchor pattern) → on change,
  re-address only the delta, atomically patch the manifest + graph. The map is never stale.

## PLANE 2 — MEANING HYPERGRAPH (progressive; lazy; compounds)
Turn the κ index into a sovereign knowledge hypergraph — the difference between a file list and a brain.
- PER-FILE: feed each decodable file's source κ into `runPlus()` (holo-plus.mjs) by-κ intake
  (`resolveObject` — no re-upload, L5-verified). `sealIngest` yields source/view/closure κ +
  family classification; `holo-map.extractGraph` (+ `makeQExtractor` with the Q brain) yields
  entities/relations; `mergeGraphs` folds them in. Lowest-priority tier, AFTER Plane 1 is durable.
- HYPERGRAPH not graph (Hyper-Extract): n-ary hyperedges — a folder, a project, a photo burst, an
  email thread, a topic — connect MANY nodes at once, so "everything about Project X" is one
  traversal. Add TEMPORAL (mtime/created → timeline) and SPATIAL (folder/volume locality) axes as
  first-class. Reuse the semantic-web substrate for typed edges; self-evolving-context for drift.
- SPATIAL PALACE (MemPalace): Volume=wing, Folder/Project=room, File=drawer holding verbatim κ
  bytes (never summarize the source of truth; summaries are derived κ on top). Gives scoped
  retrieval and a navigable mental map.
- PRIORITIZE by recency + `HoloProfile.terms()` so what the user touches becomes meaningful first.

## PLANE 3 — GROWTH (the second-brain loop; "smarter every day")
- AUTHORING: new κ-notes save to writable home (Files mkdir/write), content-addressed on save,
  L5-verifiable, auto-linked into the hypergraph as [[wikilinks]] (Hyper-Extract export shape →
  human-editable markdown AND κ-native at once). Obsidian vaults import as κ and export back to
  markdown+[[links]] losslessly — model- and tool-agnostic, the brain outlives any one model.
- ROOT PROFILE κ ("who I am", loads every session): bootstrapped by a one-question-at-a-time Q
  interview on first run (who you are, goals, how to talk to you, projects); written as a
  user-owned, κ-sealed, versioned note; folded into `rankByContext`. Never re-explain yourself.
- PROJECT SCOPING (altitude): a project = a κ-subgraph (room) mountable as a holospace
  (tab=mount(κ)) with its own context note + Inputs/Process/Outputs/Feedback. Focus mode restricts
  the brain to that subgraph. The device-graph plans; one project ships.
- SKILLS: repeated workflows saved as κ skill objects (reuse Forge + Q mux) — "run the <name>
  skill" executes, shareable + verifiable.
- LIVE CONNECTORS: calendar/email/Slack/Notion/WhatsApp via the MCP surface + "+" intake into the
  SAME hypergraph (read-only, scoped). A meeting becomes a hyperedge over the people/files it touches.
- AUTOPILOT: a daily routine (Cron) re-scans deltas, files Inputs, links, flags stale/orphans,
  re-ranks to current interests, and delivers a 3-line "what changed overnight" brief
  (`composeBrief`+`deliver` → Inbox/voice/notifications). `runPlus` surfaces unasked-for
  connections. This is the compounding engine, made literal.

## CAPABILITY SECURITY — keys, not prompts (HARD LAW)
- Read/index/link/author-in-home: default-allowed (local, reversible, L1).
- Delete / overwrite / send / spend / any egress: REQUIRE a scoped capability — Agent Passport
  delegation + biometric step-up (holo-agent-passport, holo-biometric-stepup, holo-pass TEE vault).
  Q must ASK and step up (same discipline as the wallet surface). Never gate by prompt wording.
- Connectors mount read-only, minimum scope. Every capability use is provenance-logged
  (holo-strand source chain). Fix the cleartext-session leak first (identity-boundary audit) so the
  whole-device graph is never readable by an arbitrary app.

## THE SURFACE — Holo Explorer (familiar shell, magical core)
Evolve `holo-apps/apps/files/` (+ `_shared/holo-files.js`); add a "This Device" source to `ROOTS()`
backed by holo://device/*. `list/read/verify` work unchanged. Five lenses, one window:
1. TREE — the classic explorer, now spanning the whole disk + the existing 7 VFS sources. Day one
   it feels exactly like the tool they already use. Human names via truenames + clean-addresses.
2. SEARCH — talk-to-your-disk bar. Tier A: local embeddings + keyword + temporal hybrid (NO LLM
   required, fully offline — the always-works floor). Tier B: Q reranks/answers and cites source κs.
   Wire to the Q companion command router + Q voice loop so it works typed or spoken. Sub-300ms,
   accelerated by Echo/Instant cache-collapse + Lightspeed κ-projection on repeat queries.
3. ATLAS — the hypergraph as a navigable spatial palace (wings/rooms/drawers); click a node →
   provenance, κ, and a one-click verify badge (L5 re-derivation).
4. TIMELINE — the temporal axis of your whole device.
5. INBOX/BRIEF — the overnight summary + proactive insights; act in one click (capability-gated).
- Previews are cheap-then-gorgeous: render thumbnails/quicklooks via the Canvas envelope
  (cheap render → projected super-res), media via Holo Player, all from κ.
- A quiet boot chip ("Mapping your world — N files, verifying"), never a modal. Keyboard shortcuts
  + native chrome bars make it feel like a first-class OS surface, not a web page.

## SPEED BUDGET (state it, measure it, gate on it)
- First boot: tree usable < 1s (Tier-0); full content-κ sweep streams at disk-read bandwidth with
  a live count; nothing blocks first paint.
- Warm boot: index "current" ~1s (mtime cache; ~0 re-hashes on an unchanged disk).
- Search: < 300ms typed result (Tier A); repeats near-instant (Echo/Instant + Lightspeed).
- Watcher delta: a touched file is re-addressed + re-linked within one cycle, reversibly.
- Memory: bounded by GC; manifest is durable truth, bytes are a cache.

## FULL STACK REUSE MAP (make the most of what already exists)
- Identity/serve: address.rs (address_bytes/blake3_kappa/kappa_from_fingerprint) · bao.rs
  (verify_chunk/BaoEncoder) · hologram-store-native (put/SHARDED/PINNED) · hologram-store-opfs
  (opfs_put/get/iterate/gc) · kappa_scheme.cc (KappaSchemeHandler) · os-closure.json +
  make-dist.mjs sealTree (manifest shape) · kappa-route load_store (dual-axis verify)
- Speed: Holo Echo/Instant (cache-collapse) · verified-streaming κ-fabric · upstream O(1) memo ·
  Lightspeed κ-projection
- Boot/CEF: lib.rs run()/store() · cef-host main.cc RunMain deferred tasks · CEF hot-reload /
  live-anchor (watcher) · warm-resident · boot-smoke gate · login-never-blank · single-boot-tab ·
  three-OS-trees + reseal.mjs
- Meaning: holo-plus runPlus · holo-ingest sealIngest/classify · holo-map extractGraph/
  mergeGraphs/makeQExtractor · holo-insight investigate · holo-plus-context captureContext/
  rankByContext · semantic-web substrate · self-evolving-context · Hyper-Extract n-ary +
  spatio-temporal · MemPalace spatial palace + no-LLM retrieval tiers
- Brain loop: HoloProfile.terms() · Forge (skills) · autonomy-spine · notifications + Inbox ·
  holo-brief composeBrief/deliver · Q companion router · Q voice loop · Q mux · Cron · keyboard
  shortcuts · MCP surface + "+" intake (live connectors)
- Surface: holo-files (ROOTS/list/read/verify) · Canvas envelope (super-res previews) · Holo
  Player (media) · native chrome bars · clean-addresses · truenames (κ→human words)
- Security: agent-passport · biometric step-up · holo-pass TEE · identity-boundary audit ·
  strand source chain · L1 private-first · L5 verify-by-re-derivation

## PHASING + WITNESSES (the repo proves everything — keep the discipline)
- P0 Native scanner + κ-scheme serve: walk + content-address + serve holo://device/*. Witness:
  every file in a known tree appears in device-closure.json with a κ that re-derives (L5); count parity.
- P1 Incremental cache + watcher. Witness: warm boot ~0 re-hashes; touch a file → only it re-addresses.
- P2 Explorer "This Device" tree + boot chip. Witness: lists/reads/verifies device files; boot-smoke green; first paint not delayed.
- P3 Hypergraph (n-ary + temporal + spatial). Witness: a folder/project hyperedge resolves; provenance κ links resolve.
- P4 Retrieval. Witness: Tier-A finds a known file offline with no LLM; Tier-B answer cites source κs; <300ms.
- P5 Atlas + Timeline + Canvas previews. Witness: graph navigates; verify badge re-derives; thumbnails render from κ.
- P6 Root profile + interview. Witness: profile κ loads every session; ranking shifts.
- P7 Authoring loop + Obsidian round-trip. Witness: new note auto-links; vault import↔export keeps [[links]].
- P8 Project scoping + skills. Witness: focus mode restricts context; a saved skill runs end-to-end.
- P9 Live connectors (calendar, read-only). Witness: today's events are hyperedges citing source κs; no write capability.
- P10 Autopilot + overnight brief. Witness: scheduled run files Inputs + delivers brief.
- P11 Capability audit. Witness: delete/send WITHOUT capability → refused; WITH passport+step-up → allowed + logged.
- Each phase: seal via tools/reseal.mjs; boot-only deploy gate stays green.

## DEFINITION OF DONE — the "it just works" checklist
Open the lid → your whole device is already a living, self-verifying κ-brain. Tree usable in <1s,
search under 300ms, everything verifies (L5), nothing left the device (L1). You set up nothing.
It looks like the Explorer you know on second one and becomes a brain on second two. It files
itself, links itself, and briefs you overnight; warm boots are instant; touching a file updates
the map automatically; dangerous actions need a real key, never a polite prompt. Plain-text /
Obsidian-portable, model-agnostic, sovereign. The complexity is invisible. It just works.

---
P0 starter code: see [holo-explorer-p0.md](holo-explorer-p0.md).
