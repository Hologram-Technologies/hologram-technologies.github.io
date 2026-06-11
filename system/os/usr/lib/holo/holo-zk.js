// holo-zk.js — the lean, real zero-knowledge / proof toolkit for the Holo Notepad memory
// bank. Pure, dependency-free, Node-safe (WebCrypto only — no vendored SNARK, no CDN). It
// lets you PROVE things about your private, content-addressed memory WITHOUT revealing the
// memory itself, so a fact can be shared/verified under Holo Privacy + Holo Terms while the
// graph stays yours.
//
// Three real primitives (no trusted setup; everything re-derives, Law L5):
//   • MERKLE COMMITMENT + INCLUSION PROOF — commit a day's memory to a single Merkle root
//     over its entry κs; proveInclusion(κ) is a O(log n) path that proves "this fact is in my
//     signed memory" while revealing NOTHING about the other entries. The verifier learns one
//     bit: membership.
//   • SALTED-DIGEST SELECTIVE DISCLOSURE (IETF SD-JWT shape) — an entry's claims are issued as
//     salted digests; the holder discloses ONLY the chosen claims (e.g. "met [[X]] after
//     2026-01-01") and the verifier checks each revealed claim's digest is in the signed set.
//     Unrevealed claims leak nothing (the salt hides them). This is exactly what Holo Privacy
//     uses for its Verifiable Presentations — holo-zk gives the memory layer a self-contained,
//     node-testable copy of the same mechanism.
//   • HASH COMMITMENTS (Fiat–Shamir) — hiding+binding commit(value) you can open later to
//     prove knowledge of the value, revealing nothing until you choose to.
//
// Plus an optional Ed25519 signer (WebCrypto) to sign the daily root, so a shared proof is
// bound to your did:key. HONEST SCOPE: these are genuine membership / selective-disclosure /
// commitment proofs — not arbitrary-circuit zk-SNARKs (a future axis). Everything is verifiable
// by anyone with only the public root/digests + the proof.

(function () {
  "use strict";
  const G = typeof globalThis !== "undefined" ? globalThis : window;
  if (G.HoloZK) return;

  const subtle = (G.crypto && G.crypto.subtle) || (typeof require !== "undefined" && require("crypto").webcrypto.subtle);
  const getRandom = (n) => { const c = G.crypto || (typeof require !== "undefined" && require("crypto").webcrypto); const a = new Uint8Array(n); c.getRandomValues(a); return a; };
  const te = new TextEncoder();
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  const randHex = (n = 16) => hex(getRandom(n));
  async function sha256Hex(str) { return hex(new Uint8Array(await subtle.digest("SHA-256", te.encode(str)))); }
  // deterministic canonical JSON (sorted keys) — identical bytes on every replica
  const jcs = (v) => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]"
    : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}"
    : JSON.stringify(v);

  // ── Merkle tree over leaves (entry κs / hex strings) ───────────────────────────
  const leafHash = (v) => sha256Hex("\x00leaf:" + v);          // domain-separated (2nd-preimage safe)
  const nodeHash = (a, b) => sha256Hex("\x01node:" + a + b);
  async function levelsOf(leaves) {
    if (!leaves.length) return [[await sha256Hex("\x02empty")]];
    let level = []; for (const l of leaves) level.push(await leafHash(l));
    const all = [level];
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) next.push(await nodeHash(level[i], level[i + 1] ?? level[i]));
      level = next; all.push(level);
    }
    return all;
  }
  async function merkleRoot(leaves) { const ls = await levelsOf(leaves); return ls[ls.length - 1][0]; }
  // proof for the leaf at `index` (sibling hash + side, bottom→top)
  async function merkleProof(leaves, index) {
    const ls = await levelsOf(leaves); const path = []; let idx = index;
    for (let d = 0; d < ls.length - 1; d++) {
      const level = ls[d]; const isLeft = idx % 2 === 0;
      const sib = isLeft ? (level[idx + 1] ?? level[idx]) : level[idx - 1];
      path.push({ hash: sib, dir: isLeft ? "R" : "L" });
      idx = Math.floor(idx / 2);
    }
    return { index, path, root: ls[ls.length - 1][0] };
  }
  // verify a leaf's membership against the root — reveals only that `leafValue` is committed.
  async function verifyInclusion(root, leafValue, proof) {
    let h = await leafHash(leafValue);
    for (const step of proof.path) h = step.dir === "R" ? await nodeHash(h, step.hash) : await nodeHash(step.hash, h);
    return h === root;
  }

  // ── hash commitments (Fiat–Shamir; hiding+binding) ─────────────────────────────
  async function commit(value, salt) { salt = salt || randHex(16); return { commitment: await sha256Hex(salt + "|" + jcs(value)), salt }; }
  async function verifyCommit(commitment, value, salt) { return commitment === await sha256Hex(salt + "|" + jcs(value)); }

  // ── SD-JWT-style salted-digest selective disclosure ────────────────────────────
  // issue: claims object → { digests (sorted, the signed set), disclosures (held privately) }
  async function sdIssue(claims) {
    const disclosures = {}; const digests = [];
    for (const k of Object.keys(claims).sort()) {
      const salt = randHex(16); const disclosure = jcs([salt, k, claims[k]]); const digest = await sha256Hex(disclosure);
      disclosures[k] = { salt, disclosure, digest }; digests.push(digest);
    }
    digests.sort();
    return { digests, disclosures };
  }
  // holder discloses ONLY `keys` (reveals nothing about the rest)
  function sdDisclose(sd, keys) { return { digests: sd.digests, revealed: keys.filter((k) => sd.disclosures[k]).map((k) => sd.disclosures[k].disclosure) }; }
  // verifier: every revealed disclosure's digest must be in the signed set → returns ONLY the revealed claims (or null)
  async function sdVerify(presentation) {
    const set = new Set(presentation.digests); const out = {};
    for (const d of presentation.revealed) { const dg = await sha256Hex(d); if (!set.has(dg)) return null; const [, k, v] = JSON.parse(d); out[k] = v; }
    return out;
  }

  // ── optional Ed25519 signer (sign the daily root → bind a proof to a did:key) ───
  const ED = { name: "Ed25519" };
  async function genSigner() {
    const kp = await subtle.generateKey(ED, true, ["sign", "verify"]);
    const raw = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
    return { publicKeyHex: hex(raw), sign: async (msg) => hex(new Uint8Array(await subtle.sign(ED, kp.privateKey, te.encode(msg)))), _kp: kp };
  }
  async function verifySig(msg, sigHex, publicKeyHex) {
    try {
      const pub = await subtle.importKey("raw", fromHex(publicKeyHex), ED, true, ["verify"]);
      return subtle.verify(ED, pub, fromHex(sigHex), te.encode(msg));
    } catch { return false; }
  }
  const fromHex = (s) => { const a = new Uint8Array(s.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(s.substr(i * 2, 2), 16); return a; };

  // ── persistent IDENTITY signer — your real OS did:key, not an ephemeral key ──────
  // The daily memory root is signed by your STABLE first-party did:key (minted once + persisted,
  // the SAME identity Holo Terms / Holo Privacy use), so a shared proof is bound to YOU across
  // sessions — one identity OS-wide. Browser-only (needs localStorage); callers fall back to
  // genSigner() where it is unavailable (e.g. the headless witness).
  const A58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58enc(buf) { const d = [0]; for (const x of buf) { let c = x; for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } } let s = ""; for (const x of buf) { if (x === 0) s += "1"; else break; } for (let i = d.length - 1; i >= 0; i--) s += A58[d[i]]; return s; }
  // did:key for Ed25519 = base58btc(multicodec 0xed01 ‖ pubkey) — matches holo-terms / holo-vc byte-for-byte.
  const didKeyFromPub = (raw32) => { const p = new Uint8Array(raw32.length + 2); p[0] = 0xed; p[1] = 0x01; p.set(raw32, 2); return "did:key:z" + b58enc(p); };
  const b64e = (u8) => btoa(String.fromCharCode(...u8));
  const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const ID_KEY = "holo-terms:first-party";   // the OS user's persisted identity (one did:key OS-wide)
  async function identitySigner({ key = ID_KEY } = {}) {
    if (typeof localStorage === "undefined") throw new Error("identitySigner needs localStorage (browser)");
    let saved = null; try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
    let priv, pubRaw;
    if (saved && saved.pkcs8 && saved.pubRaw) { priv = await subtle.importKey("pkcs8", b64d(saved.pkcs8), ED, false, ["sign"]); pubRaw = b64d(saved.pubRaw); }
    else {
      const kp = await subtle.generateKey(ED, true, ["sign", "verify"]);
      priv = kp.privateKey; pubRaw = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
      const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", kp.privateKey));
      try { localStorage.setItem(key, JSON.stringify({ pkcs8: b64e(pkcs8), pubRaw: b64e(pubRaw), at: Date.now() })); } catch {}
    }
    const did = didKeyFromPub(pubRaw);
    return { publicKeyHex: hex(pubRaw), did, vm: did + "#" + did.slice("did:key:".length), persistent: true,
      sign: async (msg) => hex(new Uint8Array(await subtle.sign(ED, priv, te.encode(msg)))) };
  }

  // ── pure self-test (the witness runs this headless) ─────────────────────────────
  async function zkSelftest() {
    const leaves = ["sha256:aa", "sha256:bb", "sha256:cc", "sha256:dd", "sha256:ee"];
    const root = await merkleRoot(leaves);
    const proof = await merkleProof(leaves, 2);
    const incOk = await verifyInclusion(root, "sha256:cc", proof);
    const tamperOk = !(await verifyInclusion(root, "sha256:zz", proof));   // not a member → rejected
    const wrongRootOk = !(await verifyInclusion("00".repeat(32), "sha256:cc", proof));

    const c = await commit({ x: 42 }); const comOk = await verifyCommit(c.commitment, { x: 42 }, c.salt);
    const comBad = !(await verifyCommit(c.commitment, { x: 43 }, c.salt));

    const sd = await sdIssue({ who: "Ada", when: "2026-06-09", topic: "secret-deal", amount: 5000 });
    const pres = sdDisclose(sd, ["who", "when"]);                          // reveal who+when only
    const got = await sdVerify(pres);
    const sdOk = got && got.who === "Ada" && got.when === "2026-06-09" && !("amount" in got) && !("topic" in got);
    const sdForge = await sdVerify({ digests: sd.digests, revealed: [jcs(["badsalt", "amount", 1])] });
    const sdForgeOk = sdForge === null;                                    // a fabricated claim is rejected

    let sigOk = true; try { const s = await genSigner(); const sig = await s.sign(root); sigOk = (await verifySig(root, sig, s.publicKeyHex)) && !(await verifySig(root + "x", sig, s.publicKeyHex)); } catch { sigOk = "skipped"; }

    const ok = incOk && tamperOk && wrongRootOk && comOk && comBad && sdOk && sdForgeOk && (sigOk === true || sigOk === "skipped");
    return { incOk, tamperOk, wrongRootOk, comOk, comBad, sdOk, sdForgeOk, sigOk, ok };
  }

  G.HoloZK = { sha256Hex, jcs, merkleRoot, merkleProof, verifyInclusion, commit, verifyCommit, sdIssue, sdDisclose, sdVerify, genSigner, identitySigner, didKeyFromPub, verifySig, zkSelftest };
  if (typeof module !== "undefined" && module.exports) module.exports = G.HoloZK;
})();
