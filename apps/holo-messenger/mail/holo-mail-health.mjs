// holo-mail-health.mjs - keeps a connected mailbox healthy. Polls the bridge /status, derives a plain-English
// health state, and fires onChange only on TRANSITIONS (ok → needs-reconnect → ok), so the UI can raise a
// gentle "reconnect" and Q can nudge - a dropped token or revoked password never becomes a dead inbox.
// Pure + injectable ({ bridge }); Node-gated by driving tick() over a mock bridge.

// derive(status) → { linked, health, account, needsReconnect, message }
export function derive(st) {
  const linked = !!(st && st.linked);
  const acct = st && st.accounts && st.accounts[0];
  const health = acct ? (acct.health || (linked ? "ok" : "unlinked")) : (linked ? "ok" : "unlinked");
  const needsReconnect = health === "auth-error";
  return {
    linked, health, account: acct ? acct.email : null, needsReconnect,
    message: needsReconnect ? "Reconnect needed. Your mailbox sign-in expired or was revoked." : (health === "unlinked" ? "No mailbox connected." : null),
  };
}

const changed = (a, b) => !a || a.health !== b.health || a.needsReconnect !== b.needsReconnect || a.linked !== b.linked;

export function makeMailHealth({ bridge, intervalMs = 15000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = null, running = false;

  async function tick(onChange) {
    let st = null; try { st = await bridge.status(); } catch { st = null; }
    const s = derive(st);
    if (changed(last, s)) { last = s; if (onChange) { try { onChange(s); } catch {} } }
    return s;
  }

  async function start(onChange) {
    if (running) return; running = true;
    await tick(onChange);
    (async function loop() {
      while (running) { await sleep(intervalMs); if (!running) break; await tick(onChange); }
    })();
  }
  function stop() { running = false; }

  return { start, stop, tick, state: () => last, derive };
}

export default { makeMailHealth, derive };
