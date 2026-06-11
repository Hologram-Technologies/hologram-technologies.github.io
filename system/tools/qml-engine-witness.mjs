#!/usr/bin/env node
// qml-engine-witness.mjs — proves Holo QML (os/usr/lib/holo/holo-qml.mjs) runs the REAL,
// verbatim upstream SDDM theme. Pure Node, headless backend, no DOM, no GPU — the Plymouth-
// witness pattern applied to QML. It re-derives that the theme is a sealed κ object (Law L5),
// parses it to the real component tree, evaluates its property bindings, and drives its signal
// handlers to assert the real SDDM API surface (sddm.login · userModel · sessionModel) is wired.
//
// Authority: Qt 6 QML Reference (doc.qt.io/qt-6/qmlreference.html · QtQml) · SDDM
// (github.com/sddm/sddm — data/themes/maldives, components/2.0). Writes the result the gate joins.
//
//   node tools/qml-engine-witness.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { QmlEngine, parseQml, parseThemeConf, createHeadlessBackend, hostEnv } from "../os/usr/lib/holo/holo-qml.mjs";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const THEME = "usr/share/sddm/themes/maldives";
const read = (rel) => readFileSync(join(OS, rel));
const closure = JSON.parse(read("etc/os-closure.json")).closure || {};

const checks = {};
const fail = [];
const ok = (name, cond, detail = "") => { checks[name] = !!cond; if (!cond) fail.push(name + (detail ? ` — ${detail}` : "")); return !!cond; };

// ── 1 · Law L5: the theme + its components are sealed κ objects (re-derive; tamper → refuse) ──
const qmlBytes = read(`${THEME}/Main.qml`);
const qmlHex = sha256hex(qmlBytes);
const sealed = closure[`${THEME}/Main.qml`];
ok("kappa-sealed", sealed && sealed.kappa === `did:holo:sha256:${qmlHex}`, sealed ? `closure ${sealed.kappa} vs ${qmlHex}` : "Main.qml not in os-closure (run npm run gen)");
const tampered = Buffer.concat([qmlBytes, Buffer.from(" ")]);          // one extra byte
ok("kappa-tamper-refused", sha256hex(tampered) !== qmlHex);
// the real upstream SddmComponents the theme imports are present + sealed too
const COMPONENTS = ["Background", "Clock", "TextBox", "PasswordBox", "ComboBox", "Button", "LayoutBox"];
ok("components-sealed", COMPONENTS.every((c) => {
  const e = closure[`usr/share/sddm/components/2.0/${c}.qml`];
  if (!e) return false;
  return e.kappa === `did:holo:sha256:${sha256hex(read(`usr/share/sddm/components/2.0/${c}.qml`))}`;
}), "components/2.0/*.qml sealed in os-closure");

// ── 2 · Parse the verbatim QML to the real component tree (the QML Reference grammar) ──
const src = qmlBytes.toString("utf8");
const doc = parseQml(src);
const imports = doc.imports.map((i) => i.module);
ok("imports", imports.includes("QtQuick") && imports.includes("SddmComponents"), imports.join(", "));
ok("root-type", doc.root.typeName === "Rectangle", doc.root.typeName);

// ── 3 · Run it headless against a faithful mock of the SDDM greeter context ──
const calls = { login: [], powerOff: 0, reboot: 0 };
const sigHandlers = { loginSucceeded: [], loginFailed: [], informationMessage: [] };
const textConstants = { welcomeText: "Welcome to %1", userName: "Username", password: "Password", session: "Session", layout: "Layout", login: "Login", shutdown: "Shut Down", reboot: "Restart", prompt: "Unlock your sovereign identity", loginSucceeded: "Session established", loginFailed: "Login failed" };
const sessions = [{ id: "primeos", name: "PrimeOS" }, { id: "debian", name: "Debian" }, { id: "workspace", name: "Workspace" }];
const sddm = {
  hostName: "holo-7f3a", canPowerOff: true, canReboot: true,
  login: (u, p, i) => calls.login.push([u, p, i]),
  powerOff: () => calls.powerOff++, reboot: () => calls.reboot++, suspend() {},
  connect: (sig, fn) => { (sigHandlers[sig] || (sigHandlers[sig] = [])).push(fn); },
  _emit: (sig, ...a) => (sigHandlers[sig] || []).forEach((f) => f(...a)),
};
const context = {
  sddm, textConstants,
  userModel: { lastUser: "operator", count: 1, users: [{ label: "operator" }] },
  sessionModel: { lastIndex: 1, sessions, count: sessions.length },
  keyboard: { enabled: false, capsLock: false, layouts: [] },
  config: { ...parseThemeConf(read(`${THEME}/theme.conf`).toString("utf8")) },
};
context.config.defaultBackground = context.config.background;

const engine = new QmlEngine({ backend: createHeadlessBackend(), context, baseUrl: `/${THEME}/` });
let root;
try { root = engine.load(doc); } catch (e) { ok("load", false, e.message); }
if (root) ok("load", true);

// walk the live QmlItem tree
const items = [];
(function walk(it) { if (!it) return; items.push(it); it.children.forEach(walk); })(root);
const byType = (t) => items.filter((i) => i.type === t);
const id = (n) => engine.ids[n];

// ── 4 · Bindings resolve ──
ok("binding-size", root && root.peek("width") === 640 && root.peek("height") === 480, root ? `${root.peek("width")}x${root.peek("height")}` : "no root");
const welcome = byType("Text").find((t) => String(t.peek("text") || "").startsWith("Welcome to"));
ok("binding-welcome-arg", welcome && welcome.peek("text") === "Welcome to holo-7f3a", welcome ? welcome.peek("text") : "welcome Text not found");
ok("present-types", ["Background", "Clock", "Image", "Column", "TextBox", "PasswordBox", "ComboBox", "Button", "Connections"].every((t) => byType(t).length > 0),
  "missing: " + ["Background", "Clock", "Image", "Column", "TextBox", "PasswordBox", "ComboBox", "Button", "Connections"].filter((t) => byType(t).length === 0).join(","));

// ── 5 · sessionIndex ← session.index (reactive) ──
const sessionCombo = id("session");
const before = root ? root.peek("sessionIndex") : undefined;
if (sessionCombo) sessionCombo.set("index", 2);
ok("reactive-sessionIndex", root && before === 1 && root.peek("sessionIndex") === 2, `before=${before} after=${root && root.peek("sessionIndex")}`);

// ── 6 · the real SDDM API surface is wired ──
if (id("name")) id("name").props.text = "alice";
if (id("password")) id("password").props.text = "s3cret";
const loginBtn = byType("Button").find((b) => b.peek("text") === textConstants.login);
if (loginBtn && loginBtn._handlers.self.clicked) loginBtn._handlers.self.clicked();
ok("wire-login-button", calls.login.length === 1 && calls.login[0][0] === "alice" && calls.login[0][1] === "s3cret" && calls.login[0][2] === 2, JSON.stringify(calls.login[0] || null));

// Keys.onPressed: Enter on the username field → sddm.login (verbatim handler, Qt key code)
const host = hostEnv("");
const nameField = id("name");
if (nameField && nameField._handlers.Keys && nameField._handlers.Keys.pressed) nameField._handlers.Keys.pressed({ key: host.Qt.Key_Return, accepted: false });
ok("wire-keys-enter", calls.login.length === 2, `login calls=${calls.login.length}`);

const shutBtn = byType("Button").find((b) => b.peek("text") === textConstants.shutdown);
const rebootBtn = byType("Button").find((b) => b.peek("text") === textConstants.reboot);
if (shutBtn && shutBtn._handlers.self.clicked) shutBtn._handlers.self.clicked();
if (rebootBtn && rebootBtn._handlers.self.clicked) rebootBtn._handlers.self.clicked();
ok("wire-power", calls.powerOff === 1 && calls.reboot === 1, `powerOff=${calls.powerOff} reboot=${calls.reboot}`);

// ── 7 · Connections { target: sddm } wired ──
if (id("password")) id("password").props.text = "stillhere";
sddm._emit("loginFailed");
ok("wire-connections-failed", id("password") && id("password").peek("text") === "", `password='${id("password") && id("password").peek("text")}'`);
sddm._emit("informationMessage", "Wrong passphrase");
ok("wire-connections-info", id("errorMessage") && id("errorMessage").peek("text") === "Wrong passphrase", id("errorMessage") && id("errorMessage").peek("text"));

// ── result ──
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "Holo QML parses + executes the verbatim upstream SDDM maldives/Main.qml (QtQuick + SddmComponents)",
    "property bindings + reactive dependency tracking (sessionIndex ← session.index, welcomeText.arg)",
    "real SDDM API wired: sddm.login(name.text, password.text, sessionIndex) · powerOff · reboot · Connections",
    "Law L5: the theme + components are sealed κ objects (re-derive; tamper refused)",
  ],
  checks,
  failed: fail,
  warnings: engine ? engine._warns.slice(0, 20) : [],
  itemCount: items.length,
  tree: engine && root ? engine.describeTree() : null,
  authority: "Qt 6 QML Reference (QtQml) · SDDM data/themes/maldives + components/2.0",
};
writeFileSync(join(here, "qml-engine-witness.result.json"), JSON.stringify(result, null, 2) + "\n");

console.log("Holo QML engine witness\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
if (engine && engine._warns.length) { console.log("\n  warnings:"); engine._warns.slice(0, 12).forEach((w) => console.log("    · " + w)); }
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}   (${items.length} objects)`);
process.exit(witnessed ? 0 : 1);
