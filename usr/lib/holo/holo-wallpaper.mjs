// holo-wallpaper.mjs — the ONE canonical wallpaper broker.
//
// Single source of truth = localStorage["holo.theme.v1"].wallpaper (the OS appearance key that the pre-paint
// resolver, the theme engine, and the immersive backdrop already read). Every surface — the desktop shell, the
// messenger home, any same-origin frame — reads, writes, and subscribes HERE, so the wallpaper is literally the
// SAME object everywhere and a change on one surface repaints the rest.
//
// Propagation rides two W3C primitives, no bus and no server:
//   • same document → a CustomEvent("holo-theme-change") on <html> (what the OS backdrop already listens for);
//   • other tabs / frames of this origin → the Storage event (fired by the browser on any localStorage write).
//
// PERSISTENCE: the localStorage row itself is the per-device memory. An authorized-account sync (roaming the
// choice across devices) layers on top by mirroring this same row to the signed-in principal — the broker stays
// the seam either way, so nothing downstream changes when that lands.

const KEY = "holo.theme.v1";

// κ (sha256/blake3/sha512:hex) → the content-addressed route; a path/url/data: string passes through. Same rule
// as holo-appearance-boot.js / holo-immersive-backdrop.js, single-sourced here so the three never drift.
export function resolveUrl(raw) {
  if (!raw) return "";
  const m = String(raw).match(/^(sha256|blake3|sha512):([0-9a-f]+)$/i);
  return m ? "/.holo/" + m[1].toLowerCase() + "/" + m[2] : String(raw);
}

function state() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }

// readWallpaper() → { raw, kind, scene, url }. kind: "photo" (an image we can project) | "live" (a live sim like
// Fluid, sentinel "live:<scene>") | "none". `url` is the resolved fetchable URL for a photo, "" otherwise.
export function readWallpaper() {
  const raw = String(state().wallpaper || "");
  const live = raw.match(/^live:([a-z0-9-]+)/i);
  const kind = !raw || raw === "plain" ? "none" : live ? "live" : "photo";
  return { raw, kind, scene: live ? live[1].toLowerCase() : "", url: kind === "photo" ? resolveUrl(raw) : "" };
}

// writeWallpaper(raw) — set the shared wallpaper and fan the change out. `raw` is a path/url/data:/κ, the
// "live:<scene>" sentinel, or "plain" (no wallpaper). A real wallpaper implies immersive on. Merges into the
// existing theme row so palette/presentation are preserved. Same-doc listeners get holo-theme-change now; other
// tabs get the Storage event for free. No-op (and no event) if the value is unchanged, so it never loops.
export function writeWallpaper(raw) {
  const s = state();
  if (s.wallpaper === raw) return readWallpaper();
  s.wallpaper = raw;
  if (raw && raw !== "plain") s.immersive = true;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  try { document.documentElement.dispatchEvent(new CustomEvent("holo-theme-change", { detail: { wallpaper: raw } })); } catch (e) {}
  return readWallpaper();
}

// subscribe(cb) — fire cb(readWallpaper()) whenever the wallpaper actually changes, whether from THIS surface or
// any other same-origin tab/frame. De-dupes on the raw value so cb never fires for a no-op write (or a palette-only
// theme change). Returns an unsubscribe.
export function subscribe(cb) {
  let last = readWallpaper().raw;
  const fire = () => { const w = readWallpaper(); if (w.raw !== last) { last = w.raw; try { cb(w); } catch (e) {} } };
  const onTheme = () => fire();
  const onStorage = (e) => { if (!e || e.key === null || e.key === KEY) fire(); };   // key===null ⇒ storage.clear()
  document.documentElement.addEventListener("holo-theme-change", onTheme);
  window.addEventListener("storage", onStorage);
  return () => {
    document.documentElement.removeEventListener("holo-theme-change", onTheme);
    window.removeEventListener("storage", onStorage);
  };
}
