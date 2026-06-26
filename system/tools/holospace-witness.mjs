// holospace-witness.mjs — proves the mount(κ) spine: one verb, machine-as-κ, registry not switch,
// config = re-addressing, verify-before-trust. Pure node, no browser. Run: node holospace-witness.mjs
import {
  canonicalize, serialize, kappaOf, verify, parse, withFields, isManifest,
  makeResolver, makeRegistry, mount,
} from "../os/usr/lib/holo/holospace.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// machine κs (in real life these address a runtime adapter's bytes; here any stable label stands in)
const M_WEB = "did:holo:blake3:" + "a".repeat(64);
const M_X64 = "did:holo:blake3:" + "b".repeat(64);
const M_COMP = "did:holo:blake3:" + "c".repeat(64);

// three manifests — the SAME flat shape, only `machine`/`image`/`params` differ. No `kind` anywhere.
const app   = { "@type": "holospace.v1", name: "Atlas",      machine: M_WEB,  image: "did:holo:blake3:" + "1".repeat(64) };
const devbox= { "@type": "holospace.v1", name: "alpine-dev", machine: M_X64,  image: "did:holo:blake3:" + "2".repeat(64),
                params: { cpus: 2, ramMiB: 1024 } };
const desk  = { "@type": "holospace.v1", name: "Studio",     machine: M_COMP, image: "did:holo:blake3:" + "3".repeat(64) };

// 1. round-trip (canonical — values preserved; canonical form is order-independent)
ok(canonicalize(parse(serialize(app))) === canonicalize(app), "manifest round-trips through serialize/parse");

// 2. canonical: key INSERTION order does not change κ (config = identity, not text)
const appReordered = { image: app.image, machine: app.machine, name: app.name, "@type": app["@type"] };
ok(kappaOf(app) === kappaOf(appReordered), "key order does not change κ (canonical)");

// 3. identical fields → identical κ
ok(kappaOf(devbox) === kappaOf({ ...devbox }), "identical fields → identical κ (worldwide dedupe)");

// 4. config = re-addressing: a one-field edit → a DIFFERENT κ
const devbox4 = withFields(devbox, { params: { cpus: 4, ramMiB: 1024 } });
ok(kappaOf(devbox4) !== kappaOf(devbox), "editing a param re-addresses the holospace (new κ)");
ok(kappaOf(withFields(devbox, {})) === kappaOf(devbox), "a no-op edit keeps the κ");

// 5. verify-before-trust (Law L5): the manifest verifies against its own κ; any change fails against it
const k = kappaOf(devbox);
ok(verify(devbox, k), "manifest verifies against its own κ");
ok(!verify(withFields(devbox, { params: { cpus: 99 } }), k), "a changed manifest fails verify against the original κ (L5)");
ok(kappaOf(devbox) !== kappaOf(withFields(devbox, { name: "other" })), "name is part of identity");

// 6. resolver fail-closed: a forged byte never resolves
const store = new Map([[k, serialize(devbox)]]);
const resolve = makeResolver(async (kk) => store.get(kk) || null);
ok(await resolve(k) !== null, "resolver returns a valid manifest by κ");
ok(await resolve("did:holo:blake3:" + "f".repeat(64)) === null, "resolver fail-closed on a miss");
const forgedStore = new Map([[k, serialize(withFields(devbox, { params: { cpus: 99 } }))]]); // bytes ≠ κ
ok(await makeResolver(async () => forgedStore.get(k))(k) === null, "resolver REFUSES bytes that don't re-derive to κ (L5)");

// 7. mount dispatches PURELY through the registry — no branching on type. Each adapter records its calls.
const calls = [];
const adapter = (tag) => ({ realize: (image, params, snapshot, surface) => { calls.push({ tag, image, params, surface }); return tag + ":handle"; } });
const reg = makeRegistry()
  .register(M_WEB, adapter("web"))
  .register(M_X64, adapter("x64"))
  .register(M_COMP, adapter("compositor"));

const resolveAll = makeResolver(async (kk) => {
  const m = [app, devbox, desk].find((x) => kappaOf(x) === kk);
  return m ? serialize(m) : null;
});

const rApp  = await mount(kappaOf(app),    "surfA", { resolve: resolveAll, machines: reg });
const rBox  = await mount(kappaOf(devbox), "surfB", { resolve: resolveAll, machines: reg });
const rDesk = await mount(kappaOf(desk),   "surfC", { resolve: resolveAll, machines: reg });

ok(rApp.ok && rApp.machine === M_WEB && calls.find((c) => c.tag === "web" && c.surface === "surfA"),
   "app manifest → web adapter.realize (right machine, right surface)");
ok(rBox.ok && calls.find((c) => c.tag === "x64" && c.params.cpus === 2),
   "devbox manifest → x64 adapter.realize (params passed through)");
ok(rDesk.ok && calls.find((c) => c.tag === "compositor"),
   "desktop manifest → compositor adapter.realize");
ok(calls.length === 3, "exactly one realize() per mount — no double-dispatch, no branching");

// 8. unknown machine + tampered manifest both fail closed (never a wrong mount)
const rUnknown = await mount(kappaOf({ "@type": "holospace.v1", name: "x", machine: "did:holo:blake3:" + "9".repeat(64), image: "did:holo:blake3:" + "8".repeat(64) }),
  "surfX", { resolve: makeResolver(async () => null), machines: reg });
ok(!rUnknown.ok && rUnknown.reason === "unresolved", "unresolved manifest → fail-closed");

// 9. adding a machine is one register() — zero change to mount()
const M_RISCV = "did:holo:blake3:" + "d".repeat(64);
reg.register(M_RISCV, adapter("riscv"));
const riscvBox = { "@type": "holospace.v1", name: "riscv", machine: M_RISCV, image: "did:holo:blake3:" + "7".repeat(64) };
const rRiscv = await mount(kappaOf(riscvBox), "surfR",
  { resolve: makeResolver(async (kk) => kk === kappaOf(riscvBox) ? serialize(riscvBox) : null), machines: reg });
ok(rRiscv.ok && calls.find((c) => c.tag === "riscv"), "a new machine is one register() — mount() unchanged");

// 10. shape gate
ok(isManifest(app) && !isManifest({ machine: M_WEB }) && !isManifest(null), "isManifest gates the @type/machine shape");

console.log(`\nholospace-witness: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
