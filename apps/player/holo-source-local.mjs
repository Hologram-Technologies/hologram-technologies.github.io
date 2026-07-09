// holo-source-local.mjs — files ON THIS DEVICE as a SourceProvider (OPFS / a picked folder). Enumerates a
// directory handle for video files; resolve → a blob: URL (same-origin, κ-clean, COEP-safe). The directory
// handle is injected (browser: navigator.storage.getDirectory() or showDirectoryPicker()) → Node-witnessable
// with a fake dir.

const VIDEO = /\.(mp4|webm|mkv|m4v|mov|ogv|avi)$/i;
const typeOf = (n) => /\.webm$/i.test(n) ? "video/webm" : /\.ogv$/i.test(n) ? "video/ogg" : "video/mp4";

// createLocalProvider({ getDir, name }) — getDir(): Promise<dirHandle> with async entries() → [name, handle];
// handle.kind === "file", handle.getFile() → File-like { name, size, type? }.
export function createLocalProvider({ getDir, name } = {}) {
  if (typeof getDir !== "function") throw new Error("holo-source-local: getDir required");
  const label = name || "On this device";
  let files = null;
  async function load() {
    if (files) return files;
    files = [];
    const dir = await getDir();
    for await (const [n, h] of dir.entries()) { if (h.kind === "file" && VIDEO.test(n)) files.push({ name: n, handle: h }); }
    return files;
  }
  const norm = (e, i) => ({
    id: "local:" + e.name, _handle: e.handle, kind: "movie", name: e.name.replace(VIDEO, ""), year: null, overview: "", blurb: "",
    posterUrl: null, backdrop: null, runtimeSec: 0, rating: null, genres: [], topics: [],
    channel: label, quality: 0.8, license: "On device", source: "tmdb", provider: "local", kappa: "", holoKappa: "local:" + e.name,
    availability: { playable: false, source: null, kappa: "", playSrc: "", type: "" },
  });
  const provider = {
    id: "local", name: label, kind: "local", enabled: true, trust: 1,   // your own files = highest trust
    async catalogs() { return [{ id: "all", type: "movie", name: label }]; },
    async browse() { return (await load()).map(norm); },
    async search(q) { return (await load()).map(norm).filter((x) => x.name.toLowerCase().includes(String(q).toLowerCase())); },
    async resolve(item) {
      const e = (await load()).find((x) => "local:" + x.name === item.id) || (item._handle ? { handle: item._handle, name: item.name } : null);
      if (!e) return [];
      const file = await e.handle.getFile();
      const url = (typeof URL !== "undefined" && URL.createObjectURL) ? URL.createObjectURL(file) : "blob:local/" + e.name;
      return [{ playSrc: url, type: file.type || typeOf(e.name), kind: "local", httpDirect: true, quality: 1080, provenance: { resolver: label, kind: "local", label: "On this device · " + e.name } }];
    },
  };
  return provider;
}
export default { createLocalProvider };
if (typeof window !== "undefined") window.HoloSourceLocal = {
  createLocalProvider,
  // browser helpers: OPFS root, or a user-picked folder.
  opfs: (name) => createLocalProvider({ name: name || "On this device", getDir: () => navigator.storage.getDirectory() }),
  pick: async (name) => { const dir = await window.showDirectoryPicker(); return createLocalProvider({ name: name || "Picked folder", getDir: async () => dir }); },
};
