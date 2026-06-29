// holo-fhs-map.mjs — THE one flat→FHS path mapping. The apps speak a flat URL space
// (/_shared/, /apps/<id>/, /home.html, /boot.html, …) but the OS lives in a Linux FHS tree
// (/usr/lib/holo/, /usr/share/frame/, /boot/boot/, …). This pure function maps a requested
// os-relative path to the PHYSICAL FHS path that actually holds the bytes. It is the single
// source of truth shared by BOTH the dev server (tools/holo-serve-fhs.mjs) and the in-browser
// Service Worker (os/holo-fhs-sw.js) — so a GitHub Pages deploy (dumb static host, files at
// their real FHS path) boots byte-identically to `node tools/holo-serve-fhs.mjs`. Law L2: one
// canonical mapping, no per-surface drift. Pure + dependency-free (string-only; node + SW + DOM).
//
// Returns the os-relative physical path, or null for "unknown top-level" (the dev server then
// tries the Apps repo / original-os gap fallback; on Pages a null is simply a 404).

// Flat root-served single files (requested at holo://os/<name>), grouped by their FHS home. Defined ONCE here
// and exported as FLAT_ROOT_FILES so the image builder (make-dist) projects EXACTLY what dev + SW serve at
// root — there is no second, hand-maintained list to drift. That drift is what 403'd shell-main.mjs and
// holo-fabric.mjs on the native host (they worked on dev via this map, but make-dist's old lists omitted them).
const FRAME_PAGES = ["shell.html", "holospace.html", "home.html", "home-screen.html", "homepage.html", "find.html", "splash.html", "login.html", "identity.html", "wallet.html", "workspace.html", "pair.html", "omni.html"];
const BOOT_FILES = ["holo-boot-sw.js", "coi-serviceworker.min.js"];
const LIB_FILES = ["holo-launch.mjs", "holo-omni.mjs", "holo-boot-sw-register.mjs", "holo-heal-boot.mjs", "browser-sw.js"];
const SBIN_FILES = ["holo-resolver.mjs", "holo-sources.mjs", "holo-peers.mjs", "holo-wire.mjs", "holo-fabric.mjs"];
const ETC_FILES = ["manifest.webmanifest", "os-closure.json"];
const ICON_FILES = ["icon-192.png", "icon-512.png"];
// The complete set make-dist must project to dist root. os-closure.json + holo-fhs-sw.js are sealed/anchored
// specially by the builder, so they are deliberately EXCLUDED here.
export const FLAT_ROOT_FILES = [...FRAME_PAGES, "boot.html", ...BOOT_FILES, ...LIB_FILES, ...SBIN_FILES, "manifest.webmanifest", ...ICON_FILES];

export function fhsMap(rel) {
  rel = String(rel).replace(/^\/+/, "");
  let mm;
  if (rel === "apps/index.jsonld") return "usr/share/holospaces/index.jsonld";   // the apps catalog, vendored into the image (the dev serve still prefers the live Apps-repo copy via readRel)
  if (rel === "apps/holospaces.jsonld") return "usr/share/holospaces/holospaces.jsonld";   // the holospace TEMPLATE catalog (First Light), vendored alongside the apps catalog
  // _shared and pkg are ALWAYS the OS runtime — wherever an app references them.
  if ((mm = rel.match(/^(?:apps\/[^/]+\/)?_shared\/(.+)$/))) return "usr/lib/holo/" + mm[1];
  if ((mm = rel.match(/^(?:apps\/[^/]+\/)?pkg\/(.+)$/))) return "usr/lib/pkg/" + mm[1];
  if (rel.startsWith("apps/")) { const [, id, ...sub] = rel.split("/"); return id === "boot" ? "boot/" + sub.join("/") : "usr/share/holospaces/" + id + "/" + sub.join("/"); }
  if (rel.startsWith("pkg/")) return "usr/lib/pkg/" + rel.slice(4);
  if (rel.startsWith(".well-known/")) return ".well-known/" + rel.slice(12);
  if (rel.startsWith("terms/")) return "etc/terms/" + rel.slice(6);
  if ((mm = rel.match(/^\.holo\/(terms|privacy)\/(.+)$/))) return "etc/" + mm[1] + "/" + mm[2];
  if (rel.startsWith("privacy/")) return "etc/privacy/" + rel.slice(8);   // _shared/holo-privacy.js resolves its roster as ../privacy/policies.json → /privacy/… (FHS-true under etc/)
  if ((mm = rel.match(/^(a2a|nanda|skills|atlas)\/(.+)$/))) return "srv/" + mm[1] + "/" + mm[2];
  if (rel === "apps-witness.result.json") return "srv/apps-witness.result.json";
  // The boot chain: rEFInd (boot.html at root) → Plymouth (splash.html) → SDDM (login.html)
  // → shell (home.html) → editor (workspace.html). All in /usr/share/frame.
  if (FRAME_PAGES.includes(rel)) return "usr/share/frame/" + rel;   // shell.html = the ONE canonical holospace shell (in OS2); identity.html + wallet.html = the unified Holo Identity surface (the sovereign vault) — core, always served; omni.html = the κ-resolve lab
  if (rel === "boot.html") return "boot/boot.html";                   // the bootloader, served at the root (file named boot.html — no index.html clash with the OS-root gateway)
  // …the bootloader's OWN asset subdir is physically boot/boot/, so `boot/<x>` maps one level deeper.
  if (/^boot\/(refind\.conf|boot-manifest\.json|icons\/|themes\/|make-boot\.mjs)/.test(rel)) return "boot/boot/" + rel.slice(5);
  if (BOOT_FILES.includes(rel)) return "boot/" + rel;
  if (rel === "holo-fhs-sw.js") return "holo-fhs-sw.js";              // the content-addressed delivery worker lives at the os/ root (registered relative by the gateway)
  if (LIB_FILES.includes(rel)) return "lib/" + rel;
  if (SBIN_FILES.includes(rel)) return "sbin/" + rel;
  if (ETC_FILES.includes(rel)) return "etc/" + rel;
  if (ICON_FILES.includes(rel)) return "usr/share/icons/" + rel;
  // The Plymouth theme catalog the splash fetches as `splash/themes/<id>/…` lives FHS-true.
  if ((mm = rel.match(/^splash\/themes\/(.+)$/))) return "usr/share/plymouth/themes/" + mm[1];
  // Cross-repo: the GGUF forge (apps/q/forge/*) imports the OS's holo-uor via the sibling-repo layout
  // "/holo-os/system/os/<path>". On this flat origin the OS lives at root, so resolve that prefix to the OS
  // path (mirrors the dev-server alias in tools/holo-serve-fhs.mjs) — lets Q's .holo WebGPU brain load on Pages.
  if (rel.startsWith("holo-os/system/os/")) return fhsMap(rel.slice("holo-os/system/os/".length));
  // κ-Open share cards (Phase 4): the pretty /~<app> link + its OG image are baked as static files
  // (tools/gen-apps-catalog.mjs) so a dumb static host serves a per-app unfurl with no server. /~<app> →
  // its baked index.html; /~<app>/og.svg is the content-derived κ-identicon. (The dev server resolves /~<app>
  // dynamically in makeHandler, BEFORE fhsMap — these rules are the prod-SW/static path.)
  if ((mm = rel.match(/^~([a-z0-9._-]{1,40})\/og\.svg$/i))) return "~" + mm[1] + "/og.svg";
  if ((mm = rel.match(/^~([a-z0-9._-]{1,40})\/?$/i))) return "~" + mm[1] + "/index.html";
  // FHS passthrough: the whole Linux root is addressable at its real path (identity map).
  if (/^(usr|etc|var|boot|bin|sbin|lib|lib64|opt|srv|mnt|media|home|root|dev|proc|sys|run|tmp|ui)\//.test(rel)) return rel;
  return null;
}

// devFreshAllowed — THE dev-fresh gate, shared by the Service Worker (os/holo-fhs-sw.js) and its
// witness so dev and the gate agree on one rule (Law L2). dev-fresh (serve PATH bytes without the
// stale closure's L5 refusal, so live edits show) requires BOTH an EXPLICIT opt-in (`allow`, flipped
// only by the dev server when it serves the SW) AND a loopback hostname. Hostname ALONE never enables
// it — so a production build served from a localhost origin still re-derives + refuses (Law L5).
// Pure + dependency-free (string-only; node + SW + DOM).
export const devFreshAllowed = (allow, hostname) =>
  allow === true && /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(String(hostname));
