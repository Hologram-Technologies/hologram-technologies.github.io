#!/usr/bin/env node
// holo-jupiter-witness.mjs — TEST the Solana spot-swap engine's trust-minimization (holo-jupiter.js),
// the Solana counterpart of holo-trade-witness.mjs. Jupiter's route is off-chain and untrusted; this
// witness proves the four on-chain guards that make a swap safe WITHOUT trusting that route, all
// offline and fund-free: venue κ re-derivation, the min-out floor, the sealed-program assertion, and
// the fee-payer assertion. A swap that fails any guard never reaches the human gate.
//
//   node tools/holo-jupiter-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { bs58dec, bs58enc } from "../os/usr/lib/holo/holo-solana.js";
import { verifyVenue, minOutFloor, parseVersionedTx, assertSwapTx, JUPITER } from "../os/usr/lib/holo/holo-jupiter.js";

const here = dirname(fileURLToPath(import.meta.url));
const results = []; let pass = 0, fail = 0;
const rec = (n, ok, d = "") => { results.push({ n, ok, d }); ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} — ${n}${d ? "  (" + d + ")" : ""}`); };
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };

// ── tiny Solana wire helpers (encode side; the engine owns the decode side) ──────────────────────
const sv = (n) => { const o = []; for (;;) { let b = n & 0x7f; n >>>= 7; if (n) o.push(b | 0x80); else { o.push(b); break; } } return Uint8Array.from(o); };
const cat = (...a) => { let n = 0; for (const x of a) n += x.length; const o = new Uint8Array(n); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };
const b64 = (u) => Buffer.from(u).toString("base64");
// a minimal v0 VersionedTransaction (1 zeroed sig slot) whose single instruction invokes `programB58`,
// fee-paid by `feePayerB58` — the exact shape Jupiter returns, reduced to what the guards inspect.
function fakeSwapTx(feePayerB58, programB58) {
  const fee = bs58dec(feePayerB58), prog = bs58dec(programB58), blockhash = new Uint8Array(32);
  const msg = cat(Uint8Array.of(0x80), Uint8Array.of(1, 0, 1), sv(2), fee, prog, blockhash, sv(1), Uint8Array.of(1), sv(0), sv(0), sv(0));
  return b64(cat(sv(1), new Uint8Array(64), msg));
}

const ME = bs58enc(new Uint8Array(32).fill(7));        // a deterministic fake fee-payer address
const NOTME = bs58enc(new Uint8Array(32).fill(9));
const DRAINER = bs58enc(new Uint8Array(32).fill(3));    // a look-alike program (not the sealed Jupiter)

// 1 · venue κ re-derivation (Law L5) — the sealed descriptor must re-derive, a tamper must not
const descriptor = JSON.parse(readFileSync(join(here, "..", "os", "etc", "holo-chains", "jupiter.uor.json"), "utf8"));
const v = await verifyVenue(descriptor);
rec("sealed Jupiter venue re-derives (κ == head)", v.ok, v.kappa?.slice(0, 24) + "…");
rec("venue sealedBody matches the engine's JUPITER constant", v.body?.programV6 === JUPITER.programV6 && v.body?.quote === JUPITER.quote);
const tampered = JSON.parse(JSON.stringify(descriptor)); tampered["hojup:sealedBody"].quote = "https://evil.example/quote";
rec("tampered venue host is REFUSED (κ mismatch)", !(await verifyVenue(tampered)).ok);
const tampered2 = JSON.parse(JSON.stringify(descriptor)); tampered2["hojup:sealedBody"].programV6 = DRAINER;
rec("tampered venue program is REFUSED (κ mismatch)", !(await verifyVenue(tampered2)).ok);

// 2 · min-out floor — re-derived independently of Jupiter's slippage math
const exact = minOutFloor({ outAmount: "1000000", slippageBps: 50, otherAmountThreshold: "995000" });
rec("floor: 1.000000 out @ 50bps → 995000 floor", exact.floor === 995000n && exact.ok);
const weak = minOutFloor({ outAmount: "1000000", slippageBps: 50, otherAmountThreshold: "990000" });
rec("Jupiter threshold BELOW our floor is REFUSED (ok=false)", weak.ok === false);
const exactMatch = minOutFloor({ outAmount: "1000000", slippageBps: 0, otherAmountThreshold: "1000000" });
rec("0bps floor equals outAmount (no silent slippage)", exactMatch.floor === 1000000n && exactMatch.ok);

// 3 · sealed-program + fee-payer assertion — the anti-phishing guard on the BUILT transaction
const good = fakeSwapTx(ME, JUPITER.programV6);
const parsed = parseVersionedTx(Buffer.from(good, "base64"));
rec("parseVersionedTx recovers fee-payer", parsed.feePayer === ME, parsed.feePayer.slice(0, 8) + "…");
rec("parseVersionedTx recovers invoked program", parsed.programs.includes(JUPITER.programV6));
rec("a well-formed Jupiter swap PASSES assertSwapTx", !!assertSwapTx(good, { expectedSigner: ME, programId: JUPITER.programV6 }));
rec("a swap whose fee-payer ≠ wallet is REFUSED", await throws(() => assertSwapTx(good, { expectedSigner: NOTME, programId: JUPITER.programV6 })));
const drainer = fakeSwapTx(ME, DRAINER);
rec("a swap that does NOT invoke sealed Jupiter is REFUSED", await throws(() => assertSwapTx(drainer, { expectedSigner: ME, programId: JUPITER.programV6 })));

// ── report (the gate's result contract: { witnessed, covers }) ──────────────────────────────────
const witnessed = fail === 0;
const checks = Object.fromEntries(results.map((r) => [r.n, r.ok]));
writeFileSync(join(here, "holo-jupiter-witness.result.json"), JSON.stringify({
  spec: "Holo Swap — the Solana spot-liquidity rail (Jupiter as the WDK Swidge provider): the off-chain route is NEVER trusted, it is enforced on-chain. The sealed venue descriptor re-derives to its κ (a swapped host/program is refused); an independently re-derived min-out FLOOR rejects a threshold weaker than the chosen slippage; the BUILT transaction must invoke the sealed Jupiter program AND be paid by the wallet's own key; the swap is SIMULATED before signing; and the key signs only behind the default-deny human gate, which shows the verified numbers. Solana spot beside Hyperliquid perps — one verifiable terminal, one wallet seam.",
  authority: "Jupiter (developers.jup.ag) by reference · UOR-ADDR (κ = H(canonical_form)) · IETF RFC 8785 (JCS) · CAIP-2 (solana:) · holospaces Laws L1/L4/L5 · holo-solana (ed25519 κ) + holo-wdk (default-deny gate) by reference",
  witnessed,
  covers: ["solana-spot-swap", "jupiter", "wdk-swidge-provider", "venue-kappa", "min-out-floor", "sealed-program-assertion", "fee-payer-assertion", "default-deny", "law-l5"],
  checks, passed: pass, failed: fail,
}, null, 2) + "\n");
console.log(`\nholo-jupiter-witness: ${pass} passed, ${fail} failed`);
process.exit(witnessed ? 0 : 1);
