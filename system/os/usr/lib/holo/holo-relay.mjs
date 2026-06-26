// holo-relay.mjs — COLD FIRST CONTACT. The blocked site is held by no peer yet, so there is nothing to pull.
// An UNFILTERED relay peer (a node on a connection the ISP filter does not gate) fetches the origin from its
// own vantage, content-addresses the bytes on the canonical BLAKE3 σ-axis, and serves a self-verifying Bao
// stream. The filtered node admits those bytes ONLY because they re-derive to the κ — so the relay is
// UNTRUSTED infrastructure: it can carry the content, it cannot alter it. A forged byte would need a BLAKE3
// collision, not merely a dishonest relay. This is exactly the guarantee a VPN or a Tor exit cannot offer
// (there you trust the exit's bytes); here the trust is in the math, and the relay is interchangeable.
//
// The relay does touch the origin (someone must, on first contact) — so this layer trades the consumer's
// name-privacy for reach, honestly: WHO wanted the page is hidden from the ISP, but the relay sees the fetch.
// Mixing/blinding that request is a separate, unsolved layer; stated, not buried. Pure assembly over holo-bao;
// the origin fetch is injected (node-testable; live it is the relay's own network). Law L1/L5.

import bao from "./holo-bao.mjs";

// makeRelay({ originFetch }) — originFetch(url) → Uint8Array (the relay's unfiltered fetch of the origin).
export function makeRelay({ originFetch } = {}) {
  if (typeof originFetch !== "function") throw new Error("holo-relay: originFetch required");

  // serve(url) → { kappa, len, stream } : fetch from the relay's vantage, seal to a blake3 root, emit the
  // self-verifying chunk stream the consumer feeds to holo-deliver.fetchVerified. `kappa` is the bare blake3
  // hex root — the address the consumer verifies against and the name the κ-roots binding can publish.
  async function serve(url) {
    const raw = await originFetch(url);
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const enc = bao.encode(bytes);                  // { root, len, chunks:[{index,bytes,proof}] }
    return { kappa: enc.root, len: enc.len, stream: enc.chunks };
  }

  return { serve };
}

export default { makeRelay };
