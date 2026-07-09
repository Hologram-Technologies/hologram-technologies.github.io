// holo-portrait.mjs — THE SOVEREIGN FACE: the operator's portrait as a first-class, content-addressed
// identity attribute. One law-abiding module, one resolver, every surface (login gate, messenger rail seal,
// wallet pill, identity card) renders the SAME verified face — or honestly none.
//
//   • F1 (content-addressed): the portrait's identity is the sha256 of its canonical bytes — the SAME
//     addressOf axis as the identity layer (holo-identity.mjs), no second hashing path. Canonical form =
//     256×256 cover-cropped webp: deterministic, small, and the re-encode IS the privacy gate (EXIF/GPS
//     from a phone photo cannot survive a canvas round-trip).
//   • F2 (bound): a portrait record commits the OPERATOR κ it belongs to. resolvePortrait() re-derives the
//     bytes' κ on EVERY render and refuses a mismatch (Law L5, fail closed) — a tampered cache falls back
//     to the initial, never to a wrong face. Binding is only writable inside a sealed (non-guest) session.
//   • F4 (guest law): an explicit guest presentation never resolves the device operator's portrait —
//     exactly the law the greeting/name path already enforces.
//
// Storage: localStorage record per operator (the resolver's source of truth) + an OPFS mirror of the raw
// bytes under /etc/portraits (Law L3 — the store is the memory). The record is app-visible by design: the
// face ships in presentations (public-shaped), while verification keeps it honest.

import { sha256Hex } from "./holo-identity.mjs";

const KEY = (op) => "holo.portrait." + String(op || "");
const HINT_KEY = "holo.portrait.hint";          // NON-secret greeter hint: the LAST operator's record, so the
                                                // login gate can greet a returning operator with their face
                                                // (same trust level as holo.lastOperator's label + hue).
const SIZE = 256;                               // canonical edge — crisp on every rail/pill/card at any DPI

const hasLS = typeof localStorage !== "undefined";
const b64bytes = (dataURL) => Uint8Array.from(atob(String(dataURL).split(",")[1] || ""), (c) => c.charCodeAt(0));

// ── canonicalize: any picked image → the ONE canonical form (256×256 cover-crop webp). Deterministic for a
// given source file on a given engine; strips every metadata byte by construction. Browser-only (canvas).
export async function canonicalizeImage(fileOrBlob) {
  const bmp = await createImageBitmap(fileOrBlob);
  const side = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - side) / 2, sy = (bmp.height - side) / 2;   // center cover-crop
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(SIZE, SIZE) : Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE });
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(bmp, sx, sy, side, side, 0, 0, SIZE, SIZE);
  try { bmp.close && bmp.close(); } catch {}
  const blob = c.convertToBlob ? await c.convertToBlob({ type: "image/webp", quality: 0.92 })
    : await new Promise((res) => c.toBlob(res, "image/webp", 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}

// ── the record core (pure — node-testable without a canvas): bytes + operator → a self-verifying record.
export async function mintPortraitRecord(operatorKappa, bytes, mime = "image/webp") {
  if (!operatorKappa) throw new Error("a portrait must bind an operator κ");
  const kappa = "did:holo:sha256:" + await sha256Hex(bytes);
  let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const dataURL = "data:" + mime + ";base64," + btoa(bin);
  return { "@type": "HoloPortrait", operator: operatorKappa, kappa, mime, setAt: new Date().toISOString(), dataURL };
}

// Law-L5 admission: the record's bytes must re-derive to its committed κ AND belong to the asking operator.
export async function verifyPortraitRecord(rec, operatorKappa) {
  try {
    if (!rec || !rec.kappa || !rec.dataURL) return null;
    if (operatorKappa && rec.operator !== operatorKappa) return null;      // bound to someone else → refuse
    if ("did:holo:sha256:" + await sha256Hex(b64bytes(rec.dataURL)) !== rec.kappa) return null;   // tampered → refuse
    return rec;
  } catch { return null; }
}

// ── setPortrait: canonicalize → mint → persist (record + greeter hint + OPFS bytes). Sealed sessions only —
// the caller passes the operator κ from a live non-guest presentation; there is nothing to bind for a guest.
export async function setPortrait(operatorKappa, fileOrBlob) {
  const bytes = await canonicalizeImage(fileOrBlob);
  const rec = await mintPortraitRecord(operatorKappa, bytes);
  if (hasLS) { try { localStorage.setItem(KEY(operatorKappa), JSON.stringify(rec)); localStorage.setItem(HINT_KEY, JSON.stringify(rec)); } catch {} }
  opfsMirror(rec.kappa, bytes);
  return rec;
}

export function clearPortrait(operatorKappa) {
  if (!hasLS) return;
  try {
    localStorage.removeItem(KEY(operatorKappa));
    const hint = JSON.parse(localStorage.getItem(HINT_KEY) || "null");
    if (hint && hint.operator === operatorKappa) localStorage.removeItem(HINT_KEY);
  } catch {}
}

// ── THE resolver — the one door every surface renders through. Accepts a presentation ({operator, guest})
// or a bare operator κ. Returns { kappa, url, verified: true } or null (→ the caller renders its initial).
export async function resolvePortrait(presentationOrKappa) {
  const p = typeof presentationOrKappa === "string" ? { operator: presentationOrKappa } : (presentationOrKappa || {});
  if (p.guest || !p.operator || !hasLS) return null;                       // guest law + nothing to resolve
  let rec = null; try { rec = JSON.parse(localStorage.getItem(KEY(p.operator)) || "null"); } catch {}
  const ok = await verifyPortraitRecord(rec, p.operator);
  return ok ? { kappa: ok.kappa, url: ok.dataURL, verified: true } : null;
}

// Greeter hint (pre-unlock): the last operator's face for the returning-operator greeting — verified by
// re-derivation like everything else, so even the hint cannot show a lying face.
export async function resolveHintPortrait() {
  if (!hasLS) return null;
  let rec = null; try { rec = JSON.parse(localStorage.getItem(HINT_KEY) || "null"); } catch {}
  const ok = await verifyPortraitRecord(rec, null);
  return ok ? { kappa: ok.kappa, url: ok.dataURL, operator: ok.operator, verified: true } : null;
}

// OPFS mirror — the raw canonical bytes as content under /etc/portraits/<hex>.webp (best-effort, Law L3).
async function opfsMirror(kappa, bytes) {
  try {
    if (!navigator?.storage?.getDirectory) return;
    const root = await navigator.storage.getDirectory();
    const etc = await root.getDirectoryHandle("etc", { create: true });
    const dir = await etc.getDirectoryHandle("portraits", { create: true });
    const fh = await dir.getFileHandle(kappa.split(":").pop() + ".webp", { create: true });
    const w = await fh.createWritable(); await w.write(bytes); await w.close();
  } catch { /* optional; localStorage record is the resolver's source of truth */ }
}

// ── self-test (node, no canvas): mint → resolve-shape verify → operator-binding + tamper refusal.
export async function selftest() {
  const r = {};
  const op = "did:holo:sha256:" + "a".repeat(64);
  const bytes = new TextEncoder().encode("not-really-webp-but-bytes-are-bytes");
  const rec = await mintPortraitRecord(op, bytes);
  r.kappaShape = /^did:holo:sha256:[0-9a-f]{64}$/.test(rec.kappa);
  r.deterministic = (await mintPortraitRecord(op, bytes)).kappa === rec.kappa;
  r.verifies = (await verifyPortraitRecord(rec, op)) !== null;
  r.bindsOperator = (await verifyPortraitRecord(rec, "did:holo:sha256:" + "b".repeat(64))) === null;
  const tampered = { ...rec, dataURL: rec.dataURL.slice(0, -4) + "AAAA" };
  r.tamperCaught = (await verifyPortraitRecord(tampered, op)) === null;
  r.ok = Object.values(r).every(Boolean);
  return r;
}

if (typeof process !== "undefined" && process.argv && /holo-portrait\.mjs$/.test(process.argv[1] || "")) {
  selftest().then((r) => { console.log("holo-portrait selftest:", r); process.exit(r.ok ? 0 : 1); });
}
