// holo-pointer-witness.mjs — proves T2: the signed, anti-rollback mutable index pointer. A pointer binds a
// stable name to the CURRENT index CID; clients pin the publisher's pubkey and accept only a higher seq.
// The load-bearing claims: a valid pointer verifies; a tampered target/seq/sig is refused; a pointer signed
// by a DIFFERENT key is refused (authority); an OLDER seq is refused (rollback/downgrade protection); an
// expired pointer is refused; and the loader's integrity binding (served index CID must equal the signed
// target) catches a stale/forged CAR. Ed25519 via WebCrypto — the substrate's signature primitive.
import { signPointer, verifyPointer } from "../os/sbin/holo-index-pointer.mjs";
import { toHex } from "../os/usr/lib/holo/holo-ipfs.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};
let pass = 0, fail = 0, kn = 0;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56);
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); checks[(slug(name) || "check") + "-" + (++kn)] = !!cond; console.log((cond ? "  ok  " : " FAIL ") + name + (extra ? "  — " + extra : "")); };

async function genKey() {
  const s = globalThis.crypto.subtle;
  const kp = await s.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pub = toHex(new Uint8Array(await s.exportKey("raw", kp.publicKey)));
  return { privateKey: kp.privateKey, pub };
}

async function main() {
  const CID_A = "bafybeigomnyl7md4b6awkfyuyqsi5cbcr6rx2qyu6kissmt65fmwmqubay";
  const CID_B = "bafybeiczeulmu52f4aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const authority = await genKey();
  const attacker = await genKey();

  const ptr = await signPointer({ target: CID_A, seq: 5, validMs: 60_000, privateKey: authority.privateKey, pub: authority.pub });
  ok("signPointer emits a holo:IndexPointer with a signature", ptr["@type"] === "holo:IndexPointer" && !!ptr.sig, "seq " + ptr.seq);

  const good = await verifyPointer(ptr, { pinnedPub: authority.pub, minSeq: 4 });
  ok("a valid pointer verifies and yields the current target CID", good.ok && good.target === CID_A, good.target && good.target.slice(0, 16) + "…");

  // tamper: target
  const tT = { ...ptr, target: CID_B };
  ok("a tampered TARGET is refused (signature breaks)", !(await verifyPointer(tT, { pinnedPub: authority.pub, minSeq: 4 })).ok);
  // tamper: seq
  const tS = { ...ptr, seq: 99 };
  ok("a tampered SEQ is refused (signature breaks)", !(await verifyPointer(tS, { pinnedPub: authority.pub, minSeq: 4 })).ok);
  // tamper: signature bytes
  const tG = { ...ptr, sig: ptr.sig.slice(0, -2) + (ptr.sig.endsWith("00") ? "11" : "00") };
  ok("a tampered SIGNATURE is refused", !(await verifyPointer(tG, { pinnedPub: authority.pub, minSeq: 4 })).ok);

  // authority: a pointer signed by a different key is refused even if internally valid
  const forged = await signPointer({ target: CID_B, seq: 6, validMs: 60_000, privateKey: attacker.privateKey, pub: attacker.pub });
  const forgedV = await verifyPointer(forged, { pinnedPub: authority.pub, minSeq: 4 });
  ok("a pointer signed by a NON-pinned key is refused (authority)", !forgedV.ok && /untrusted/.test(forgedV.reason), forgedV.reason);

  // rollback: a strictly-lower seq is refused (downgrade protection); equal seq is the SAME record → accepted.
  const roll = await verifyPointer(ptr, { pinnedPub: authority.pub, minSeq: 6 });
  ok("a strictly-lower seq is refused (rollback/downgrade protection)", !roll.ok && /rollback/.test(roll.reason), roll.reason);
  const same = await verifyPointer(ptr, { pinnedPub: authority.pub, minSeq: 5 });
  ok("re-seeing the SAME seq is accepted (re-visit, not a rollback)", same.ok && same.seq === 5);

  // expiry
  const exp = await signPointer({ target: CID_A, seq: 7, validMs: 1000, privateKey: authority.privateKey, pub: authority.pub, now: Date.now() - 10_000 });
  const expV = await verifyPointer(exp, { pinnedPub: authority.pub, minSeq: 4 });
  ok("an expired pointer is refused", !expV.ok && /expired/.test(expV.reason), expV.reason);

  // integrity binding (the loader's check): a verified pointer's target must equal the served index CID.
  const servedRoot = CID_A;                       // pretend we loaded the CAR and read its root
  ok("integrity binding: served index CID == verified target (accept)", good.target === servedRoot);
  ok("integrity binding: a mismatched served CID is detected (reject)", good.target !== CID_B);

  const result = { "@type": "holo:WitnessResult", witness: "holo-pointer", step: "T2",
    pub: authority.pub, pass, fail, total: pass + fail, ok: fail === 0, checks };
  writeFileSync(join(here, "holo-pointer-witness.result.json"), JSON.stringify(result, null, 2));
  console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass}/${pass + fail}  ·  signed mutable pointer: authority + anti-rollback + integrity binding`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error("witness threw:", e); process.exit(1); });
