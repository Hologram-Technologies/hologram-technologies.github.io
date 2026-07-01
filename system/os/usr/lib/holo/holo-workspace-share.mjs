// holo-workspace-share.mjs — SHARE A TAB/APP AS A LIVE κ-LINK (Phase D). A window is its own source
// chain (Phase A/B); sharing it is just handing a peer that chain. The "link" the user copies is the
// app's head κ — it NAMES exactly this history. The peer re-validates on RECEIPT (holo-strand-admit,
// V / verify-before-trust): every entry must re-derive, link, and (if signed) carry a verifying operator
// signature, or the whole bundle is refused (fail-closed). So a shared workspace is "your live window,
// not a copy" — and a tampered, dropped, reordered, or forged one can't masquerade as it.
//
// Pure assembly, additive: no new crypto, no change to holo-strand. The bundle is the chain segment +
// its head κ; openSharedWorkspace routes it through the same admit gate every transport uses, then
// projects the latest workspace.snapshot into the state to mount. Reachable by agents
// (window.HoloWorkspaceShare) and, via the shell's verify-before-mount, by humans.

import { admitChain } from "./holo-strand-admit.mjs";
import { makeStrand } from "./holo-strand.mjs";
import { blake3hex } from "./holo-blake3.mjs";

const KIND = "workspace.snapshot";
// Link budgets: a QR tops out near ~2.3 KB, so keep the token well under that to scan directly; a URL can
// carry much more, so still allow it as a copy/native-share link up to a generous ceiling before we give up.
const QR_FIT = 1600, URL_FIT = 28000;

// shareWorkspace(strand) → { head, entries } — a self-verifying bundle of one app's chain. `head` is the
// κ-link the user copies; `entries` travel so the recipient can re-validate (the κ alone is not enough to
// mount — verify-before-trust needs the bytes). A whole chain by default; pass a strand pre-sliced for a segment.
export async function shareWorkspace(strand) {
  if (!strand) return null;
  if (strand.ready) await strand.ready();
  const entries = strand.replay({});                       // the full hash-linked history
  return { head: strand.head ? strand.head() : (entries.length ? entries[entries.length - 1].id : null), entries };
}

// openSharedWorkspace(bundle, { ruleset, immunity }) → { ok, state, head, actor, length } | { ok:false, why }.
// Verify-before-trust on receipt: admitChain re-runs integrity (L5) + immunity (+ optional ruleset) over
// the WHOLE segment; the head κ must name exactly this chain. Only then is the latest snapshot's state
// returned to mount. ANY tamper/drop/reorder/forge → refused; nothing untrusted is ever mounted.
export async function openSharedWorkspace(bundle, opts = {}) {
  const entries = (bundle && Array.isArray(bundle.entries)) ? bundle.entries : [];
  if (!entries.length) return { ok: false, why: "empty" };
  const a = await admitChain(entries, opts);                                   // V — verify-before-trust
  if (!a.ok) return { ok: false, why: a.why, stage: a.stage, rejectedAt: a.rejectedAt };
  const head = entries[entries.length - 1].id;
  if (bundle.head && bundle.head !== head) return { ok: false, why: "head-mismatch" };   // the link must name this chain
  const snaps = entries.filter((e) => e["holstr:kind"] === KIND);
  const last = snaps.length ? snaps[snaps.length - 1] : null;
  const state = last ? ((last["holstr:payload"] || {}).state ?? null) : null;
  return { ok: true, state, head, actor: a.actor || (last && last["holstr:op"]) || null, length: entries.length };
}

// ── share-link payload: a COMPACT, self-verifying snapshot of the app's CURRENT state ────────────────
// We don't ship the whole private history in a link — we re-seal the current state as a fresh one-entry
// chain (genesis). It's small (fits a link), still verify-before-trust (admit re-derives it), AND privacy-
// preserving (no past states travel). The recipient resumes exactly your current window; tamper → refused.

// shareLinkPayload(appKappa, host, { signer, now }) → { head, entries } | null. null ⇒ nothing live to share
// (the caller shares the app fresh, as today). signer (optional) binds authorship; unsigned still content-verifies.
export async function shareLinkPayload(appKappa, host, { signer = null, now = () => new Date().toISOString() } = {}) {
  if (!appKappa || !host || !host.mount) return null;
  let state = null;
  try { const m = await host.mount(appKappa); state = m ? m.state : null; } catch (e) { return null; }
  if (state == null) return null;                                              // no live state → share fresh
  const s = makeStrand({ now, signer });
  await s.append({ kind: KIND, payload: { app: appKappa, state } });           // one genesis entry = the snapshot
  return shareWorkspace(s);
}

const b64urlEncode = (str) => {
  const bytes = new TextEncoder().encode(str); let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = (typeof btoa !== "undefined") ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlDecode = (tok) => {
  const b64 = String(tok).replace(/-/g, "+").replace(/_/g, "/");
  const bin = (typeof atob !== "undefined") ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

// encodeWorkspaceShare(bundle) → { token, len, qrFits, fits }. token rides the link fragment (&ws=…); qrFits
// says it's small enough to also carry in the QR; fits says it's within the URL ceiling at all (else: too big,
// share fresh or use the holospace #wks=/#car= path). Pure + portable (node + browser).
export function encodeWorkspaceShare(bundle) {
  if (!bundle || !Array.isArray(bundle.entries) || !bundle.entries.length) return { token: "", len: 0, qrFits: false, fits: false };
  const token = b64urlEncode(JSON.stringify({ h: bundle.head, e: bundle.entries }));
  const len = token.length;
  return { token, len, qrFits: len <= QR_FIT, fits: len <= URL_FIT };
}

// decodeWorkspaceShare(token) → bundle { head, entries } | null. Pure inverse; never throws.
export function decodeWorkspaceShare(token) {
  try { const o = JSON.parse(b64urlDecode(token)); return (o && Array.isArray(o.e)) ? { head: o.h, entries: o.e } : null; }
  catch (e) { return null; }
}

// ── large-share (#wsc=): when a snapshot is too big for a link, PUBLISH its bytes and carry a content id.
// The pin/fetch transport is the same out-of-band IPFS leg the holospace #car= uses; the LOGIC here is the
// content address + double verify-before-trust (the fetched bytes must re-hash to the cid, AND the chain
// must admit). bundleBytes/bundleCid are pure; openSharedByBytes verifies both layers.
async function sha256hex(bytes) {                                                 // legacy dual-read: opens EXISTING sha256-addressed shares
  const SUB = (globalThis.crypto && globalThis.crypto.subtle);
  const h = await SUB.digest("SHA-256", bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export function bundleBytes(bundle) { return new TextEncoder().encode(JSON.stringify({ h: bundle && bundle.head, e: (bundle && bundle.entries) || [] })); }
export async function bundleCid(bundle) { return "did:holo:blake3:" + blake3hex(bundleBytes(bundle)); }

// openSharedByBytes(bytes, expectCid, opts) → like openSharedWorkspace, but FIRST re-derives the bytes' cid
// and refuses a mismatch (Law L5 over the transport), then decodes + admits the chain. For the #wsc= leg.
export async function openSharedByBytes(bytes, expectCid = null, opts = {}) {
  const u8 = (bytes instanceof Uint8Array) ? bytes : new TextEncoder().encode(String(bytes));
  if (expectCid) {                                                               // accept EITHER axis: blake3 (canonical) or legacy sha256-addressed shares
    const matches = ("did:holo:blake3:" + blake3hex(u8)) === expectCid || ("did:holo:sha256:" + await sha256hex(u8)) === expectCid; // legacy dual-read
    if (!matches) return { ok: false, why: "cid-mismatch" };
  }
  let o; try { o = JSON.parse(new TextDecoder().decode(u8)); } catch (e) { return { ok: false, why: "bad-bytes" }; }
  const bundle = { head: o.h ?? o.head, entries: o.e ?? o.entries };
  return openSharedWorkspace(bundle, opts);
}

if (typeof window !== "undefined") window.HoloWorkspaceShare = { shareWorkspace, openSharedWorkspace, shareLinkPayload, encodeWorkspaceShare, decodeWorkspaceShare, bundleBytes, bundleCid, openSharedByBytes };
