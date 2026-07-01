// holo-q-app-kappa-witness.mjs — §1.2 P3b: the app-compilation κ-tree mints BLAKE3, opens dual-read.
// Proves compileSpec/sealApp/openApp/app-dag are single-axis BLAKE3 AND that legacy sha256-sealed apps
// + links still open (transition dual-read), with tamper fail-closed on BOTH axes. Pure → Node-witnessed.
import { compileSpec } from "./usr/lib/holo/q/holo-q-app-spec.mjs";
import { sealApp, openApp, shareLink, parseShareLink } from "./usr/lib/holo/q/holo-q-app-seal.mjs";
import * as dag from "./usr/lib/holo/q/holo-q-app-dag.mjs";
import { blake3hex } from "./usr/lib/holo/holo-blake3.mjs";
import { jcs } from "./usr/lib/holo/holo-uor.mjs";
import { createHash } from "node:crypto";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok  " + m); } else { fail++; console.log("  XX  " + m); } };
const enc = (s) => (typeof s === "string" ? new TextEncoder().encode(s) : s);
const b3 = (s) => blake3hex(enc(s));
const sha = (s) => createHash("sha256").update(Buffer.from(enc(s))).digest("hex");
const is64 = (h) => /^[0-9a-f]{64}$/.test(h);

// ── A. compileSpec mints BLAKE3 ──────────────────────────────────────────────────────────────
const c = compileSpec({ name: "Notes", collections: [{ name: "notes", kind: "note", fields: [{ name: "text", type: "string" }] }] });
ok(is64(c.manifestK) && b3(jcs(c.manifest)) === c.manifestK, "compileSpec: manifestK is BLAKE3(jcs(manifest))");
ok(b3(jcs(c.reducer)) === c.reducerK, "compileSpec: reducerK is BLAKE3");
ok(b3(c.projectionHtml) === c.projectionK, "compileSpec: projectionK is BLAKE3");
ok(c.collections.every((x) => b3(jcs(x.genesis)) === x.genesisK), "compileSpec: every genesisK is BLAKE3");
ok(c.kid === "did:holo:blake3:" + c.manifestK, "compileSpec: kid is a did:holo:blake3 label");
ok(sha(jcs(c.manifest)) !== c.manifestK, "sanity: manifestK is NOT the sha256 (axis actually changed)");

// ── B. seal → open round-trip (new BLAKE3 app) ───────────────────────────────────────────────
const sealed = sealApp(c);
const opened = openApp(sealed.manifestK, sealed.store);
ok(opened.manifest.name === "Notes" && opened.projectionHtml === c.projectionHtml, "sealApp→openApp round-trips a BLAKE3 app");

// ── C. DUAL-READ: a legacy sha256-sealed app still opens ─────────────────────────────────────
const projHtml = "<!doctype html><html><head></head><body>legacy</body></html>";
const reducer = { format: "holo-reducer/1", platform: "uniform", kinds: {} };
const pK = sha(projHtml), rK = sha(jcs(reducer));
const manifest = { format: "holo-app/1", name: "Legacy", reducer: rK, projection: pK, kinds: { platform: [], app: [] }, capabilities: [], identity: "open" };
const mK = sha(jcs(manifest));
const legacyStore = { [mK]: jcs(manifest), [rK]: jcs(reducer), [pK]: projHtml };
const legacyOpened = openApp(mK, legacyStore);
ok(legacyOpened.manifest.name === "Legacy", "openApp DUAL-READ: a legacy sha256-sealed app still opens (transition compat)");

// ── D. tamper is refused on BOTH axes (fail-closed) ──────────────────────────────────────────
let refused = false;
try { openApp(sealed.manifestK, { ...sealed.store, [sealed.manifestK]: jcs(c.manifest) + " " }); } catch (e) { refused = /L5 REFUSE/.test(e.message); }
ok(refused, "openApp: a tampered block is REFUSED (neither BLAKE3 nor sha256 re-derives → fail-closed)");

// ── E. app-dag: decompose → verify → recompose (BLAKE3) + dual-read verify ────────────────────
const { root, store: ds } = dag.decompose("<p>hi</p><b>yo</b>");
ok(dag.verify(ds).ok && Object.keys(ds).every(is64), "app-dag: decompose → verify ok, every node BLAKE3-keyed");
ok(dag.recompose(root, ds).includes("hi") && dag.recompose(root, ds).includes("yo"), "app-dag: recompose round-trips the HTML");
const desc = { t: "txt", v: "hi" }; const lk = sha(jcs(desc));
ok(dag.verify({ [lk]: desc }).ok, "app-dag verify DUAL-READ: a legacy sha256-keyed node still verifies");
ok(!dag.verify({ [lk]: { t: "txt", v: "tampered" } }).ok, "app-dag verify: a tampered legacy node is refused (both axes)");

// ── F. share links: BLAKE3 canonical, legacy still parses ────────────────────────────────────
const k = c.manifestK;
ok(shareLink(k) === "holo://blake3/" + k, "shareLink emits the canonical holo://blake3/ form");
ok(parseShareLink("holo://blake3/" + k) === k, "parseShareLink: canonical blake3 link");
ok(parseShareLink("holo://sha256/" + k) === k, "parseShareLink: legacy sha256 link still resolves");
ok(parseShareLink(k) === k, "parseShareLink: bare 64-hex (axis-agnostic)");

console.log(`\n${fail ? "FAIL" : "ALL_PASS"}  ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
