// B1 witness: the "prove X to this app/person" flow. Assemble a credential, CONSENT (gate names exactly what
// is shared + with whom), disclose ONLY the consented attribute as a κ-proof + self-contained link; the
// recipient decodes + verifies, learning only that fact. Without consent → refused (no proof). The biometric
// step-up is the prod gate (OUT-OF-BAND); here the gate is a stub so the assemble→consent→prove→verify path
// + the honest consent payload are witnessed.
import { shareProof, decodeProofLink, verifyProof, operatorSigner } from "./usr/lib/holo/holo-proof.mjs";

let pass = 0, fail = 0; const ok = (c, m) => { console.log((c ? "  ok  " : "  XX  ") + m); c ? pass++ : fail++; };
const claims = { adult: true, role: "developer", legal_name: "Ada", balance: 5000 };
const signer = await operatorSigner();

// CONSENT GRANTED → a κ-proof disclosing only "adult", shared with "job-board"
let seen = null; const okGate = async (a) => { seen = a; return { ok: true }; };
const res = await shareProof({ claims, attributes: ["adult"], audience: "job-board", signer, gate: okGate });
ok(res.ok && res.proof && res.link.startsWith("#proof="), "share → κ-proof + self-contained link");
ok(seen && seen.kind === "proof.share" && seen.attributes.join() === "adult" && seen.audience === "job-board", "consent NAMES exactly what is shared (adult) + with whom (job-board)");
ok(/nothing else is revealed/.test(seen.reason), "consent reason is plain + honest: " + JSON.stringify(seen.reason).slice(0, 60));

// recipient: decode the link → verify → learns ONLY adult
const decoded = decodeProofLink(res.link);
const v = await verifyProof(decoded);
ok(v && v.ok && v.claims.adult === true, "recipient verifies → learns adult=true");
ok(v && !("legal_name" in v.claims) && !("balance" in v.claims) && !("role" in v.claims), "recipient learns NOTHING else (legal_name/balance/role hidden)");

// CONSENT DENIED → refused, NO proof produced (consent is the only egress)
const denied = await shareProof({ claims, attributes: ["adult"], audience: "spam", signer, gate: async () => ({ ok: false, reason: "user declined" }) });
ok(!denied.ok && denied.refused && !denied.proof, "consent DENIED → refused, no proof leaves (consent gates egress)");

console.log(`\n${pass}/${pass + fail}${fail ? " FAIL" : " — WITNESSED B1: prove X to an audience as a κ-proof; consent names+gates the disclosure; recipient learns only the fact"}`);
process.exit(fail ? 1 : 0);
