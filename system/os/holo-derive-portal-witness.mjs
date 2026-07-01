// Derive-portal tab witness (slice 8a — THE SPINE).
//
// Proves a real CEF tab is the ONE portal: a runtime κ AND a media κ project through the SAME tab path
// (descriptorFromLocation → deriveTab), same verb (derive), same surface (this document), different `kind`.
// The tab URL alone names WHICH κ and HOW to project it; the bytes still come by κ and are verified before
// projection (Law L5 — a tampered byte never reaches a lens). A URL with no `kind` is a composition (a space)
// and yields null, so boot() takes the proven member-tiling path — the two models meet in one entry, no
// divergence. 100% local + pure; derive() is the byte-identical lab verb lifted into the OS tree.
import { descriptorFromLocation, deriveTab, b64urlToBytes, sniffKind } from "./usr/lib/holo/holo-holospace-host.mjs";
import { blake3hex, KINDS } from "./usr/lib/holo/holo-derive.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
const loc = (o) => ({ host: "", pathname: "/", search: "", hash: "", ...o });   // a stand-in Location

// Two real κ-objects: content-address them so derive()'s L5 check is exercised for real (not a stub equal).
const mediaBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);   // "an image blob"
const runtimeBytes = new Uint8Array(1024).map((_, i) => (i * 7 + 3) & 0xff);            // "a machine snapshot"
const mediaK = await blake3hex(mediaBytes);
const runtimeK = await blake3hex(runtimeBytes);

// A ctx that records which lens fired — the routing proof — plus injected transport (fetch by κ).
function rig(bytesByKappa) {
  const fired = [];
  const mk = (name) => async (bytes, d) => { fired.push(name); return { action: "projected", lens: name, kind: d.kind, bytes: bytes.length, meta: d.meta }; };
  const projectors = { space: mk("space"), image: mk("image"), video: mk("video"), audio: mk("audio"), scene: mk("scene"), machine: mk("machine") };
  const ctx = { fetchBytes: async (k) => (k in bytesByKappa ? bytesByKappa[k] : null), projectors };
  return { fired, ctx };
}

// ── A. descriptorFromLocation — the URL alone names WHICH κ + HOW (kind + meta), or null for a composition ──
const dMediaPath = descriptorFromLocation(loc({ host: "space", pathname: "/" + mediaK, search: "?kind=image&dims=1x1&mime=image/png" }));
ok(dMediaPath && dMediaPath.kappa === mediaK && dMediaPath.kind === "image", "clean holo://space/<κ>?kind=image → { kappa, kind:image }");
ok(dMediaPath && dMediaPath.meta.dims === "1x1" && dMediaPath.meta.mime === "image/png", "remaining query params become projection meta (dims, mime)");

const dMachineRef = descriptorFromLocation(loc({ host: "os", pathname: "/usr/share/frame/holospace-host.html", search: "?ref=did:holo:sha256:" + runtimeK + "&kind=machine&engine=v86" }));
ok(dMachineRef && dMachineRef.kappa === runtimeK && dMachineRef.kind === "machine" && dMachineRef.meta.engine === "v86",
   "?ref=<any-κ-spelling>&kind=machine → { kappa(bare hex), kind:machine, meta.engine }");

ok(descriptorFromLocation(loc({ host: "space", pathname: "/" + mediaK })) === null, "no ?kind → null (a composition → the space/member-tiling path)");
ok(descriptorFromLocation(loc({ host: "space", pathname: "/" + mediaK, search: "?kind=space" })) === null, "?kind=space → null (explicit composition)");
ok(descriptorFromLocation(loc({ host: "space", pathname: "/" + mediaK, search: "?kind=bogus" })) === null, "unknown kind → null (fail-soft, never a wrong lens)");
ok(descriptorFromLocation(loc({ host: "space", pathname: "/not-a-kappa", search: "?kind=video" })) === null, "non-κ segment → null (fail-closed on the address)");
ok(descriptorFromLocation(null) === null, "no location → null (node/SSR safe)");

// ── B. deriveTab — the ONE verb routes each verified kind to its lens; nothing else fires ──────────────────
{
  const { fired, ctx } = rig({ [mediaK]: mediaBytes });
  const r = await deriveTab({ kappa: mediaK, kind: "image", meta: { dims: "1x1" } }, ctx);
  ok(r.ok && r.kind === "image" && r.verified && r.projection.lens === "image", "deriveTab(image κ) → verified → image lens");
  ok(fired.length === 1 && fired[0] === "image", "only the image lens fired (routed by kind, not broadcast)");
}
{
  const { fired, ctx } = rig({ [runtimeK]: runtimeBytes });
  const r = await deriveTab({ kappa: runtimeK, kind: "machine", meta: { engine: "v86" } }, ctx);
  ok(r.ok && r.kind === "machine" && r.verified && r.projection.lens === "machine", "deriveTab(machine κ) → verified → machine lens");
  ok(fired.length === 1 && fired[0] === "machine", "only the machine lens fired");
}

// ── C. L5 verify-before-project: a tampered/absent byte NEVER reaches a lens ────────────────────────────────
{
  const { fired, ctx } = rig({ [mediaK]: runtimeBytes });   // serve the WRONG bytes under the media κ
  const r = await deriveTab({ kappa: mediaK, kind: "image" }, ctx);
  ok(!r.ok && r.error === "kappa-mismatch", "bytes that don't hash to the κ → refused (L5, kappa-mismatch)");
  ok(fired.length === 0, "no lens fired on a tampered byte (verify-before-project holds)");
}
{
  const { fired, ctx } = rig({});                            // κ not resolvable
  const r = await deriveTab({ kappa: mediaK, kind: "image" }, ctx);
  ok(!r.ok && r.error === "not-found" && fired.length === 0, "an unresolvable κ → refused, no lens fired");
}

// ── D. THE UNIFICATION: a runtime κ AND a media κ project through the SAME tab path, different kind ─────────
// Exactly the master witness: same two functions (descriptorFromLocation → deriveTab), same surface, one verb.
const mediaUrl = loc({ host: "space", pathname: "/" + mediaK, search: "?kind=video&dims=640x480&mime=video/mp4" });
const runtimeUrl = loc({ host: "space", pathname: "/" + runtimeK, search: "?kind=machine&engine=v86" });
const { ctx: ctxU } = rig({ [mediaK]: mediaBytes, [runtimeK]: runtimeBytes });
const rMedia = await deriveTab(descriptorFromLocation(mediaUrl), ctxU);
const rRuntime = await deriveTab(descriptorFromLocation(runtimeUrl), ctxU);
ok(rMedia.ok && rMedia.kind === "video" && rRuntime.ok && rRuntime.kind === "machine",
   "runtime κ AND media κ both project through the SAME tab path (URL→descriptor→derive), different kind");
ok(rMedia.projection.lens === "video" && rRuntime.projection.lens === "machine",
   "the ONE verb routed each to its own lens — one door, one surface, no divergence");

// ── D2. self-contained transport: the whole κ-object rides in the URL boundary, still L5-verified ───────────
// A portal link carries meta.bytes=<b64url>; decoded locally (no store, no cache) and hashed by derive().
const b64url = Buffer.from(mediaBytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
ok(b64urlToBytes(b64url).every((v, i) => v === mediaBytes[i]) && b64urlToBytes(b64url).length === mediaBytes.length,
   "b64urlToBytes round-trips the inline payload");
{
  const { fired, ctx } = rig({});   // NO κ in the store — bytes come only from the inline boundary
  ctx.fetchBytes = async () => b64urlToBytes(b64url);
  const r = await deriveTab({ kappa: mediaK, kind: "image", meta: { bytes: b64url } }, ctx);
  ok(r.ok && r.kind === "image" && r.verified && fired[0] === "image", "self-contained inline κ → verified → projected (no store/cache)");
  const bad = { fetchBytes: async () => b64urlToBytes(Buffer.from(runtimeBytes).toString("base64url")), projectors: ctx.projectors };
  const rBad = await deriveTab({ kappa: mediaK, kind: "image", meta: { bytes: "x" } }, bad);
  ok(!rBad.ok && rBad.error === "kappa-mismatch", "a tampered inline blob is refused exactly like a fetched one (L5)");
}

// ── D3. ONE DOOR: a BARE κ (no declared kind) self-identifies by content (sniff) and routes through derive ──
// This is the fold: holo://space/<κ> opens ANY κ — the URL never declares the kind; the verified bytes do.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);   // …ftypisom
const ID3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]);                      // MP3 ID3
ok(sniffKind(PNG) === "image" && sniffKind(MP4) === "video" && sniffKind(ID3) === "audio", "sniffKind: PNG→image, MP4→video, MP3→audio (magic numbers)");
ok(sniffKind(new Uint8Array([1, 2, 3, 4])) === "bytes", "sniffKind: unknown magic → bytes");
{
  const pngK = await blake3hex(PNG);
  const { fired, ctx } = rig({ [pngK]: PNG });
  ctx.sniff = sniffKind;                                    // the portal wires sniff into ctx
  const r = await deriveTab({ kappa: pngK, kind: "bytes" }, ctx);   // NO real kind declared — must be sniffed
  ok(r.ok && r.kind === "image" && fired[0] === "image", "bare κ (kind:bytes) + sniff → routed to the image lens (one door)");
  const explicit = await deriveTab({ kappa: pngK, kind: "video" }, rig({ [pngK]: PNG }).ctx);  // declared kind wins over sniff
  ok(explicit.ok && explicit.kind === "video", "an explicit descriptor kind still wins over the sniff");
}

// ── E. the verb's kind set (media/machine + space folded in) ───────────────────────────────────────────────
ok(KINDS.includes("machine") && KINDS.includes("video") && KINDS.includes("image") && KINDS.includes("space"),
   "derive() KINDS covers media/machine AND space (a composition is a kind)");

// ── F. §0 UNIFICATION: a SPACE is just another derive kind — same verb, same path as media ──────────────────
const spaceObj = { v: 1, name: "Room", layout: "grid-2x2", accent: "", mood: "", members: [{ kind: "app", root: "a".repeat(64) }] };
const spaceBytes = new TextEncoder().encode(JSON.stringify(spaceObj));
const spaceK = await blake3hex(spaceBytes);
ok(sniffKind(spaceBytes) === "space", "sniffKind: a JSON composition self-identifies → 'space'");
{
  const { fired, ctx } = rig({ [spaceK]: spaceBytes }); ctx.sniff = sniffKind;
  const r = await deriveTab({ kappa: spaceK, kind: undefined, meta: {} }, ctx);
  ok(r && r.ok && r.kind === "space" && fired.includes("space"), "a bare space κ: derive → verify → sniff → SPACE lens (ONE verb, same path as a media κ)");
}
{ // ctx.verify hook: a space still addressable by its LEGACY κ opens through the SAME verb (transition dual-read)
  const legacyK = "deadbeef".repeat(8);
  const { ctx } = rig({ [legacyK]: spaceBytes }); ctx.sniff = sniffKind; ctx.verify = async (_b, k) => k === legacyK;
  const r = await deriveTab({ kappa: legacyK, kind: undefined, meta: {} }, ctx);
  ok(r && r.ok && r.kind === "space", "ctx.verify hook: a legacy-κ space opens via the ONE verb (dual-read injected only at the door)");
}
{ // WITHOUT the hook, default BLAKE3 verify refuses a wrong-axis κ → §1.2 preserved on the default path
  const legacyK = "deadbeef".repeat(8);
  const { ctx } = rig({ [legacyK]: spaceBytes }); ctx.sniff = sniffKind;
  const r = await deriveTab({ kappa: legacyK, kind: undefined, meta: {} }, ctx);
  ok(r && !r.ok && r.error === "kappa-mismatch", "no hook → default BLAKE3 verify refuses a mismatch (§1.2 default preserved)");
}

console.log(`\n${fail ? "FAIL" : "ALL_PASS"}  ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
