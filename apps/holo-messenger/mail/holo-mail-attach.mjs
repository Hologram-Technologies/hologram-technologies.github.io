// holo-mail-attach.mjs - the in-app entry. Loaded additively by app.html; mounts the Intelligent Inbox
// (holo-mail-ui) over the REAL engine (email-bridge provider + on-device Q + holo-strand) as a full-screen
// overlay. When no mailbox is linked yet, it shows the one-tap ONBOARDING first. FEATURE-FLAGGED OFF by
// default: with the flag off nothing is added to the page, so it can't affect the messenger's paint.
//   flag on:  localStorage.setItem("holo.mail.enabled","1")   - or open with ?mail=1
//   manual:   window.HoloMailOpen()   (always available)

import { makeMailProvider } from "./holo-mail-provider.mjs";
import { makeMultiProvider } from "./holo-mail-multi.mjs";
import { attachMailEngine } from "./holo-mail-engine.mjs";
import { mountMailUI } from "./holo-mail-ui.mjs";
import { makeOnboarding } from "./holo-mail-onboard.mjs";
import { mountOnboard } from "./holo-mail-onboard-ui.mjs";
import { makeMailHealth } from "./holo-mail-health.mjs";

const BASE = "http://127.0.0.1:8793";              // the primary bridge (account #1). More = more ports.
const SUPERVISOR = "http://127.0.0.1:8795";        // email-supervisor: spawns/owns one bridge per mailbox
const ACCOUNTS_KEY = "holo.mail.accounts";
// Each account is its own email-bridge instance on its own port (isolated state dir), spawned by the
// supervisor. The list is cached in localStorage so buildProvider() stays synchronous; the supervisor is the
// source of truth and we refresh from it whenever the inbox opens. The provider is ALWAYS the unified
// multi-provider, so the engine/UI work over one or many mailboxes unchanged.
const DEFAULT_ACCOUNTS = [{ id: "default", label: "", base: BASE }];
function loadAccounts() {
  try { const a = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "null"); if (Array.isArray(a) && a.length) return a; } catch {}
  return DEFAULT_ACCOUNTS.slice();
}
function saveAccounts(list) { try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list)); } catch {} }
const primaryBase = () => (loadAccounts()[0] || { base: BASE }).base;
const flagOn = () => { try { return localStorage.getItem("holo.mail.enabled") === "1" || /(?:^|[?&])mail=1(?:&|$)/.test(location.search); } catch { return false; } };

function buildProvider() {
  return makeMultiProvider({ accounts: loadAccounts().map((a) => ({ id: a.id, label: a.label, provider: makeMailProvider({ base: a.base }) })) });
}

// the supervisor's control API (loopback). Absent in the web preview / no-host dev - every call fails soft.
function supervisor(base = SUPERVISOR) {
  const j = async (p, init) => { const r = await fetch(base + p, init); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json(); };
  return {
    reachable: async () => { try { await j("/health"); return true; } catch { return false; } },
    accounts: () => j("/accounts"),
    add: (label) => j("/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }) }),
    remove: (id) => j("/accounts/" + encodeURIComponent(id), { method: "DELETE" }),
  };
}
// pull the authoritative account list from the supervisor into the local cache (so buildProvider sees it).
async function syncAccountsFromSupervisor() {
  try {
    const rows = await supervisor().accounts();
    if (Array.isArray(rows) && rows.length) saveAccounts(rows.map((r) => ({ id: r.id, label: r.label || "", base: r.base })));
    return rows;
  } catch { return null; }   // supervisor down → keep whatever's cached (single default account still works)
}

// Account management surface. add() asks the supervisor to spawn a fresh bridge, then walks the user through
// linking THAT mailbox; it then joins the unified inbox. Fallback (no supervisor): register a manual port.
if (typeof window !== "undefined") window.HoloMailAccounts = {
  list: () => loadAccounts(),
  refresh: () => syncAccountsFromSupervisor(),
  async add({ label = "", port, base } = {}) {
    if (await supervisor().reachable()) {
      const acct = await supervisor().add(label);                    // spawns the bridge on a fresh port
      await syncAccountsFromSupervisor();
      await addAccountFlow(acct.base);                               // link the new mailbox → unified inbox
      return loadAccounts();
    }
    // no supervisor: accept a manually-started bridge (EMAIL_BRIDGE_PORT=<port> node email-bridge.mjs)
    const b = base || (port ? `http://127.0.0.1:${port}` : null);
    if (!b) throw new Error("no supervisor - pass a port of a manually-started bridge");
    const list = loadAccounts();
    if (!list.some((a) => a.base === b)) { list.push({ id: "acct" + (list.length + 1), label, base: b }); saveAccounts(list); }
    await addAccountFlow(b);
    return loadAccounts();
  },
  async remove(id) {
    try { if (await supervisor().reachable()) await supervisor().remove(id); } catch {}
    const list = loadAccounts().filter((a) => a.id !== id); saveAccounts(list.length ? list : DEFAULT_ACCOUNTS.slice());
    if (overlay && overlay.style.display !== "none") openMail(true);
    return loadAccounts();
  },
  reset() { try { localStorage.removeItem(ACCOUNTS_KEY); } catch {} return loadAccounts(); },
};

// drive onboarding for a specific (freshly-spawned, unlinked) mailbox, then return to the unified inbox.
async function addAccountFlow(targetBase) {
  if (!overlay) await openMail();
  showOnboarding(buildProvider(), targetBase);
}

// a thin client over the loopback bridge (creds pass straight through, never stored here).
function bridgeClient(base) {
  const j = async (p, init) => { const r = await fetch(base + p, init); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json(); };
  return {
    status: () => j("/status"),
    login: (body) => j("/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  };
}

// build the inbox UI's `source` over the live provider corpus (filled by the bridge SSE stream).
function buildSource(provider) {
  return {
    async ids() {
      let list = []; try { list = await provider.listThreads(); } catch {}
      const ids = (list || []).map((s) => s.jid).filter(Boolean);
      if (ids.length) return ids;
      const seen = new Set(); provider.allMessages().forEach((m) => seen.add(m.threadId)); return [...seen];
    },
    meta(jid) {
      const msgs = provider.threadMessages(jid);
      const inbound = msgs.find((m) => !m.fromMe) || msgs[0] || {};
      const last = msgs[msgs.length - 1] || {};
      return { who: inbound.fromName || inbound.from || jid, subj: last.subject || inbound.subject || "(no subject)",
        account: provider.accountLabel ? provider.accountLabel(jid) : null,
        msgs: msgs.map((m) => ({ fromMe: m.fromMe, fromName: m.fromName || m.from, from: m.from, date: m.date, text: m.text })) };
    },
  };
}

let overlay = null, host = null, banner = null, ui = null, health = null;

const clearHost = () => { host.innerHTML = ""; host.className = ""; };

function showBanner(state) {
  if (!banner) return;
  if (state && state.needsReconnect) {
    banner.innerHTML = `<span>${state.message || "Reconnect needed."}</span><button class="hm-reconnect">Reconnect</button>`;
    banner.style.display = "flex";
    banner.querySelector(".hm-reconnect").onclick = () => { banner.style.display = "none"; showOnboarding(buildProvider()); };
  } else { banner.style.display = "none"; }
}

function showOnboarding(provider, targetBase = primaryBase()) {
  if (health) { health.stop(); health = null; }
  clearHost();
  const onboarding = makeOnboarding({ bridge: bridgeClient(targetBase) });
  mountOnboard(host, { onboarding, onLinked: () => showInbox(buildProvider()) });   // rebuild → include newly-linked account
}

async function showInbox(provider) {
  clearHost();
  const engine = await attachMailEngine({ base: primaryBase(), provider });   // real Q + window.HoloStrand
  try { await provider.connect(); } catch {}                          // live SSE stream (fans out to all accounts)
  await new Promise((r) => setTimeout(r, 600));                       // let first messages land
  ui = mountMailUI(host, { engine, source: buildSource(provider), foot: "On-device Q · sovereign κ",
    onSend: (jid, text) => { try { provider.sendReply({ chat: jid, text }); } catch {} } });
  // keep the mailbox healthy: a dropped/expired sign-in surfaces a reconnect banner instead of a dead inbox.
  health = makeMailHealth({ bridge: bridgeClient(primaryBase()) });
  health.start(showBanner);
}

export async function openMail(rebuild = false) {
  if (overlay && rebuild) { closeMail(); overlay.remove(); overlay = null; }   // re-render over a changed account set
  if (overlay) { overlay.style.display = "block"; return; }
  overlay = document.createElement("div");
  overlay.id = "holo-mail-overlay";
  overlay.style.cssText = "position:fixed;inset:0;z-index:2147482000;background:#0b0d10";
  banner = document.createElement("div");
  banner.style.cssText = "display:none;position:absolute;top:0;left:0;right:0;z-index:2147483001;align-items:center;justify-content:center;gap:12px;padding:9px 14px;background:#e6462e;color:#fff;font:600 13px system-ui";
  host = document.createElement("div"); host.style.cssText = "position:absolute;inset:0";
  const closer = document.createElement("button"); closer.textContent = "✕"; closer.title = "Close (Esc)";
  closer.style.cssText = "position:fixed;top:10px;right:14px;z-index:2147483002;border:0;background:#0006;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:15px";
  closer.onclick = closeMail;
  const reBtnCss = "border:0;background:#fff;color:#e6462e;border-radius:7px;padding:4px 12px;font:inherit;font-weight:700;cursor:pointer";
  const style = document.createElement("style"); style.textContent = `.hm-reconnect{${reBtnCss}}`; overlay.appendChild(style);
  overlay.append(host, banner, closer); document.body.appendChild(overlay);
  document.addEventListener("keydown", escClose);

  // refresh the account list from the supervisor (source of truth), then build the unified multi-provider.
  await syncAccountsFromSupervisor();
  const provider = buildProvider();
  let st = null; try { st = await bridgeClient(primaryBase()).status(); } catch {}
  if (st && st.linked) return showInbox(provider);
  showOnboarding(provider);
}

export function closeMail() { if (health) { health.stop(); health = null; } if (overlay) overlay.style.display = "none"; }
function escClose(e) { if (e.key === "Escape" && overlay && overlay.style.display !== "none" && !document.querySelector(".hm-scrim.on")) closeMail(); }

function addLauncher() {
  if (document.getElementById("holo-mail-launch")) return;
  const b = document.createElement("button");
  b.id = "holo-mail-launch"; b.title = "Holo Mail"; b.textContent = "✦";
  b.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:2147481000;width:44px;height:44px;border-radius:50%;border:0;cursor:pointer;color:#fff;font-size:18px;background:linear-gradient(135deg,#3b6ef5,#8a4fd6);box-shadow:0 6px 20px rgba(0,0,0,.35)";
  b.onclick = openMail; document.body.appendChild(b);
}

if (typeof window !== "undefined") {
  window.HoloMailOpen = openMail;
  window.HoloMailClose = closeMail;
  if (flagOn()) {
    if (document.readyState !== "loading") addLauncher();
    else document.addEventListener("DOMContentLoaded", addLauncher);
  }
}

export default { openMail, closeMail };
