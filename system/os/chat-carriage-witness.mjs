// P2 substrate: a chat travels on the Share carriage (ADR-0105). Seal a conversation into an IPFS κ-DAG,
// encode it as a self-contained #wks= resume link (NEVER hits a server), decode it, and restore through the
// SAME trustless gateway (L5 re-derives every block) → the exact conversation. This is the cross-device /
// IPFS transport for share-a-chat; the self-contained #chat= fragment already ships the serverless version.
import * as ws from "./sbin/holo-workspace-sync.mjs";
import { jcs } from "./usr/lib/holo/holo-uor.mjs";

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };

const conversation = { model: "Q", system: "You are a concise, helpful assistant.",
  messages: [{ role: "user", content: "What is the capital of France? One word." }, { role: "assistant", content: "Paris" }, { role: "user", content: "And Italy? One word." }] };
const manifest = { "@type": ["holo:SessionManifest"], "holo:kind": "holo:ChatShare", "holo:conversation": conversation };

// SEAL → κ-DAG (rootCid = content identity), then the self-contained link
const sealed = await ws.sealWorkspace({ manifest, transport: "link" });
console.log(`sealed chat → rootCid ${sealed.rootCid}  did ${String(sealed.did).slice(0, 28)}…  ${sealed.blocks.size} blocks`);
const link = ws.encodeResumeLink(sealed.rootCid, sealed.blocks);
ok(typeof link === "string" && link.length > 0, `#wks= resume link built (${link.length} B, self-contained — no server)`);

// RESTORE on a fresh side: decode the link, re-derive every block (L5), resolve the conversation
const dec = ws.decodeResumeLink(link);
ok(dec && dec.roots && dec.roots[0] === sealed.rootCid, "decoded link re-derives the SAME rootCid (content-addressed)");
const getBlock = ws.verifiedBlockSource(dec.blocks);     // L5: each block verified against its CID before serving
const restored = await ws.restoreWorkspace(dec.roots[0], getBlock);
ok(!!restored && !!restored.manifest, "restored the manifest through the trustless gateway (L5 every block)");
const rc = restored && restored.manifest["holo:conversation"];
ok(rc && jcs(rc) === jcs(conversation), "restored conversation == the original (exact, mid-thought)");

// tamper a block → restore must refuse (L5), not serve a wrong byte
let refused = false;
try {
  const tb = new Map(dec.blocks); const [cid, b] = [...tb][tb.size - 1]; const bad = b.slice(); bad[bad.length >> 1] ^= 0xff; tb.set(cid, bad);
  const r2 = await ws.restoreWorkspace(dec.roots[0], ws.verifiedBlockSource(tb));
  refused = !r2 || JSON.stringify(r2.manifest?.["holo:conversation"]) !== JSON.stringify(conversation);
} catch { refused = true; }
ok(refused, "tampered block → restore REFUSES (L5 fail-closed, no faked restore)");

console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: a chat rides the Share carriage (seal→#wks=→restore, L5)"}`);
process.exit(fail ? 1 : 0);
