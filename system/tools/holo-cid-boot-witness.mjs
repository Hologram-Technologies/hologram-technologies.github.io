#!/usr/bin/env node
// holo-cid-boot-witness.mjs — PROVE the cold-device, dead-origin boot from a single link …/#<root-CID>
// (decentralized-boot delta A). The fragment carries the κ of the boot root (os-closure.json) as a
// CIDv1; on a fresh device whose origin is DOWN, the root must resolve BY ITS κ from a NON-ORIGIN
// source and RE-DERIVE (Law L5). Witnessed offline with REAL crypto + the REAL os-closure root bytes,
// using a SIMULATED swarm source (the production source is IPFS Trustless Gateways / mesh peers, which
// need network — honestly noted; the control flow + L5 gate are what this proves).
//
//   node tools/holo-cid-boot-witness.mjs

import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rootKappaFromHash, coldBootRoot } from "../os/lib/holo-cid-boot.mjs";
import { makeCIDv1, cidToString } from "../os/usr/lib/holo/holo-ipfs.js";

const here = dirname(fileURLToPath(import.meta.url));
const results = []; let passed = 0, failed = 0;
const rec = (n, ok, d = "") => { results.push({ name: n, ok, detail: d }); ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const fromHex = (h) => { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return o; };

// the REAL boot root: os-closure.json bytes and their sha-256 κ
const rootBytes = readFileSync(join(here, "../os/etc/os-closure.json"));
const KAPPA = createHash("sha256").update(rootBytes).digest("hex");
const CID = cidToString(makeCIDv1(0x55, 0x12, fromHex(KAPPA)));   // CIDv1(raw, sha2-256) = the share-link fragment
const SHARE = `https://anyhost.example/#${CID}`;
console.log(`  share link: ${SHARE}\n  root κ: ${KAPPA.slice(0, 24)}…  CID: ${CID.slice(0, 24)}…\n`);

// 1 · fragment → κ, every accepted form
rec("a #<CID> fragment decodes to the root κ (CIDv1 sha2-256 → κ)", rootKappaFromHash("#" + CID) === KAPPA);
rec("a #root=<CID> fragment decodes to the root κ", rootKappaFromHash("#root=" + CID) === KAPPA);
rec("a #k=did:holo:sha256:<κ> fragment decodes to the root κ", rootKappaFromHash("#k=did:holo:sha256:" + KAPPA) === KAPPA);
rec("a bare #<κ> hex fragment decodes to the root κ", rootKappaFromHash("#" + KAPPA) === KAPPA);
rec("an empty / missing fragment yields null", rootKappaFromHash("") === null && rootKappaFromHash("#") === null);
rec("a non-sha2-256 / garbage fragment yields null (not a κ)", rootKappaFromHash("#not-a-cid") === null);

// ordered recovery sources (store → origin → ipfs → mesh). The ORIGIN is DEAD (throws) — simulating
// GitHub Pages down / censored. A SIMULATED swarm source serves the real root bytes by κ.
const deadOrigin = { name: "origin", get: async () => { throw new Error("ECONNREFUSED — origin down"); } };
const ipfsSim = { name: "ipfs-sim", get: async (hex) => (hex === KAPPA ? new Uint8Array(rootBytes) : null) };
const tampered = { name: "evil", get: async () => { const b = new Uint8Array(rootBytes); b[0] ^= 0xff; return b; } };
const emptyStore = { name: "store", get: async () => null };

// 2 · cold boot with a DEAD origin → resolves the root from the non-origin swarm, re-derived (L5)
{
  const r = await coldBootRoot({ hash: "#" + CID, sources: [emptyStore, deadOrigin, ipfsSim] });
  const okBytes = r && createHash("sha256").update(Buffer.from(r.bytes)).digest("hex") === KAPPA;
  rec("DEAD ORIGIN — the root resolves from a NON-ORIGIN source by κ and re-derives (Law L5)", !!r && r.kappa === KAPPA && okBytes, r ? `served by ${r.source}` : "no source served the root");
}

// 3 · a tampered source is refused (L5), even if it is the only one
{
  const r = await coldBootRoot({ hash: "#" + CID, sources: [deadOrigin, tampered] });
  rec("a TAMPERED root (bytes ≠ κ) from any source is refused (Law L5)", r === null);
}

// 4 · tampered THEN honest → skip the liar, accept the verified copy
{
  const r = await coldBootRoot({ hash: "#" + CID, sources: [tampered, ipfsSim] });
  rec("a liar source is skipped; the verified copy from a later source is accepted", !!r && r.source === "ipfs-sim");
}

// 5 · honest failure modes
{
  let threw = false; try { await coldBootRoot({ hash: "", sources: [ipfsSim], requireFragment: true }); } catch { threw = true; }
  rec("no root CID in the fragment + requireFragment → throws (no silent boot)", threw);
  const none = await coldBootRoot({ hash: "#" + CID, sources: [emptyStore, deadOrigin] });
  rec("no source can serve the root → null (honest, no fabricated boot)", none === null);
}

const witnessed = failed === 0 && passed > 0;
console.log(`\n${witnessed ? "WITNESSED ✓" : "FAILED ✗"} — ${passed}/${passed + failed} · cold-device boot from …/#<root-CID> resolves the root by κ from a non-origin source, re-derived (L5), with the origin dead.`);
writeFileSync(join(here, "holo-cid-boot-witness.result.json"),
  JSON.stringify({
    witnessed, passed, failed, rootKappa: KAPPA, cid: CID, shareLink: SHARE,
    covers: results.filter((r) => r.ok).map((r) => r.name.slice(0, 56)), results,
    pending: "The production recovery source is IPFS Trustless Gateways / mesh peers (holo-peers.mjs ipfsPeer), which need network. This witness simulates the swarm with a local source serving the REAL root bytes by κ — proving the fragment→κ decode, the non-origin resolution control flow, and the L5 re-derivation gate offline. Exercising a live gateway needs internet.",
    spec: "delta A — a single link …/#<root-CID> cold-boots a fresh device with the origin dead: the fragment CID decodes to the boot-root κ (CIDv1 sha2-256 → κ), the root resolves by κ from a NON-ORIGIN source (IPFS/mesh/store), and is re-derived before acceptance (Law L5). Refuses tampered bytes, skips liar sources, and fails honestly when no source serves a verified root.",
  }, null, 2) + "\n");
process.exit(witnessed ? 0 : 1);
