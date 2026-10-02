// holo-platform.js — detect the host OS and expose a profile so Hologram OS feels NATIVE on
// whatever machine boots it. Same shell, but the modifier key, window-control side + style,
// font stack, accent, and keyboard shortcuts match Windows / macOS / Linux / Android / iOS /
// iPadOS / ChromeOS. Pure + dependency-free + isomorphic: profileFor() takes a navigator-like
// object (so it is unit-testable headless in Node) and defaults to the real navigator.
//
// W3C/WICG User-Agent Client Hints (navigator.userAgentData) is the primary signal, with a
// User-Agent string fallback for engines that don't expose it; iPadOS (which masquerades as
// macOS) is disambiguated by touch points.

const UAD_PLATFORM = { Windows: "windows", macOS: "macos", "Mac OS X": "macos", Linux: "linux", Android: "android", "Chrome OS": "chromeos", "Chromium OS": "chromeos" };

function osFromUA(ua) {
  if (/Windows/i.test(ua)) return "windows";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPod/i.test(ua)) return "ios";
  if (/iPad/i.test(ua)) return "ipados";
  if (/CrOS/i.test(ua)) return "chromeos";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Linux/i.test(ua)) return "linux";
  return "linux";
}

const FONT = {
  windows: '"Segoe UI Variable","Segoe UI",system-ui,sans-serif',
  macos: '-apple-system,"SF Pro Text","Helvetica Neue",system-ui,sans-serif',
  ios: '-apple-system,"SF Pro Text",system-ui,sans-serif',
  ipados: '-apple-system,"SF Pro Text",system-ui,sans-serif',
  android: 'Roboto,"Noto Sans",system-ui,sans-serif',
  chromeos: 'Roboto,system-ui,sans-serif',
  linux: 'system-ui,"Cantarell","Ubuntu","Noto Sans",sans-serif',
};
const ACCENT = { windows: "#0a84ff", macos: "#0a84ff", ios: "#0a84ff", ipados: "#0a84ff", android: "#1a73e8", chromeos: "#1a73e8", linux: "#3584e4" };
const LABEL = { windows: "Windows", macos: "macOS", ios: "iOS", ipados: "iPadOS", android: "Android", chromeos: "ChromeOS", linux: "Linux" };

// profileFor(nav) → the native-feel profile for the host. nav defaults to globalThis.navigator.
export function profileFor(nav) {
  nav = nav || (typeof navigator !== "undefined" ? navigator : {});
  const ua = String(nav.userAgent || "");
  const uad = nav.userAgentData;
  let os = (uad && uad.platform && UAD_PLATFORM[uad.platform]) || osFromUA(ua);
  let mobile = uad ? !!uad.mobile : /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  // iPadOS reports as macOS in modern Safari — disambiguate via multi-touch.
  if (os === "macos" && (nav.maxTouchPoints || 0) > 1) { os = "ipados"; mobile = true; }
  const apple = os === "macos" || os === "ios" || os === "ipados";
  const touch = mobile || os === "ipados";
  const mod = apple ? "⌘" : "Ctrl";
  const alt = apple ? "⌥" : "Alt";
  return {
    os, label: LABEL[os] || os, mobile, apple, touch,
    modKey: apple ? "meta" : "control",          // which KeyboardEvent modifier to honour
    modSymbol: mod, altSymbol: alt,
    controlsSide: apple ? "left" : "right",       // traffic-lights left (macOS) vs min/max/close right (Win/Linux)
    controlStyle: apple ? "traffic" : "win",
    font: FONT[os] || FONT.linux,
    accent: ACCENT[os] || "#1f6feb",
    shortcuts: {
      spotlight: `${mod} K`,
      newComponent: `${mod} ⇧ N`,
      closeWindow: `${mod} W`,
      maximize: apple ? `⌃${mod} F` : "Super ↑",
      minimize: apple ? `${mod} M` : "Super ↓",
      snapLeft: apple ? `⌃${alt} ←` : "Super ←",
      snapRight: apple ? `⌃${alt} →` : "Super →",
    },
    // THE FILE-MANAGER IDIOM TABLE (Native Mirror N3) — every host-specific word/verb/default the
    // Files chrome shows, in ONE place, so a Windows person reads Explorer, a Mac person reads Finder,
    // a Linux person reads GNOME Files — with no scattered `P.apple ?` forks in the chrome.
    files: apple ? {
      places: "Favourites", drives: "Locations", thisComputer: "This Mac",
      getInfo: "Get Info", copy: "Copy", cut: "Cut", paste: "Paste", rename: "Rename", del: "Move to Trash",
      trash: "Trash", newFolder: "New Folder", emptyTrash: "Empty Trash",
      kind: "Kind", dateModified: "Date Modified", where: "Where",
      defaultView: "icons", defaultSort: "name", newFolderKey: `${mod} ⇧ N`, infoKey: `${mod} I`,
    } : os === "windows" ? {
      places: "Quick access", drives: "This PC", thisComputer: "This PC",
      getInfo: "Properties", copy: "Copy", cut: "Cut", paste: "Paste", rename: "Rename", del: "Delete",
      trash: "Recycle Bin", newFolder: "New folder", emptyTrash: "Empty Recycle Bin",
      kind: "Type", dateModified: "Date modified", where: "Location",
      defaultView: "details", defaultSort: "name", newFolderKey: "Ctrl ⇧ N", infoKey: "Alt ⏎",
    } : {   // Linux / GNOME Files (Nautilus)
      places: "Places", drives: "Devices", thisComputer: "Computer",
      getInfo: "Properties", copy: "Copy", cut: "Cut", paste: "Paste", rename: "Rename", del: "Move to Trash",
      trash: "Trash", newFolder: "New Folder", emptyTrash: "Empty Trash",
      kind: "Type", dateModified: "Modified", where: "Parent folder",
      defaultView: "list", defaultSort: "name", newFolderKey: "Ctrl ⇧ N", infoKey: "Ctrl I",
    },
  };
}

const HoloPlatform = { profileFor };
if (typeof globalThis !== "undefined") globalThis.HoloPlatform = globalThis.HoloPlatform || HoloPlatform;
export default HoloPlatform;
