// holo-release-boot.mjs — S3 of the downstream-holospace initiative: EVERY boot verifies through the
// SIGNED release pointer, not just #m1-link opens.
//
// Today the worker's integrity bar is seeded from shell-manifest.json — unsigned bytes from the origin —
// and only an #m1 boot link upgrades it to link-verified. This module makes the SIGNED strand head the
// standing bar: fetch release.json (the ONE mutable fetch, no-store) → acceptHead() against the local pin
// (TOFU, key-continuity, seq-monotonic — holo-release-verify.mjs) → prove the origin's manifest is the
// EXACT one the release signed (bytes re-derive to payload.manifest, aggregate re-derives to payload.shell)
// → only then pin + hand the manifest to the worker. A refused pointer changes NOTHING: the worker keeps
// serving the last verified shell (fail-closed to last-good, never to blank).
//
// Additive + fail-soft at the seam (a deploy without release.json is a quiet no-op), fail-CLOSED at the
// bar (no signature → no upgrade). Injectable core; the browser auto-run wires live fetch/storage/worker.

import { acceptHead } from "./holo-release-verify.mjs";
import { shellAggregate } from "./holo-m1-boot.mjs";

export const PIN_KEY = "holo.release.pin";
const _hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256hex = async (buf) => _hex(await (globalThis.crypto).subtle.digest("SHA-256", buf));

// releaseBoot({ fetchFn, storage, post, baseUrl }) → { ok, why?, pin?, unchanged? }
//   fetchFn — fetch-compatible; storage — localStorage-compatible {getItem,setItem};
//   post — receives the verified manifest message for the worker; baseUrl — this module's URL (relocatable).
export async function releaseBoot({ fetchFn, storage, post = null, baseUrl } = {}) {
  // 1. the pointer — the ONE mutable fetch (everything else it names is immutable, κ-addressed)
  let head = null;
  try { const r = await fetchFn(new URL("../../release.json", baseUrl), { cache: "no-store" }); if (r && r.ok) head = await r.json(); } catch {}
  if (!head) return { ok: false, why: "no-pointer" };                       // pre-strand deploy: additive no-op
  // 2. accept against the durable pin (SEC-1/4: forge, tamper, replay, key-swap → refused by name)
  let pinned = null; try { pinned = JSON.parse(storage.getItem(PIN_KEY) || "null"); } catch {}
  const a = await acceptHead(head, pinned);
  if (!a.ok) return { ok: false, why: a.why, pinned };                      // bar unchanged — last-good keeps serving
  // 3. the head COMMITS the shell: the origin's manifest must be the exact object the release signed
  const p = head["holstr:payload"] || {};
  let mfBytes = null;
  try { const r = await fetchFn(new URL("./shell-manifest.json", baseUrl), { cache: "no-store" }); if (r && r.ok) mfBytes = await r.arrayBuffer(); } catch {}
  if (!mfBytes) return { ok: false, why: "no-manifest", head: head.id };
  if (p.manifest && (await sha256hex(mfBytes)) !== p.manifest) return { ok: false, why: "manifest-not-signed", head: head.id };
  let manifest = null; try { manifest = JSON.parse(new TextDecoder().decode(mfBytes)); } catch {}
  const agg = manifest ? await shellAggregate(manifest) : "";
  if (!agg || agg !== p.shell) return { ok: false, why: "shell-mismatch", head: head.id };
  // 4. accepted — advance the pin, upgrade the worker's bar to SIGNED-verified (what #m1 links did, now standing)
  try { storage.setItem(PIN_KEY, JSON.stringify(a.pin)); } catch {}
  try { if (post) post({ type: "holo-shell-manifest", assets: manifest.assets, runtime: manifest.runtime || [] }); } catch {}
  return { ok: true, pin: a.pin, unchanged: !!a.unchanged, shell: p.shell };
}

// rollback is an EXPLICIT LOCAL ACT (never something a remote pointer can cause): re-pin a parent entry
// the operator chose from the strand. The next acceptHead treats it as the baseline.
export function repin(storage, entry) {
  const pin = { id: entry.id, seq: entry["holstr:seq"], pub: entry["holstr:pub"] };
  storage.setItem(PIN_KEY, JSON.stringify(pin));
  return pin;
}

// ── browser auto-run: after the worker registers, verify the pointer off the critical path ────────────
if (typeof window !== "undefined" && typeof navigator !== "undefined") {
  (async () => {
    try {
      if (!("serviceWorker" in navigator)) return;
      const reg = await navigator.serviceWorker.ready;
      const r = await releaseBoot({
        fetchFn: fetch.bind(globalThis), storage: window.localStorage, baseUrl: import.meta.url,
        post: (m) => { try { (reg.active || navigator.serviceWorker.controller)?.postMessage(m); } catch {} },
      });
      window.HoloRelease = Object.assign(window.HoloRelease || {}, { last: r, repin: (e) => repin(window.localStorage, e) });
      if (r.ok && !r.unchanged) console.log("[release] signed head pinned: seq " + r.pin.seq + " " + r.pin.id.slice(-16));
      else if (!r.ok && r.why !== "no-pointer") console.warn("[release] pointer refused (" + r.why + ") — shell stays on the last verified release");
    } catch {}
  })();
}
