// holo-omni-index.mjs — the omnibar's MEMORY: a persistent, on-device index of everything you've resolved,
// browsed, or sealed (a URL, an ENS name, a CID, a κ-app, a file, a snapshot). As you type, the one bar
// autocompletes from YOUR history — ranked by match × recency × frequency (× holo-rank authority when present)
// — served INSTANTLY with no network. Content-addressed: each entry carries its address/κ, so Enter re-opens
// it O(1) from the commons. Private by construction — it lives in localStorage and never leaves the device.
// Pure logic (the store + clock are injected) → Node-witnessable; the shell uses the default localStorage store.

const KEY = "holo:omni-index";
const MAX = 800;

const _load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } };
const _save = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a.slice(0, MAX))); } catch {} };
const defaultStore = () => ({ get: _load, set: _save, now: () => Date.now() });

// record(entry) — upsert by `addr` (dedupe across re-visits); bumps frequency + recency, moves to front.
//   entry: { addr, input?, kind?, title?, kappa? }  — addr is the canonical re-open key (a url / ipfs:// / κ / …).
export function record(e, store = defaultStore()) {
  if (!e || !e.addr) return;
  const a = store.get(); const now = store.now();
  const i = a.findIndex((x) => x.addr === e.addr);
  if (i >= 0) { const x = a[i]; x.n = (x.n || 1) + 1; x.t = now; if (e.title) x.title = e.title; if (e.kind) x.kind = e.kind; if (e.kappa) x.kappa = e.kappa; a.splice(i, 1); a.unshift(x); }
  else a.unshift({ addr: e.addr, kind: e.kind || "", title: e.title || e.addr, input: e.input || e.addr, kappa: e.kappa || null, n: 1, t: now });
  store.set(a);
}

// search(q, opts) → ranked [{ addr, kind, title, input, kappa, n, t, score }] — match × recency × frequency
// (× holo-rank authority `rank[hex]` when a rank map is provided). The omnibar prepends these as "recent" rows.
export function search(q, { limit = 6, rank = null, store = defaultStore(), now = null } = {}) {
  q = String(q || "").trim().toLowerCase(); if (!q) return [];
  const a = store.get(); const T = now || store.now(); const out = [];
  for (const x of a) {
    const hay = ((x.title || "") + "  " + (x.addr || "") + "  " + (x.input || "")).toLowerCase();
    const qsp = " " + q;
    let m = 0;
    if (hay.startsWith(q)) m = 3;                                  // prefix
    else if (hay.indexOf(qsp) >= 0) m = 2.2;                       // word-start
    else if (hay.indexOf(q) >= 0) m = 1.4;                         // substring
    else { const qs = q.split(/\s+/).filter(Boolean); const hit = qs.filter((t) => hay.indexOf(t) >= 0).length; if (hit) m = 0.7 * (hit / qs.length); }   // token coverage
    if (!m) continue;
    const ageH = Math.max(0, (T - (x.t || 0)) / 3.6e6);
    const recency = 1 / (1 + ageH / 24);                           // ~halves per day
    const freq = Math.log2(1 + (x.n || 1));
    const auth = rank && x.kappa ? 1 + (rank[String(x.kappa).split(":").pop()] || 0) * 1.5 : 1;   // holo-rank, when present
    out.push({ ...x, score: m * (1 + recency) * (1 + 0.4 * freq) * auth });
  }
  return out.sort((p, q2) => q2.score - p.score || (q2.t || 0) - (p.t || 0)).slice(0, limit);
}

export function clear(store = defaultStore()) { store.set([]); }
export default { record, search, clear };
