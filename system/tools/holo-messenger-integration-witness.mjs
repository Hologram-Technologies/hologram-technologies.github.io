#!/usr/bin/env node
// holo-messenger-integration-witness.mjs — THE LAST WIRINGS, end-to-end, proven in pure Node.
//
// Closes three of the four honest boundaries left after the per-layer witnesses:
//   SECURE   — the live stream now carries CIPHERTEXT: a captured message is sealed under the
//              conversation's PQ epoch key, framed, forwarded by a content-blind relay (no
//              plaintext on the wire), then opened + re-verified before ingest. A non-member key
//              cannot open it (fail-closed).
//   CHANNEL  — over a REAL BroadcastChannel (Node's global, two independent peers), a sealed
//              message published by peer A is received, opened and ingested by peer B — real
//              cross-context delivery, not an in-page stand-in.
//   CAPTURE  — installBridgeCapture, run against a rendered WhatsApp-shaped DOM, lifts the bubble
//              into a κ and drives it through the sealed stream into the inbox (rendered tab →
//              κ → sealed → delivered → verified → ingested), end to end.
//
//   node tools/holo-messenger-integration-witness.mjs
//
// Authority: holo-apps §2.6/§2.8 · holospaces SEC-1/SEC-7 · holo-pqc (hybrid KEM + AEAD) · Law L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { conversationGenesis, makeThread } from "../os/usr/lib/holo/holo-messenger-thread.mjs";
import { makeSecureLink } from "../os/usr/lib/holo/holo-messenger-secure.mjs";
import { newEpoch, unwrapEpochKey } from "../os/usr/lib/holo/holo-messenger-epoch.mjs";
import { kemKeygen } from "../os/usr/lib/holo/holo-pqc.mjs";
import { installBridgeCapture, resolveAdapter } from "../os/usr/lib/holo/holo-bridge-adapters.mjs";
import { mint } from "../os/usr/lib/holo/holo-pluck.mjs";
import { decodeMsg, OP } from "../os/sbin/holo-wire.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const dec = new TextDecoder();
let tick = 0; const now = () => `2026-06-23T14:00:${String(tick++).padStart(2, "0")}.000Z`;

// ── minimal controlled DOM (same querySelector grammar the in-page adapter uses) ──
function parseSimple(t) { const tag = (/^([a-zA-Z*][\w-]*)/.exec(t) || [])[1]; const classes = [...t.matchAll(/\.([\w-]+)/g)].map((m) => m[1]); const attrs = [...t.matchAll(/\[([\w-]+)(?:(\^=|\$=|\*=|=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g)].map((m) => ({ name: m[1], op: m[2] || null, val: m[3] != null ? m[3] : m[4] != null ? m[4] : m[5] != null ? m[5] : null })); return { tag, classes, attrs }; }
function matchSimple(n, s) { if (s.tag && s.tag !== "*" && (n.tag || "").toLowerCase() !== s.tag.toLowerCase()) return false; for (const c of s.classes) if (!n.classList.includes(c)) return false; for (const a of s.attrs) { const v = n.getAttribute(a.name); if (a.op == null) { if (v == null) return false; continue; } if (v == null) return false; if (a.op === "=" && v !== a.val) return false; if (a.op === "^=" && !v.startsWith(a.val)) return false; if (a.op === "$=" && !v.endsWith(a.val)) return false; if (a.op === "*=" && !v.includes(a.val)) return false; } return true; }
function matchChain(n, ch) { if (!matchSimple(n, ch[ch.length - 1])) return false; let i = ch.length - 2, p = n.parent; while (i >= 0 && p) { if (matchSimple(p, ch[i])) i--; p = p.parent; } return i < 0; }
function descendants(r) { const o = []; (function w(n) { for (const c of n.children) { o.push(c); w(c); } })(r); return o; }
function qsa(root, sel) { const cands = descendants(root), res = [], seen = new Set(); const chains = sel.split(",").map((p) => p.trim().split(/\s+/).filter(Boolean).map(parseSimple)).filter((c) => c.length); for (const n of cands) for (const ch of chains) { if (!seen.has(n) && matchChain(n, ch)) { seen.add(n); res.push(n); break; } } return res; }
function h(tag, attrs = {}, kids = []) { const n = { tag, _a: { ...attrs }, children: [], parent: null, _t: null }; if (typeof kids === "string") n._t = kids; else for (const k of kids) { k.parent = n; n.children.push(k); } n.classList = String(n._a.class || "").split(/\s+/).filter(Boolean); n.getAttribute = (x) => (x in n._a ? String(n._a[x]) : null); n.querySelectorAll = (s) => qsa(n, s); n.querySelector = (s) => qsa(n, s)[0] || null; Object.defineProperty(n, "textContent", { get() { return n._t != null ? n._t : n.children.map((c) => c.textContent).join(""); } }); Object.defineProperty(n, "innerText", { get() { return n.textContent; } }); return n; }

const op = await enroll({ label: "integration-tester", passphrase: "correct horse battery" });
const genesis = conversationGenesis({ platform: "whatsapp", chat: "Ilya" });
const member = (() => { const kp = kemKeygen(); return { kappa: op.kappa, pub: kp.pub, sk: kp.sk }; })();
const stranger = (() => { const kp = kemKeygen(); return { kappa: "did:holo:member:stranger", pub: kp.pub, sk: kp.sk }; })();
const epoch = await newEpoch({ genesis, members: [member], seq: 0 });
const epochKey = await unwrapEpochKey(epoch.meta, member);

// ════ A · SECURE — the stream carries ciphertext; opened + verified before ingest ════
const threadB = makeThread({ genesis, now, signer: op });
const wireFrames = [];
const linkA = makeSecureLink({ genesis, epoch, send: (f) => wireFrames.push(f) });          // platform tab (sealer)
const linkB = makeSecureLink({ genesis, epoch, epochKey, thread: threadB });                  // inbox (opener)
const PLAIN = "The future is light photonics. HOLOGRAM.";
const obj = mint({ text: PLAIN, sender: "Ilya", sentAt: "08:31", chat: "Ilya", source: "web.whatsapp.com" }).object;
await linkA.publishSecure(obj);
const frame = wireFrames[0];
const decoded = decodeMsg(frame);
const wireText = dec.decode(frame);
linkB.receive(frame);
await new Promise((r) => setTimeout(r, 30));
const bView = threadB.view();
ok("secure-stream-ciphertext-on-wire",
  decoded.op === OP.PUT && decoded.topic === genesis &&
  !wireText.includes(PLAIN) && !wireText.includes("schema:text") &&     // a relay sees NO plaintext
  bView.length === 1 && bView[0].kappa === obj.id && bView[0].text === PLAIN,   // opened + verified + ingested
  `wire ${frame.length}B opaque → ingested ${bView.length}`);

// a non-member key cannot open the same frame (fail-closed)
const strangerKey = (await newEpoch({ genesis, members: [stranger], seq: 7 })).key;   // a DIFFERENT epoch key
let refusedWhy = null;
const linkStranger = makeSecureLink({ genesis, epoch, epochKey: strangerKey, thread: makeThread({ genesis, now }), onRefused: (w) => { refusedWhy = w; } });
linkStranger.receive(frame);
await new Promise((r) => setTimeout(r, 30));
ok("non-member-cannot-open", refusedWhy !== null, refusedWhy || "opened (LEAK!)");

// ════ B · CHANNEL — real BroadcastChannel, two independent peers converge ════
const NAME = "holo-messenger-integration-witness";
const bcA = new BroadcastChannel(NAME);
const bcB = new BroadcastChannel(NAME);
const threadB2 = makeThread({ genesis, now, signer: op });
const got = new Promise((resolve) => {
  const linkPeerB = makeSecureLink({ genesis, epoch, epochKey, thread: threadB2, onRender: () => resolve(true) });
  bcB.onmessage = (e) => linkPeerB.receive(e.data);
});
const linkPeerA = makeSecureLink({ genesis, epoch, send: (f) => bcA.postMessage(f) });
const objCh = mint({ text: "delivered over a real BroadcastChannel", sender: "Ilya", sentAt: "08:40", chat: "Ilya", source: "web.whatsapp.com" }).object;
await linkPeerA.publishSecure(objCh);
const arrived = await Promise.race([got, new Promise((r) => setTimeout(() => r(false), 1500))]);
bcA.close(); bcB.close();
ok("real-broadcastchannel-converges",
  arrived === true && threadB2.view().some((m) => m.kappa === objCh.id && m.text === "delivered over a real BroadcastChannel"),
  `peerB msgs=${threadB2.view().length}`);

// ════ C · CAPTURE — installBridgeCapture lifts a rendered WhatsApp bubble into the sealed stream ════
const waDoc = h("div", {}, [
  h("header", {}, [h("div", { role: "button" }, [h("span", { title: "Ilya" }, "Ilya")])]),
  h("div", { class: "message-in" }, [
    h("div", { class: "copyable-text", "data-pre-plain-text": "[08:55, 6/23/2026] Ilya: " }, [
      h("span", { class: "selectable-text" }, "captured live from the rendered tab"),
    ]),
  ]),
]);
ok("adapter-resolves-for-tab", resolveAdapter("web.whatsapp.com")?.id === "whatsapp");
const threadC = makeThread({ genesis, now, signer: op });
const linkC = makeSecureLink({ genesis, epoch, epochKey, thread: threadC });
const linkCsend = makeSecureLink({ genesis, epoch, send: (f) => linkC.receive(f) });   // tab → (sealed) → inbox
let capturedInput = null;
installBridgeCapture({
  doc: waDoc, loc: { hostname: "web.whatsapp.com" },
  onMessage: async (input) => { capturedInput = input; await linkCsend.publishSecure(mint(input).object); },
});
await new Promise((r) => setTimeout(r, 40));
const cView = threadC.view();
ok("installBridgeCapture-rendered-to-ingested",
  capturedInput && capturedInput.text === "captured live from the rendered tab" && capturedInput.sender === "Ilya" &&
  cView.length === 1 && cView[0].text === "captured live from the rendered tab",
  `captured="${capturedInput && capturedInput.text}" → ingested ${cView.length}`);

await forget(op.kappa).catch(() => {});

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "SECURE — the live stream carries a ciphertext envelope (no plaintext on the wire); the inbox opens it under the PQ epoch key and re-verifies the content κ before ingest; a non-member key cannot open it (fail-closed)",
    "NON-MEMBER — a wrong/other epoch key is refused fail-closed; the message is never ingested or rendered",
    "CHANNEL — over a real BroadcastChannel (two independent peers), a sealed message published by A is received, opened and ingested by B — real cross-context delivery",
    "CAPTURE — installBridgeCapture run over a rendered WhatsApp-shaped DOM lifts the bubble into a κ and drives it through the sealed stream into the inbox, end to end",
  ],
  genesis, epoch: epoch.id,
  checks, failed: fail,
  authority: "holo-apps §2.6/§2.8 · holospaces SEC-1/SEC-7 · holo-pqc (X25519‖ML-KEM-1024 + AES-256-GCM) · Law L5",
};
writeFileSync(join(here, "holo-messenger-integration-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Messenger integration witness — sealed stream · real channel · live capture\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  epoch ${epoch.id.slice(-12)} · ciphertext on the wire · real BroadcastChannel · installBridgeCapture`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
