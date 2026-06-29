#!/usr/bin/env node
// holo-home-files-witness.mjs — proves THE FILES PILLAR (holo-home-files): a navigable view over the
// manifest's owned file index, where a file's NAME is the address of its bytes (content κ) and opening it
// RE-DERIVES that address — so a compromised store cannot hand you the wrong bytes (file-level Law L5).
// CasaOS's drive/file manager with no drives and no locations. Drives the real substrate: a real content
// store contract (KappaStore: get(κ)→bytes, κ = sha256 of bytes) via an in-memory adapter, a real
// holo-home manifest over holo-strand, and the real provenance seam (holo-strand-provenance).
//
// Checks (all must hold):
//   1 listGroupsByFolder    — listFolder returns exactly the entries whose parent matches (root vs folder).
//   2 breadcrumbWalksToRoot  — a nested folder's breadcrumb is the full path root→…→folder.
//   3 opensVerifiedBytes     — resolveFile returns the bytes when they hash to the ref (content-verified).
//   4 refusesWrongBytes      — a store that returns BYTES NOT MATCHING the ref ⇒ refused (why:"integrity").
//   5 missingIsNotFound      — bytes not held ⇒ { ok:false, why:"not-found" } (honest, never a silent zero).
//   6 provenanceProvable     — an ingested file yields its signed ingest entry; a never-ingested one ⇒ null.
//
// Authority: UOR-ADDR (κ = H(bytes)) · holospaces Laws L1/L3/L5 · rests on #holo-home + #holo-strand-
// provenance + the KappaStore contract. node tools/holo-home-files-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeHome } from "../os/usr/lib/holo/holo-home.mjs";
import { listFolder, breadcrumb, resolveFile, fileProvenance } from "../os/usr/lib/holo/holo-home-files.mjs";
import { recordIngest } from "../os/usr/lib/holo/holo-strand-provenance.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const te = new TextEncoder();
const subtle = (globalThis.crypto || crypto).subtle;
const sha256hex = async (u8) => Array.from(new Uint8Array(await subtle.digest("SHA-256", u8)), (b) => b.toString(16).padStart(2, "0")).join("");

let tick = 0;
const now = () => `2026-06-24T02:00:${String(tick++).padStart(2, "0")}.000Z`;
const op = await enroll({ label: "files-owner", passphrase: "correct horse battery staple three" });

// ── a tiny content-addressed store (the KappaStore contract) + a helper to make real (ref, bytes) pairs ──
const blobs = new Map();                                   // hex → Uint8Array
const store = { get: async (kappa) => { const hex = String(kappa).split(":").pop(); return blobs.get(hex) || null; } };
async function mintFile(text) { const u8 = te.encode(text); const hex = await sha256hex(u8); blobs.set(hex, u8); return { ref: `did:holo:sha256:${hex}`, bytes: u8 }; }

// ── a Home with a folder, a file inside it, and a file at root ───────────────────────────────────────
const notes = await mintFile("# my notes\nhello home");
const photo = await mintFile("JPEGDATA-trip-2026");
const FOLDER = "did:holo:sha256:" + "f".repeat(64);        // a folder is just a ref used as a parent
const backend = (() => { let s = []; return { load: async () => s.slice(), save: async (r) => { s = r.slice(); } }; })();
const home = makeHome({ backend, now, signer: op });
await home.init({ owner: op.kappa, title: "Files Home" });
await home.addFile(FOLDER, "Travel");                       // the folder's own display entry (root-level)
await home.addFile(notes.ref, "notes.md");                  // a file at root
await home.addFile(photo.ref, "trip.jpg", FOLDER);          // a file inside Travel
const files = (await home.project()).files;

// ── 1 · listFolder groups by parent (root has folder + notes; Travel has the photo) ─────────────────
const rootItems = listFolder(files, null);
const travelItems = listFolder(files, FOLDER);
ok("listGroupsByFolder",
  rootItems.length === 2 && rootItems.some((f) => f.ref === notes.ref) && rootItems.some((f) => f.ref === FOLDER)
  && travelItems.length === 1 && travelItems[0].ref === photo.ref,
  JSON.stringify({ root: rootItems.map((f) => f.name), travel: travelItems.map((f) => f.name) }));

// ── 2 · breadcrumb walks a nested folder back to root ────────────────────────────────────────────────
const crumb = breadcrumb(files, FOLDER);
ok("breadcrumbWalksToRoot", crumb.length === 1 && crumb[0].ref === FOLDER && crumb[0].name === "Travel", JSON.stringify(crumb));

// ── 3 · open returns content-verified bytes ──────────────────────────────────────────────────────────
const r3 = await resolveFile(notes.ref, store);
ok("opensVerifiedBytes", r3.ok === true && new TextDecoder().decode(r3.bytes) === "# my notes\nhello home" && r3.size === notes.bytes.byteLength, JSON.stringify({ ok: r3.ok, why: r3.why }));

// ── 4 · a store returning WRONG bytes for a ref is refused (file-level Law L5) ───────────────────────
const evilStore = { get: async () => te.encode("totally different bytes") };
const r4 = await resolveFile(notes.ref, evilStore);
ok("refusesWrongBytes", r4.ok === false && r4.why === "integrity" && r4.got !== r4.expected, JSON.stringify({ ok: r4.ok, why: r4.why }));

// ── 5 · bytes not held ⇒ honest not-found (not a crash, not a silent empty) ──────────────────────────
const r5 = await resolveFile("did:holo:sha256:" + "0".repeat(64), store);
ok("missingIsNotFound", r5.ok === false && r5.why === "not-found", JSON.stringify(r5));

// ── 6 · provenance: an ingested file is provable; a never-ingested one is honestly null ──────────────
await recordIngest(home._strand, { source: notes.ref, name: "notes.md", bytes: notes.bytes.byteLength });
const prov = fileProvenance(home._strand, notes.ref);
const provNone = fileProvenance(home._strand, photo.ref);
ok("provenanceProvable",
  prov && prov["holstr:kind"] === "ingest" && prov["holstr:payload"].source === notes.ref && prov["holstr:op"] === op.kappa
  && provNone === null,
  JSON.stringify({ ingested: !!prov, op: prov && prov["holstr:op"] === op.kappa, none: provNone === null }));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-home-files — THE FILES PILLAR: a navigable view over the manifest's owned file index where a file's NAME is the content address of its bytes and opening it re-derives that address (file-level Law L5 — a compromised store cannot return the wrong bytes), with provenance (who/when) read from the signed ingest entry on the spine. CasaOS's drive/file manager with no drives and no locations: identical bytes are one κ everywhere. The content store is the injected KappaStore contract; navigation, integrity and provenance are owned here.",
  authority: "UOR-ADDR (κ = H(bytes)) · holospaces Laws L1/L3/L5 · rests on #holo-home + #holo-strand-provenance + KappaStore contract",
  witnessed,
  covers: witnessed ? ["folder-navigation", "breadcrumb", "open-content-verified", "refuse-wrong-bytes", "honest-not-found", "provenance-provable"] : [],
  sample: { rootCount: rootItems.length, ingestProvable: !!fileProvenance(home._strand, notes.ref) },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-home-files-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-home-files witness — the files pillar (a file's name IS the address of its bytes)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  files: ${files.length} indexed · open re-derives the address (Law L5) · provenance from the spine`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  open your files anywhere; the bytes are verified before you ever see them" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
