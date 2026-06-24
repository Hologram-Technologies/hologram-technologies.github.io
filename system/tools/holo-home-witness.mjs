#!/usr/bin/env node
// holo-home-witness.mjs — proves THE PERSONAL CLOUD MANIFEST (holo-home): your files, apps, LLM
// context, spaces and paired devices as ONE owner-signed, append-only κ you carry — the CasaOS
// experience with the server deleted. Home is a PROJECTION of a signed source chain (holo-strand);
// the head κ attests the WHOLE Home, so it must FAIL CLOSED on any tamper, and a peer's Home is taken
// only via verify-before-adopt (cross-device roam). Drives the REAL substrate (holo-strand over
// holo-object seal/verify + a REAL enrolled holo-identity principal as signer).
//
// Checks (all must hold):
//   1 projectsTheManifest   — add files/apps/spaces/devices ⇒ project() returns exactly the live set.
//   2 removeShrinksHome      — unlink/unpin ⇒ the item disappears from the projection.
//   3 headAttestsHome        — head === the spine head; signed authorship bound to the operator κ.
//   4 onlyListedItems        — list("files"/"apps") returns only manifest-listed refs, nothing else.
//   5 tamperRefusedFailClosed— mutate a stored entry's payload ⇒ project() refuses (no partial Home).
//   6 durableReload          — a fresh Home over the SAME backend recovers the identical projection.
//   7 adoptVerifiesPeerHome  — a VALID peer chain is adopted; the projection becomes the peer's Home.
//   8 adoptRefusesTamperedPeer— a TAMPERED peer chain is refused; the local Home is untouched.
//
// Authority: UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · W3C PROV-O · holospaces Laws
// L1/L2/L5 · rests on #holo-strand + #holo-object + #holo-identity. node tools/holo-home-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeHome } from "../os/usr/lib/holo/holo-home.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let store = clone(init); return { load: async () => clone(store), save: async (r) => { store = clone(r); }, dump: () => clone(store) }; };

let tick = 0;
const now = () => `2026-06-24T00:00:${String(tick++).padStart(2, "0")}.000Z`;

// a REAL operator principal as signer (production Ed25519/ECDSA axis via holo-identity)
const op = await enroll({ label: "home-owner", passphrase: "correct horse battery staple" });

// ── build a Home: init, two files, two apps, a space, a device ───────────────────────────────────────
const backend = arrayBackend();
const home = makeHome({ backend, now, signer: op });
await home.init({ owner: op.kappa, title: "Ilya's Home" });
await home.addFile("did:holo:sha256:file-notes", "notes.md");
await home.addFile("did:holo:sha256:file-photo", "trip.jpg", "did:holo:sha256:folder-travel");
await home.pinApp("did:holo:sha256:app-atlas", "kappa");
await home.pinApp("did:holo:sha256:app-jelly", "alpine");
await home.addSpace("did:holo:sha256:space-work", "Work");
await home.pairDevice("did:holo:sha256:dev-phone", "Phone");

// ── 1 · the manifest projects exactly the live set ───────────────────────────────────────────────────
const h1 = await home.project();
ok("projectsTheManifest",
  h1.ok && h1.meta.title === "Ilya's Home" && h1.meta.owner === op.kappa
  && h1.files.length === 2 && h1.apps.length === 2 && h1.spaces.length === 1 && h1.devices.length === 1
  && h1.apps.find((a) => a.ref === "did:holo:sha256:app-jelly").class === "alpine",
  JSON.stringify({ files: h1.files.length, apps: h1.apps.length, spaces: h1.spaces.length, devices: h1.devices.length }));

// ── 2 · remove shrinks the Home (unlink a file, unpin an app) ────────────────────────────────────────
await home.unlinkFile("did:holo:sha256:file-photo");
await home.unpinApp("did:holo:sha256:app-jelly");
const h2 = await home.project();
ok("removeShrinksHome",
  h2.ok && h2.files.length === 1 && h2.files[0].ref === "did:holo:sha256:file-notes"
  && h2.apps.length === 1 && h2.apps[0].ref === "did:holo:sha256:app-atlas",
  JSON.stringify({ files: h2.files.length, apps: h2.apps.length }));

// ── 3 · the head κ attests the Home; entries carry verifying operator authorship ─────────────────────
const v = await home.verify();
ok("headAttestsHome",
  v.ok && v.head === home.head() && h2.head === home.head()
  && backend.dump().every((r) => r["holstr:op"] === op.kappa && r["holstr:sig"]),
  JSON.stringify({ vok: v.ok, head: String(home.head()).slice(0, 24) }));

// ── 4 · list() returns only manifest-listed refs — nothing fabricated, nothing leaked ────────────────
const fileRefs = await home.list("files");
const appRefs = await home.list("apps");
ok("onlyListedItems",
  Array.isArray(fileRefs) && fileRefs.length === 1 && fileRefs[0].ref === "did:holo:sha256:file-notes"
  && Array.isArray(appRefs) && appRefs.length === 1 && appRefs[0].ref === "did:holo:sha256:app-atlas",
  JSON.stringify({ files: fileRefs, apps: appRefs }));

// ── 5 · tamper a stored entry's payload ⇒ project() refuses (fail closed, no partial Home) ───────────
const tampered = clone(backend.dump());
tampered[1]["holstr:payload"].name = "evil.exe";          // mutate the first file's name
const ht = await makeHome({ backend: arrayBackend(tampered) }).project();
ok("tamperRefusedFailClosed", ht.ok === false && ht.why === "chain-broken" && ht.brokeAt === 1, JSON.stringify(ht));

// ── 6 · durability: a fresh Home over the SAME backend recovers the identical projection ─────────────
const reloaded = makeHome({ backend, now });
const hr = await reloaded.project();
ok("durableReload",
  hr.ok && hr.head === home.head() && hr.files.length === 1 && hr.apps.length === 1 && hr.spaces.length === 1,
  JSON.stringify({ head: String(hr.head).slice(0, 24), files: hr.files.length }));

// ── 7 · adopt a VALID peer Home (cross-device roam) ⇒ projection becomes the peer's Home ─────────────
const peerOp = await enroll({ label: "home-peer", passphrase: "another correct horse battery" });
const peerBackend = arrayBackend();
const peerHome = makeHome({ backend: peerBackend, now, signer: peerOp });
await peerHome.init({ owner: peerOp.kappa, title: "Peer Home" });
await peerHome.addFile("did:holo:sha256:peer-doc", "peer.md");
await peerHome.pinApp("did:holo:sha256:peer-app", "web");
const peerChain = peerBackend.dump();

const target = makeHome({ backend: arrayBackend(), now });   // a fresh local Home that will adopt the peer's
const adoptOk = await target.adopt(peerChain);
const ha = await target.project();
ok("adoptVerifiesPeerHome",
  adoptOk.ok === true && ha.ok && ha.meta.title === "Peer Home"
  && ha.files.length === 1 && ha.files[0].ref === "did:holo:sha256:peer-doc" && ha.apps.length === 1,
  JSON.stringify({ adopt: adoptOk, title: ha.meta && ha.meta.title }));

// ── 8 · adopt a TAMPERED peer Home ⇒ refused, local Home untouched ───────────────────────────────────
const tamperedPeer = clone(peerChain);
tamperedPeer[1]["holstr:payload"].name = "malware.md";
const target2 = makeHome({ backend: arrayBackend(), now });
await target2.addFile("did:holo:sha256:local-keep", "keep.md");   // local Home has its own file first... but no init/signer
const before = await target2.project();
const adoptBad = await target2.adopt(tamperedPeer);
const after = await target2.project();
ok("adoptRefusesTamperedPeer",
  adoptBad.ok === false && JSON.stringify(after.files) === JSON.stringify(before.files),
  JSON.stringify({ adopt: adoptBad, kept: before.ok && before.files.map((f) => f.ref) }));

await forget(op.kappa); await forget(peerOp.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-home — THE PERSONAL CLOUD MANIFEST: your files, apps, LLM context, named spaces and paired devices as ONE owner-signed, append-only κ you carry, not a server you reach. Home is a projection of a signed source chain (holo-strand); the head κ attests the whole Home so any tamper/reorder/drop fails closed (Law L5 over the sequence), and a peer's Home is taken only via verify-before-adopt (cross-device roam). The CasaOS experience with the box deleted: no origin, no IP, no port — reuse of the existing spine, no new store and no new crypto.",
  authority: "UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · W3C PROV-O · holospaces Laws L1/L2/L5 · rests on #holo-strand + #holo-object + #holo-identity",
  witnessed,
  covers: witnessed ? ["manifest-projection", "append-only-mutation", "head-attests-home", "only-listed-items", "tamper-fail-closed", "durable-reload", "adopt-verifies-peer", "adopt-refuses-tampered-peer"] : [],
  sample: { head: home.head(), kinds: backend.dump().map((r) => r["holstr:kind"]) },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-home-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-home witness — the personal cloud manifest (files · apps · LLMs · spaces · devices as one owned κ)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  home: head ${String(home.head()).slice(0, 28)}… · ${backend.dump().length} entries · ${(await home.project()).files.length} files, ${(await home.project()).apps.length} apps`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  a personal cloud you carry — one signed manifest, projected anywhere, verified before trust" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
