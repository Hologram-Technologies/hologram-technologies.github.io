// holospace-lifecycle-witness.mjs — proves the sovereign snapshot/resume lifecycle end-to-end (logic layer):
// suspend→seal→persist→resume round-trip, owner-only resume, second-identity refused, tamper refused, roam via
// home, deterministic κ. Mock machine (suspend/resume) + in-memory κ-store. Pure node.
import { snapshot, resume } from "../os/usr/lib/holo/holospace-lifecycle.mjs";
import { ownerOf } from "../os/usr/lib/holo/holospace-identity.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const enc = (s) => new TextEncoder().encode(s);
const eq = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);

// a mock machine: suspend() yields its current state bytes; resume(bytes) loads them.
const makeMachine = (initial) => { let state = enc(initial); return {
  suspend: async () => state.slice(), resume: async (b) => { state = b.slice(); }, peek: () => new TextDecoder().decode(state) }; };

// an in-memory κ-store + a recording home.
const store = (() => { const m = new Map(); return { put: async (k, v) => void m.set(k, v.slice()), get: async (k) => m.get(k) || null, has: (k) => m.has(k) }; })();
const homeCalls = []; const home = { addSpace: async (ref, name) => void homeCalls.push({ ref, name }) };

const A = "did:holo:sha256:" + "a".repeat(64), Asecret = "tee-A", dev = "dev-1";
const B = "did:holo:sha256:" + "b".repeat(64), Bsecret = "tee-B";
const spec = { "@type": "holospace.v1", name: "alpine-dev", machine: "did:holo:blake3:" + "1".repeat(64) };

// 1. snapshot a running machine → sealed, owned, persisted, roamed
const m1 = makeMachine("WORK: edited /etc/hosts; installed ripgrep");
const snap = await snapshot({ machine: m1, spec, owner: A, secret: Asecret, deviceSalt: dev }, { store, home, name: "my alpine" });
ok(/^did:holo:blake3:/.test(snap.kappa) && store.has(snap.kappa), "snapshot seals + persists the VM state to a κ");
ok(ownerOf(snap.manifest) === A && snap.manifest.snapshot === snap.kappa, "the snapshot manifest is owned by A and points at the κ");
ok(homeCalls.length === 1 && homeCalls[0].ref === snap.kappa, "the snapshot is added to A's Home (roams with the user)");

// 2. the persisted blob is SEALED, not plaintext (the work string must not appear in the stored bytes)
const stored = await store.get(snap.kappa);
ok(!new TextDecoder("latin1").decode(stored).includes("ripgrep"), "the persisted snapshot is encrypted at rest (no plaintext leak)");

// 3. resume by the OWNER → the machine comes back exactly where it was
const m2 = makeMachine("EMPTY");
const r = await resume({ kappa: snap.kappa, machine: m2, owner: A, secret: Asecret, deviceSalt: dev }, { store });
ok(r.ok && m2.peek().includes("ripgrep"), "the OWNER resumes the sealed machine to its exact suspended state");

// 4. a SECOND identity cannot resume it
const m3 = makeMachine("EMPTY");
const rB = await resume({ kappa: snap.kappa, machine: m3, owner: B, secret: Bsecret, deviceSalt: dev }, { store });
ok(!rB.ok && /refused/.test(rB.reason) && m3.peek() === "EMPTY", "a SECOND identity is REFUSED (machine untouched)");

// 5. the owner on a DIFFERENT device cannot resume it
const rDev = await resume({ kappa: snap.kappa, machine: makeMachine("EMPTY"), owner: A, secret: Asecret, deviceSalt: "dev-2" }, { store });
ok(!rDev.ok, "the owner on a DIFFERENT device is refused (device-bound)");

// 6. a TAMPERED snapshot is refused
const k = snap.kappa, bad = (await store.get(k)).slice(); bad[bad.length - 1] ^= 0xff;
const tamperStore = { get: async () => bad, put: async () => {} };
const rT = await resume({ kappa: k, machine: makeMachine("EMPTY"), owner: A, secret: Asecret, deviceSalt: dev }, { store: tamperStore });
ok(!rT.ok, "a TAMPERED snapshot is refused (AES-GCM auth)");

// 7. deterministic κ — re-snapshotting an identical state yields the identical κ (memo/dedup)
const snap2 = await snapshot({ machine: makeMachine("WORK: edited /etc/hosts; installed ripgrep"), spec, owner: A, secret: Asecret, deviceSalt: dev }, { store });
ok(snap2.kappa === snap.kappa, "an identical snapshot dedups to the same κ (κ-memo)");

console.log(`\nholospace-lifecycle-witness: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
