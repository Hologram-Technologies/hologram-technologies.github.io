# ADR-0105 — Holo Workspace Sync: backup, recover, and resume the *exact* workspace on any device — serverless, content-addressed, transport-honest

Status: **Stage 1 LANDED + witnessed 23/23** (`system/tools/holo-workspace-sync-witness.mjs`). Stage 1 = the portable seal/restore core: the same `holo:SessionManifest` that Holo Session (ADR-0104) already captures, sealed as a real **IPFS UnixFS DAG** (not just a local-κ-store κ), restored on a **different device** without the device-binding refusal, exported as a single **CAR** (the shareable resume token), with the bytes-transport pinned honestly in a receipt. Built on the existing sealer (`sealSnapshot`) and resolver (`resolveIpfsPath`) verbatim — one sealer, one resolver, no new substrate. A `#holo-workspace-sync` conformance row is added and registered in the gate's live set. Cross-machine *byte movement* ships staged: the **file** tier (carry the CAR) is serverless and works today; **pin** and **peer** are Stage 2/3. **Deferred:** the `os-closure.json` κ-pin for the new served module (the same step the recent ADR rows defer). Landed 2026-06-16.

Relates: [[holo-session-persistence-adr]] (ADR-0104 — the device-LOCAL continuity leg this extends; its row names `holo-zk.js` cross-device as the deferred *future axis* — this ADR is that axis) · [[web-commons-snapshot]] (`sealSnapshot` — the page→IPFS κ-DAG mint reused verbatim) · [[ipfs-native-browsing]] (ADR-0026, `resolveIpfsPath` — the trustless DAG resolver reused verbatim) · [[holo-onion-omnisearch-adr]] (ADR-0103 — the **transport-honesty split** copied here: address self-verifies, bytes need a named transport) · [[ADR-0022]] (W3C content addressing — CIDv1 sha2-256 ≡ `did:holo:sha256`) · [[ADR-0082]] (PROV-O receipts, out-of-band) · holospaces Laws L1 (identity is content, not location) / L4 (local/serverless) / L5 (verify by re-derivation).

---

## Context

Holo Session (ADR-0104) already does the thing that is hard: it captures a signed-in operator's **entire** experience — holospace tabs with order, the active tab, each tab's open-surface snapshot `{world,layout,focusedId}`, and an auditable settings allowlist — into **one** PROV-O `holo:SessionManifest`, and κ-seals it (κ = SHA-256 of the manifest's RFC-8785 JCS bytes). Restore re-derives the bytes (L5) and rehydrates the desktop in one deterministic reflow.

But it is **device-LOCAL by deliberate construction**, and that is exactly the wall this ADR removes:

1. The manifest is sealed into **local IndexedDB** (`holo-kstore`), not as an IPFS object — so it cannot travel.
2. `restore()` **refuses** any manifest whose embedded device-κ ≠ this machine ([holo-session.mjs](../../os/usr/lib/holo/holo-session.mjs) line 113). A store copied to another machine yields a clean default. ADR-0104's own row says so plainly: *"cross-device continuity is explicitly a DIFFERENT, future axis (the holo-zk selective-disclosure egress envelope), NOT this row."*

This ADR is that future axis. The ask: **backup, recover, and resume the exact workspace from any device, at any time — feeling like cloud, being 100% sovereign.**

### The load-bearing tension (the same one Onion faced)

A content address is **self-verifying with no network at all**: a CIDv1/`did:holo:sha256` re-derives to itself (L5). But the **bytes** behind it must physically reach the other device. We must not paper over this (L5):

- **The resume token** (the manifest's root CID) proves *what* the workspace is, offline, forever.
- **The bytes** require an explicit **transport**. Three honest tiers:
  - **file** — download/paste the **CAR** bundle. Fully serverless, works today. The "email yourself a file" tier.
  - **pin** — the CID lives on an IPFS peer/gateway; any device resolves it through the existing trustless gateway. Serverless once pinned.
  - **peer** — live P2P borrow-a-peer. Future.

The receipt pins which tier carried the bytes and asserts `directIPFS:false` until a real peer/pin actually serves them — never presenting a not-yet-transported snapshot as available.

### Why this is mostly wiring

`sealSnapshot({resources})` already mints a real UnixFS DAG (CIDv1, raw leaves under a dag-pb directory). `resolveIpfsPath(root, path, getBlock)` already walks that DAG back to bytes, trustless, re-deriving every block. `encodeCar(roots, blocks)` already produces the standard single-file IPFS bundle, and `CarParser` parses it back. The settings allowlist (`isExperienceKey`) already enforces the privacy boundary. The only genuinely new code is the **glue**: seal the manifest as a one-file DAG, restore it **without** the device check, wrap a transport receipt.

---

## Decision

Add a thin, **opt-in portable leg** — `os/sbin/holo-workspace-sync.mjs` — that reuses Session's manifest, the IPFS sealer, and the IPFS resolver, abstracting the whole loop behind one verb pair.

### The capture schema (unchanged)

The portable snapshot **is** the existing `holo:SessionManifest` — the same `buildManifest()` output. No second schema. Two fields are dropped from the **addressed** body so the CID is a pure function of the *experience*:

- **`holo:device`** — the machine anchor must not travel and must not gate restore (dropping it is what removes the wall);
- **`prov:generatedAtTime`** — provenance is lineage; folding it into the κ breaks κ-memo (the Holo Playground lesson). It moves **out-of-band** into the receipt.

Result: the same workspace on any machine, at any time, seals to the **same CID** — real cross-device dedup, idempotent re-seal, history-for-free.

### The resume token

The token is the manifest DAG's **root CID** (`bafy…`, equivalently `did:holo:sha256:…`). Self-verifying, copy-pasteable, one line. That is the "magical" surface: copy a token on machine A, paste on machine B, you are back.

### The verbs (the one-verb abstraction)

```
sealWorkspace({ manifest, transport, now })        → { rootCid, did, blocks, manifest, receipt }
restoreWorkspace(rootCid, getBlock)                → { manifest } | null   (transport-honest null)
verifiedBlockSource(blocks)                        → getBlock that re-derives every block (L5)
exportCar(rootCid, blocks)                          → Uint8Array            (the single-file token)
importCar(carBytes)                                 → { roots, blocks }     (CarParser)
```

`sealWorkspace` calls `sealSnapshot([{ name: "workspace.json", bytes: jcs(portable) }])` — **the same sealer the web commons uses**. `restoreWorkspace` calls `resolveIpfsPath(rootCid, "workspace.json", getBlock)` — **the same resolver IPFS browsing uses** — drains the stream, re-derives, parses. Applying the restored manifest reuses Session's `applyExperience` (settings → localStorage → subsystems rehydrate) but **skips the device-binding refusal** — that skip is the entire point. `verifiedBlockSource` makes restore trustless even from a plain block map (the SW path uses `makeGetBlock`, which verifies the same way against live gateways).

### Transport tiers + receipt

```
{ "@type": ["prov:Entity","holo:WorkspaceSyncReceipt"],
  "holo:rootCid": "...", "holo:resumeToken": "did:holo:sha256:...",
  "holo:transport": "file|pin|peer|null", "holo:directIPFS": false,
  "holo:blockCount": N, "holo:byteSize": B, "prov:generatedAtTime": "..." }
```

Resolving with a block source that cannot serve the blocks returns **null** — an honest "not transported here," never a crash and never a faked restore (mirrors Onion's transport-honest null).

### Privacy boundary

The snapshot carries **only** what `isExperienceKey` allows: `holo-widgets.*`, `holo.voice.*`, `holo:wall*`, `holo-vinyl.*`, `holo.q.*`, `holo.playground`. `sealWorkspace` re-filters the settings through the allowlist **defensively** — even a hand-built manifest cannot smuggle an identity/device/corpus key into a shareable DAG (witnessed). Tier capabilities and the **private Recall corpus** (ADR-0099) live in the κ-store/conscience, are not settings, and never enter the shareable DAG — a restored capability is never faked (L5). The portable snapshot is operator-portable, not operator-impersonating.

---

## Honest staging

- **Stage 1 (LANDED):** seal-as-DAG · device-free restore · CAR export/import · transport-honest receipt + null. Fully serverless, witnessed in Node (cross-device dedup to the same CID, round-trip κ-parity across a simulated foreign device, L5 tamper-refusal, privacy-boundary including a rogue-key probe, CAR round-trip, no egress).
- **Stage 2:** shell wiring (a desktop-menu "Back up / Resume workspace" → download CAR / paste token), the **pin** transport (publish blocks via `publishToKStore` / an IPFS peer so any gateway resolves the CID), and lazy blob resolution (keep wallpapers/app blocks as κ-refs, ship the manifest only).
- **Stage 3:** **peer** transport (live borrow-a-peer), an encrypted-at-rest CAR (the holo-zk selective-disclosure envelope ADR-0104 named) for sharing a token over an untrusted channel, and explicit snapshot history (a CID chain — automatic, since unchanged blocks dedup).

What we explicitly do **not** claim in Stage 1: that pasting a token on a fresh machine with no CAR and no pin will restore. It will not, and it will say so (transport-honest null). That honesty is the feature.

---

## Consequences

- Cloud-grade ergonomics (one token, instant resume, history for free via dedup) with zero server, account, or origin.
- Cost scales with *change*, not workspace size or device count — content addressing gives dedup, idempotent re-seal (κ-memo), and trustless verification for free.
- The remaining hard edge — moving bytes between machines — is surfaced as explicit tiers with a receipt, not hidden. The lowest tier (a CAR file the user carries) is sovereign and works on day one.
