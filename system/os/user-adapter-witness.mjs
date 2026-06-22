// A2 witness: the per-user adapter persists ENCRYPTED at rest, decrypts only with the operator key, is
// κ-stable, resettable, and refuses tamper. Real AES-GCM (makeCipher) + an in-memory store stub.
import { makeUserAdapterStore } from "./usr/lib/holo/holo-user-adapter.mjs";
import { makeCipher } from "./usr/lib/holo/holo-session.mjs";

let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };
const MARK = "OPERATOR_ADAPTER_SECRET";
const bytes = new TextEncoder().encode("HOLO-ADAPTER|" + MARK + "|" + "x".repeat(200));   // stands in for .holo adapter bytes
const key = new Uint8Array(32); for (let i = 0; i < 32; i++) key[i] = (i * 7 + 3) & 255;
let mem = null;
const store = { read: async () => mem, write: async (b) => { mem = b; return true; }, remove: async () => { mem = null; return true; } };
const ua = makeUserAdapterStore({ cipher: async () => makeCipher(key), store });

const saved = await ua.save(bytes);
ok(saved && saved.kappa.startsWith("did:holo:sha256:"), "save -> adapter kappa (" + (saved && saved.kappa.slice(0, 24)) + "...)");
const raw = new TextDecoder("utf-8", { fatal: false }).decode(mem || new Uint8Array());
ok(mem && mem.length > 0 && !raw.includes(MARK) && !raw.includes("HOLO-ADAPTER"), "stored blob is AES-GCM ciphertext at rest (no plaintext leak)");
const loaded = await ua.load();
ok(loaded && loaded.bytes.length === bytes.length && new TextDecoder().decode(loaded.bytes).includes(MARK), "load -> decrypts the EXACT adapter bytes (round-trip)");
ok(loaded.kappa === saved.kappa, "loaded adapter kappa == saved kappa (content identity stable)");
ok((await ua.has()) === true, "has() true while stored");
const wrong = makeUserAdapterStore({ cipher: async () => makeCipher(new Uint8Array(32)), store });
ok((await wrong.load()) === null, "wrong key -> load null (only the operator key decrypts it)");
const tampered = { read: async () => { const b = mem.slice(); b[b.length >> 1] ^= 0xff; return b; }, write: async () => true, remove: async () => true };
ok((await makeUserAdapterStore({ cipher: async () => makeCipher(key), store: tampered }).load()) === null, "tampered blob -> load null (L5 fail-closed)");
await ua.reset();
ok((await ua.has()) === false && (await ua.load()) === null, "reset() -> adapter gone (reset what Q learned)");

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED A2: per-user adapter ENCRYPTED at rest, operator-key-only decrypt, kappa-stable, resettable, tamper-refusing"}`);
process.exit(fail ? 1 : 0);
