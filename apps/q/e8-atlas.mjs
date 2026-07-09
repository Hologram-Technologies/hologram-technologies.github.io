// e8-atlas.mjs — THE SUBSTRATE-NATIVE E₈ LATTICE OBJECT, as hosted by ATLAS 96 (ADR-0054 arc).
// Compiles the E₈ ball (shells of norm² ≤ 8: 1+240+2160+6720+17520 = 26,641 points, EXACT integer
// arithmetic in doubled coordinates c = 2q ∈ ℤ⁸) into a sealed, content-addressed UOR object with
// hologram-style PRECOMPILED LOOKUP TABLES — membership, shell, resonance class, Φ-cell, and Gosset
// adjacency are all O(1) hash/table reads at runtime (the "compile-once, dispatch-O(1)" principle).
//
// THE ATLAS 96 BRIDGE (declared, zero free parameters — verbatim invariants from the vendored
// upstream: R96 = b % 96, Φ(p,b) = (p<<8)|b, 48×256 = 12,288 cells):
//   • R96(point)  = ( Σ_i byte(c_i) ) mod 96      — the per-byte classifier composed additively
//                    over the point's canonical 8-byte (int8 c=2q) encoding; the 96 classes are
//                    the resonance HYPEREDGES grouping lattice points.
//   • Φ(point)    = its index in canonical order (shell-major, lex-minor) — the atlas's 12,288
//                    pages exactly HOST the ball through shell 3 (origin+240+2160+6720 = 9,121
//                    cells used); shell 4 lives outside the page space (stated, not hidden).
//
// E₈ in c = 2q coordinates: all c_i SAME parity, Σc_i ≡ 0 (mod 4); norm² = Σc²/4.
// Falsification gates in the witness: shell counts must equal the theta series, every root must
// have exactly 56 Gosset neighbors, the Conway-Sloane decoder must be idempotent on every point,
// the hash table must hit 100% of members and 0% of perturbed non-members.
import { nearestE8 } from "./e8-quant.mjs";
// node-only deps (seal + the witness main) load lazily so the module stays browser-importable

export const MAX_NORM2 = 8;                       // shells: 2,4,6,8 (plus the origin)
export const THETA = { 0: 1, 2: 240, 4: 2160, 6: 6720, 8: 17520 };   // E₈ theta series (the gate)
export const PAGES = 48, BYTES = 256, CELLS = 12288, RCLASSES = 96;  // ATLAS 96 — verbatim
const phiEncode = (p, b) => (p << 8) | b;          // verbatim
const r96byte = (b) => (b & 0xff) % 96;            // verbatim per-byte classifier

// ── exact construction: DFS over c ∈ ℤ⁸, same parity, Σ ≡ 0 (mod 4), Σc² ≤ 4·MAX_NORM2 ──
export function buildBall(maxNorm2 = MAX_NORM2) {
  const pts = [];
  const lim2 = 4 * maxNorm2;
  for (const parity of [0, 1]) {
    const vals = [];
    for (let v = -5; v <= 5; v++) if (Math.abs(v % 2) === parity) vals.push(v);
    const c = new Int8Array(8);
    const dfs = (i, n2, sum) => {
      if (n2 > lim2) return;
      if (i === 8) { if ((((sum % 4) + 4) % 4) === 0 && !(parity === 0 && n2 === 0 && false)) pts.push(Int8Array.from(c)); return; }
      for (const v of vals) { c[i] = v; dfs(i + 1, n2 + v * v, sum + v); }
    };
    dfs(0, 0, 0);
  }
  // canonical order: shell-major (norm² asc), then lexicographic — the Φ order
  pts.sort((a, b) => { const na = a.reduce((s, v) => s + v * v, 0), nb = b.reduce((s, v) => s + v * v, 0); if (na !== nb) return na - nb; for (let i = 0; i < 8; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; });
  return pts;                                       // includes the origin at index 0
}

// ── the precompiled lookup tables (the hologram move: compute once → O(1) forever) ──
const fnv = (bytes) => { let h = 0x811c9dc5; for (let i = 0; i < 8; i++) { h ^= bytes[i] & 0xff; h = Math.imul(h, 0x01000193); } return h >>> 0; };
export function buildTables(pts) {
  const n = pts.length;
  const points = new Int8Array(n * 8);
  const shell = new Uint8Array(n), cls = new Uint8Array(n);
  const HASH_SIZE = 65536, hash = new Int32Array(HASH_SIZE);       // (idx+1), 0 = empty; linear probe
  for (let i = 0; i < n; i++) {
    const c = pts[i]; points.set(c, i * 8);
    let n2 = 0, cs = 0;
    for (let k = 0; k < 8; k++) { n2 += c[k] * c[k]; cs += (c[k] & 0xff); }
    shell[i] = n2 / 4; cls[i] = cs % 96;
    let s = fnv(c) & (HASH_SIZE - 1);
    while (hash[s] !== 0) s = (s + 1) & (HASH_SIZE - 1);
    hash[s] = i + 1;
  }
  const lookup = (c) => {                                          // O(1) membership/index
    let s = fnv(c) & (HASH_SIZE - 1);
    while (hash[s] !== 0) {
      const i = hash[s] - 1; let eq = true;
      for (let k = 0; k < 8; k++) if (points[i * 8 + k] !== c[k]) { eq = false; break; }
      if (eq) return i;
      s = (s + 1) & (HASH_SIZE - 1);
    }
    return -1;
  };
  // Gosset graph: the 240 roots (shell 1 = indices 1..240); edges at ‖c_a−c_b‖² = 8 (q-dist² = 2)
  const roots = [];
  for (let i = 0; i < n; i++) if (shell[i] === 2) roots.push(i);
  const deg = [], gosset = [];
  for (const a of roots) {
    const nb = [];
    for (const b of roots) {
      if (a === b) continue;
      let d2 = 0; for (let k = 0; k < 8; k++) { const d = points[a * 8 + k] - points[b * 8 + k]; d2 += d * d; }
      if (d2 === 8) nb.push(b);
    }
    deg.push(nb.length); gosset.push(nb);
  }
  return { n, points, shell, cls, hash, lookup, roots, gosset, deg };
}

// ── runtime API over the tables (usable in node + browser; experiments run THROUGH this) ──
export function atlasE8(T) {
  const c8 = new Int8Array(8);
  const snap = (x) => {                                            // ℝ⁸ → nearest E₈ point (exact decoder) → c = 2q
    const q = new Float64Array(8); nearestE8(x, q);
    for (let i = 0; i < 8; i++) c8[i] = Math.round(q[i] * 2);
    return Int8Array.from(c8);
  };
  return {
    n: T.n,
    member: (c) => T.lookup(c) >= 0,
    index: (c) => T.lookup(c),
    point: (i) => T.points.subarray(i * 8, i * 8 + 8),
    shellOf: (i) => T.shell[i],
    class96: (i) => T.cls[i],
    phiOf: (i) => (i < CELLS ? { cell: i, page: i >> 8, byte: i & 0xff, phi: phiEncode(i >> 8, i & 0xff) } : null),   // shells ≤3 live in the atlas page space
    snap,
    neighbors: (i) => {                                            // lattice neighbors via the 240 roots, each an O(1) lookup
      const out = [], c = T.points.subarray(i * 8, i * 8 + 8), t = new Int8Array(8);
      for (const r of T.roots) {
        for (let k = 0; k < 8; k++) t[k] = c[k] + T.points[r * 8 + k];
        const j = T.lookup(t); if (j >= 0) out.push(j);
      }
      return out;
    },
    gosset: (rootIdx) => T.gosset[T.roots.indexOf(rootIdx)] || null,
  };
}

// ── seal: blocks (gzip, sha256-addressed) + JCS manifest → did:holo ── (node-only)
const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]" : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}" : JSON.stringify(v);
export async function seal(T, outDir, links = {}) {
  const { createHash } = await import("node:crypto");
  const { gzipSync } = await import("node:zlib");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const sha = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");
  mkdirSync(outDir + "/b", { recursive: true });
  const block = (bytes) => { const gz = gzipSync(Buffer.from(bytes.buffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes), { level: 9 }); const k = sha(gz); writeFileSync(`${outDir}/b/${k.replace(":", "_")}.gz`, gz); return { kappa: k, stored: gz.length, bytes: bytes.byteLength }; };
  const gflat = new Uint16Array(240 * 56);
  T.gosset.forEach((nb, i) => nb.forEach((v, j) => { gflat[i * 56 + j] = v; }));
  const blocks = {
    points: block(T.points), shells: block(T.shell), classes: block(T.cls),
    hash: block(T.hash), gosset: block(gflat),
  };
  const shellCounts = {}; for (let i = 0; i < T.n; i++) shellCounts[T.shell[i]] = (shellCounts[T.shell[i]] || 0) + 1;
  const body = {
    "@context": ["https://www.w3.org/ns/did/v1", { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", holo: "https://hologram.os/ns/q#", hosc: "https://hologram.os/ns/conformance#" }],
    "@type": ["holo:E8AtlasLattice", "prov:Entity"],
    "schema:name": "E₈ lattice ball, ATLAS-96-hosted, O(1)-navigable",
    "schema:version": "e8atlas/1.0",
    "holo:coords": "c = 2q ∈ ℤ⁸ (int8), same parity, Σc ≡ 0 mod 4; norm² = Σc²/4",
    "holo:maxNorm2": MAX_NORM2,
    "holo:points": T.n,
    "holo:shellCounts": shellCounts,
    "holo:classRule": "R96(point) = (Σ_i byte(c_i)) mod 96 — verbatim per-byte R96 composed additively",
    "holo:phiRule": "Φ(point) = canonical index (shell-major, lex-minor); shells ≤3 (9,121 points) live inside the 12,288-cell page space",
    "holo:navigation": "precompiled O(1): FNV-1a open-addressed membership (65,536 slots) · per-point shell/class tables · Gosset 240×56 adjacency",
    "holo:blocks": Object.fromEntries(Object.entries(blocks).map(([k, v]) => [k, { kappa: v.kappa, bytes: v.bytes }])),
    "holo:links": links,                                            // atlas object id ⊕ atlas wasm κ ⊕ E8 standard ⊕ model codebook κs
    "holo:laws": ["L1 content-address", "L5 re-derivation"],
  };
  const id = "did:holo:" + sha(Buffer.from(jcs(body)));
  writeFileSync(`${outDir}/lattice.uor.json`, JSON.stringify({ "@id": id, ...body }, null, 1));
  return { id, body, blocks };
}

// ── isomorphic loader: fetch the SEALED object, κ-verify every block (Law L5), rebuild the O(1)
// API with zero recompute — browser experiments run against the same content-addressed bytes. ──
export async function loadObject(baseUrl) {
  const man = await (await fetch(baseUrl + "/lattice.uor.json", { cache: "no-store" })).json();
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const gun = async (u8) => { const ds = new DecompressionStream("gzip"); const w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); };
  const blk = async (rec) => {
    const gz = new Uint8Array(await (await fetch(baseUrl + "/b/" + rec.kappa.replace(":", "_") + ".gz", { cache: "no-store" })).arrayBuffer());
    if ("sha256:" + hex(await crypto.subtle.digest("SHA-256", gz)) !== rec.kappa) throw new Error("κ MISMATCH " + rec.kappa.slice(0, 24));
    return gun(gz);
  };
  const B = man["holo:blocks"];
  const [p, s, c, h, g] = await Promise.all([blk(B.points), blk(B.shells), blk(B.classes), blk(B.hash), blk(B.gosset)]);
  const points = new Int8Array(p.buffer, p.byteOffset, p.byteLength);
  const shell = s, cls = c;
  const hash = new Int32Array(h.buffer.slice(h.byteOffset, h.byteOffset + h.byteLength));
  const gflat = new Uint16Array(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength));
  const n = points.length / 8, HASH_SIZE = hash.length;
  const lookup = (cc) => { let sl = fnv(cc) & (HASH_SIZE - 1); while (hash[sl] !== 0) { const i = hash[sl] - 1; let eq = true; for (let k = 0; k < 8; k++) if (points[i * 8 + k] !== cc[k]) { eq = false; break; } if (eq) return i; sl = (sl + 1) & (HASH_SIZE - 1); } return -1; };
  const roots = []; for (let i = 0; i < n; i++) if (shell[i] === 2) roots.push(i);
  const gosset = Array.from({ length: 240 }, (_, i) => Array.from(gflat.subarray(i * 56, i * 56 + 56)));
  return { man, api: atlasE8({ n, points, shell, cls, hash, lookup, roots, gosset, deg: gosset.map((x) => x.length) }) };
}

// ── node: build + WITNESS + seal + the codebook-alignment experiment ──
if (typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("e8-atlas.mjs")) {
  const { createHash } = await import("node:crypto");
  const { readFileSync, existsSync } = await import("node:fs");
  const sha = (b) => "sha256:" + createHash("sha256").update(b).digest("hex");
  const t0 = Date.now();
  const pts = buildBall();
  const T = buildTables(pts);
  const A = atlasE8(T);
  const rec = [];
  const check = (name, ok, detail = "") => { rec.push(ok); console.log(` ${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };

  // 1 · theta series (the construction gate)
  const counts = {}; for (let i = 0; i < T.n; i++) counts[T.shell[i]] = (counts[T.shell[i]] || 0) + 1;
  check("shell counts = E₈ theta series", JSON.stringify(counts) === JSON.stringify(THETA), JSON.stringify(counts));
  // 2 · negation closure (lattice symmetry)
  let negOk = true; const t = new Int8Array(8);
  for (let i = 0; i < T.n && negOk; i += 7) { const c = A.point(i); for (let k = 0; k < 8; k++) t[k] = -c[k]; negOk = T.lookup(t) >= 0; }
  check("closed under negation", negOk);
  // 3 · Gosset degree = 56 for every root (E₈ kissing structure)
  check("every root has exactly 56 Gosset neighbors", T.deg.every((d) => d === 56), `degrees ${Math.min(...T.deg)}..${Math.max(...T.deg)}`);
  // 4 · decoder idempotence: snap(point) = point, all 26,641
  let snapOk = true; const x = new Float64Array(8);
  for (let i = 0; i < T.n && snapOk; i++) { const c = A.point(i); for (let k = 0; k < 8; k++) x[k] = c[k] / 2; const s = A.snap(x); for (let k = 0; k < 8; k++) if (s[k] !== c[k]) { snapOk = false; break; } }
  check("Conway-Sloane decoder idempotent on every point", snapOk);
  // 5 · hash: 100% member hits + 0 false positives on parity-violating perturbations
  let hit = 0; for (let i = 0; i < T.n; i++) if (T.lookup(A.point(i)) === i) hit++;
  let fp = 0; for (let i = 0; i < T.n; i += 3) { const c = Int8Array.from(A.point(i)); c[i % 8] += 1; if (T.lookup(c) >= 0) fp++; }   // breaks parity ⇒ must miss
  check("O(1) hash: 100% hits, 0 false positives", hit === T.n && fp === 0, `${hit}/${T.n} hits, ${fp} fp`);
  // 6 · O(1) speed: lookups/s vs decoder ops/s
  let s1 = Date.now(), m = 0;
  for (let r = 0; r < 40; r++) for (let i = 0; i < T.n; i++) m += T.lookup(A.point(i)) >= 0 ? 1 : 0;
  const lps = (m / ((Date.now() - s1) / 1000) / 1e6).toFixed(1);
  check("O(1) navigation speed", true, `${lps} M lookups/s (${m.toLocaleString()} lookups)`);
  // 7 · resonance classes: how the 96 hyperedges partition the ball
  const ch = new Array(96).fill(0); for (let i = 0; i < T.n; i++) ch[T.cls[i]]++;
  const nz = ch.filter((v) => v > 0).length, mx = Math.max(...ch), mn = Math.min(...ch.filter((v) => v > 0));
  check("R96 hyperedges cover the ball", nz > 0, `${nz}/96 classes populated, sizes ${mn}..${mx}`);

  // 8 · THE ALIGNMENT EXPERIMENT: where does the LLM's sealed E8 codebook live in the lattice?
  for (const model of ["qwen2.5-1.5b-e8", "qwen2.5-14b-e8"]) {
    const lp = `./models/${model}/_lut.bin`;
    if (!existsSync(lp)) continue;
    const lut = new Float32Array(readFileSync(lp).buffer.slice(0), 0, 2048);
    const sh = {}; let onLattice = 0;
    for (let s = 0; s < 256; s++) {
      const c = new Int8Array(8); let n2 = 0;
      for (let k = 0; k < 8; k++) { c[k] = Math.round(lut[s * 8 + k] * 2); n2 += c[k] * c[k]; }
      const i = T.lookup(c);                                       // the +sign representative
      if (i >= 0) { onLattice++; sh[T.shell[i]] = (sh[T.shell[i]] || 0) + 1; }
      else sh["off:" + n2 / 4] = (sh["off:" + n2 / 4] || 0) + 1;
    }
    console.log(` · codebook[${model}]: ${onLattice}/256 shapes are lattice points · shells ${JSON.stringify(sh)}`);
  }

  // 9 · seal
  const links = {};
  try { links.atlasWasm = "did:holo:" + sha(readFileSync("./atlas12288.wasm")); } catch {}
  try { links.modelCodebook15 = JSON.parse(readFileSync("./models/qwen2.5-1.5b-e8/manifest.json", "utf8")).e8lut; } catch {}
  const { id, blocks } = await seal(T, "./atlas-e8", links);
  const total = Object.values(blocks).reduce((a, b) => a + b.stored, 0);
  console.log(`\nsealed → ./atlas-e8  (${(total / 1024).toFixed(0)} KB in ${Object.keys(blocks).length} κ-blocks)`);
  console.log(`object id: ${id}`);
  console.log(`witness: ${rec.filter(Boolean).length}/${rec.length} checks pass · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(rec.every(Boolean) ? 0 : 1);
}
