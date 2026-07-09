// holo-watchlist.mjs — "My List" as an append-only, hash-linked κ-chain (the Holo-strand discipline).
//
// This replaces Jellyseerr/Overseerr's request DATABASE with something you own: each add is an entry whose
// id is the content hash of (item · addedAt · prev), so the head κ attests the WHOLE list — drop, reorder,
// or tamper with any entry and adoption fails closed. It is portable (export → a verifiable payload),
// shareable, and roamable (adopt verify-before-trust). Persistence is injected (localStorage in the browser,
// a Map in Node), so the chain logic is Node-witnessable.
//
// NOTE on signing: entries are hash-LINKED (tamper-evident) here, kept self-contained + app-local. Wiring
// the operator SIGNATURE + epoch seal is a one-line swap to the real holo-strand (session.activeCipher) when
// this graduates to usr/lib — the chain shape is already strand-compatible.

function jcs(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
}
async function sha256hex(s) {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(s).digest("hex");
}
// the canonical fields an entry commits to (its identity). poster/year are convenience, not identity.
const core = (e) => ({ item: { id: e.item.id, name: e.item.name, kind: e.item.kind }, addedAt: e.addedAt, prev: e.prev });
const linkId = async (e) => "sha256:" + (await sha256hex(jcs(core(e))));

// createWatchlist({ store }) — store: { load()->array|null (maybe async), save(array) }.
export function createWatchlist({ store } = {}) {
  if (!store || typeof store.load !== "function" || typeof store.save !== "function") throw new Error("holo-watchlist: store required");
  let chain = null;
  async function _load() { if (chain) return chain; const v = await store.load(); chain = Array.isArray(v) ? v : []; return chain; }

  async function add(item, addedAt) {
    const c = await _load();
    if (c.some((e) => e.item.id === item.id)) return head();      // idempotent: already on the list
    const prev = c.length ? c[c.length - 1].id : "";
    const e = { item: { id: item.id, name: item.name, kind: item.kind || "movie" }, addedAt: addedAt || 0, prev,
                poster: item.posterUrl || null, year: item.year || null };
    e.id = await linkId(e);
    c.push(e); await store.save(c);
    return e.id;
  }
  async function remove(itemId) {
    let c = await _load();
    const idx = c.findIndex((e) => e.item.id === itemId);
    if (idx < 0) return head();
    // removing breaks the link → re-link the tail from the cut point (a new, valid chain).
    c.splice(idx, 1);
    let prev = idx > 0 ? c[idx - 1].id : "";
    for (let i = idx; i < c.length; i++) { c[i].prev = prev; c[i].id = await linkId(c[i]); prev = c[i].id; }
    chain = c; await store.save(c);
    return head();
  }
  async function list() { return [...(await _load())]; }
  async function has(itemId) { return (await _load()).some((e) => e.item.id === itemId); }
  async function head() { const c = await _load(); return c.length ? c[c.length - 1].id : ""; }

  // export → a payload anyone can verify; adopt → verify-before-trust (every link re-derives + chains).
  async function exportList() { return { entries: await list(), head: await head() }; }
  async function verifyChain(entries) {
    let prev = "";
    for (const e of entries) {
      if (e.prev !== prev) return false;
      if (e.id !== (await linkId(e))) return false;            // tamper → id won't re-derive
      prev = e.id;
    }
    return true;
  }
  async function adopt(payload) {
    if (!payload || !Array.isArray(payload.entries)) return false;
    if (!(await verifyChain(payload.entries))) return false;
    if (payload.head && payload.entries.length && payload.entries[payload.entries.length - 1].id !== payload.head) return false;
    chain = payload.entries.map((e) => ({ ...e })); await store.save(chain);
    return true;
  }

  return { add, remove, list, has, head, exportList, verifyChain, adopt };
}

// browser store — one localStorage key, JSON array.
function lsStore(key = "holoplayer.mylist.v1") {
  return {
    load() { try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch { return []; } },
    save(arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch {} },
  };
}
export function memStore() { let a = []; return { load: () => a, save: (x) => { a = x; } }; }

if (typeof window !== "undefined") window.HoloWatchlist = { createWatchlist, live: () => createWatchlist({ store: lsStore() }) };

export default { createWatchlist, memStore };
