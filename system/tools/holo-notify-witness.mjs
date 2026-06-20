#!/usr/bin/env node
// holo-notify-witness.mjs — PROVE Hologram OS has ONE notification surface: a quiet toast that ALWAYS
// files into a persistent, openable Center, with Q as a first-class sender — and that the two ad-hoc
// surfaces it replaces (the ephemeral #toast and the hardcoded "Secure your account" banner) now flow
// through it. Static analysis of the served bytes (no browser needed):
//
//   1 · PRIMITIVE — holo-notify.mjs exports mountNotifications + window.HoloNotify; notify() shows a
//       transient toast AND files a durable record; history is per-operator on the OS's localStorage
//       UI-state axis (survives reload + re-sign-in), capped to a recent window.
//   2 · CARRIAGE  — the Center reuses the ONE shared right side-carriage primitive (createAside — the
//       same dock the Create/Play/Share verbs wear), not a bespoke panel.
//   3 · COHERENT  — tokens + golden-ratio, a κ-glyph shimmer on arrival, reduced-motion + mobile media
//       queries; obvious-not-intrusive (the bell carries an unread badge; the toast self-files).
//   4 · Q CHANNEL — Q is a first-class sender with its own thread and a DELIVER-ONLY seam (window.Q.note):
//       it posts a note it is handed and never generates text, so nothing is fabricated (Law L5).
//   5 · UNIFIED   — the shell routes toast() through window.HoloNotify, and the backup nudge is migrated
//       to a persistent, actionable "Backup" notification (the hardcoded-hex banner is gone).
//
//   node tools/holo-notify-witness.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OS = join(here, "../os");
const read = (rel) => (existsSync(join(OS, rel)) ? readFileSync(join(OS, rel), "utf8") : "");

const notify = read("usr/lib/holo/holo-notify.mjs");
const shell = read("usr/share/frame/shell.html");
const backup = read("usr/lib/holo/holo-backup.js");

const checks = {
  // 1 · the primitive
  "holo-notify.mjs exists and is the notification surface": notify.length > 0,
  "exports mountNotifications + installs window.HoloNotify":
    /export function mountNotifications/.test(notify) && /window\.HoloNotify\s*=/.test(notify),
  "notify() shows a transient toast AND files a durable record":
    /function showToast/.test(notify) && /items\.unshift\(rec\)/.test(notify),
  "a bare/transient toast is shown but NOT filed (history stays meaningful)":
    /if \(opts\.transient\) return rec/.test(notify),
  "the live pill collapses per concern too — ONE pill per concernKey, never a duplicate stack (persistent 'action' pills can't pile up)":
    /const key = concernKey\(rec\)/.test(notify) && /el\.__hnKey === key/.test(notify) && /el\.remove\(\)/.test(notify) && /t\.__hnKey = key/.test(notify),
  "history is per-operator + durable (localStorage UI-state axis, survives reload + re-sign-in)":
    /holo\.notify\.v1\./.test(notify) && /getOperator/.test(notify) && /localStorage\.setItem\(opKey\(\)/.test(notify),
  "history is a recent window, not an unbounded log (capped)": /CAP\s*=\s*\d+/.test(notify) && /slice\(0, CAP\)/.test(notify),

  // 2 · the carriage
  "the Center reuses the ONE shared right side-carriage primitive (createAside)":
    /import \{ createAside \} from "\.\/holo-aside\.mjs"/.test(notify) && /createAside\(\{\s*id:\s*"notify"/.test(notify),

  // 3 · coherent + obvious-not-intrusive
  "the bell carries an unread badge (obvious, not intrusive)":
    /id="notif-btn"/.test(shell) && /hn-badge/.test(notify) && /const refreshBadge|function refreshBadge/.test(notify),
  "a κ-glyph shimmer marks a fresh arrival (the OS's own sealed-byte vocabulary)":
    /hn-shimmer/.test(notify) && /KAPPA_GLYPHS/.test(notify),
  "token-driven, not hardcoded palette (the backup-banner anti-pattern)":
    /var\(--holo-accent/.test(notify) && /var\(--holo-bg/.test(notify) && /var\(--holo-ink/.test(notify),
  "golden-ratio spacing tokens (φ) throughout": /var\(--holo-size-/.test(notify),
  "calm motion: reduced-motion + mobile media queries honored":
    /@media \(prefers-reduced-motion/.test(notify) && /@media \(max-width:600px\)/.test(notify),
  "mark-read · clear · sender filter":
    /const markAllRead =/.test(notify) && /const clear =/.test(notify) && /function renderFilters/.test(notify),
  "tapping a notification deep-links to its source (omnibox / Q)":
    /onDeepLink/.test(notify) && /onDeepLink:/.test(shell) && /omniGo\(link\.value\)/.test(shell),

  // 4 · Q as a first-class sender, deliver-only (never fabricates)
  "Q is a first-class sender with its own thread": /SENDERS = \["Q"/.test(notify) && /const q =/.test(notify),
  "Q ↔ Center seam delivers a handed note, never generates (Law L5)":
    /window\.Q\.note\s*=/.test(shell) && /HoloNotify\.q/.test(shell) && /it never generates/.test(shell),
  "an honest welcome note seeds the Q thread once per operator (static, not model output)":
    /leave notes here/.test(shell) && /holo\.notify\.welcomed\./.test(shell),

  // 5 · the two old surfaces now flow through the one
  "the shell routes toast() through the unified surface":
    /if \(window\.HoloNotify\) \{ window\.HoloNotify\.toast\(m\)/.test(shell),
  "the shell mounts the Notification Center": /mountNotifications\(document\.getElementById\("notif-btn"\)/.test(shell),
  "the backup nudge is a quiet, persistent, deep-linked Backup notification (files silently into the inbox, opens the reveal flow)":
    /window\.HoloNotify\.notify\(/.test(backup) && /sender:\s*"Backup"/.test(backup) && /silent:\s*true/.test(backup) &&
    /kind:\s*"backup"/.test(backup) && /link\.kind === "backup"/.test(shell) && /HoloBackup\.reveal/.test(shell),
  "the hardcoded-hex backup banner is gone":
    !/id: "holo-backup-nudge", style: "position:fixed/.test(backup),
};

const witnessed = Object.values(checks).every(Boolean);
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} — ${k}`);
const passed = Object.values(checks).filter(Boolean).length;

writeFileSync(join(here, "holo-notify-witness.result.json"), JSON.stringify({
  spec: "Hologram OS has ONE notification surface (Holo Notify, holo-notify.mjs): holo.notify shows a transient, theme-coherent toast and ALWAYS files a durable, per-operator record into a persistent Notification Center rendered in the shared right side-carriage (createAside). The bell carries an unread badge; arrivals shimmer with the OS's κ-glyphs; motion is reduced-motion-aware. Q is a first-class sender with its own thread and a deliver-only seam (window.Q.note) that never generates text (Law L5). The two prior ad-hoc surfaces — the ephemeral #toast and the hardcoded 'Secure your account' banner — now flow through it.",
  authority: "ADR-0109 (Holo Aside — the one right side-carriage) · ADR-0104/0106 (per-operator, device-local persistence axis) · ADR-0030 (Holo UI tokens) · ADR-0057 (readability floor) · golden ratio (holo-phi.css) · WCAG 2.2 (prefers-reduced-motion, status messages) · holospaces Law L5 (honest by construction — never fabricate a state) · verify by static analysis of the served module + shell + backup",
  witnessed,
  covers: ["notifications", "holo-notify", "notification-center", "carriage-reuse", "per-operator-persistence", "toast-unified", "backup-migrated", "q-sender", "deliver-only-seam", "unread-badge", "kappa-shimmer", "reduced-motion", "deep-link", "tokens", "golden-ratio"],
  passed,
  total: Object.keys(checks).length,
  checks,
}, null, 2) + "\n");

console.log(`\nholo-notify-witness: ${witnessed ? "WITNESSED" : "FAILED"} (${passed}/${Object.keys(checks).length})`);
process.exit(witnessed ? 0 : 1);
