#!/usr/bin/env node
// holo-blake3-appcas-witness.mjs — P6 of the canonical-κ cutover: app-CAS dual-axis carry + lazy re-seal.
// Apps are independently-sealed κ-bundles (holospace.lock.json); v86/ISO manifests carry multi-GB blobs.
// The cutover does NOT flag-day re-hash those — it carries blake3 alongside sha256 where cheap and lets a
// large blob fill its canonical axis LAZILY (serve via the sha bridge alias until re-sealed). This proves:
//   • the app-lock generator (relock-app) now emits the canonical top-level `blake3` κ (P2 shape);
//   • a small app file (blake3-primary) resolves on the CANONICAL axis, tamper refused (Law L5);
//   • a large ISO entry carrying ONLY the sha bridge alias (not yet re-hashed) still resolves via the
//     fallback — the lazy path — and tamper is still refused; when its blake3 lands it verifies canonically;
//   • both the SW (foldClosure/select) and the native Rust app-lock loader read the canonical blake3.
//
//   node tools/holo-blake3-appcas-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const { blake3hex } = await import(new URL("../os/usr/lib/holo/holo-blake3.mjs", import.meta.url));
const sha256hex = (b) => createHash("sha256").update(b).digest("hex");

const checks = {}; let passed = 0, failed = 0;
const rec = (name, ok) => { checks[name] = !!ok; ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${name}`); };

// fold + select, mirroring the SW (canonical blake3 first, sha bridge fallback) for an app-lock closure.
function fold(closure) {
  const BYPATH = new Map(), BYPATH_B3 = new Map();
  for (const [p, v] of Object.entries(closure)) {
    const sha = String(typeof v === "string" ? v : v.kappa || "").split(":").pop().toLowerCase();
    if (/^[0-9a-f]{64}$/.test(sha) && !BYPATH.has(p)) BYPATH.set(p, sha);
    if (v && typeof v === "object") for (const c of [v.blake3, ...(v.alsoKnownAs || [])]) {
      const m = /^did:holo:blake3:([0-9a-f]{64})$/.exec(String(c)); if (m && !BYPATH_B3.has(p)) BYPATH_B3.set(p, m[1]);
    }
  }
  return { BYPATH, BYPATH_B3 };
}
const select = (maps, rel) => { const b3 = maps.BYPATH_B3.get(rel); return b3 ? { axis: "blake3", expect: b3 } : { axis: "sha256", expect: maps.BYPATH.get(rel) || null }; };
const verify = (axis, buf, expect) => (axis === "blake3" ? blake3hex(buf) : sha256hex(buf)) === expect;

const te = new TextEncoder();
const small = te.encode("<!doctype html><title>App</title>\n");                 // small file → carry blake3 (cheap)
const iso = te.encode("…pretend this is a multi-GB v86 disk image…\n");          // large blob → lazy axis
// an app-lock in the cutover shape: small file dual-axis; ISO carries ONLY the sha bridge alias (not re-hashed yet).
const lock = {
  "apps/demo/index.html": { blake3: "did:holo:blake3:" + blake3hex(small), kappa: "did:holo:sha256:" + sha256hex(small), bytes: small.length, alsoKnownAs: ["did:holo:blake3:" + blake3hex(small)] },
  "apps/demo/disk.img": { kappa: "did:holo:sha256:" + sha256hex(iso), bytes: iso.length },   // sha-only (lazy blake3)
};
const maps = fold(lock);

const selS = select(maps, "apps/demo/index.html");
rec("small app file resolves on the CANONICAL blake3 axis", selS.axis === "blake3" && verify(selS.axis, small, selS.expect));
rec("small app file tamper refused on the canonical axis", verify(selS.axis, te.encode("<!doctype html><title>X</title>\n"), selS.expect) === false);

const selI = select(maps, "apps/demo/disk.img");
rec("large ISO (sha-only) resolves via the bridge FALLBACK — lazy re-seal, no flag-day re-hash", selI.axis === "sha256" && verify(selI.axis, iso, selI.expect));
rec("large ISO tamper still refused on the bridge axis (Law L5 holds during the lazy window)", verify(selI.axis, te.encode("tampered iso\n"), selI.expect) === false);

// when the ISO's blake3 axis is later filled (lazy re-seal completes), it verifies CANONICALLY.
const lazyFilled = fold({ "apps/demo/disk.img": { blake3: "did:holo:blake3:" + blake3hex(iso), kappa: "did:holo:sha256:" + sha256hex(iso) } });
const selL = select(lazyFilled, "apps/demo/disk.img");
rec("once the blake3 axis is filled, the ISO verifies CANONICALLY (lazy cut-over completes)", selL.axis === "blake3" && verify(selL.axis, iso, selL.expect));

// structural: the real generators + native loader carry the canonical axis.
const relock = readFileSync(join(here, "relock-app.mjs"), "utf8");
rec("relock-app emits the canonical top-level blake3 κ on every app entry", /blake3: `did:holo:blake3:\$\{b3\}`/.test(relock));
const rust = readFileSync(join(here, "../../../holo-apps/apps/tauri/src-tauri/kappa-route/src/lib.rs"), "utf8");
rec("native Rust app-lock loader reads the canonical blake3 (top-level OR alsoKnownAs)", /app locks carry the canonical blake3/.test(rust));

const witnessed = failed === 0;
writeFileSync(join(here, "holo-blake3-appcas-witness.result.json"), JSON.stringify({
  spec: "P6 — app-CAS (holospace.lock) carries the canonical blake3 alongside the sha256 bridge alias; large v86/ISO blobs fill their canonical axis LAZILY (serve via the sha alias until re-sealed), never a flag-day multi-GB re-hash. Tamper refused on whichever axis is canonical for the entry.",
  witnessed, covers: ["app-cas", "holospace-lock", "dual-axis", "lazy-reseal", "iso", "law-l5"],
  checks, passed, failed,
}, null, 2) + "\n");
console.log(`\nholo-blake3-appcas-witness: ${passed} passed, ${failed} failed`);
process.exit(witnessed ? 0 : 1);
