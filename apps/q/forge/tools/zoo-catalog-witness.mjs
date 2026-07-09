// zoo-catalog-witness.mjs — A1/A3: the catalog + drop-in + frame-gating + tamper-refusal that make the zoo
// "100% wired" safely. Proves: (1) an empty catalog routes to base (current behavior, never blank); (2) DROPPING
// an entry (skill → adapter κ) makes it resolve with NO code change — the loader re-reads the catalog; (3) a wrong
// base or frame is REFUSED (an incompatible delta never binds — dims wouldn't align); (4) a sealed adapter .holo
// round-trips, and a single tampered byte is L5-REFUSED on open (fail-closed). Pure Node, no GPU.

import { resolveAdapter } from "../../../../../holo-os/system/os/usr/lib/holo/q/holo-q-adapters.mjs";
import { genTestAdapter, sealAdapterHolo, openAdapterHolo, adapterKappa } from "../gpu/holo-lora.mjs";
import { sha256hex } from "../../../../../holo-os/system/os/usr/lib/holo/holo-uor.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };

const BASE = "qwen2.5-0.5b", FRAME = "qwen25-05b-f1";

// ── (1) empty catalog → null ⇒ base-only (the safe default; the zoo never makes Q worse than no zoo) ──
{
  const empty = {};
  ok(resolveAdapter("respond", { baseModel: BASE, baseFrame: FRAME }, empty) === null, "empty catalog → null (base-only, never blank)");
}

// ── (2) DROP-IN: add one entry to the catalog object → it resolves with no other change ──
const catalog = {};
{
  ok(resolveAdapter("code", { baseModel: BASE }, catalog) === null, "before drop-in: skill 'code' → null");
  // a deployer drops the specialist's κ into the catalog (this is the whole "add a specialist" gesture):
  catalog["code"] = { adapter: "did:holo:sha256:" + "c0de".padEnd(64, "0"), base: BASE, frame: FRAME, target: "attn_q" };
  ok(resolveAdapter("code", { baseModel: BASE, baseFrame: FRAME }, catalog) === catalog["code"].adapter, "after drop-in: skill 'code' → its adapter κ (picked up, no code change)");
}

// ── (3) FRAME/BASE GATING: an incompatible adapter is REFUSED (returns null), never bound ──
{
  ok(resolveAdapter("code", { baseModel: "other-model", baseFrame: FRAME }, catalog) === null, "wrong base model → null (REFUSED)");
  ok(resolveAdapter("code", { baseModel: BASE, baseFrame: "different-frame" }, catalog) === null, "wrong frame fingerprint → null (REFUSED — dims wouldn't align)");
  ok(resolveAdapter("nope", { baseModel: BASE, baseFrame: FRAME }, catalog) === null, "unknown skill → null (base-only)");
}

// ── (4) a sealed adapter .holo round-trips; a tampered byte is L5-REFUSED on open ──
{
  const ad = genTestAdapter({ seed: 3, inn: 896, out: 896, r: 8, nLayer: 24, scale: 1.0, amp: 0.02 });
  const s = sealAdapterHolo(ad, sha256hex);
  const opened = openAdapterHolo(s.holo);
  ok(opened.target === "attn_q" && opened.r === 8 && opened.nLayer === 24, "sealed adapter .holo opens with intact frame");
  const k = await adapterKappa(ad, sha256hex);
  ok(/^sha256:/.test(k), `adapter content-κ derives (${k.slice(0, 22)}…)`);
  const bad = s.holo.slice(); bad[Math.floor(bad.length / 2)] ^= 0xff;   // flip one body byte
  let refused = false; try { openAdapterHolo(bad); } catch (e) { refused = /tamper|REFUSE|mismatch/i.test(String(e)); }
  ok(refused, "tampered adapter .holo is L5-REFUSED on open (fail-closed)");
}

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED: the zoo catalog routes a skill to its adapter κ, picks up a dropped-in specialist with no code change, REFUSES an incompatible base/frame, and a tampered adapter never opens — safe by construction."}`);
process.exit(fail ? 1 : 0);
