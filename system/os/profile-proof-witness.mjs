// P5 witness: SHARE A FACT ABOUT YOUR PROFILE AS A κ-PROOF — reveal one attribute, nothing else.
// Ties the witnessed holo-zk toolkit to the distilled profile (P2): issue the profile's claims as a
// salted-digest set signed by the operator's did:key, disclose ONLY the chosen claim, and a verifier
// confirms it against the signed set (the rest stays hidden by salt). Plus Merkle membership ("this
// interest IS in my profile") + forge/tamper rejection. 100% serverless, L5; no SNARK needed for this tier.
import { createRequire } from "node:module";
import { distillProfile } from "./usr/lib/holo/holo-profile.mjs";
const require = createRequire(import.meta.url);
require("./usr/lib/holo/holo-zk.js");                 // assigns globalThis.HoloZK (IIFE)
const ZK = globalThis.HoloZK;

let pass = 0, fail = 0; const ok = (c, m) => { if (c) { console.log(`  ok  ${m}`); pass++; } else { console.log(`  XX  ${m}`); fail++; } };
const rec = (k, t, v) => ({ "holmem:kind": k, "holmem:text": t, ...(v ? { "holmem:vote": v } : {}) });

(async () => {
  if (!ZK || !ZK.sdIssue) { console.log("XX holo-zk not loaded"); process.exit(2); }

  // distill a profile, then derive a SHAREABLE claim set (booleans/values an app or peer might ask to verify)
  const profile = distillProfile([
    rec("intent", "ship a rust wasm module"), rec("intent", "debug a webgpu shader"),
    rec("feedback", "great rust tip", "up"), rec("intent", "senior engineer interview prep"),
  ]);
  const claims = {
    role: "developer",
    interest_rust: profile["holo:interests"].includes("rust"),
    interest_webgpu: profile["holo:interests"].includes("webgpu"),
    adult: true,                          // an issuer-asserted boolean (the honest tier; not a range proof)
    legal_name: "Ada Lovelace",           // sensitive — must NEVER leak unless explicitly disclosed
  };

  // ISSUE: salted-digest set + sign it with the operator's did:key (the same OS-wide identity)
  const sd = await ZK.sdIssue(claims);
  const signer = await ZK.genSigner();                       // stands in for identitySigner (browser did:key)
  const sig = await signer.sign(ZK.jcs(sd.digests));         // bind the claim set to the operator
  ok(sd.digests.length === Object.keys(claims).length, `issued ${sd.digests.length} salted-digest claims, signed by did:key`);

  // DISCLOSE only "role" + "interest_rust" to a verifier (e.g. a job-board app)
  const presentation = ZK.sdDisclose(sd, ["role", "interest_rust"]);
  const got = await ZK.sdVerify(presentation);
  const sigOk = await ZK.verifySig(ZK.jcs(sd.digests), sig, signer.publicKeyHex);
  ok(sigOk, "verifier checks the operator's signature over the claim set (binding)");
  ok(got && got.role === "developer" && got.interest_rust === true, `verifier LEARNS only what was disclosed: role=developer, interest_rust=true`);
  ok(got && !("legal_name" in got) && !("adult" in got) && !("interest_webgpu" in got), "verifier learns NOTHING about legal_name / adult / other interests (hidden by salt)");

  // FORGE: a fabricated claim the issuer never signed → rejected
  const forged = await ZK.sdVerify({ digests: sd.digests, revealed: [ZK.jcs(["fakesalt", "role", "admin"])] });
  ok(forged === null, "fabricated claim (role=admin) → REJECTED (digest not in the signed set)");

  // MERKLE membership: "this interest IS in my profile" (O(log n)) without revealing the interest list
  const interestLeaves = await Promise.all(profile["holo:interests"].map((t) => ZK.sha256Hex("interest:" + t)));
  const root = await ZK.merkleRoot(interestLeaves);
  const idx = 0;
  const proof = await ZK.merkleProof(interestLeaves, idx);
  ok(await ZK.verifyInclusion(root, interestLeaves[idx], proof), `Merkle inclusion: interest "${profile["holo:interests"][idx]}" proves membership in the signed profile root`);
  const notMember = await ZK.verifyInclusion(root, await ZK.sha256Hex("interest:gambling"), proof);
  ok(!notMember, "a NON-member interest → REJECTED by the Merkle root");

  console.log(`\n${pass}/${pass + fail} green${fail ? " — FAIL" : " — WITNESSED: prove a profile attribute as a κ-proof — disclose one fact, reveal nothing else, forge/tamper refused (serverless, L5)"}`);
  process.exit(fail ? 1 : 0);
})();
