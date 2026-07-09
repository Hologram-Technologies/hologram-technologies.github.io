// holo-mail-health.gate.mjs - M4/F gate: derive() + transition-only onChange over a mock bridge. No network.
//   run:  node holo-mail-health.gate.mjs
import { makeMailHealth, derive } from "./holo-mail-health.mjs";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("  ✗ " + name); } };

// derive()
ok("healthy account → ok, no reconnect", (() => { const s = derive({ linked: true, accounts: [{ email: "me@x.io", health: "ok" }] }); return s.linked && s.health === "ok" && !s.needsReconnect; })());
ok("auth-error → needsReconnect + message", (() => { const s = derive({ linked: false, accounts: [{ email: "me@x.io", health: "auth-error" }] }); return s.needsReconnect && /Reconnect needed/.test(s.message); })());
ok("no account → unlinked", (() => { const s = derive({ linked: false, accounts: [] }); return s.health === "unlinked" && !s.needsReconnect; })());

// transition-only onChange: ok → auth-error → ok fires exactly 3 times (initial + 2 transitions), not on repeats
{
  const seq = [
    { linked: true, accounts: [{ email: "me@x.io", health: "ok" }] },
    { linked: true, accounts: [{ email: "me@x.io", health: "ok" }] },   // repeat - no fire
    { linked: false, accounts: [{ email: "me@x.io", health: "auth-error" }] }, // fire
    { linked: false, accounts: [{ email: "me@x.io", health: "auth-error" }] }, // repeat - no fire
    { linked: true, accounts: [{ email: "me@x.io", health: "ok" }] },   // fire (recovery)
  ];
  let i = 0;
  const bridge = { async status() { return seq[Math.min(i++, seq.length - 1)]; } };
  const h = makeMailHealth({ bridge });
  const fires = [];
  for (let k = 0; k < seq.length; k++) await h.tick((s) => fires.push(s.needsReconnect));
  ok("fires only on transitions (3x: init, break, recover)", fires.length === 3);
  ok("transition sequence is ok→break→recover", fires[0] === false && fires[1] === true && fires[2] === false);
}

// status() failure (bridge down) → treated as unlinked, no throw
{
  const h = makeMailHealth({ bridge: { async status() { throw new Error("down"); } } });
  let got = null; await h.tick((s) => { got = s; });
  ok("bridge down → graceful unlinked (no throw)", got && got.linked === false && got.needsReconnect === false);
}

console.log(`\nholo-mail-health gate: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
