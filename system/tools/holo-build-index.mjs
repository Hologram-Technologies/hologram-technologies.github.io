// holo-build-index.mjs — build the PRE-BUILT κ-index asset the live OS ships. Crawls a curated seed set
// over the linked-data adapter (live Wikidata + Wikipedia), builds the retrieval corpus, and seals it into
// one self-verifying IPFS object → writes it as a CAR file under the frame assets. The OS then fetches this
// CAR, re-derives it (Law L5), and queries it network-free as a discovery source (holo-index.indexAdapter).
//
// Run: node holo-build-index.mjs   (needs network at build time). The committed CAR is fixed + self-
// verifying thereafter; rebuilding from live sources may yield a different CID as the world's content drifts.
import { createDiscovery, linkedDataAdapter } from "../os/sbin/holo-discover.mjs";
import { crawl, buildIndex, toIndexCar } from "../os/sbin/holo-index.mjs";
import { signPointer } from "../os/sbin/holo-index-pointer.mjs";
import { toHex } from "../os/usr/lib/holo/holo-ipfs.js";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const ASSET_DIR = join(here, "..", "os", "usr", "share", "frame");

// a curated seed set spanning several domains, so the index answers beyond one topic. Each seed → one
// sealed, content-addressed source object. Breadth comes from more seeds (one canonical entity each);
// this is still a HAND-SEEDED frontier, not the whole object space — honest scale, not coverage.
const SEEDS = [
  // history
  "ancient Rome", "Roman Empire", "Roman Republic", "Julius Caesar", "Augustus", "Punic Wars",
  "Colosseum", "Roman Senate", "ancient Greece", "ancient Egypt", "Byzantine Empire", "Renaissance",
  "French Revolution", "World War II", "Industrial Revolution",
  // science
  "theory of relativity", "quantum mechanics", "evolution", "DNA", "photosynthesis",
  "gravity", "periodic table", "black hole", "plate tectonics", "climate change",
  // computing & tech
  "Internet", "World Wide Web", "cryptography", "machine learning", "IPFS",
  "blockchain", "Linux", "artificial intelligence",
  // people
  "Albert Einstein", "Isaac Newton", "Marie Curie", "Leonardo da Vinci", "William Shakespeare",
  // geography & nature
  "Amazon rainforest", "Mount Everest", "Pacific Ocean", "Nile",
];

// a polite fetch for a build-time crawl: a real User-Agent (Wikipedia's REST API expects one and throttles
// anonymous bursts) and a small inter-request gap so an 80+ request crawl is not rate-limited.
let _last = 0;
async function politeFetch(url, opts = {}) {
  const gap = 150 - (Date.now() - _last); if (gap > 0) await new Promise((r) => setTimeout(r, gap)); _last = Date.now();
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), "user-agent": "HoloIndexBot/1.0 (https://hologram.os; kappa-index builder)" } });
}

// the index-authority keypair (Ed25519). DEMO key — persisted next to the tool, NOT for production; in a
// real deploy the secret lives in a vault and only the pubkey is pinned in the app. Holds the rolling seq.
const KEY_PATH = join(here, ".holo-index-key.json");
async function loadOrCreateKey() {
  const s = globalThis.crypto.subtle;
  if (existsSync(KEY_PATH)) {
    const j = JSON.parse(readFileSync(KEY_PATH, "utf8"));
    const privateKey = await s.importKey("pkcs8", Buffer.from(j.pkcs8, "base64"), { name: "Ed25519" }, true, ["sign"]);
    return { privateKey, pub: j.pub, seq: j.seq || 0 };
  }
  const kp = await s.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pub = toHex(new Uint8Array(await s.exportKey("raw", kp.publicKey)));
  const pkcs8 = Buffer.from(new Uint8Array(await s.exportKey("pkcs8", kp.privateKey))).toString("base64");
  writeFileSync(KEY_PATH, JSON.stringify({ pkcs8, pub, seq: 0 }, null, 2));
  return { privateKey: kp.privateKey, pub, seq: 0 };
}

async function main() {
  const discovery = createDiscovery({ adapters: [linkedDataAdapter()], fetchImpl: politeFetch });   // live, throttled
  console.log(`crawling ${SEEDS.length} seeds (live Wikidata + Wikipedia)…`);
  const docs = await crawl(SEEDS, { discovery });
  console.log(`  sealed ${docs.length} source objects`);
  if (!docs.length) { console.error("no docs crawled — is the network reachable?"); process.exit(1); }
  const idx = await buildIndex(docs, { embedder: null });                   // BM25 index (no model needed at build)
  const car = toIndexCar(idx.indexCid, idx.blocks);
  writeFileSync(join(ASSET_DIR, "holo-index.car"), car);
  // builtAt lives in the SIDECAR, never in the sealed manifest — the index object stays content-deterministic
  // (same docs → same CID), and the build event's timestamp is surfaced as honest staleness metadata.
  const sidecar = {
    "@type": "holo:SemanticIndex", indexCid: idx.indexCid, did: idx.did, stateKappa: idx.stateKappa,
    builtAt: new Date().toISOString(), car: "holo-index.car", carBytes: car.length, count: idx.docs.size,
    docs: [...idx.docs.values()].map((d) => ({ cid: d.cid, title: d.title, meta: d.meta })),
  };
  writeFileSync(join(ASSET_DIR, "holo-index.json"), JSON.stringify(sidecar, null, 2));

  // sign + emit the mutable pointer (T2): a new seq each build → the latest index is the authority's
  // highest-seq signed record; clients pin `pub` and refuse a lower seq. 30-day validity.
  const key = await loadOrCreateKey();
  const seq = key.seq + 1;
  const ptr = await signPointer({ name: "holo:index", target: idx.indexCid, seq, validMs: 30 * 24 * 3600 * 1000, privateKey: key.privateKey, pub: key.pub });
  writeFileSync(join(ASSET_DIR, "holo-index.ptr.json"), JSON.stringify(ptr, null, 2));
  writeFileSync(KEY_PATH, JSON.stringify({ pkcs8: JSON.parse(readFileSync(KEY_PATH, "utf8")).pkcs8, pub: key.pub, seq }, null, 2));

  console.log(`\nindex ${idx.indexCid}`);
  console.log(`  ${idx.docs.size} docs · CAR ${car.length} B → ${join(ASSET_DIR, "holo-index.car")}`);
  console.log(`  titles: ${[...idx.docs.values()].map((d) => d.title).join(", ")}`);
  console.log(`\npointer seq ${seq} → ${idx.indexCid.slice(0, 18)}…  (valid 30d)`);
  console.log(`  PIN THIS PUBKEY in the loaders (PINNED_INDEX_PUB): ${key.pub}`);
}
main().catch((e) => { console.error("build failed:", e); process.exit(1); });
