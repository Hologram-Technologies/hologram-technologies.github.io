// holo-swarm.mjs — ATTESTED PEER COMPUTE (Confidential Swarm, Phase C). A holospace that cannot finish
// a workload alone RECRUITS a second attested device to run part of it — with NO central orchestrator,
// and accepts the result only after verifying the peer ran the agreed work (verify-before-accept).
//
// This is Super Swarm's shape (self-organising attested peers, leader election, regroup-on-drop) with
// the TRUST kept in κ + L5, not a chain. It composes the earlier phases and adds three pure pieces:
//
//   1. WORK ORDER — a content-addressed description of WHAT to compute ({op, inputs κs, params}). Its κ
//      is the agreement object; both peers attest it (Phase B co-attestation = admission to the session).
//   2. LEADERLESS ELECTION — a κ-seeded VRF: each peer's "ticket" = addressOf(canon([session,round,peer])).
//      The lowest ticket leads. Every peer computes the SAME leader from public κs alone (no orchestrator),
//      and anyone can re-derive and verify it (Law L5). regroup() drops a peer and re-elects in a new round.
//   3. CONFIDENTIAL DISPATCH + VERIFY-BEFORE-ACCEPT — the input is SEALED (AES-GCM) so the worker's HOST
//      sees only ciphertext; the worker returns the output κ plus an attestation that THIS work κ produced
//      THIS output κ. The requester re-derives the expected (work→output) subject and verifies the
//      attestation before accepting — a forged / wrong / tampered result is refused.
//
// One addressing path (Law L4): canon/addressOf from holo-identity. Built on CC-56 (attest) + CC-57
// (coAttest). Pure + isomorphic (Node-witnessable); fail-closed (Law L5).

import { canon, addressOf } from "./holo-identity.mjs";
import { attest, verifyAttestation } from "./holo-attest.mjs";
import { coAttest } from "./holo-coattest.mjs";

const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const te = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hexTail = (kappa) => String(kappa || "").split(":").pop();

// ── 1. work order: the content-addressed unit of work both peers agree on ──────────────────
// inputs/params are REFERENCES (κs / small scalars), never raw data — the data is sealed + dispatched.
export async function workOrder({ op, inputs = [], params = {} } = {}) {
  if (!op) throw new Error("a work order needs an op");
  const body = { "@type": "HoloWorkOrder", op, inputs: [].concat(inputs).map(String).sort(), params };
  const kappa = await addressOf(te.encode(canon(body)));
  return { kappa, ...body };
}
export async function verifyWorkOrder(order) {
  if (!order || !order.kappa) return null;
  const { kappa, ...body } = order;
  return (await addressOf(te.encode(canon(body)))) === kappa ? body : null;     // L5
}

// ── 2. leaderless election (a κ-seeded VRF) ────────────────────────────────────────────────
// ticket(session, round, peer) — a deterministic, verifiable lottery number for a peer in a round.
export async function ticket(session, round, peer) {
  return hexTail(await addressOf(te.encode(canon({ "@type": "HoloSwarmTicket", session, round, peer: String(peer) }))));
}
// electLeader(session, peers, round) — the peer with the SMALLEST ticket leads. Every peer computes the
// same result from public κs; no orchestrator. Returns { leader, round, tickets } (tickets ⇒ verifiable).
export async function electLeader(session, peers = [], round = 0) {
  const set = [...new Set(peers.map(String))].filter(Boolean);
  if (set.length < 1) return null;
  const tickets = {};
  for (const p of set) tickets[p] = await ticket(session, round, p);
  const leader = set.slice().sort((a, b) => tickets[a].localeCompare(tickets[b]) || a.localeCompare(b))[0];
  return { leader, round, tickets };
}
// regroup(session, peers, dropped, round) — a peer vanished: drop it and re-elect in the NEXT round, so
// the membership change is itself recorded (a fresh ticket draw). Deterministic + verifiable.
export async function regroup(session, peers, dropped, round = 0) {
  const survivors = peers.map(String).filter((p) => p !== String(dropped));
  return electLeader(session, survivors, round + 1);
}

// ── 3a. confidential dispatch: seal the input so the worker's HOST sees only ciphertext ─────
// (the worker decrypts in-TEE; the session key rides the identity/out-of-band channel.) AES-GCM.
export async function sealInput(bytes, keyBytes) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await SUB.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await SUB.encrypt({ name: "AES-GCM", iv }, key, bytes instanceof Uint8Array ? bytes : te.encode(bytes)));
  return { "@type": "HoloSealedInput", v: 1, iv: b64(iv), ct: b64(ct) };          // no plaintext, no key
}
export async function openInput(sealed, keyBytes) {
  const key = await SUB.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  return new Uint8Array(await SUB.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, key, unb64(sealed.ct)));
}

// assign(session, workKappa, leaderAttestation, workerAttestation) — admit the (leader, worker) pair to
// the session for THIS work via a Phase-B co-attestation. The assignment exists only if BOTH attested
// the work κ scoped to the session — the recruitment handshake. Returns the co-attestation or null.
export async function assign({ session, work, attestations }) {
  return coAttest({ space: session, subject: work, attestations });
}

// ── 3b. result attestation + verify-before-accept ──────────────────────────────────────────
// resultSubject(work, output) — the composite κ a worker attests: "work κ produced output κ". The
// requester re-derives it from the work it sent + the output it got back, so the attestation's subject
// can't be honoured unless it names the SAME pair (Law L5 on the pair).
export async function resultSubject(work, output) {
  return addressOf(te.encode(canon({ "@type": "HoloWorkResult", work, output })));
}
// attestResult — the worker's side: a CC-56 attestation whose subject is the (work→output) pair, scoped
// to the session (audience). This is the receipt the requester verifies before accepting the output.
export async function attestResult({ work, output, session }, workerSigner) {
  const subject = await resultSubject(work, output);
  return attest({ subject, audience: session }, workerSigner);
}
// acceptResult — the requester's side (VERIFY-BEFORE-ACCEPT, fail-closed): re-derive the expected
// (work→output) subject, verify the worker's attestation against it + the session, and (if given) confirm
// the attester is the recruited worker. Returns { ok, output, worker } or null. A wrong output, a forged
// result, a tampered attestation, or a stranger's signature all yield null — the output is NOT accepted.
export async function acceptResult({ work, output, attestation, session, expectWorker = null }) {
  const subject = await resultSubject(work, output);
  const v = await verifyAttestation(attestation, { expectSubject: subject, audience: session });
  if (!v) return null;                                                          // the receipt didn't verify
  if (expectWorker && v.attester !== expectWorker) return null;                 // must be the recruited peer
  return { ok: true, output, worker: v.attester };
}

if (typeof window !== "undefined" && !window.HoloSwarm) {
  window.HoloSwarm = Object.freeze({ workOrder, verifyWorkOrder, electLeader, regroup, ticket, sealInput, openInput, assign, attestResult, acceptResult, resultSubject });
}

// ── self-test (node): order → election → regroup → sealed dispatch → assign → result accept/refuse ──
export async function selftest() {
  const r = {};
  const b64k = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
  async function party() {
    const kp = await SUB.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const pub = new Uint8Array(await SUB.exportKey("raw", kp.publicKey));
    return { kappa: await addressOf(pub), alg: "Ed25519", pub: b64k(pub), async sign(s) { const u = typeof s === "string" ? te.encode(s) : s; return b64k(await SUB.sign({ name: "Ed25519" }, kp.privateKey, u)); } };
  }
  // 1. work order
  const order = await workOrder({ op: "lora.train.shard", inputs: ["did:holo:sha256:" + "a".repeat(64)], params: { layer: 5, rank: 8 } });
  r.orderAddresses = /^did:holo:sha256:[0-9a-f]{64}$/.test(order.kappa) && (await verifyWorkOrder(order)) !== null;
  r.orderReorderStable = (await workOrder({ op: "lora.train.shard", inputs: ["did:holo:sha256:" + "a".repeat(64)], params: { rank: 8, layer: 5 } })).kappa === order.kappa;  // param key order irrelevant (canon)
  r.orderTamper = (await verifyWorkOrder({ ...order, op: "evil.op" })) === null;

  // 2. leaderless election: deterministic, agreed by all, lowest-ticket, verifiable
  const session = "did:holo:sha256:" + "5".repeat(64);
  const reqP = await party(), w1 = await party(), w2 = await party();
  const peers = [reqP.kappa, w1.kappa, w2.kappa];
  const e1 = await electLeader(session, peers, 0);
  const e1b = await electLeader(session, [...peers].reverse(), 0);
  r.electDeterministic = e1.leader === e1b.leader;                                                  // order-independent
  r.electIsMinTicket = peers.every((p) => e1.tickets[e1.leader].localeCompare(e1.tickets[p]) <= 0); // leader has min ticket
  r.electVerifiable = (await ticket(session, 0, e1.leader)) === e1.tickets[e1.leader];              // anyone re-derives it
  // 3. regroup on drop → new round, deterministic, excludes the dropped peer
  const e2 = await regroup(session, peers, e1.leader, 0);
  r.regroupExcludes = e2.leader !== e1.leader || !Object.keys(e2.tickets).includes(e1.leader);
  r.regroupDeterministic = (await regroup(session, peers, e1.leader, 0)).leader === e2.leader && e2.round === 1;

  // 4. confidential dispatch: host sees only ciphertext; round-trips; wrong key fails
  const key = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const plaintext = te.encode("private training shard bytes");
  const sealed = await sealInput(plaintext, key);
  r.sealNoPlaintext = !canon(sealed).includes("private") && !sealed.ct.includes("private");
  r.sealRoundTrips = new TextDecoder().decode(await openInput(sealed, key)) === "private training shard bytes";
  r.sealWrongKey = await (async () => { try { await openInput(sealed, globalThis.crypto.getRandomValues(new Uint8Array(32))); return false; } catch { return true; } })();

  // 5. recruitment: leader + worker co-attest the work (admission); a non-attesting pair can't assign
  const aReq = await attest({ subject: order.kappa, audience: session }, reqP);
  const aW1 = await attest({ subject: order.kappa, audience: session }, w1);
  const assignment = await assign({ session, work: order.kappa, attestations: [aReq, aW1] });
  r.assignAdmits = !!assignment && /^did:holo:sha256:/.test(assignment.id);

  // 6. result: worker attests work→output; requester accepts ONLY after verifying; refuses the rest
  const output = "did:holo:sha256:" + "0".repeat(64);
  const receipt = await attestResult({ work: order.kappa, output, session }, w1);
  r.accepts = (await acceptResult({ work: order.kappa, output, attestation: receipt, session, expectWorker: w1.kappa })) !== null;
  r.rejectsWrongOutput = (await acceptResult({ work: order.kappa, output: "did:holo:sha256:" + "1".repeat(64), attestation: receipt, session })) === null;  // subject mismatch
  r.rejectsWrongWork = (await acceptResult({ work: "did:holo:sha256:" + "2".repeat(64), output, attestation: receipt, session })) === null;
  r.rejectsTamper = (await acceptResult({ work: order.kappa, output, attestation: { ...receipt, attester: "did:holo:sha256:" + "9".repeat(64) }, session })) === null;
  const stranger = await party();
  const forged = await attestResult({ work: order.kappa, output, session }, stranger);
  r.rejectsStranger = (await acceptResult({ work: order.kappa, output, attestation: forged, session, expectWorker: w1.kappa })) === null;  // not the recruited worker
  r.acceptsStrangerWithoutBinding = (await acceptResult({ work: order.kappa, output, attestation: forged, session })) !== null;            // honest: verifies, but caller MUST bind expectWorker

  r.ok = Object.values(r).every(Boolean);
  return r;
}

if (typeof process !== "undefined" && process.argv && /holo-swarm\.mjs$/.test(process.argv[1] || "")) {
  selftest().then((r) => { console.log("holo-swarm selftest:", r); process.exit(r.ok ? 0 : 1); });
}

export default { workOrder, verifyWorkOrder, electLeader, regroup, ticket, sealInput, openInput, assign, attestResult, acceptResult, resultSubject };
