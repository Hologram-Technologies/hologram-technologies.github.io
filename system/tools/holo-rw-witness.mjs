#!/usr/bin/env node
// holo-rw-witness.mjs — PROVE the UOR-native read/WRITE substrate. Every holospace object is a
// Realization (type-IRI, ordered κ-refs, payload) whose identity is the κ of its canonical form;
// JSON-LD is the editable projection. Writing is content-addressed and self-verifying: an object
// is stored under the κ its bytes re-derive to (Law L2), read back only if it still re-derives
// (Law L5), and any component can be SPLIT into its own smaller κ-object or FUSED back into a
// larger one — the compositional substrate, built on the World shell's existing HoloRepo.
//
// Pure Node (no Chromium / no network) → the gate re-runs it live. The real-browser end-to-end
// (boot the World shell, drive split/fuse, IndexedDB durability) is a separate browser tier.
// Authority is external: UOR-ADDR (κ = H(canonical_form)), IETF RFC 8785 (JCS), W3C JSON-LD 1.1,
// and the upstream holospaces SPINE-2 realization shell (consumed by reference, ADR-006). κ here
// is structural (sha256 axis); BLAKE3/KappaLabel71 byte-parity to the hologram substrate is the
// one expected-RED target, gated on substrate access — tracked, not claimed.
//
//   node tools/holo-rw-witness.mjs

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const L = (p) => new URL("../os/usr/lib/holo/" + p, import.meta.url);
const RZ = await import(L("holo-realization.mjs"));
const ST = await import(L("holo-store.js"));
const WRW = await import(L("holo-world-rw.mjs"));
let RepoClass = null;
try { ({ HoloRepo: RepoClass } = await import(L("holo-blocks-repo.mjs"))); } catch {}

const { makeAddress, makeKernel, jcs } = RZ;
const { makeStore, memBackend } = ST;
const { persist, splitNode, fuseNode } = WRW;

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };
const tick = () => new Promise((r) => setTimeout(r, 20));
const hash = async (u8) => createHash("sha256").update(Buffer.from(u8)).digest("hex");
const CTX = "https://uor.foundation/holospaces/vocab#";
const IRI = "https://uor.foundation/holospaces/realization/holospace";
const strip = (o) => { const { ["@id"]: _, ...r } = o; return jcs(r); };

// ── 1 · the kernel: canonical-form ⇄ JSON-LD bijection, split/fuse, L5 ──
{
  const address = makeAddress({ hash, axis: "sha256" });
  const k = makeKernel({ store: RZ.memStore({ hash, axis: "sha256" }), address });
  const orig = { "@context": CTX, "@type": IRI, title: "Notes", editor: { a: 1, b: [2, 3] }, count: 5 };
  const k0 = await k.write(orig);
  rec("kernel: write → resolve round-trips (JSON-LD bijection)", strip(await k.resolve(k0)) === strip(orig));
  const s = await k.split(k0, "editor");
  rec("kernel: split lifts a property into its own κ-object (ref edge)", (await k.resolve(s.kappa)).editor === s.child && jcs((await k.resolve(s.child)).value) === jcs(orig.editor));
  const f = await k.fuse(s.kappa, "editor");
  rec("kernel: fuse inlines the child back (split∘fuse = identity)", strip(await k.resolve(f.kappa)) === strip(orig));
  // L5: a byte that does not re-derive is refused on resolve
  const good = address.canon(orig);
  const bad = Uint8Array.from(good); bad[bad.length - 1] ^= 0xff;
  const kk = makeKernel({ store: { get: async () => bad, has: () => true, put: async () => k0, verify: RZ.memStore({ hash, axis: "sha256" }).verify }, address });
  let refused = false; try { await kk.resolve(k0); } catch (e) { refused = /tamper|re-derive/i.test(e.message); }
  rec("kernel: tampered bytes refused on resolve (Law L5)", refused);
}

// ── 2 · the durable κ store (the IndexedDB-shaped async contract, via memBackend) ──
{
  const store = makeStore({ hash, axis: "sha256", backend: memBackend() });
  const bytes = new TextEncoder().encode("hello holospace");
  const kk = await store.put(bytes);
  rec("store: put re-derives κ from the bytes (Law L2)", kk === "sha256:" + (await hash(bytes)));
  rec("store: get returns the stored bytes; unknown κ → null", jcs(Array.from(await store.get(kk))) === jcs(Array.from(bytes)) && (await store.get("sha256:" + "0".repeat(64))) === null);
  const t = Uint8Array.from(bytes); t[0] ^= 0xff;
  rec("store: verify refuses bytes that don't re-derive (Law L5)", (await store.verify(kk, t)) === false && (await store.verify(kk, bytes)) === true);
}

// ── 3 · World read/write on the real HoloRepo: split → durable persist → reload → fuse ──
{
  const store = makeStore({ hash, axis: "sha256", backend: memBackend() });
  let repo, desk;
  if (RepoClass) { repo = new RepoClass(); desk = await repo.create({ world: [] }); }
  else {
    repo = { objStore: new Map(), publishSource({ name, source }) { const obj = { "@type": "schema:SoftwareSourceCode", "schema:name": name, "schema:text": source }; const hex = createHash("sha256").update(jcs(obj)).digest("hex"); this.objStore.set(hex, jcs(obj)); return { id: "did:holo:sha256:" + hex }; } };
    let world = []; desk = { doc: () => ({ world: structuredClone(world) }), change(fn) { const d = { world: structuredClone(world) }; fn(d); world = d.world; } };
  }
  persist(repo, store);
  desk.change((d) => d.world.push({ id: "n1", name: "greeter", kind: "block", content: "<b>hello holospace</b>" }));
  const ref = splitNode(repo, desk, "n1");
  rec("world: split lifts a component into a κ-object the node references", desk.doc().world.find((w) => w.id === "n1").contentRef === ref && !!ref);
  await tick();
  rec("world: the object is durable in the κ store (survives reload)", await store.has("sha256:" + ref.split(":").pop()));
  repo.objStore.clear();                                   // simulate reload — drop in-memory cache
  const restored = await fuseNode(repo, desk, "n1", store);
  rec("world: fuse restores content from the durable store after reload", restored === "<b>hello holospace</b>" && !desk.doc().world.find((w) => w.id === "n1").contentRef);
  splitNode(repo, desk, "n1"); await tick(); repo.objStore.clear();
  let refused = false; try { await fuseNode(repo, desk, "n1", { get: async () => new TextEncoder().encode("TAMPERED"), verify: store.verify }); } catch (e) { refused = /tamper|re-derive/i.test(e.message); }
  rec("world: fuse refuses a tampered durable blob (Law L5)", refused);
}

const witnessed = failed === 0;
writeFileSync(join(here, "holo-rw-witness.result.json"), JSON.stringify({
  spec: "Hologram OS read/WRITE substrate — every holospace object is a self-verifying, content-addressed Realization that can be split into smaller κ-objects or fused into larger ones, durably stored and verified on read",
  authority: "UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · W3C JSON-LD 1.1 · upstream holospaces SPINE-2 realization (consumed by reference, ADR-006) · Law L1/L2/L5",
  witnessed,
  covers: ["read-write", "self-editable", "content-addressed-objects", "split-fuse", "durable-store", "law-l5", "uor-substrate"],
  note: "κ is structural (sha256 axis); BLAKE3/KappaLabel71 byte-parity to the hologram substrate is the one expected-RED target, gated on substrate access. Real-browser end-to-end (World shell boot + split/fuse + IndexedDB durability) is proven in a separate browser tier.",
  realHoloRepo: !!RepoClass,
  checks, passed, failed,
}, null, 2) + "\n");

console.log(`\nholo-rw-witness: ${passed} passed, ${failed} failed  (real HoloRepo=${!!RepoClass})`);
process.exit(witnessed ? 0 : 1);
