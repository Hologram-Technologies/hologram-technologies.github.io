// seal-hyperliquid.mjs — seal the two new objects of Holo Trade's write side (ADR-0070) as
// self-verifying UOR objects (ADR-0025, Law L5). Reuses the substrate's one canonical primitive
// (holo-uor.mjs, NIHITO). No signing/encoding code here — that all lives in the vendored SDK.
//
//   1. hyperliquid-sdk.uor.json — pins the bundled official SDK bytes (sha256). A tampered
//      bundle changes the hash → changes the head κ → is refused at load.
//   2. hyperliquid.uor.json (venue) — pins endpoints + HyperEVM chain ids + the Arbitrum
//      Bridge2 address. A swapped RPC/exchange/bridge changes the κ and is refused (anti-phishing
//      is structural, not vigilance).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { jcs, sha256hex, didHolo } from "../os/usr/lib/holo/holo-uor.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS = process.env.HOLO_APPS || "C:/Users/pavel/Desktop/Hologram Apps";
const BUNDLE = join(APPS, "apps", "trade", "_shared", "vendor", "hyperliquid-sdk.mjs");
const seal = (body) => didHolo("sha256", sha256hex(jcs(body)));

// ── 1. the vendored SDK ──────────────────────────────────────────────────────────────────────
if (!existsSync(BUNDLE)) { console.error("SDK bundle not found at " + BUNDLE); process.exit(1); }
const bundleSha = sha256hex(readFileSync(BUNDLE));
const sdkBody = {
  name: "@nktkas/hyperliquid", version: "0.32.2", license: "MIT",
  bundler: "esbuild --format=esm --platform=browser --minify", signer: "viem privateKeyToAccount",
  bundleSha256: bundleSha,
  note: "The official Hyperliquid TypeScript SDK, bundled verbatim to one browser ESM. ALL msgpack + phantom-agent EIP-712 signing is the SDK's, never hand-rolled (the docs' own rule).",
};
const sdkDescriptor = {
  head: seal(sdkBody),
  "@context": { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", hostrade: "https://hologram.os/ns/trade#" },
  "@type": ["prov:Entity", "hostrade:SDK", "schema:SoftwareSourceCode"],
  "schema:name": "Hyperliquid SDK (vendored)", "schema:codeRepository": "https://github.com/nktkas/hyperliquid",
  "schema:license": "https://opensource.org/licenses/MIT",
  "hostrade:sealedBody": sdkBody,
};
const SDK_OUT = join(APPS, "apps", "trade", "_shared", "vendor", "hyperliquid-sdk.uor.json");
writeFileSync(SDK_OUT, JSON.stringify(sdkDescriptor, null, 2) + "\n");

// ── 2. the venue (endpoints + chains + bridge) ────────────────────────────────────────────────
// Pinned from the official Hyperliquid docs + SDK constants. The Arbitrum Bridge2 address MUST be
// re-verified by a human against the official mainnet-details page before any production deposit.
const venueBody = {
  name: "Hyperliquid",
  info: "https://api.hyperliquid.xyz/info", exchange: "https://api.hyperliquid.xyz/exchange",
  ws: "wss://api.hyperliquid.xyz/ws",
  testnet: { info: "https://api.hyperliquid-testnet.xyz/info", exchange: "https://api.hyperliquid-testnet.xyz/exchange", ws: "wss://api.hyperliquid-testnet.xyz/ws" },
  hyperEVM: { caip2: "eip155:999", chainId: 999, rpc: "https://rpc.hyperliquid.xyz/evm", nativeCurrency: "HYPE" },
  hyperEVMTestnet: { caip2: "eip155:998", chainId: 998, rpc: "https://rpc.hyperliquid-testnet.xyz/evm" },
  arbitrumBridge2: { chain: "eip155:42161", address: "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7", token: "USDC", note: "RE-VERIFY against official docs before production deposit." },
  signatureChainId: "0x66eee", phantomAgentChainId: 1337,
};
const venueDescriptor = {
  head: seal(venueBody),
  "@context": { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#", hostrade: "https://hologram.os/ns/trade#" },
  "@type": ["prov:Entity", "hostrade:Venue"],
  "schema:name": "Hyperliquid venue descriptor",
  "hostrade:sealedBody": venueBody,
};
const VENUE_DIR = join(HERE, "..", "os", "etc", "holo-chains");
mkdirSync(VENUE_DIR, { recursive: true });
const VENUE_OUT = join(VENUE_DIR, "hyperliquid.uor.json");
writeFileSync(VENUE_OUT, JSON.stringify(venueDescriptor, null, 2) + "\n");

// ── re-derive both (Law L5) ───────────────────────────────────────────────────────────────────
const okSdk = seal(sdkBody) === sdkDescriptor.head;
const okVenue = seal(venueBody) === venueDescriptor.head;
console.log("sealed SDK   →", SDK_OUT);
console.log("  head κ     ", sdkDescriptor.head, okSdk ? "✓" : "✗");
console.log("  bundleSha  ", bundleSha);
console.log("sealed venue →", VENUE_OUT);
console.log("  head κ     ", venueDescriptor.head, okVenue ? "✓" : "✗");
process.exit(okSdk && okVenue ? 0 : 1);
