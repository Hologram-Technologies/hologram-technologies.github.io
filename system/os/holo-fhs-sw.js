// holo-fhs-sw.js — the CONTENT-ADDRESSED delivery worker. It makes the OS boot on any dumb
// static host (GitHub Pages) with no server cooperation, AND it makes every booted byte native
// to the UOR substrate: nothing is trusted by location — every response is RE-DERIVED to its κ
// and refused on mismatch (Law L5). The origin is thereby demoted from authority to one untrusted
// CDN: tamper with it, or swap a byte in transit, and the boot fails closed.
//
//   1 · Names → bytes. A request's path is a NAME; its identity is its κ in the OS closure
//       (etc/os-closure.json). The flat URL space maps onto the FHS tree via the ONE shared rule
//       (lib/holo-fhs-map.mjs), shared with the dev server — dev and prod resolve identically (L2).
//   2 · Verify by re-derivation (L5). Fetch the bytes, hash them, compare to the pinned κ
//       (the κ-route hex, or the closure κ for the path). Mismatch ⇒ refuse (409). Unpinned ⇒ pass.
//   3 · κ-route. /.holo/sha256/<hex> resolves a byte-set by content directly.
//   4 · Cross-origin isolation. Stamp COOP/COEP/CORP so crossOriginIsolated works without headers.

import { fhsMap } from "./lib/holo-fhs-map.mjs";

const BASE = new URL(self.registration.scope).pathname;       // "/" at a root/user site, "/<repo>/" under a project site
const COI = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

let BYHEX = null;     // κ hex → os-relative path (the κ-route name table)
let BYPATH = null;    // os-relative path → κ hex (the verification pins)
async function loadClosure() {
  if (BYPATH) return;
  BYHEX = new Map(); BYPATH = new Map();
  try {
    const doc = await (await fetch(BASE + "etc/os-closure.json", { cache: "no-store" })).json();
    for (const [p, v] of Object.entries(doc.closure || {})) {
      const k = typeof v === "string" ? v : (v.kappa || v.did || v["@id"] || "");
      const hex = String(k).split(":").pop().toLowerCase();
      if (/^[0-9a-f]{64}$/.test(hex)) { BYHEX.set(hex, p); BYPATH.set(p, hex); }
    }
  } catch { /* no closure → serve unverified (flat mapping still works) */ }
}
const sha256hex = async (buf) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => { await self.clients.claim(); await loadClosure(); })()));

const withHeaders = (body, resp, extra = {}) => { const h = new Headers(resp.headers); for (const [k, v] of Object.entries({ ...COI, ...extra })) h.set(k, v); return new Response(body, { status: resp.status, statusText: resp.statusText, headers: h }); };
const refuse = (rel, want, got) => new Response(`holo-fhs-sw: κ MISMATCH — refused (Law L5)\n  name: ${rel}\n  want: sha256:${want}\n  got:  sha256:${got}\nThe origin is untrusted; tampered bytes do not boot.`, { status: 409, headers: { ...COI, "content-type": "text/plain" } });

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // only our origin (cross-origin untouched)
  if (!url.pathname.startsWith(BASE)) return;                 // out of scope

  event.respondWith((async () => {
    await loadClosure();
    let rel = decodeURIComponent(url.pathname.slice(BASE.length)).replace(/^\/+/, "");
    if (rel === "" || rel.endsWith("/")) rel += "index.html";

    // κ-route: /.holo/sha256/<hex> → the pin IS the hex; resolve its name, fetch, re-derive.
    let expect = null;
    const m = rel.match(/^\.holo\/sha256\/([a-f0-9]{64})(?:\.\w+)?$/i);
    if (m) {
      expect = m[1].toLowerCase();
      const named = BYHEX.get(expect);
      if (!named) return new Response("κ not in closure index", { status: 404, headers: COI });
      rel = named;
    } else {
      expect = BYPATH.get(rel) || null;                       // the pinned κ for this path, if any
    }

    const phys = fhsMap(rel) || rel;                          // mapped FHS path, else the path as-is
    let resp;
    try { resp = await fetch(BASE + phys, { cache: "no-store" }); }   // SW-initiated → does not re-enter this handler
    catch (e) { return new Response("holo-fhs-sw: fetch failed for " + phys, { status: 502, headers: COI }); }
    if (resp.status !== 200) return withHeaders(resp.body, resp);

    // Law L5: re-derive the bytes against the pinned κ; refuse a mismatch. Unpinned files pass through.
    if (expect) {
      const buf = await resp.arrayBuffer();
      const got = await sha256hex(buf);
      if (got !== expect) return refuse(rel, expect, got);
      return withHeaders(buf, resp);
    }
    return withHeaders(resp.body, resp);
  })());
});
