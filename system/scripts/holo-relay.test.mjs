// Conformance witness for the P2 transport: two browser-style peers converge on
// a channel over the live κ pub/sub relay, with no server owning the content —
// and a lying relay's forged bytes are refused on receipt (Law L5).
//
// The relay is content-blind, so the κ here is a stand-in (sha256 of the bytes)
// computed in JS; the production peer computes the substrate's blake3 κ in wasm.
// The discipline witnessed is identical: trust is in re-derivation, not the relay.
//
// Run: node holo-relay.test.mjs

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startRelay } from "./holo-relay.mjs";
import { WsKappaSync } from "../os/holo-kappa-sync.mjs";

const kappa = (bytes) => "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");
const verify = (k, bytes) => kappa(bytes) === k;
const enc = (s) => new TextEncoder().encode(s);

// Resolve once `cond()` holds (announces arrive asynchronously over the socket).
async function until(cond, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const relay = await startRelay();
try {
  const channel = "blake3:hologram-team-channel";

  await test("two peers converge on the published messages over the relay", async () => {
    const alice = await new WsKappaSync(relay.url).ready;
    const bob = await new WsKappaSync(relay.url).ready;

    // Bob joins the channel and listens; Alice posts three messages.
    const seen = new Set();
    await bob.subscribe(channel, (_topic, k) => seen.add(k));

    const bodies = ["kickoff: substrate sync", "agenda attached", "+1 sharing notes"];
    const published = bodies.map((b) => {
      const bytes = enc(b);
      const k = kappa(bytes);
      alice.announce(channel, k, bytes);
      return k;
    });

    // Bob hears every announce, then fetches each object and verifies it.
    await until(() => published.every((k) => seen.has(k)));
    const got = new Map();
    for (const k of published) {
      const bytes = await bob.fetch(k, { verify });
      assert.ok(bytes, `bob resolves ${k}`);
      assert.equal(kappa(bytes), k, "fetched bytes re-derive to the announced κ");
      got.set(k, new TextDecoder().decode(bytes));
    }
    assert.deepEqual([...published].sort(), [...got.keys()].sort(), "same set of messages");
    assert.deepEqual(bodies.map((b) => got.get(kappa(enc(b)))), bodies, "exact bodies");

    alice.close();
    bob.close();
  });

  await test("a late joiner catches up via announce replay", async () => {
    const carol = await new WsKappaSync(relay.url).ready;
    const seen = new Set();
    // Carol subscribes only now — the relay replays the channel's known κs.
    await carol.subscribe(channel, (_t, k) => seen.add(k));
    await until(() => seen.size >= 3);
    assert.ok(seen.size >= 3, "late joiner received the backlog of announces");
    carol.close();
  });

  await test("a forged object is refused on receipt (Law L5)", async () => {
    const peer = await new WsKappaSync(relay.url).ready;
    // A lying relay: advertise a κ but hold bytes that do not hash to it.
    const realBytes = enc("authentic decision");
    const honest = kappa(realBytes);
    const forgedClaim = kappa(enc("a different message")); // κ peers will ask for
    peer.announce(channel, forgedClaim, realBytes); // bytes ≠ what forgedClaim hashes

    const accepted = await peer.fetch(forgedClaim, { verify });
    assert.equal(accepted, null, "bytes that fail re-derivation are rejected");

    // The same bytes under their honest κ verify fine — integrity, not censorship.
    peer.announce(channel, honest, realBytes);
    const ok = await peer.fetch(honest, { verify });
    assert.ok(ok && verify(honest, ok), "honest content still resolves");
    peer.close();
  });
} finally {
  await relay.close();
}

console.log(`\n${passed} passed`);
