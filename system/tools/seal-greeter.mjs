#!/usr/bin/env node
// seal-greeter.mjs — seal the display-manager greeter as a SELF-VERIFYING UOR object so AI
// agents can discover + verify it through the OS's existing agent door (resolve_object /
// verify_object). It does NOT restate the greeter — it derives a structural descriptor from the
// REAL upstream QML (imports · component types · ids · the wired sddm.* API surface) and links,
// by content address, to the verbatim source files (Main.qml + components/2.0/*.qml). One object,
// re-derivable top to bottom (Law L5): a W3C JSON-LD record an agent can both interpret and verify.
//
//   node tools/seal-greeter.mjs        (then: npm run gen  to address it in the closure)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseQml } from "../os/usr/lib/holo/holo-qml.mjs";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { makeObject, contentLink } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const THEME = "usr/share/sddm/themes/maldives";
const COMPONENTS = ["Background", "Clock", "TextBox", "PasswordBox", "ComboBox", "Button", "LayoutBox"];
const read = (rel) => readFileSync(join(OS, rel));

const doc = parseQml(read(`${THEME}/Main.qml`).toString("utf8"));

// derive a structural fingerprint from the AST (deterministic; no runtime/session values)
const types = {}, ids = [], api = new Set();
(function walk(node) {
  types[node.typeName] = (types[node.typeName] || 0) + 1;
  for (const m of node.members) {
    if (m.kind === "id") ids.push(m.name);
    const body = m.body || m.rhs || "";
    for (const fn of ["login", "powerOff", "reboot", "suspend"]) if (new RegExp(`sddm\\.${fn}\\b`).test(body)) api.add(`sddm.${fn}`);
    if (m.kind === "child") walk(m.object);
    if (m.kind === "binding" && m.object) walk(m.object);
    if (m.kind === "propDecl" && m.child) walk(m.child);
  }
})(doc.root);

const store = new Map();
const leaf = (rel, p) => contentLink(rel, `did:holo:sha256:${sha256hex(read(p))}`, "schema:MediaObject");
const links = [
  leaf("qml:theme", `${THEME}/Main.qml`),
  ...COMPONENTS.map((c) => leaf("qml:component", `usr/share/sddm/components/2.0/${c}.qml`)),
];

const obj = makeObject(store, {
  type: ["schema:SoftwareApplication", "prov:Entity"],
  context: [{ qml: "https://doc.qt.io/qt-6/qtqml-index.html#", sddm: "https://github.com/sddm/sddm#", hosc: "https://hologram.os/ns/conformance#" }],
  "schema:name": "Hologram OS display manager — real SDDM greeter (Holo QML)",
  "schema:description": "The login greeter IS the verbatim upstream SDDM maldives/Main.qml, parsed + executed by Holo QML (a from-spec QML engine, os/usr/lib/holo/holo-qml.mjs) and rendered to the DOM — the way Holo Splash runs Plymouth's real .script themes. sddm.login() unlocks a self-sovereign key bound to this device (Law L1), not PAM. Re-derive this object's did and each linked source κ to verify (Law L5).",
  "schema:applicationCategory": "DisplayManager",
  "schema:softwareRequirements": "Holo QML engine (os/usr/lib/holo/holo-qml.mjs)",
  "qml:imports": doc.imports.map((i) => `${i.module} ${i.version}`.trim()),
  "qml:types": types,
  "qml:ids": ids,
  "qml:apiSurface": [...api].sort(),
  "hosc:authority": "Qt 6 QML Reference — QtQml (doc.qt.io/qt-6/qmlreference.html) · SDDM (github.com/sddm/sddm — data/themes/maldives + components/2.0)",
  "hosc:witness": "tools/qml-engine-witness.mjs",
  links,
});

writeFileSync(join(OS, "usr/share/sddm/greeter.uor.json"), JSON.stringify(obj, null, 2) + "\n");
console.log(`sealed greeter.uor.json\n  ${obj.id}\n  types: ${Object.keys(types).length} · ids: ${ids.length} · api: ${[...api].sort().join(", ")} · source links: ${links.length}`);
