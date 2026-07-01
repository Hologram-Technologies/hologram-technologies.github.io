// Holospace-per-tab boot witness (Phase 2.1, keystone).
//
// Proves a real CEF tab can BE a holospace: the standalone host document derives WHICH space to mount from
// the tab URL alone — including the clean κ form `holo://space/<κ>` (host="space", pathname="/<κ>") that a
// LoadURL (or a nested-space member iframe) commits — then loads + L5-verifies it before tiling. Three URL
// forms resolve to the same admission path; every failure is fail-closed (an honest empty surface, never a
// wrong arrangement). 100% local + pure; SP is the real holo-spaces model (node-isomorphic WebCrypto).
import { spaceRefFromLocation, loadSpace, planHost, storeForLocation, spaceTabUrl } from "./usr/lib/holo/holo-holospace-host.mjs";
import * as SP from "../../../holo-apps/apps/spaces/holo-spaces.mjs";
import { blake3hex } from "./usr/lib/holo/holo-blake3.mjs";
import { createHash } from "node:crypto";
SP.setBlake3(blake3hex);   // Node has no served /_shared — inject the canonical BLAKE3 hasher (browser lazy-imports it)

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
const loc = (o) => ({ host: "", pathname: "/", search: "", hash: "", ...o });   // a stand-in Location

// ── A. spaceRefFromLocation — the three URL forms + the empty case ────────────────────────────────
const KA = "a".repeat(64), KB = "b".repeat(64);

const fromPath = spaceRefFromLocation(loc({ host: "space", pathname: "/" + KA }));
ok(fromPath && fromPath.ref === KA, "path form holo://space/<κ> → ref = the κ (the clean LoadURL/iframe URL)");

const fromRef = spaceRefFromLocation(loc({ host: "os", pathname: "/usr/lib/holo/holospace-host.html", search: "?ref=did:holo:sha256:" + KB }));
ok(fromRef && fromRef.ref === KB, "?ref=<κ> (any κ spelling) → ref, normalized to bare hex");

const fromS = spaceRefFromLocation(loc({ host: "space", pathname: "/" + KA, search: "?s=PAYLOAD&k=" + KB }));
ok(fromS && fromS.payload === "PAYLOAD" && fromS.expect === KB, "?s=<bytes>&k=<κ> wins over the path → self-contained + expected κ");

const fromHashK = spaceRefFromLocation(loc({ search: "?s=PAYLOAD", hash: "#k=" + KA }));
ok(fromHashK && fromHashK.expect === KA, "?s with #k=<κ> in the fragment → expected κ read from the hash");

const samePath = spaceRefFromLocation(loc({ host: "os", pathname: "/space/" + KA }));
ok(samePath && samePath.ref === KA, "a same-origin /space/<κ> path resolves identically (OS-origin wiring)");

ok(spaceRefFromLocation(loc({ host: "os", pathname: "/home" })) === null, "no addressable space → null (caller paints empty)");
ok(spaceRefFromLocation(null) === null, "no location → null (node/SSR safe)");

// ── B. loadSpace — admission is fail-closed on tamper (L5 on the composition) ──────────────────────
// Build a real space, content-address it, stash it in an injected (Node) backend.
const backend = (() => { const m = new Map(); return { get: async (h) => m.get(h) || null, put: async (h, b) => { m.set(h, b); } }; })();
const store = SP.makeStore(backend);
const space = { name: "Studio", layout: "split-h", accent: "#5b8cff",
  members: [{ kind: "app", root: KB, position: 1 }, { kind: "app", root: KA, position: 0 }] };
const ref = await store.put(space);                         // → did:holo:sha256:<hex>
const hex = SP.hexOf(ref);

// ref form: a store hit re-derives and returns the space (store injected — browser default is OPFS).
const viaRef = await loadSpace(SP, { ref: hex }, store);
ok(viaRef && viaRef.name === "Studio", "loadSpace({ref}) → store hit re-derives (L5) and returns the space");
ok((await loadSpace(SP, { ref: KA }, store)) === null, "loadSpace({ref}) miss → null (never a wrong space)");

// self-contained form: bytes in the link, κ verified.
const payload = SP.encode(space);
ok((await loadSpace(SP, { payload, expect: hex })) !== null, "loadSpace({payload,expect}) with the true κ → admitted");
ok((await loadSpace(SP, { payload, expect: KA })) === null, "loadSpace({payload,expect}) with a WRONG κ → refused (tamper, L5)");

// tamper the bytes but keep the old κ: re-derivation must reject (the heart of fail-closed).
const tampered = SP.encode({ ...space, accent: "#ff0000" });
ok((await loadSpace(SP, { payload: tampered, expect: hex })) === null, "tampered self-contained bytes under the old κ → refused");

// ── C. End-to-end: URL → ref → loaded → planHost tiles members in IDENTITY order ──────────────────
const sel = spaceRefFromLocation(loc({ host: "space", pathname: "/" + hex }));
const loaded = await loadSpace(SP, sel, store);
const plan = planHost(loaded);
ok(plan.ok && plan.members.length === 2, "URL→load→planHost: a 2-member space tiles 2 panes");
ok(plan.members[0].url === "holo://" + KA + "/" && plan.members[1].url === "holo://" + KB + "/",
   "members tile in identity order (position 0 then 1), each an app κ URL (the web machine)");
ok(planHost({ members: [] }).members.length === 0, "an empty space → an empty plan (honest empty surface)");

// ── D. Cross-origin resolution: a `space` tab resolves a BARE κ via the content route (no OPFS, no ?s) ──
// Stand in for the published shared κ-cache the native serves at /space/.holo/sha256/<hex>: a fetch over a
// Map keyed by hex. The space's bytes were published by whoever shared it; this tab only reads, by content κ.
const published = new Map([[hex, SP.canonicalBytes(space)]]);
const fakeFetch = async (u) => {
  const m = String(u).match(/\/\.holo\/blake3\/([0-9a-f]{64})$/i);
  const b = m && published.get(m[1].toLowerCase());
  return b ? { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
           : { ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
};
const cstore = SP.makeStore(SP.contentBackend({ fetch: fakeFetch }));
ok((await cstore.get(hex)) !== null, "contentBackend: a published κ resolves over /.holo/sha256/<hex> (cross-origin read)");
ok((await cstore.get(KA)) === null, "contentBackend: an UNpublished κ → null (never a wrong/empty-faked space)");

// drift: serve bytes that DON'T hash to the requested κ → makeStore.get re-derives and refuses (L5).
const liar = new Map([[hex, SP.canonicalBytes({ ...space, accent: "#ff0000" })]]);
const liarFetch = async (u) => { const m = String(u).match(/([0-9a-f]{64})$/i); const b = m && liar.get(m[1].toLowerCase()); return b ? { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) } : { ok: false }; };
const lstore = SP.makeStore(SP.contentBackend({ fetch: liarFetch }));
ok((await lstore.get(hex)) === null, "contentBackend: a lying gateway (bytes ≠ κ) → refused on re-derivation (L5)");

// storeForLocation: a `space` origin selects the content backend; the OS origin keeps OPFS-default.
ok(SP.contentBackend && typeof SP.contentBackend === "function", "holo-spaces exports contentBackend");
const spaceStore = storeForLocation(SP, loc({ host: "space", pathname: "/" + hex }));
ok(spaceStore && typeof spaceStore.get === "function", "storeForLocation(host=space) → a usable store (content-backed)");
const osStore = storeForLocation(SP, loc({ host: "os", pathname: "/usr/share/frame/holospace-host.html" }));
ok(osStore && typeof osStore.get === "function", "storeForLocation(host=os) → the default (OPFS) store");

// End-to-end cross-origin: URL(bare κ, host=space) → content store → loaded → tiled. No ?s, no OPFS.
const xref = spaceRefFromLocation(loc({ host: "space", pathname: "/" + hex }));
const xloaded = await loadSpace(SP, xref, cstore);
ok(xloaded && planHost(xloaded).members.length === 2, "bare holo://space/<κ> resolves via content route → 2 panes (the shareable path)");

// ── E. spaceTabUrl ⟷ spaceRefFromLocation round-trip (the chrome and the host agree on a space tab URL) ──
const urlToLoc = (u) => { const x = new URL(u); return loc({ host: x.host, pathname: x.pathname, search: x.search, hash: x.hash }); };
ok(spaceTabUrl({ kappa: hex }) === "holo://space/" + hex, "spaceTabUrl(bare) → holo://space/<κ> (the clean LoadURL)");
ok(spaceTabUrl({ kappa: KA, payload: "PL" }) === "holo://space/" + KA + "?s=PL", "spaceTabUrl(self-contained) → holo://space/<κ>?s=<bytes>");
ok(spaceTabUrl({ kappa: "not-a-κ" }) === null, "spaceTabUrl(non-κ) → null");
const rtBare = spaceRefFromLocation(urlToLoc(spaceTabUrl({ kappa: hex })));
ok(rtBare && rtBare.ref === hex, "round-trip: spaceTabUrl(bare) → spaceRefFromLocation recovers the ref");
const rtSelf = spaceRefFromLocation(urlToLoc(spaceTabUrl({ kappa: hex, payload }) + "&k=" + hex));
ok(rtSelf && rtSelf.payload === payload && rtSelf.expect === hex, "round-trip: spaceTabUrl(self-contained)+k → recovers payload + expected κ");

// ── F. DUAL-READ (transition): a space PUBLISHED under a legacy sha256 κ STILL resolves ─────────────
// The §1.2 cutover mints BLAKE3, but nothing published under the old sha256 axis may break. Prove store.get +
// verifyBytes accept EITHER axis (canonical blake3 OR legacy sha256), and refuse a wrong κ on both.
const cbytes = SP.canonicalBytes(space);
const legacyHex = createHash("sha256").update(Buffer.from(cbytes)).digest("hex");
ok(legacyHex !== hex, "sanity: the legacy sha256 κ differs from the canonical blake3 κ");
const legacyStore = SP.makeStore((() => { const m = new Map([[legacyHex, cbytes]]); return { get: async (h) => m.get(h) || null, put: async () => {} }; })());
ok((await legacyStore.get(legacyHex))?.name === "Studio", "dual-read: a legacy sha256-addressed space still resolves (store.get accepts either axis)");
ok((await SP.verifyBytes(cbytes, legacyHex)) === true, "verifyBytes accepts a legacy sha256 κ (transition compat)");
ok((await SP.verifyBytes(cbytes, hex)) === true, "verifyBytes accepts the canonical blake3 κ");
ok((await SP.verifyBytes(cbytes, "f".repeat(64))) === false, "verifyBytes refuses a wrong κ on BOTH axes (fail-closed)");

console.log(`\n${fail ? "FAIL" : "ALL_PASS"}  ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
