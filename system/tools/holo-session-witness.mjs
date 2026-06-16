#!/usr/bin/env node
// holo-session-witness.mjs — PROVE Holo Session v2 (ADR-0106): seamless for EVERY user, sovereign at
// rest, battle-tested. Drives the adapter-injectable core with in-memory fakes + a REAL cipher
// (WebCrypto, no DOM/IndexedDB) and a fetch spy. Covers:
//   v1 (kept):   round-trip every axis · per-operator isolation · device isolation (same-machine-only)
//   ENCRYPTION:  ciphertext at rest (≠ plaintext) · decrypt round-trip · wrong-key → null · tamper → L5 refuse
//   κ-memo:      identical experience + key → identical κ (synthetic-IV determinism)
//   GUEST+CLAIM: guest realm autosaves · one sign-in CLAIMS it with ZERO loss · guest head consumed ·
//                a different operator gets ZERO bleed
//   CONCURRENCY: a stale second tab does NOT clobber a newer save (seq guard)
//   MIGRATION:   a v1 PLAINTEXT manifest restores forward, never dropped
//   DURABILITY:  a quota error never corrupts the last good snapshot
//   NO-EGRESS:   the fetch spy is NEVER called across seal/save/restore/claim/key-derive

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSession, isExperienceKey, SETTINGS_PREFIXES, makeCipher, deriveOperatorKeyBytes, guestRealm, SCHEMA_VERSION } from "../os/usr/lib/holo/holo-session.mjs";
import { jcs } from "../os/usr/lib/holo/holo-uor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); };
const eq = (a, b) => jcs(a) === jcs(b);

// ── no-egress guard ──
let fetched = false;
globalThis.fetch = () => { fetched = true; throw new Error("Holo Session must never touch the network"); };

const NOW = "2026-06-16T00:00:00.000Z";
const OP_A = "did:holo:sha256:aaaa1111", OP_B = "did:holo:sha256:bbbb2222";
const DEV = "did:holo:sha256:dddd0000", DEV_OTHER = "did:holo:sha256:eeee9999";
const GUEST = guestRealm(DEV);

function makeStore() { const m = new Map(); let blockPut = false; return { _m: m, block: (v) => { blockPut = v; }, put: async (k, u8) => { if (blockPut) throw new Error("QuotaExceeded"); m.set(String(k).split(":").pop(), u8.slice()); }, get: async (k) => m.get(String(k).split(":").pop()) || null }; }
function makeKv(seed = {}) { const m = new Map(Object.entries(seed)); return { _m: m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, String(v)), remove: (k) => m.delete(k), keys: () => [...m.keys()] }; }

const SETTINGS = {
  "holo-widgets.v5": JSON.stringify([{ id: "w1", type: "clock", x: 40, y: 40 }]),
  "holo-widgets.mode.v5": "work",
  "holo.voice.wake": "1",
  "holo:wall-live": "1",
  "holo-vinyl.dockpin.v1": "1",
  "holo.q.tier": "hybrid",
  "holo.playground": "1",
};
const EXCLUDED = { "holo.device.id": DEV, "holo.session.head.zzz": "stale", "holo.install.dismissed": "1" };
const TABS = [
  { id: "t0", title: "Home", home: true, addr: "", snap: { world: [], layout: null, focusedId: null } },
  { id: "t1", title: "Holo Files", addr: "holo://app", pinned: true, group: "g1",
    snap: { world: [{ id: "win-1", kind: "app", x: 90, y: 80, appState: { path: "/notes" } }], layout: null, focusedId: "win-1" } },
];
const ACTIVE = 1;

// real ciphers (WebCrypto in Node)
const opKeyBytes = await deriveOperatorKeyBytes(OP_A, "correct horse battery", DEV);
const opKeyWrong = await deriveOperatorKeyBytes(OP_A, "wrong passphrase here", DEV);
const opCipher = makeCipher(opKeyBytes);
const wrongCipher = makeCipher(opKeyWrong);
const devCipher = makeCipher(new Uint8Array(32).fill(7));

// ── round-trip every axis, ENCRYPTED (operator realm + vault cipher) ──
const store = makeStore();
const kv = makeKv({ ...SETTINGS, ...EXCLUDED });
const S = createSession({ kv, store, now: () => NOW });

const saved = await S.save({ realm: OP_A, device: DEV, tabs: TABS, activeTab: ACTIVE, cipher: opCipher, tab: "tabA" });
ok("save-returns-kappa-seq", saved && /^did:holo:sha256:[0-9a-f]{64}$/.test(saved.kappa) && saved.seq === 1);
ok("settings-allowlist-excludes-identity", saved && !("holo.device.id" in saved.body["holo:experience"].settings) && !("holo.session.head.zzz" in saved.body["holo:experience"].settings));
ok("settings-allowlist-captures-every-axis", saved && Object.keys(SETTINGS).every((k) => saved.body["holo:experience"].settings[k] === SETTINGS[k]));
ok("manifest-carries-schema-version", saved && saved.body["holo:v"] === SCHEMA_VERSION);

// stored bytes are CIPHERTEXT, not the plaintext JCS
const head = S.readHead(OP_A);
const atRest = store._m.get(head.k.split(":").pop());
const plaintext = new TextEncoder().encode(jcs(saved.body));
ok("at-rest-is-ciphertext", atRest && !(atRest.length === plaintext.length && atRest.every((b, i) => b === plaintext[i])));

const body = await S.restore({ realm: OP_A, device: DEV, cipher: opCipher });
ok("decrypt-round-trip-every-axis", !!body && eq(body["holo:experience"], saved.body["holo:experience"]));
ok("round-trip-open-surfaces-appstate", body && body["holo:experience"].tabs[1].snap.world[0].appState.path === "/notes");

const applied = S.apply(body);
ok("apply-restores-tabs-active-order", applied.activeTab === ACTIVE && applied.tabs.length === 2 && applied.tabs[1].pinned === true);

// κ-memo: identical experience + key → identical κ, idempotent
const sizeBefore = store._m.size;
const again = await S.save({ realm: OP_A, device: DEV, tabs: TABS, activeTab: ACTIVE, cipher: opCipher, tab: "tabA", expectSeq: saved.seq });
ok("kappa-memo-identical", again.kappa === saved.kappa);
ok("kappa-memo-idempotent-store", store._m.size === sizeBefore);

// wrong key → clean default (cannot read another's at-rest data)
ok("wrong-key-clean-default", (await S.restore({ realm: OP_A, device: DEV, cipher: wrongCipher })) === null);
// tamper a ciphertext byte → L5 refuses
const hk = S.readHead(OP_A).k.split(":").pop(); const t = store._m.get(hk).slice(); t[14] ^= 0xff; store._m.set(hk, t);
ok("L5-tamper-refused", (await S.restore({ realm: OP_A, device: DEV, cipher: opCipher })) === null);
store._m.set(hk, atRest);   // restore the good ciphertext for later checks

// device isolation (same-machine-only)
ok("device-isolation-clean-default", (await S.restore({ realm: OP_A, device: DEV_OTHER, cipher: opCipher })) === null);

// ── GUEST + one-sign-in CLAIM (zero loss + zero bleed) ──
const gStore = makeStore(); const gKv = makeKv({ ...SETTINGS });
const G = createSession({ kv: gKv, store: gStore, now: () => NOW });
const guestSaved = await G.save({ realm: GUEST, device: DEV, tabs: TABS, activeTab: ACTIVE, cipher: devCipher, tab: "guestTab" });
ok("guest-realm-persists", !!guestSaved.kappa && !!gKv.get("holo.session.head." + GUEST));
const claimed = await G.claim({ fromRealm: GUEST, toRealm: OP_A, device: DEV, fromCipher: devCipher, toCipher: opCipher, tab: "guestTab" });
ok("claim-returns-operator-body", !!claimed && !!claimed.body);
ok("claim-zero-loss", claimed && eq(claimed.body["holo:experience"], guestSaved.body["holo:experience"]));
ok("claim-consumes-guest-head", gKv.get("holo.session.head." + GUEST) === null);
const claimedReadback = await G.restore({ realm: OP_A, device: DEV, cipher: opCipher });
ok("claim-operator-can-read", !!claimedReadback && eq(claimedReadback["holo:experience"], guestSaved.body["holo:experience"]));
ok("claim-zero-bleed-other-operator", (await G.restore({ realm: OP_B, device: DEV, cipher: makeCipher(await deriveOperatorKeyBytes(OP_B, "b-secret", DEV)) })) === null);
// the claimed operator data is NOT readable with the device key (now sovereign-encrypted)
ok("claimed-data-not-device-readable", (await G.restore({ realm: OP_A, device: DEV, cipher: devCipher })) === null);

// ── operator isolation on a shared store ──
ok("operator-isolation-clean-default", (await S.restore({ realm: OP_B, device: DEV, cipher: opCipher })) === null);

// ── CONCURRENCY: a stale second tab must not clobber a newer save ──
const cStore = makeStore(), cKv = makeKv({});
const C = createSession({ kv: cKv, store: cStore, now: () => NOW });
const c1 = await C.save({ realm: OP_A, device: DEV, tabs: TABS, activeTab: 0, cipher: opCipher, tab: "tab1" });          // seq 1
const c2 = await C.save({ realm: OP_A, device: DEV, tabs: TABS, activeTab: 1, cipher: opCipher, tab: "tab1", expectSeq: c1.seq });   // seq 2 (same tab, ok)
const stale = await C.save({ realm: OP_A, device: DEV, tabs: [], activeTab: 0, cipher: opCipher, tab: "tab2", expectSeq: c1.seq });   // tab2 based on old seq → must skip
ok("concurrency-stale-tab-skips", stale && stale.skipped === true);
ok("concurrency-newer-survives", C.readHead(OP_A).seq === c2.seq);
const resync = await C.save({ realm: OP_A, device: DEV, tabs: TABS, activeTab: 0, cipher: opCipher, tab: "tab2", expectSeq: C.readHead(OP_A).seq });   // re-synced → writes
ok("concurrency-resynced-tab-writes", resync && resync.seq === c2.seq + 1);

// ── MIGRATION: a v1 PLAINTEXT manifest (no holo:v, bare-κ head) restores forward ──
const mStore = makeStore(), mKv = makeKv({});
const M = createSession({ kv: mKv, store: mStore, now: () => NOW });
const v1body = { "@context": ["https://www.w3.org/ns/did/v1", { holo: "https://hologram.os/ns#", prov: "http://www.w3.org/ns/prov#" }],
  "@type": ["prov:Entity", "holo:SessionManifest"], "holo:operator": { "@id": OP_A }, "holo:device": DEV,
  "prov:generatedAtTime": NOW, "holo:experience": { tabs: [{ id: "t0", title: "Home", addr: "", home: true, snap: null }], activeTab: 0, settings: { "holo.playground": "1" } } };
const v1bytes = new TextEncoder().encode(jcs(v1body));
const v1kappa = "did:holo:sha256:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", v1bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
await mStore.put(v1kappa, v1bytes);
mKv.set("holo.session.head." + OP_A.split(":").pop(), v1kappa);    // legacy BARE-κ head (no JSON wrapper)
const migrated = await M.restore({ realm: OP_A, device: DEV, cipher: opCipher });
ok("v1-plaintext-migrates-forward", !!migrated && migrated["holo:experience"].settings["holo.playground"] === "1");
ok("v1-migrated-tagged-v1", migrated && migrated["holo:v"] === 1);

// ── DURABILITY: a quota error never corrupts the last good snapshot ──
const qStore = makeStore(), qKv = makeKv({});
const Q = createSession({ kv: qKv, store: qStore, now: () => NOW });
const good = await Q.save({ realm: OP_A, device: DEV, tabs: TABS, activeTab: 1, cipher: opCipher, tab: "tabQ" });
qStore.block(true);
const quotaFail = await Q.save({ realm: OP_A, device: DEV, tabs: [], activeTab: 0, cipher: opCipher, tab: "tabQ", expectSeq: good.seq });
ok("quota-save-honest-fail", quotaFail && quotaFail.ok === false && quotaFail.why === "quota");
ok("quota-head-unchanged", Q.readHead(OP_A).k === good.kappa);
qStore.block(false);
const stillGood = await Q.restore({ realm: OP_A, device: DEV, cipher: opCipher });
ok("quota-last-good-snapshot-intact", !!stillGood && stillGood["holo:experience"].activeTab === 1);

// ── reset (escape hatch) on the active realm ──
S.reset(OP_A);
ok("reset-clears-head-and-settings", kv.get("holo.session.head." + OP_A.split(":").pop()) === null && kv.get("holo-widgets.v5") === null);

// ── allowlist coverage ──
ok("coverage-prefixes", SETTINGS_PREFIXES.every((p) => isExperienceKey(p + "x")));
ok("coverage-excludes", !isExperienceKey("holo.device.id") && !isExperienceKey("holo.session.head.x") && !isExperienceKey("holo.session.devkey"));

// ── no egress (asserted last, after seal/save/restore/claim/key-derive all ran) ──
ok("no-network-egress", fetched === false);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "a signed-in operator's entire experience (tabs + order + active + open-surfaces incl. per-app state + every settings axis) round-trips through an ENCRYPTED κ-store byte-for-byte",
    "at rest the manifest is ciphertext: a wrong key yields a clean default and a tampered byte is refused (Law L5) — not readable by another operator on the profile",
    "an identical experience + key seals to an identical κ (synthetic-IV determinism, κ-memo preserved)",
    "a GUEST realm persists like an operator, and a single sign-in CLAIMS it into the operator with ZERO loss, consumes the guest head, and leaks ZERO bytes to a different operator",
    "per-operator + same-machine-only (device-binding) isolation hold under encryption",
    "a stale second tab does not clobber a newer save (seq guard); a v1 plaintext manifest migrates forward; a quota error never corrupts the last good snapshot",
    "NO network egress on any path (local κ-store only, Law L4); the reset escape hatch forgets the active realm",
  ],
  checks,
  failed: fail,
  authority: "W3C PROV-O · W3C EARL 1.0 · IETF RFC 8785 (JCS) · FIPS 180-4 (SHA-256) · NIST SP 800-38D (AES-GCM) · NIST SP 800-132 (PBKDF2) · UOR-ADDR · Laws L1/L4/L5",
  sample: { manifestKappa: saved.kappa, guestRealm: GUEST, axes: Object.keys(SETTINGS) },
};
writeFileSync(join(here, "holo-session-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-session witness (v2 — ADR-0106)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
