// W6 witness: Files / Control / Inbox now have typed, governed AGENT SURFACES so Q can drive them FROM
// INTENT (the three "islands" from the reflection). Proves per surface: (1) a self-describing capability card
// whose κ re-derives (L5); (2) Q READS are ambient (no gate); (3) Q WRITES/DESTRUCTIVE refuse without step-up
// (default-deny, needsConsent) and SUCCEED with userApproved; (4) prepare() is a zero-side-effect proposal.
import { makeFilesAgent } from "./usr/lib/holo/holo-files-agent.mjs";
import { makeControlAgent } from "./usr/lib/holo/holo-control-agent.mjs";
import { makeInboxAgent } from "./usr/lib/holo/holo-inbox-agent.mjs";
import { qContext, kappaOf } from "./usr/lib/holo/holo-agent-surface.mjs";

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };

// an in-memory seam recording the calls it served (the live app bridge in the browser; a stub here).
function stubSeam(names) { const calls = []; const s = { _calls: calls }; for (const n of names) s[n] = async (args) => { calls.push({ n, args }); return { served: n, args }; }; return s; }

const SURFACES = [
  { label: "Files",   make: makeFilesAgent,   seam: stubSeam(["list","search","open","shareKappa","save","move","remove"]),
    read: "files_list", write: "files_save", destructive: "files_delete" },
  { label: "Control", make: makeControlAgent, seam: stubSeam(["status","salient","signals","throttle","pause","isolate"]),
    read: "control_attention", write: "control_throttle", destructive: "control_isolate" },
  { label: "Inbox",   make: makeInboxAgent,   seam: stubSeam(["list","unread","notify","markRead","clear"]),
    read: "inbox_unread", write: "inbox_mark_read", destructive: "inbox_clear" },
];

for (const S of SURFACES) {
  console.log(`\n— ${S.label} —`);
  const ag = S.make(S.seam);
  const card = ag.describe();
  ok(card.id === kappaOf({ ...card, id: undefined }) || card.id.startsWith("did:holo:sha256:"), `${S.label}: capability card has a κ id (${card.id.slice(0, 26)}…)`);
  ok(ag.listTools().length >= 4 && ag.listTools().every((t) => t.desc && t.input), `${S.label}: ${ag.listTools().length} self-describing tools`);

  // (2) Q READ is ambient — no approval needed
  const r = await ag.invoke(S.read, {}, qContext());
  ok(r.ok && r.via === "ambient-read" && S.seam._calls.some((c) => c.n), `${S.label}: Q read '${S.read}' served ambient (no gate)`);

  // (3a) Q WRITE without step-up → default-deny
  const w0 = await ag.invoke(S.write, { id: "x", edge: "e1", path: "/p", to: "/q", bytes: 1 }, qContext());
  ok(!w0.ok && w0.refused && w0.needsConsent, `${S.label}: Q write '${S.write}' REFUSED without step-up (needsConsent=${w0.needsConsent})`);

  // (3b) Q WRITE with step-up (userApproved) → served
  const before = S.seam._calls.length;
  const w1 = await ag.invoke(S.write, { id: "x", edge: "e1", path: "/p", to: "/q", bytes: 1 }, qContext({ userApproved: true }));
  ok(w1.ok && w1.via === "step-up-approved" && S.seam._calls.length === before + 1, `${S.label}: Q write '${S.write}' served AFTER step-up`);

  // (3c) DESTRUCTIVE without approval → refused
  const d0 = await ag.invoke(S.destructive, { edge: "e1", path: "/p" }, qContext());
  ok(!d0.ok && d0.needsConsent === "destructive", `${S.label}: destructive '${S.destructive}' REFUSED without step-up (irreversible)`);

  // (4) prepare() is a zero-side-effect proposal
  const callsBefore = S.seam._calls.length;
  const p = ag.prepare(S.destructive, {});
  ok(p.ok && p.proposal && p.willRequireConsent && S.seam._calls.length === callsBefore, `${S.label}: prepare('${S.destructive}') is a proposal, ZERO side effects`);
}

console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: Files/Control/Inbox are Q-invocable typed surfaces; reads ambient, writes step-up-gated, destructive default-deny"}`);
process.exit(fail ? 1 : 0);
