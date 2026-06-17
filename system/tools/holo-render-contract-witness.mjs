#!/usr/bin/env node
// holo-render-contract-witness.mjs — PROVE S1: a κ-addressed UOR object can DECLARE how it renders, the
// declaration round-trips + re-derives (Law L5), the SW dispatch seam honors it, and the whole thing is
// ADDITIVE (a non-renderable object's address is byte-stable — Laws L1/L2). This witness IS the behavioral
// definition of the holospaces target row CC-render (see vv target wrapper).
//   node tools/holo-render-contract-witness.mjs
import { makeObject, verify, verifyDeep, resolve } from "../os/usr/lib/holo/holo-object.mjs";   // canonical isomorphic substrate
import { makeRenderable } from "../os/sbin/holo-renderable.mjs";
import { renderContract, selectRender, kindOfContentType, RENDER_KINDS } from "../os/sbin/holo-render-contract.mjs";
import { dispatchRender, resolveIpfsPath } from "../os/sbin/holo-ipfs-gateway.mjs";
import * as holoIpfs from "../os/usr/lib/holo/holo-ipfs.js";

const r = [];
const ok = (label, pass, d = "") => { r.push({ label, pass: !!pass }); console.log(`${pass ? "PASS" : "FAIL"} — ${label}${d ? "  (" + d + ")" : ""}`); return !!pass; };

// A · renderContract builds a typed descriptor for each of the three kinds, and refuses an unknown kind.
for (const kind of RENDER_KINDS) {
  const c = renderContract({ kind, contentType: "text/html" });
  ok(`renderContract("${kind}") is typed holo:RenderContract`, c["@type"] === "holo:RenderContract" && c.renderKind === kind);
}
let threw = false; try { renderContract({ kind: "bogus" }); } catch { threw = true; }
ok("renderContract refuses an unknown render kind", threw);

// B · makeRenderable seals a self-verifying object that carries its contract; it re-derives (Law L5) and
//     round-trips byte-stably through the content-addressed store.
const store = new Map();
const docObj = makeRenderable(store, { type: ["schema:WebPage"], render: { kind: "doc", contentType: "text/html", entry: "index.html" }, name: "home" });
ok("a renderable object seals to a content-derived did:holo id", /^did:holo:sha256:[0-9a-f]{64}$/.test(docObj.id));
ok("the renderable object re-derives (Law L5: verify)", verify(docObj));
ok("the renderable object verifies deep (whole DAG, Law L5)", verifyDeep(store, docObj).ok);
const round = resolve(store, docObj.id);
ok("the object round-trips through the κ-store unchanged", round && round.id === docObj.id && verify(round));

// C · selectRender is the single dispatch authority: it honors the declared contract.
const sel = selectRender(docObj);
ok("selectRender honors the declared contract", sel.kind === "doc" && sel.contentType === "text/html" && sel.entry === "index.html");
const mediaObj = makeRenderable(store, { type: ["schema:VideoObject"], render: { kind: "media", contentType: "video/mp4" }, name: "clip" });
ok("a declared media object dispatches as media", selectRender(mediaObj).kind === "media");
const expObj = makeRenderable(store, { type: ["schema:SoftwareApplication"], render: { kind: "experience", entry: "boot.js" }, name: "app" });
ok("a declared experience object dispatches as experience", selectRender(expObj).kind === "experience");

// D · fallback dispatch when NO contract is declared — content-type → kind inference; "experience" is
//     never inferred (a live surface must declare itself).
ok("no-contract object falls back to doc", selectRender({ render: undefined, contentType: "text/html" }).kind === "doc");
ok("content-type inference: video → media", kindOfContentType("video/mp4") === "media");
ok("content-type inference: audio → media", kindOfContentType("audio/mpeg") === "media");
ok("content-type inference: html → doc", kindOfContentType("text/html") === "doc");
ok("experience is never INFERRED (must be declared)", kindOfContentType("application/wasm") !== "experience");

// E · the SW dispatch seam (dispatchRender) honors a contract carried in the served bytes, and falls back
//     to the byte sniffer for plain content.
const docBytes = new TextEncoder().encode(JSON.stringify(docObj));
const d1 = dispatchRender(docBytes, "");
ok("dispatchRender honors a UOR envelope's declared contract", d1.kind === "doc" && d1.contentType === "text/html");
const mediaBytes = new TextEncoder().encode(JSON.stringify(mediaObj));
ok("dispatchRender honors a declared media envelope", dispatchRender(mediaBytes, "").kind === "media");
const rawHtml = new TextEncoder().encode("<!doctype html><title>hi</title>");
const d2 = dispatchRender(rawHtml, "");
ok("dispatchRender falls back to sniff for plain (non-UOR) bytes", d2.kind === "doc" && d2.contentType === "text/html");
ok("dispatchRender sniffs a media extension to media", dispatchRender(new Uint8Array([0, 1, 2, 3]), "clip.mp4").kind === "media");

// F · Law L5 — a tampered envelope is REFUSED, and dispatch never launders a forged contract as trusted.
const tampered = { ...docObj, render: { "@type": "holo:RenderContract", renderKind: "experience", entry: "evil.js" } };
ok("a tampered render contract breaks re-derivation (Law L5: verify=false)", verify(tampered) === false);
const forgedBytes = new TextEncoder().encode(JSON.stringify(tampered));
ok("forged envelope does NOT re-derive (caller must refuse before serving)", verify(JSON.parse(new TextDecoder().decode(forgedBytes))) === false);

// G · ADDITIVITY — a plain (non-renderable) object is byte-IDENTICAL to before this change: the render
//     context is never injected globally, so existing addresses do not churn (Laws L1/L2).
const plain = makeObject(store, { type: ["schema:Thing"], name: "plain" });
ok("a non-renderable object carries NO render field", !("render" in plain));
ok("a non-renderable object's @context is exactly the 3-entry UOR base (no render context)", Array.isArray(plain["@context"]) && plain["@context"].length === 3);
// re-build the identical plain object → identical address (deterministic, content-derived)
const plain2 = makeObject(new Map(), { type: ["schema:Thing"], name: "plain" });
ok("identical plain inputs → identical address (κ stability)", plain.id === plain2.id);

// H · INTEGRATION — the IPFS path gateway (the layer the service worker serves from) honors a render
//     contract carried in a single raw leaf. Build a real RAW CIDv1 for the envelope bytes, drive
//     resolveIpfsPath with a fixture getBlock, and assert it serves the DECLARED content type + kind.
await (async () => {
  const bytes = new Uint8Array(new TextEncoder().encode(JSON.stringify(docObj)));
  const cid = holoIpfs.cidToString(await holoIpfs.cidOf(bytes, holoIpfs.CODEC.RAW));
  const getBlock = async (c) => (c === cid ? bytes : null);
  const out = await resolveIpfsPath(cid, "", getBlock);
  ok("resolveIpfsPath serves a UOR envelope's DECLARED content type (SW dispatch path)", out.kind === "file" && out.contentType === "text/html" && out.renderKind === "doc", out.contentType + "/" + out.renderKind);
  // a raw leaf with no contract still resolves via the existing sniffer (no regression)
  const plainBytes = new Uint8Array(new TextEncoder().encode("<!doctype html><title>x</title>"));
  const pcid = holoIpfs.cidToString(await holoIpfs.cidOf(plainBytes, holoIpfs.CODEC.RAW));
  const pout = await resolveIpfsPath(pcid, "", async (c) => (c === pcid ? plainBytes : null));
  ok("resolveIpfsPath still sniffs plain (non-UOR) bytes — no regression", pout.kind === "file" && pout.contentType === "text/html" && !pout.renderKind);
})();

const passed = r.filter((x) => x.pass).length;
console.log(`\n${passed}/${r.length} checks`);
if (passed !== r.length) process.exit(1);
console.log("WITNESSED ✓ — S1: self-describing render-contract envelope + SW dispatch seam, L5-verified, additive");
