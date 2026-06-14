// seal-jupiter.mjs — seal the Jupiter venue (Solana spot-swap aggregator) as a self-verifying UOR
// object (ADR-0025, Law L5), the Solana counterpart of seal-hyperliquid.mjs. Unlike Hyperliquid
// there is NO vendored SDK to pin — Jupiter is two REST endpoints (quote + swap), so only the venue
// descriptor exists: it pins the API hosts + the Jupiter v6 program id. A swapped host or a look-alike
// program changes the κ and is refused at load (anti-phishing is structural, not vigilance).
//
//   jupiter.uor.json (venue) — pins quote/swap hosts + the sealed Jupiter v6 program id. holo-jupiter's
//   verifyVenue re-derives this κ in the browser before the first swap; the built transaction is then
//   required to invoke exactly this program id (assertSwapTx), paid by the user's own key.

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { jcs, sha256hex, didHolo } from "../os/usr/lib/holo/holo-uor.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const seal = (body) => didHolo("sha256", sha256hex(jcs(body)));

// Pinned from developers.jup.ag + the Jupiter v6 program constant (already in holo-solana's PROGRAMS
// registry). RE-VERIFY hosts/program against the official docs before treating as production-canonical.
const venueBody = {
  name: "Jupiter",
  api: "https://lite-api.jup.ag",
  quote: "https://lite-api.jup.ag/swap/v1/quote",
  swap: "https://lite-api.jup.ag/swap/v1/swap",
  programV6: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  chain: "solana",
  caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};
const venueDescriptor = {
  head: seal(venueBody),
  "@context": { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", hojup: "https://hologram.os/ns/jupiter#" },
  "@type": ["prov:Entity", "hojup:Venue"],
  "schema:name": "Jupiter venue descriptor",
  "hojup:sealedBody": venueBody,
};

const VENUE_DIR = join(HERE, "..", "os", "etc", "holo-chains");
mkdirSync(VENUE_DIR, { recursive: true });
const VENUE_OUT = join(VENUE_DIR, "jupiter.uor.json");
writeFileSync(VENUE_OUT, JSON.stringify(venueDescriptor, null, 2) + "\n");

const okVenue = seal(venueBody) === venueDescriptor.head;
console.log("sealed venue →", VENUE_OUT);
console.log("  head κ     ", venueDescriptor.head, okVenue ? "✓" : "✗");
process.exit(okVenue ? 0 : 1);
