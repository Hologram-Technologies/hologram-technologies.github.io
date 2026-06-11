// holo-ui.js — Hologram OS design-system loader. One call brings the whole component
// system (Shoelace / Web Awesome) wearing the Hologram look:
//   <script type="module" src="_shared/holo-ui.js"></script>
// It (1) sets Shoelace's base path from its OWN location — robust at any URL, dev or
// holo://<κ>/; (2) self-bundles the Shoelace light/dark themes + the Holo Theme bridge;
// (3) starts the autoloader, which registers <sl-*> components on demand.
//
// Pair with holo-theme.js (the token/runtime engine): Holo Theme stays the source of
// truth for tone; this file is just the components that conform to it.

import { setBasePath } from "./shoelace/utilities/base-path.js";

const here = new URL(".", import.meta.url).href;          // …/_shared/
const sl = here + "shoelace/";
setBasePath(sl.replace(/\/$/, ""));                       // absolute → autoloader imports resolve everywhere

// Self-bundle the stylesheets once (skip if a page pre-linked them, to avoid flash/dupes).
if (!document.querySelector("link[data-holo-ui]")) {
  for (const href of [sl + "themes/light.css", sl + "themes/dark.css", here + "holo-shoelace.css"]) {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href; l.setAttribute("data-holo-ui", "");
    document.head.appendChild(l);
  }
}

// Start the component autoloader (registers <sl-*> as they appear in the DOM).
import(sl + "shoelace-autoloader.js");
