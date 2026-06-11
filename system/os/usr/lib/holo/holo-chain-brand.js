// holo-chain-brand.js — per-chain branding + concise metadata + official links.
//
// So Holo Scan "feels native to each chain": a logo, a brand accent colour, a one-line
// description, and links to each chain's official resources + socials. Logos come from
// the open DeFiLlama icon CDN (content type only, no key); everything else is curated
// factual metadata. Keyed by the same chain id as CHAINS in holo-blockscout.js.

const ICON = (slug) => `https://icons.llamao.fi/icons/chains/rsz_${slug}.jpg`;

export const BRAND = {
  1:        { logo: ICON("ethereum"),    color: "#627eea", desc: "The original smart-contract blockchain and largest decentralized settlement layer.", web: "https://ethereum.org", docs: "https://ethereum.org/developers", x: "ethereum", github: "ethereum", explorer: "https://etherscan.io" },
  10:       { logo: ICON("optimism"),    color: "#ff0420", desc: "An OP-Stack Ethereum L2; the home of the Optimism Superchain.", web: "https://www.optimism.io", docs: "https://docs.optimism.io", x: "optimism", discord: "optimism", github: "ethereum-optimism", explorer: "https://optimistic.etherscan.io" },
  30:       { logo: ICON("rootstock"),   color: "#ff9100", desc: "A Bitcoin-secured (merge-mined) EVM sidechain bringing smart contracts to Bitcoin.", web: "https://rootstock.io", docs: "https://dev.rootstock.io", x: "rootstock_io", github: "rsksmart", explorer: "https://explorer.rootstock.io" },
  42:       { logo: ICON("lukso"),       color: "#fe005b", desc: "An EVM L1 for digital identity (Universal Profiles) and creative economies.", web: "https://lukso.network", docs: "https://docs.lukso.tech", x: "lukso_io", discord: "lukso", github: "lukso-network", explorer: "https://explorer.lukso.network" },
  56:       { logo: ICON("binance"),     color: "#f0b90b", desc: "A high-throughput EVM L1 in the BNB Chain ecosystem.", web: "https://www.bnbchain.org", docs: "https://docs.bnbchain.org", x: "BNBCHAIN", discord: "bnbchain", github: "bnb-chain", explorer: "https://bscscan.com" },
  100:      { logo: ICON("xdai"),        color: "#3e6957", desc: "A community-run EVM L1 secured by GNO, with stablecoin (xDAI) gas.", web: "https://www.gnosis.io", docs: "https://docs.gnosischain.com", x: "gnosischain", discord: "gnosis", github: "gnosischain", explorer: "https://gnosisscan.io" },
  130:      { logo: ICON("unichain"),    color: "#ff007a", desc: "An OP-Stack L2 by Uniswap Labs, built for DeFi and cross-chain liquidity.", web: "https://www.unichain.org", docs: "https://docs.unichain.org", x: "unichain", github: "Uniswap", explorer: "https://uniscan.xyz" },
  137:      { logo: ICON("polygon"),     color: "#8247e5", desc: "A leading EVM scaling ecosystem (PoS) for low-cost Ethereum transactions.", web: "https://polygon.technology", docs: "https://docs.polygon.technology", x: "0xPolygon", discord: "0xpolygondevs", github: "0xPolygon", explorer: "https://polygonscan.com" },
  250:      { logo: ICON("fantom"),      color: "#1969ff", desc: "A high-performance EVM L1 (evolving into Sonic).", web: "https://fantom.foundation", docs: "https://docs.fantom.foundation", x: "FantomFDN", discord: "fantom", github: "Fantom-foundation", explorer: "https://ftmscan.com" },
  324:      { logo: ICON("zksync-era"),  color: "#8c8dfc", desc: "A ZK-rollup EVM L2 using zero-knowledge proofs for scalable, low-cost Ethereum.", web: "https://zksync.io", docs: "https://docs.zksync.io", x: "zksync", discord: "zksync", github: "matter-labs", explorer: "https://era.zksync.network" },
  480:      { logo: ICON("world-chain"), color: "#3c3c3c", desc: "An OP-Stack L2 by World (Worldcoin) for proof-of-personhood apps.", web: "https://world.org", docs: "https://docs.world.org", x: "worldcoin", discord: "worldcoin", github: "worldcoin", explorer: "https://worldscan.org" },
  5000:     { logo: ICON("mantle"),      color: "#65b3ae", desc: "An EVM L2 with a modular architecture and dedicated data-availability layer.", web: "https://www.mantle.xyz", docs: "https://docs.mantle.xyz", x: "0xMantle", discord: "0xMantle", github: "mantlenetworkio", explorer: "https://mantlescan.xyz" },
  8453:     { logo: ICON("base"),        color: "#0052ff", desc: "An OP-Stack Ethereum L2 incubated by Coinbase; a hub for onchain apps.", web: "https://www.base.org", docs: "https://docs.base.org", x: "base", discord: "buildonbase", github: "base-org", explorer: "https://basescan.org" },
  34443:    { logo: ICON("mode"),        color: "#dffe00", desc: "An OP-Stack L2 focused on DeFi, with sequencer-fee sharing.", web: "https://www.mode.network", docs: "https://docs.mode.network", x: "modenetwork", discord: "modenetworkofficial", github: "mode-network", explorer: "https://explorer.mode.network" },
  42161:    { logo: ICON("arbitrum"),    color: "#28a0f0", desc: "The leading optimistic-rollup EVM L2 (Arbitrum One) scaling Ethereum.", web: "https://arbitrum.io", docs: "https://docs.arbitrum.io", x: "arbitrum", discord: "arbitrum", github: "OffchainLabs", explorer: "https://arbiscan.io" },
  42220:    { logo: ICON("celo"),        color: "#fcff52", desc: "A mobile-first EVM L2 for accessible, real-world finance.", web: "https://celo.org", docs: "https://docs.celo.org", x: "Celo", discord: "celo", github: "celo-org", explorer: "https://celoscan.io" },
  42793:    { logo: ICON("etherlink"),   color: "#2c7df7", desc: "An EVM L2 powered by Tezos Smart Rollups.", web: "https://www.etherlink.com", docs: "https://docs.etherlink.com", x: "etherlink", discord: "etherlink", github: "etherlink", explorer: "https://explorer.etherlink.com" },
  57073:    { logo: ICON("ink"),         color: "#7132f5", desc: "An OP-Stack L2 by Kraken, built for DeFi.", web: "https://inkonchain.com", docs: "https://docs.inkonchain.com", x: "inkonchain", discord: "inkonchain", github: "inkonchain", explorer: "https://explorer.inkonchain.com" },
  59144:    { logo: ICON("linea"),       color: "#61dfff", desc: "A zkEVM rollup L2 by Consensys.", web: "https://linea.build", docs: "https://docs.linea.build", x: "LineaBuild", discord: "linea", github: "Consensys", explorer: "https://lineascan.build" },
  80094:    { logo: ICON("berachain"),   color: "#f0a44a", desc: "An EVM-identical L1 with Proof-of-Liquidity consensus.", web: "https://www.berachain.com", docs: "https://docs.berachain.com", x: "berachain", discord: "berachain", github: "berachain", explorer: "https://berascan.com" },
  81457:    { logo: ICON("blast"),       color: "#fcfc03", desc: "An OP-Stack L2 with native yield for ETH and stablecoins.", web: "https://blast.io", docs: "https://docs.blast.io", x: "Blast_L2", discord: "blastdevelopers", github: "blast-io", explorer: "https://blastscan.io" },
  534352:   { logo: ICON("scroll"),      color: "#f4720b", desc: "A bytecode-compatible zkEVM rollup scaling Ethereum.", web: "https://scroll.io", docs: "https://docs.scroll.io", x: "Scroll_ZKP", discord: "scroll", github: "scroll-tech", explorer: "https://scrollscan.com" },
  999:      { logo: ICON("hyperliquid"), color: "#50d2c1", desc: "HyperEVM — the EVM chain of Hyperliquid, interoperable with HyperCore.", web: "https://hyperliquid.xyz", docs: "https://hyperliquid.gitbook.io", x: "HyperliquidX", discord: "hyperliquid", github: "hyperliquid-dex", explorer: "https://hyperevmscan.io" },
  11155111: { logo: ICON("ethereum"),    color: "#9a9a9a", desc: "Ethereum's primary proof-of-stake testnet (Sepolia).", web: "https://ethereum.org", docs: "https://ethereum.org/developers", x: "ethereum", github: "ethereum", explorer: "https://sepolia.etherscan.io" },
  43114:    { logo: ICON("avalanche"),   color: "#e84142", desc: "A high-speed EVM L1 (C-Chain) with subnets and sub-second finality.", web: "https://www.avax.network", docs: "https://docs.avax.network", x: "avax", discord: "avalancheavax", github: "ava-labs", explorer: "https://snowtrace.io" },
  101:      { logo: ICON("solana"),      color: "#14f195", desc: "A high-performance non-EVM L1 with parallel execution; thousands of TPS.", web: "https://solana.com", docs: "https://docs.solana.com", x: "solana", discord: "solana", github: "solana-labs", explorer: "https://explorer.solana.com" },
  1000000:  { logo: ICON("hyperliquid"), color: "#50d2c1", desc: "HyperCore — Hyperliquid's perps L1, a fully on-chain order-book exchange.", web: "https://hyperliquid.xyz", docs: "https://hyperliquid.gitbook.io", x: "HyperliquidX", discord: "hyperliquid", github: "hyperliquid-dex", explorer: "https://app.hyperliquid.xyz" },
};

export const brandOf = (id) => BRAND[id] || { color: "#627eea", logo: null, desc: "", web: null };

// relative luminance → choose readable ink (dark/light text) on a brand-coloured surface
export function inkOn(hex) {
  const h = hex.replace("#", ""); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; return L > 0.6 ? "#0a0d12" : "#ffffff";
}
// links + socials for a chain, as an array of {label, href, icon}
export function chainLinks(id) {
  const b = BRAND[id]; if (!b) return [];
  const out = [];
  if (b.web) out.push({ label: "Website", href: b.web, icon: "🌐" });
  if (b.docs) out.push({ label: "Docs", href: b.docs, icon: "📄" });
  if (b.explorer) out.push({ label: "Official explorer", href: b.explorer, icon: "🔎" });
  if (b.x) out.push({ label: "X", href: "https://x.com/" + b.x, icon: "𝕏" });
  if (b.discord) out.push({ label: "Discord", href: "https://discord.gg/" + b.discord, icon: "💬" });
  if (b.github) out.push({ label: "GitHub", href: "https://github.com/" + b.github, icon: "⌨" });
  return out;
}
