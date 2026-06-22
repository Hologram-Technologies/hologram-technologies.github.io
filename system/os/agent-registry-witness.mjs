// Witness the unified agent REGISTRY: every app surface registers once; Q gets ONE flat tool menu and
// routes a tool call BY NAME to the owning surface, which still governs it. Proves: all surfaces' tools in
// one menu (with a re-derivable κ); ownerOf routing; invoke routes + governs (ambient read, step-up write,
// destructive default-deny); unknown tool refuses; prepare routes as a zero-side-effect proposal.
import { register, surfaces, ownerOf, listAllTools, toolMenu, invoke, prepare } from "./usr/lib/holo/holo-agent-registry.mjs";
import { makeFilesAgent } from "./usr/lib/holo/holo-files-agent.mjs";
import { makeControlAgent } from "./usr/lib/holo/holo-control-agent.mjs";
import { makeInboxAgent } from "./usr/lib/holo/holo-inbox-agent.mjs";
import { qContext } from "./usr/lib/holo/holo-agent-surface.mjs";

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
const stub = (names) => { const c = []; const s = { _c: c }; for (const n of names) s[n] = async (a) => { c.push(n); return { served: n }; }; return s; };

register("files",   makeFilesAgent(stub(["list","search","open","shareKappa","save","move","remove"])));
register("control", makeControlAgent(stub(["status","salient","signals","throttle","pause","isolate"])));
register("inbox",   makeInboxAgent(stub(["list","unread","notify","markRead","clear"])));

ok(surfaces().length === 3 && surfaces().join(",") === "files,control,inbox", `3 surfaces registered: ${surfaces().join(", ")}`);
const all = listAllTools();
ok(all.length === 18 && all.every((t) => t.surface && t.name && t.desc), `ONE flat menu of ${all.length} tools, each tagged with its surface`);
ok(ownerOf("control_attention") === "control" && ownerOf("inbox_clear") === "inbox" && ownerOf("files_open") === "files", "ownerOf routes each tool to the right surface");
const menu = toolMenu();
ok(menu.id.startsWith("did:holo:sha256:") && menu.tools.length === 18, `toolMenu has a κ id (${menu.id.slice(0, 26)}…) over all ${menu.tools.length} tools`);

// route by name + govern
const r = await invoke("control_attention", {}, qContext());
ok(r.ok && r.via === "ambient-read", "invoke('control_attention') routed to control, served ambient (Q read)");
const w0 = await invoke("inbox_clear", {}, qContext());
ok(!w0.ok && w0.needsConsent === "destructive", "invoke('inbox_clear') routed to inbox, REFUSED without step-up (destructive)");
const w1 = await invoke("inbox_clear", {}, qContext({ userApproved: true }));
ok(w1.ok && w1.via === "step-up-approved", "invoke('inbox_clear') served AFTER step-up");
const unk = await invoke("teleport_me", {}, qContext());
ok(!unk.ok && /no registered surface/.test(unk.reason), "unknown tool → default-deny (no surface owns it)");
const p = prepare("files_delete", { path: "/x" });
ok(p.ok && p.proposal && p.willRequireConsent, "prepare('files_delete') routed → zero-side-effect proposal");

console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: ONE registry, ONE tool menu (κ), name-routed + governed — the substrate Q's intent→tool layer plugs into"}`);
process.exit(fail ? 1 : 0);
