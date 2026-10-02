// holo-self-pin.mjs — I0+I1 of HOLO-ONE-KAPPA-IN: the worker pins ITSELF at install, then ingests
// the boot module graph as ONE κ-object. ONE implementation for both workers (root-sw + holo-sw),
// exactly like holo-rungs/holo-evict-rescue (Law L4).
//
//   I0 self-pin  — fetch release.json (no-store) → resolve the closure by its sha256 κ through THE
//                  ladder (origin b/ → mirror, verified fail-closed) → seed the "holo-pin" cache.
//                  The closure exists BEFORE this worker's first fetch event, so the very first
//                  session serves lawfully (K2 stamps + device-store-first). The page-side holo-pin
//                  flow stays the authority for the full O3/O4 seal; this is only the early copy.
//   I1 pack      — boot-pack.json (closure-verified) names the pack κ; the pack resolves through the
//                  ladder as ONE fetch, and a block enters the device store iff the CLOSURE — the
//                  signed authority — lists that exact κ for that path (L5/SEC-6 on the κ's own
//                  axis). The pack is untrusted transport; the closure signs. Absent pack → no-op.
//
// Fully fail-soft: any miss anywhere leaves today's behavior byte-identical. No dynamic import()
// (SW law); createBlake3 is a static same-tree import (holo-rungs pulls the same module).
import { createBlake3 } from "./holo-blake3.mjs";

export function makeSelfPin({ base, ladder, rung, closure, onFresh }) {
  const sha256hex = async (buf) => {
    const d = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const b3hex = (u8) => { const h = createBlake3(); h.update(u8); return h.hex(); };

  async function selfPin() {
    try {
      const r = await fetch(base + "/release.json", { cache: "no-store" });
      if (!r || !r.ok) return;
      const rel = await r.json();
      const want = (rel["holstr:payload"] || {}).closure;
      if (!/^[0-9a-f]{64}$/.test(want || "")) return;
      const pin = await caches.open("holo-pin");
      const cur = await pin.match(base + "/os-closure.json");
      const current = cur && (await sha256hex(await cur.clone().arrayBuffer())) === want;
      if (!current) {
        const res = await ladder.resolve("sha256", want, { ext: "json" });   // verified fail-closed by the ladder
        if (!res || !res.ok) return;
        const bytes = await res.arrayBuffer();
        // release first, then closure: pinnedClosure()'s head-check must never see the new closure
        // beside an old release (it would memoize a refusal).
        await pin.put(base + "/release.json", new Response(JSON.stringify(rel), { headers: { "content-type": "application/json" } }));
        await pin.put(base + "/os-closure.json", new Response(bytes, { headers: { "content-type": "application/json", "x-holo-kappa": "sha256:" + want } }));
        try { onFresh && onFresh(); } catch {}
      }
      // Z2b (BYTE-ZERO): pin THE WORLD ROOT beside the closure — the ~17.7KB sharded root that
      // carries the rescue registry. Device-local before traffic, so the resolver (holo-world.mjs)
      // answers from the pin with ZERO network on every later start (and offline), and the arrival
      // manifests can die in Z3. Ladder-resolved = verified fail-closed; any miss changes nothing.
      try {
        const wk = (rel["holstr:payload"] || {}).world;
        if (/^[0-9a-f]{64}$/.test(wk || "") && !(await pin.match(base + "/b/" + wk))) {
          const wres = await ladder.resolve("sha256", wk, { ext: "json" });
          if (wres && wres.ok) {
            const wb = await wres.arrayBuffer();
            // prune superseded world-root pins (κ-named; only the current one serves)
            try { for (const k of await pin.keys()) { const u = new URL(k.url); if (/\/b\/[0-9a-f]{64}$/.test(u.pathname) && !u.pathname.endsWith("/" + wk)) await pin.delete(k); } } catch {}
            await pin.put(base + "/b/" + wk, new Response(wb, { headers: { "content-type": "application/json", "x-holo-kappa": "sha256:" + wk } }));
          }
        }
      } catch {}
      await bootPackIngest();
    } catch {}
  }

  async function bootPackIngest() {
    try {
      const cl = await closure();
      if (!cl || !cl.files) return;
      const pe = cl.files["boot-pack.json"];
      if (!pe || !pe.blake3) return;
      const R = await rung();
      if (!R) return;
      if (await R.get("blake3", pe.blake3)) return;              // this pack version already ingested (marker)
      const bpr = await fetch(base + "/boot-pack.json", { cache: "no-store" });
      if (!bpr || !bpr.ok) return;
      const bpBytes = new Uint8Array(await bpr.arrayBuffer());
      if (b3hex(bpBytes) !== pe.blake3) return;                  // L5 at the trust boundary
      const bp = JSON.parse(new TextDecoder().decode(bpBytes));
      if (!/^[0-9a-f]{64}$/.test(bp.kappa || "")) return;
      const pr = await ladder.resolve("blake3", bp.kappa);       // ONE fetch (origin b/ may 404 → mirror rung)
      if (!pr || !pr.ok) return;
      const u8 = new Uint8Array(await pr.arrayBuffer());         // ladder already re-derived the pack κ
      const nl = u8.indexOf(10);
      if (nl < 1 || nl > 12) return;
      const hlen = parseInt(new TextDecoder().decode(u8.slice(0, nl)), 10);
      if (!(hlen > 0) || nl + 1 + hlen > u8.length) return;
      const header = JSON.parse(new TextDecoder().decode(u8.slice(nl + 1, nl + 1 + hlen)));
      const blob0 = nl + 1 + hlen;
      for (const [pth, ent] of Object.entries(header.files || {})) {
        const ce = cl.files[pth];
        if (!ce || !ent || ce.blake3 !== ent.kappa) continue;    // closure is the authority; pack is transport
        if (!(ent.length >= 0) || blob0 + ent.offset + ent.length > u8.length) continue;
        const block = u8.slice(blob0 + ent.offset, blob0 + ent.offset + ent.length);
        if (b3hex(block) !== ent.kappa) continue;
        try { R.put("blake3", ent.kappa, block); } catch {}
      }
      try { R.put("blake3", pe.blake3, bpBytes); } catch {}      // marker LAST: presence = fully ingested
    } catch {}
  }

  return { selfPin };
}
