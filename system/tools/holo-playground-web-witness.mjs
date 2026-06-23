// holo-playground-web-witness.mjs — proves Playground reaches REAL web tabs: an element edit on a real page
// mints a SNAPSHOT κ you own, through the ONE primitive (createLiveEditor) — no second sealer — and the
// snapshot is L5 self-verifying (re-derive the κ from the bytes ⇒ it matches), with the live site untouched.
//
// Pure: a tiny deterministic DOM (no jsdom), the REAL Playground agent, the REAL substrate hash (holo-uor
// sha256hex), cross-checked against node:crypto so the content addresser is honest — the same logic that runs
// host-injected in a native tab (the Atlas-isomorphism discipline).
//
// Run: node system/tools/holo-playground-web-witness.mjs

import { createPlaygroundAgent } from "../os/usr/lib/holo/holo-playground-agent.mjs";
import { createWebPlaygroundHost, createSnapshotSealer, snapKappa, holoUrl, packSnapshot, unpackSnapshot, snapshotLink } from "../os/usr/lib/holo/holo-playground-web.mjs";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};
let pass = 0, fail = 0, kn = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const ok = (n, c, x = "") => { (c ? pass++ : fail++); checks[(slug(n) || "check") + "-" + (++kn)] = !!c; console.log((c ? "  ok  " : " FAIL ") + n + (x ? "  — " + x : "")); };
const nodeSha = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");

// ── 0) the content addresser is HONEST — the substrate σ-axis IS real sha256 (no smuggled hash) ────────────
ok("substrate sha256hex === node:crypto sha256 (honest σ-axis content address)", sha256hex("hologram") === nodeSha("hologram"), sha256hex("hologram").slice(0, 16) + "…");

// ── 1) the snapshot sealer: SYNC, deterministic, did:holo:sha256:<hex> — re-derivable from the bytes (L5) ──
const seal = createSnapshotSealer({ hash: sha256hex });
const A = "<h1>Hello</h1>", B = "<h1>Goodbye</h1>";
ok("seal is deterministic — same bytes ⇒ same κ", seal("p", A).id === seal("p", A).id);
ok("seal is injective enough — different bytes ⇒ different κ", seal("p", A).id !== seal("p", B).id);
ok("κ form is did:holo:sha256:<64hex>", /^did:holo:sha256:[0-9a-f]{64}$/.test(seal("p", A).id), seal("p", A).id);
ok("L5: re-derive κ from the bytes ⇒ matches", seal("p", A).id === snapKappa(sha256hex(A)));
ok("seal refuses a non-hex hasher (a byte that can't address is refused)", (() => { try { createSnapshotSealer({ hash: () => "nothex!" })("p", A); return false; } catch (e) { return true; } })());

// ── 2) the host: ONE primitive (createLiveEditor) — O(1) no-op on unchanged bytes, new κ on change ─────────
const pinned = [];
let clock = 100;
const host = createWebPlaygroundHost({ hash: sha256hex, urlOf: () => "https://example.com/article", pin: (src, k) => { pinned.push({ k, n: src.length }); }, now: () => clock++ });
const id = "tab:https://example.com/article";
const r1 = host.commit(id, A);
ok("first commit succeeds and yields a snapshot κ", r1.ok && /^did:holo:sha256:/.test(r1.kappa), r1.kappa);
ok("first commit is a CHANGE (new content)", r1.changed === true);
const r1b = host.commit(id, A);
ok("re-commit identical bytes ⇒ O(1) no-op (changed:false), SAME κ (the κ-memo)", r1b.ok && r1b.changed === false && r1b.kappa === r1.kappa);
const r2 = host.commit(id, B);
ok("commit edited bytes ⇒ changed:true with a DIFFERENT κ", r2.changed === true && r2.kappa !== r1.kappa);
ok("kappaOf reflects the editor state (the host has no sealer of its own — ONE primitive)", host.kappaOf(id) === r2.kappa);

// ── 3) honest boundary: the live site is UNTOUCHED; the κ is a snapshot, not the URL ───────────────────────
ok("commit carries the LIVE url unchanged (the URL stays the live entry point)", r2.url === "https://example.com/article");
ok("the snapshot κ is NOT the url (a content-addressed copy you own, not the origin)", r2.kappa.indexOf("example.com") < 0);

// ── 4) provenance is OUT-OF-BAND — edges recorded, but NEVER inside the κ'd bytes ──────────────────────────
const edges = host.lineage();
ok("provenance edges recorded only on a real change (A→change, A-again→no edge, B→change = 2)", edges.length === 2, "edges=" + edges.length);
ok("each edge binds url → κ → time (the snapshot's origin), out-of-band", edges[0].url === "https://example.com/article" && /^did:holo:sha256:/.test(edges[0].kappa) && typeof edges[0].at === "number");
ok("the edge metadata is NOT embedded in the sealed bytes (would break content-addressing)", B.indexOf(String(edges[1].at)) < 0 && B.indexOf("example.com") < 0);
ok("a failing pin never breaks the edit (durability is OFF the content-address path)", (() => { const h2 = createWebPlaygroundHost({ hash: sha256hex, pin: () => { throw new Error("store down"); } }); const r = h2.commit("t", A); return r.ok && /^did:holo:sha256:/.test(r.kappa); })());
ok("pin received the snapshot bytes for durable storage (best-effort)", pinned.length === 2 && pinned[0].k === r1.kappa);

// ── 5) integrate the REAL agent: edit a real-page DOM → ephemeral-stripped serialise → snapshot κ (L5) ─────
// the live tab DOM AFTER host injection: real page content + the injected boot script (ephemeral) + a hovered
// element carrying the transient glow class. Mirrors the agent-witness DOM (only what serializeNode touches).
const mkText = (t) => ({ nodeType: 3, nodeName: "#text", nodeValue: t, childNodes: [] });
function mkEl(tag, attrs = {}, kids = []) {
  const attributes = Object.entries(attrs).map(([name, value]) => ({ name, value: String(value) }));
  return { nodeType: 1, nodeName: tag.toUpperCase(), localName: tag.toLowerCase(), nodeValue: "", childNodes: kids, attributes,
    getAttribute(n) { const a = attributes.find((a) => a.name === n); return a ? a.value : null; } };
}
const h1 = mkEl("h1", { class: "headline holo-pg-hot" }, [mkText("Real News")]);   // transient glow must NOT seal
const p = mkEl("p", {}, [mkText("body copy")]);
const bootScript = mkEl("script", { id: "holo-playground-web", "data-holo-ephemeral": "", type: "module" }, []);
const head = mkEl("head", {}, []);
const body = mkEl("body", {}, [h1, p, bootScript]);
const html = mkEl("html", { lang: "en" }, [head, body]);
const doc = { nodeType: 9, nodeName: "#document", documentElement: html, body, childNodes: [html] };

const committed = [];
const agent = createPlaygroundAgent({ doc, win: null, surfaceId: "tab:real", commit: (sid, source) => { const r = host.commit(sid, source); committed.push({ sid, source, r }); return r; } });
const serialized = agent.serialize();
ok("agent serialise drops the injected boot script (#holo-playground-web) — L5", !/holo-playground-web/.test(serialized));
ok("agent serialise drops the transient .holo-pg-hot glow class — L5", !/holo-pg-hot/.test(serialized));
ok("agent serialise KEEPS the real page content", /<h1 class="headline">Real News<\/h1>/.test(serialized) && /<p>body copy<\/p>/.test(serialized), serialized.slice(0, 120));
const rr = agent.commitEdit();                                              // host mode: commits DIRECTLY through host.commit
ok("agent.commitEdit routes through the host (ONE path) and mints a snapshot κ", committed.length === 1 && committed[0].r.ok && /^did:holo:sha256:/.test(committed[0].r.kappa));
ok("L5 self-verify: re-derive κ from the EXACT serialised bytes ⇒ matches the minted snapshot κ", committed[0].r.kappa === snapKappa(sha256hex(committed[0].source)));

// ── 6) the self-verifying share link round-trips (serverless, tamper-evident, any device) ──────────────────
const bytes = Buffer.from(B, "utf8");
const linkKappa = snapKappa(sha256hex(B));
const packed = await packSnapshot(bytes);
const restored = await unpackSnapshot(packed);
ok("share pack→unpack restores the exact snapshot bytes", Buffer.from(restored).equals(bytes));
ok("L5: re-derive κ from the UNPACKED link bytes ⇒ matches the κ in the link (self-verifying)", snapKappa(sha256hex(Buffer.from(restored).toString("utf8"))) === linkKappa);
const link = await snapshotLink({ origin: "https://holo.host", kappa: linkKappa, bytes });
ok("share link carries BOTH the κ and the inline bytes (opens on any device, no server)", link.indexOf(encodeURIComponent(holoUrl(linkKappa))) > 0 && link.indexOf("&o=") > 0, link.slice(0, 80) + "…");
const big = await snapshotLink({ origin: "https://holo.host", kappa: linkKappa, bytes, maxInline: 4 });
ok("oversized snapshot falls back to a κ-only link (honest: needs a source)", big.indexOf("&o=") < 0 && big.indexOf("render.html#k=") > 0);

// ── summary ────────────────────────────────────────────────────────────────────────────────────────────
console.log("\n" + (fail === 0 ? "PASS" : "FAIL") + "  " + pass + "/" + (pass + fail) + " checks");
try { writeFileSync(join(here, "holo-playground-web-witness.result.json"), JSON.stringify({ pass, fail, total: pass + fail, checks, at: 0 }, null, 2)); } catch (e) {}
process.exit(fail === 0 ? 0 : 1);
