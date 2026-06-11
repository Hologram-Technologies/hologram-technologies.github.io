// holo-dweb.js — Holo Home: the front page of the dweb. The thesis is that IPFS, ENS,
// DNSLink, the web2 web, web3 dapps, and Hologram-native apps are not separate worlds —
// they are one content-addressed object graph behind one address bar. This module is the
// substrate of that front page: a FEDERATED, VERIFIABLE directory whose every entry is a
// UOR object (a JSON-LD descriptor with a content-derived id and typed links, ADR-025), a
// classifier that maps any omnibox input to a destination across all those webs, and a
// search over the directory. It crawls nothing and trusts no ranking — it federates the
// dweb's existing naming layers (ENS, DNSLink, IPNI) and what people choose to publish.
//
// Pure ES module (browser + Node witness). Identity/verification reuse holo-ipfs.js.

import { cidToDid, holoUri, parseCID } from "./holo-ipfs.js";

// ── the unified directory: real destinations spanning every web, one shape ──────────
// kind ∈ ipfs | ipns | dnslink | ens | web | app. `target` is what the omnibox resolves.
export const SECTIONS = [
  {
    title: "Start here", note: "works offline — served + verified locally",
    entries: [
      { name: "Holo demo site", desc: "a real IPFS site, rendered + verified by the service worker", kind: "demo", target: "@demo", tags: ["demo", "offline", "site"] },
      { name: "Empty UnixFS directory", desc: "the canonical CID — a clean first verify", kind: "ipfs", target: "bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354", tags: ["ipfs", "unixfs"] },
    ],
  },
  {
    title: "Knowledge", note: "the open web, mirrored on IPFS (DNSLink)",
    entries: [
      { name: "Wikipedia (English)", desc: "the full encyclopedia on IPFS", kind: "dnslink", target: "en.wikipedia-on-ipfs.org", tags: ["wiki", "reference"] },
      { name: "Wikipedia (Türkçe)", desc: "a smaller mirror — quick to load", kind: "dnslink", target: "tr.wikipedia-on-ipfs.org", tags: ["wiki"] },
      { name: "IPFS documentation", desc: "the project docs", kind: "dnslink", target: "docs.ipfs.tech", tags: ["docs", "ipfs"] },
    ],
  },
  {
    title: "Web3 · names & dapps", note: "ENS names resolve on-chain → IPFS contenthash",
    entries: [
      { name: "vitalik.eth", desc: "a personal site published via ENS + IPFS", kind: "ens", target: "vitalik.eth", tags: ["ens", "web3", "blog"] },
      { name: "app.uniswap.org", desc: "a real dapp frontend served from IPFS", kind: "dnslink", target: "app.uniswap.org", tags: ["defi", "dapp"] },
      { name: "ens.eth", desc: "the Ethereum Name Service, on the dweb", kind: "ens", target: "ens.eth", tags: ["ens", "names"] },
    ],
  },
];

// Hologram-native apps as first-class entries in the SAME substrate (loader opens at <base>).
export const APPS = [
  { id: "org.hologram.HoloIpfs", name: "Holo IPFS", loader: "ipfs.html", desc: "this gateway", accent: "#4dd0e1" },
  { id: "org.hologram.HoloEtherscan", name: "Holo Scan", loader: "etherscan.html", desc: "multi-chain explorer", accent: "#627eea" },
  { id: "org.hologram.HoloGit", name: "Holo Git", loader: "git.html", desc: "serverless git forge", accent: "#f05133" },
  { id: "org.hologram.HoloDocs", name: "Holo Docs", loader: "docs.html", desc: "real-time office suite", accent: "#2dd4bf" },
  { id: "org.hologram.HoloCloud", name: "Holo Cloud", loader: "cloud.html", desc: "content-addressed files", accent: "#5b9bd5" },
  { id: "org.hologram.HoloMusic", name: "Holo Music", loader: "music.html", desc: "the whole internet as a library", accent: "#ffb454" },
];

// ── classify any omnibox input → a destination across all the webs ──────────────────
const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,}|z[1-9A-HJ-NP-Za-km-z]{40,}|f[0-9a-f]{60,})$/;
export function classify(raw) {
  let s = String(raw || "").trim();
  if (!s) return { kind: "empty" };
  if (/^@demo$/i.test(s)) return { kind: "demo", target: "@demo" };
  if (/^did:/i.test(s)) return { kind: "did", target: s };
  if (/^ipfs:\/\//i.test(s) || /^\/ipfs\//i.test(s)) return { kind: "ipfs", target: s };
  if (/^ipns:\/\//i.test(s) || /^\/ipns\//i.test(s)) return { kind: "ipns", target: s };
  if (/^https?:\/\//i.test(s)) return { kind: "web", target: s };               // a web2 URL (gateway/DNSLink/save-to-dweb)
  const head = s.split("/")[0];
  if (CID_RE.test(head)) { try { parseCID(head); return { kind: "ipfs", target: s }; } catch {} }
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/i.test(head)) return { kind: "ens", target: s };
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(head)) return { kind: "dnslink", target: s };
  return { kind: "search", target: s };                                          // free text → search the directory
}

// ── every entry IS a UOR object (ADR-025): one self-verifying, interpretable envelope ─
// IPFS entries get a content-derived did:holo (verifiable); names get a holo:// alias.
export const UOR_CONTEXT = Object.freeze([
  "https://schema.org/",
  { holo: "https://hologram.os/ns#", rel: "schema:additionalType", via: "holo:via", address: "holo:address", links: { "@id": "schema:hasPart", "@container": "@set" } },
]);
const TYPE = { ipfs: "WebSite", ipns: "WebSite", dnslink: "WebSite", ens: "WebSite", web: "WebPage", app: "SoftwareApplication", demo: "WebSite" };
export function toUorObject(entry) {
  let id;
  try { if (entry.kind === "ipfs" && CID_RE.test(String(entry.target).split("/")[0])) id = cidToDid(String(entry.target).split("/")[0]) || holoUri(String(entry.target).split("/")[0]); } catch {}
  if (!id) id = entry.kind === "app" ? "holo://" + entry.id : "holo://" + (entry.target || entry.name).toLowerCase().replace(/[^a-z0-9.]+/g, "-");
  return {
    "@context": UOR_CONTEXT,
    "@type": TYPE[entry.kind] || "CreativeWork",
    id, name: entry.name, description: entry.desc || "",
    via: entry.kind, address: entry.target || (entry.loader ? entry.loader : null),
    keywords: entry.tags || [],
  };
}

// ── search the federated directory (name · description · tags · kind) ───────────────
export function allEntries() { const out = []; for (const s of SECTIONS) for (const e of s.entries) out.push({ ...e, section: s.title }); for (const a of APPS) out.push({ name: a.name, desc: a.desc, kind: "app", target: a.loader, id: a.id, accent: a.accent, section: "Apps", tags: ["app", "holospace"] }); return out; }
export function searchDirectory(q) {
  const t = String(q || "").trim().toLowerCase(); if (!t) return [];
  const terms = t.split(/\s+/);
  return allEntries().map((e) => {
    const hay = (e.name + " " + (e.desc || "") + " " + (e.tags || []).join(" ") + " " + e.kind).toLowerCase();
    const score = terms.reduce((a, term) => a + (hay.includes(term) ? 1 : 0), 0);
    return { e, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.e);
}

// the directory spans multiple webs by construction — the proof of "one substrate"
export const webs = () => [...new Set(allEntries().map((e) => e.kind))];
export const VERSION = "holo-dweb 1.0";
