// hl-to-lean.mjs — transcode Holo Trade's Hyperliquid candles into the LEAN data format,
// pinned by κ (ADR-0072, Law L2: canonicalize at the ingest boundary, hold κ). This is the
// data seam between Holo Trade (ADR-0070, the Hyperliquid `candleSnapshot` feed) and Holo
// Strategy's vendored LEAN engine. Pure, deterministic: the same candles always produce the
// same bytes, so the same κ — a backtest over this data is re-derivable (Law L5).
//
// LEAN crypto hour/daily bar CSV (verified verbatim against the bundled sample data):
//   YYYYMMDD HH:mm,open,high,low,close,volume        (UTC; raw prices for crypto)
//
// Usage: node hl-to-lean.mjs <hyperliquid-candles.json> <out.csv>
//   input = the array returned by POST /info {type:"candleSnapshot", req:{coin,interval,...}}
//   prints the LEAN data κ (did:holo:sha256:…) of the produced bytes.

import { readFileSync, writeFileSync } from "node:fs";
import { sha256hex, didHolo } from "../../os/usr/lib/holo/holo-uor.mjs";

const pad = (n, w = 2) => String(n).padStart(w, "0");
// Hyperliquid candle open-time `t` (ms, UTC) → LEAN `YYYYMMDD HH:mm`
function leanTime(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

// candles → LEAN CSV bytes (sorted by open-time, deduped — fully deterministic)
export function transcode(candles) {
  const seen = new Map();
  for (const c of candles) seen.set(+c.t, c);                 // dedupe by open-time
  const rows = [...seen.values()].sort((a, b) => a.t - b.t).map((c) =>
    `${leanTime(+c.t)},${+c.o},${+c.h},${+c.l},${+c.c},${+c.v}`);
  return Buffer.from(rows.join("\n") + "\n", "utf8");
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("hl-to-lean.mjs")) {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) { console.error("usage: node hl-to-lean.mjs <candles.json> <out.csv>"); process.exit(2); }
  const candles = JSON.parse(readFileSync(inPath, "utf8"));
  const bytes = transcode(candles);
  writeFileSync(outPath, bytes);
  const κ = didHolo("sha256", sha256hex(bytes));
  console.log(`transcoded ${candles.length} Hyperliquid candles → ${outPath}`);
  console.log(`  ${bytes.length} bytes · LEAN data κ ${κ}`);
}
