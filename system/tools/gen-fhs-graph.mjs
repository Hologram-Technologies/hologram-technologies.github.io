#!/usr/bin/env node
// gen-fhs-graph.mjs — generate the Hologram OS filesystem as a content-addressed GRAPH.
//
// Each Linux FHS directory becomes a UOR object (a self-verifying linked-data node) minted
// through the engine envelope (holo-object.mjs): identity = did:holo:sha256(content) (Law L1),
// children linked by schema:hasPart into a Merkle-DAG (Law L5), app/file membership carried as
// dcat:dataset references. The Linux path rides along as a hosfs:fhs LABEL — a projection, never
// the identity. Writes one index.jsonld per directory + a manifest. Pure Node.
//
//   node tools/gen-fhs-graph.mjs

import { makeObject, linkTo } from "../os/usr/lib/holo/holo-object.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));     // .../Hologram OS2/tools
const OS2 = join(here, "../os");                          // .../Hologram OS2/os  (the / root)

const FS_CTX = [{ dcat: "http://www.w3.org/ns/dcat#", hosfs: "https://hologram.os/ns/fs#" }];
const DIR_TYPE = ["hosfs:Directory", "dcat:Catalog", "prov:Collection"];

// an app/file membership reference (a dcat:dataset entry) — a resolvable did:holo, not bytes here.
const ref = (hex, name, id, fhs, type = ["schema:SoftwareApplication", "schema:WebApplication"]) =>
  ({ "@id": `did:holo:sha256:${hex}`, "@type": type, "schema:name": name, "schema:identifier": id, "hosfs:fhs": fhs });

// ── the 9 core holospaces shipped under /usr/share/holospaces (real κ from os-root.jsonld) ──
const H = "/usr/share/holospaces";
const CORE = [
  ref("3e9eea487fd446767c9c3fc323581728d8a257dd71ca609d501b527344609c2c", "Holo World", "org.hologram.HoloWorld", `${H}/world`),
  ref("0953518061292e1961f1d1d187e6dcb179799535274c95ac7c61866b6a6f76a5", "Holo OS", "org.hologram.HoloOS", `${H}/os`),
  ref("5411cf8d9ad7ac2bb3593d1b74b06d5d94fd8769dc72f2810028e1ffd32faec5", "Holo Browser", "org.hologram.HoloBrowser", `${H}/browser`),
  ref("7e4f77c6cd7252055f307eca984357fb1fb9ef11c321a652585516840669d70f", "Holo Search", "org.hologram.HoloSearch", `${H}/search`),
  ref("5518c5f9c15ef2ae68b8827d54b85a932cb04c2ef0cbcf46a289813ca2b5a74a", "Holo Notepad", "org.hologram.HoloNotepad", `${H}/notepad`),
  ref("8bc211711ef0c0a96d881a604a495994e2259a2661b6b871c2b03f793b4c048f", "Holo Docs", "org.hologram.HoloDocs", `${H}/docs`),
  ref("a2b54fc09ef724cb06c5bc8562f257333de87ef17de84d3da90f4147551b833f", "Holo Workspace", "org.hologram.HoloWorkspace", `${H}/workspace`),
  ref("4df84b13e2dcefc69cce6ff33f626b394f2b9eef8bef457270abfe8063cb1205", "Holo Wallet", "org.hologram.HoloWallet", `${H}/wallet`),
  ref("3bcc1b669e7e0b086d21ce7684d561be2e9053cdf8fc7560dabb4786c57dbd8b", "Holo IPFS", "org.hologram.HoloIpfs", `${H}/ipfs`),
];

// ── optional holospaces installed BY κ under /opt (references only — not shipped) ──
const O = "/opt";
const OPT = [
  ref("a2460476662fff16a7c9cee05b120545e47ede01ef73c0f159c10c355432b2cd", "Holo BRC", "org.hologram.HoloBrc", `${O}/brc`),
  ref("1c03eb820ca8e2cc1cd1515e6f88afc25ba298c274ae46f6a988edcc565f40ff", "Holo BTC", "org.hologram.HoloBtc", `${O}/btc`),
  ref("1587a5bb218c2a7e8c8f6ad1222508d1360b71da25b5653bbbc2c1e3558d5606", "Holo Capture", "org.hologram.HoloCapture", `${O}/capture`),
  ref("efc6e3a8f992e81534628902c29a9f8fd8f50f1b4c3655f6836a6efbcbc8a9c0", "Holo Cloud", "org.hologram.HoloCloud", `${O}/cloud`),
  ref("c3cdb2908ba03fc6df337934365ee23d1c6457fcd5d71fbd77b3ece4ce7a1c6f", "Holo EVM", "org.hologram.HoloEVM", `${O}/evm`),
  ref("137007e581fe97e5f74c54884fb11a239ca28d7420a9bb64e25bbeb66495fce5", "Holo Etherscan", "org.hologram.HoloEtherscan", `${O}/etherscan`),
  ref("abf78931ca04a5a00eff1961287a5f35186e7071ebc3817f948172db696f87dc", "Holo Git", "org.hologram.HoloGit", `${O}/git`),
  ref("b43aa2c9c0ba0b35b0201da7afbc1a51a9839b2f583b3d9417b06c9741ec0d53", "Holo Music", "org.hologram.HoloMusic", `${O}/music`),
  ref("4f17cac17cb50322a96ec428fcfdddae09dc8cde0f4f6a6d784d1fcaffba96df", "Holo Player", "org.hologram.HoloPlayer", `${O}/player`),
  ref("c59f58167d1aace0237b9d71d919d127838908879df1d16b5732920485a7279e", "Holo Privacy", "org.hologram.HoloPrivacy", `${O}/privacy`),
  ref("5ef837959e8366dd351ab45e23398fd69bd8ada7270d4639fac0cc7fe8dfdb5d", "Holo Stream", "org.hologram.HoloStream", `${O}/stream`),
  ref("651d2e10a5c6b8e18025081e341f3e44249113b0b64f897f3084acefa789618c", "Holo Terms", "org.hologram.HoloTerms", `${O}/terms`),
  ref("09b8f9023a8be3115a3bd6fe3b6973ce1144b1f1024c3b8a8ea10ba4958c19cf", "Holo Video", "org.hologram.HoloVideo", `${O}/video`),
  ref("012533c9f246ef522a5c104e5d88206345cf6b7cbbb9b577e1e5ff93eda93ad0", "Holo Amp", "org.hologram.HoloAmp", `${O}/amp`),
  ref("e8e6717757c65f23993a6fac4a12fb23a9792bbbdf9ae2edc61c31c669d5118a", "Hologram Meet", "org.hologram.HologramMeet", `${O}/meet`),
  ref("e37e0157561c8a77dc5f3f7f5591ceac126f9144212169b657ebdfbca3d74b2a", "Plasma Desktop", "org.kde.PlasmaDesktop", `${O}/plasma`),
  ref("bdde3b1b466acb14e4033c79e8c70c5fa8c62e9f8bc5938f92b4816046c4a2d1", "QEMU", "org.qemu.QEMU", `${O}/qemu`),
];

// ── /boot κ-pins: the Linux VM image, referenced (resolved at boot), not shipped (os-artifacts.sha256) ──
const BOOT_PINS = [
  ref("a7bb1f02a5ac96371ecb402645d25e1cc7cda18c5280f0828f0e31c4fb16162e", "Linux kernel (κ-pin)", "os-kernel.gz", "/boot/kernel.uor.json", ["schema:SoftwareApplication"]),
  ref("352acc3ce0e18a8eecba8cebabbfac8f5d264e89513a883c1566d91d15491462", "Root filesystem (κ-pin)", "os-rootfs.tar.gz", "/boot/rootfs.uor.json", ["schema:MediaObject"]),
];

// ── the tree (Linux function → Hologram realization, stated in fhsRole) ──
const TREE = {
  fhs: "/", name: "Hologram OS", kind: "content",
  role: "the OS root — one did:holo, one self-verifying Merkle-DAG; boots from a single κ (ADR-026)",
  extraType: ["schema:SoftwareApplication"], extraProps: { "schema:applicationCategory": "OperatingSystem" },
  children: [
    { fhs: "/.well-known", name: ".well-known", kind: "content", role: "RFC 8615 — the interop & agent doors (agents.json · mcp.json · did.json)" },
    { fhs: "/boot", name: "boot", kind: "content", role: "boot loader + kernel → boot-from-κ: the κ-route service worker + the Linux VM image as pins", datasets: BOOT_PINS },
    { fhs: "/bin", name: "bin", kind: "content", role: "essential user commands → core command κ-objects every holospace can invoke" },
    { fhs: "/sbin", name: "sbin", kind: "content", role: "essential system binaries → the resolution spine (resolver · sources · peers)" },
    { fhs: "/lib", name: "lib", kind: "content", role: "libraries for /bin and /sbin → the boot-critical runtime (κ-route SW, launch)" },
    { fhs: "/etc", name: "etc", kind: "content", role: "host configuration, no secrets (ADR-017) → manifests · capability policy · the Constitution",
      datasets: [ref("3ff288d0c06a0fd22da898301cb6c8c11fc62e3b2b7ab58a53c7cb0cb385f00c", "Hologram OS Constitution", "org.hologram.HoloConstitution", "/etc/constitution/constitution.uor.json", ["schema:Legislation", "schema:CreativeWork"])] },
    { fhs: "/home", name: "home", kind: "state", role: "user home directories → per-user OPFS namespace, default-deny holospace sandbox",
      children: [{ fhs: "/home/user", name: "user", kind: "state", role: "the user's writable space — OPFS-backed, content sealed on write" }] },
    { fhs: "/usr", name: "usr", kind: "content", role: "shareable, READ-ONLY data ≡ the content-addressed (κ) hierarchy — identical on any peer",
      children: [
        { fhs: "/usr/bin", name: "bin", kind: "content", role: "non-essential user commands → app launchers · hologram-mcp" },
        { fhs: "/usr/lib", name: "lib", kind: "content", role: "/usr libraries",
          children: [{ fhs: "/usr/lib/holo", name: "holo", kind: "content", role: "the _shared OS runtime kit (ui-kernel · theme · object · icons)" }] },
        { fhs: "/usr/share", name: "share", kind: "content", role: "architecture-independent data → the apps + assets as κ-containers",
          children: [
            { fhs: "/usr/share/frame", name: "frame", kind: "content", role: "the desktop template — world · holospace · home · find" },
            { fhs: "/usr/share/holospaces", name: "holospaces", kind: "content", role: "the core holospaces — each a self-contained, portable κ-container", datasets: CORE },
            { fhs: "/usr/share/icons", name: "icons", kind: "content", role: "content-addressed icon sets" },
            { fhs: "/usr/share/ns", name: "ns", kind: "content", role: "the minted OWL ontologies (hosfs: · hosc:) — dereferenceable vocabularies" },
            { fhs: "/usr/share/shapes", name: "shapes", kind: "content", role: "the W3C SHACL shapes the witnesses validate against" },
          ] },
      ] },
    { fhs: "/opt", name: "opt", kind: "pin", role: "add-on application packages → optional holospaces, installed BY κ on demand (not shipped)", datasets: OPT },
    { fhs: "/srv", name: "srv", kind: "state", role: "data served by this system → the holospaces this node serves to peers (IPFS/mesh)" },
    { fhs: "/var", name: "var", kind: "state", role: "variable data → mutable substrate state",
      children: [
        { fhs: "/var/cache", name: "cache", kind: "ephemeral", role: "the κ-cache (Cache API, read-through, re-derived)" },
        { fhs: "/var/lib", name: "lib", kind: "state", role: "persistent holospace state" },
        { fhs: "/var/log", name: "log", kind: "state", role: "run / witness / telemetry logs" },
      ] },
    { fhs: "/root", name: "root", kind: "state", role: "superuser home → the operator (Platform Manager) space" },
    { fhs: "/mnt", name: "mnt", kind: "mount", role: "temporary mount point → attach a peer κ-store or a guest rootfs at runtime" },
    { fhs: "/media", name: "media", kind: "mount", role: "removable media → peer / IPFS volumes mounted live" },
    { fhs: "/run", name: "run", kind: "ephemeral", role: "run-time state since boot (tmpfs) → live sessions · sockets · the mesh" },
    { fhs: "/tmp", name: "tmp", kind: "ephemeral", role: "temporary files (tmpfs) — cleared on boot" },
    { fhs: "/dev", name: "dev", kind: "virtual", role: "device nodes — synthesized by the VM (virtio: blk→κ-disk · net→relay · 9p→workspace)" },
    { fhs: "/proc", name: "proc", kind: "virtual", role: "process/kernel info — the live holospace process model" },
    { fhs: "/sys", name: "sys", kind: "virtual", role: "hardware/resource tree — the CapabilitySet budgets (resource management)" },
  ],
};

// ── build bottom-up: seal children first, link them, seal the parent (Merkle-DAG), write to disk ──
const store = new Map();
const written = [];

function build(spec) {
  const childObjs = (spec.children || []).map(build);
  const links = childObjs.map((c) => linkTo(store, "schema:hasPart", c));
  const node = makeObject(store, {
    type: [...DIR_TYPE, ...(spec.extraType || [])],
    context: FS_CTX,
    "schema:name": spec.name,
    "hosfs:fhs": spec.fhs,
    "hosfs:fhsRole": spec.role,
    "hosfs:kind": spec.kind,
    ...(spec.datasets && spec.datasets.length ? { "dcat:dataset": spec.datasets } : {}),
    ...(spec.extraProps || {}),
    links,
  });
  const rel = spec.fhs === "/" ? "" : spec.fhs.slice(1);
  const outDir = join(OS2, rel);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "index.jsonld"), JSON.stringify(node, null, 2) + "\n");
  written.push({ fhs: spec.fhs, did: node.id, kind: spec.kind, parts: links.length, datasets: (spec.datasets || []).length, path: join(rel, "index.jsonld").replace(/\\/g, "/") });
  return node;
}

const root = build(TREE);

writeFileSync(join(here, "fhs-graph.manifest.json"),
  JSON.stringify({ "@type": "prov:Collection", root: root.id, nodes: written.length, generatedBy: "tools/gen-fhs-graph.mjs", nodesList: written }, null, 2) + "\n");

console.log(`✓ minted ${written.length} directory nodes into one Merkle-DAG`);
console.log(`  root  ${root.id}`);
console.log(`  apps  ${CORE.length} core (/usr/share/holospaces) · ${OPT.length} optional (/opt) · ${BOOT_PINS.length} boot pins`);
for (const w of written) console.log(`  ${w.kind.padEnd(9)} ${w.fhs.padEnd(22)} ${w.did.slice(0, 26)}…  (${w.parts} parts${w.datasets ? `, ${w.datasets} refs` : ""})`);
