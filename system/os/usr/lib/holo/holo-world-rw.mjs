// holo-world-rw.mjs — World read/WRITE. Makes every scene node a DURABLE, splittable /
// fusable κ-object, built ON the shell's existing HoloRepo (publishSource + the CvRDT
// scene) and the durable κ store (holo-store.js). It fills the two gaps the shell has
// today: published objects live only in an in-memory Map (lost on reload), and there is
// no way to break a component into a smaller atomic object or fuse one back.
//
//   persist(repo, store)      — every published object ALSO lands in the durable store.
//   splitNode(repo, desk, id) — lift a node's source into its own κ-object; the node now
//                               REFERENCES it (a smaller, reusable, shareable atomic object).
//   fuseNode(repo, desk, id, store) — resolve the ref and inline the source back in.
//
// Addressing stays the shell's current did:holo:sha256 (one scheme in the shell). The
// BLAKE3/SPINE-2 convergence (holo-realization) swaps publishSource + the kernel together,
// later — splitNode/fuseNode are unchanged by that swap. Dual-env (browser shell + Node
// witness): no DOM, no node-only APIs.

const hexOf = (kappa) => String(kappa).split(":").pop();
const te = new TextEncoder();
const td = new TextDecoder();

// Mirror published objects into the durable store. publishSource is sync and writes the
// exact canonical bytes into repo.objStore (κ-hex → JCS string); we re-publish those bytes
// to the store so the object survives a reload (fire-and-forget; store.put re-derives the
// SAME hex on the sha256 axis, so the key matches the object's did). Idempotent.
export function persist(repo, store) {
  if (repo.__holoPersisted) return repo;
  const orig = repo.publishSource.bind(repo);
  repo.publishSource = (args) => {
    const sealed = orig(args);
    const bytes = repo.objStore.get(hexOf(sealed.id));
    if (bytes != null) Promise.resolve(store.put(te.encode(bytes))).catch(() => {});
    return sealed;
  };
  repo.__holoPersisted = true;
  return repo;
}

// Break a component into a smaller atomic object: publish the node's source as its own κ
// (persisted), then point the node at it. Returns the new ref κ. Idempotent (already split
// → returns the existing ref).
export function splitNode(repo, desk, id, { kind = "block" } = {}) {
  const node = desk.doc().world.find((w) => w.id === id);
  if (!node) throw new Error("splitNode: no node " + id);
  if (node.contentRef) return node.contentRef;
  const obj = repo.publishSource({ name: node.name || "object", source: node.content || "", kind });
  desk.change((d) => { const n = d.world.find((w) => w.id === id); if (n) { n.contentRef = obj.id; n.split = true; } });
  return obj.id;
}

// Fuse the referenced source back into the node. Resolves from the in-memory objStore
// first, else the durable store (Law L5: the bytes re-derive to the ref's hex on read).
export async function fuseNode(repo, desk, id, store) {
  const node = desk.doc().world.find((w) => w.id === id);
  if (!node || !node.contentRef) throw new Error("fuseNode: node " + id + " is not split");
  const hex = hexOf(node.contentRef);
  let bytes = repo.objStore.get(hex);
  bytes = bytes != null ? te.encode(bytes) : (store ? await store.get("sha256:" + hex) : null);
  if (!bytes) throw new Error("fuseNode: source object not resolvable: " + node.contentRef);
  if (store && !(await store.verify("sha256:" + hex, bytes))) throw new Error("fuseNode: refused — source does not re-derive (tampered)");
  const obj = JSON.parse(td.decode(bytes));
  const source = obj["schema:text"] || "";
  desk.change((d) => { const n = d.world.find((w) => w.id === id); if (n) { n.content = source; delete n.contentRef; delete n.split; } });
  return source;
}
