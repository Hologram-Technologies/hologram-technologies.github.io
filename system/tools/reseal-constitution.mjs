#!/usr/bin/env node
// reseal-constitution.mjs — rebrand the Constitution's normative-source node to Hologram OS native
// (no Hologram OS / Hologram Technologies / Hologram Technologies) and RE-DERIVE its content addresses with the
// engine's own primitives so it stays internally self-verifying (Law L5). The 8 principle κ are
// UNTOUCHED (none names the external source) → verifyConstitution still seals; only the source node's
// κ and the root κ change. Self-checks that its re-derivation matches the original seal before
// mutating. Prints OLD→NEW root for the pointer updates.
//
//   node tools/reseal-constitution.mjs

import { address, jcs, sriOf, mbSha256 } from "../os/usr/lib/holo/holo-object.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const P = join(here, "../os/etc/constitution/constitution.uor.json");
const c = JSON.parse(readFileSync(P, "utf8"));
const g = c["@graph"];
const OLD_ROOT = c.root;
const sealedBytes = (node) => Buffer.from(jcs(node), "utf8");          // the bytes a link's digest commits to

const src = g.find((n) => /Normative source/i.test(n["dcterms:title"] || ""));
const root = g[0];
const OLD_SRC_ID = src.id;
const edge = root.links.find((l) => l.id === OLD_SRC_ID);

// self-check: our re-derivation must reproduce the EXISTING seal exactly, else abort (don't corrupt it).
if (sriOf(sealedBytes(src)) !== edge.digestSRI) { console.error("ABORT: re-derivation does not match the existing link digest — method mismatch"); process.exit(1); }
if ((await address((({ id, ...r }) => r)(root))) !== OLD_ROOT) { console.error("ABORT: root re-derivation mismatch"); process.exit(1); }

// rebrand → Hologram-native, self-authored; drop the external byte-pinned source document.
src["dcterms:title"] = "Normative source — the Hologram OS constitutional principles (self-authored)";
src["dcterms:creator"] = "Hologram Technologies";
delete src.links;

// re-derive the source node's address, re-link node[0]'s edge to it, re-derive the root.
const newSrcId = await address((({ id, ...r }) => r)(src));
src.id = newSrcId;
edge.id = newSrcId;
edge.digestSRI = sriOf(sealedBytes(src));
edge.digestMultibase = mbSha256(sealedBytes(src));
const NEW_ROOT = await address((({ id, ...r }) => r)(root));
root.id = NEW_ROOT;
c.root = NEW_ROOT;

writeFileSync(P, JSON.stringify(c, null, 2) + "\n");
console.log("✓ re-sealed — source node is Hologram-native; root re-derived (8 principle κ unchanged)");
console.log("OLD_ROOT=" + OLD_ROOT);
console.log("NEW_ROOT=" + NEW_ROOT);
console.log("OLD_SRC=" + OLD_SRC_ID);
console.log("NEW_SRC=" + newSrcId);
