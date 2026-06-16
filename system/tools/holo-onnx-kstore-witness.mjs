// holo-onnx-kstore-witness.mjs — the browser-half witness for ADR-0101 Stage 0 (Seam A).
//
// Proves the OS2 `.holo` κ-store implements the SAME KappaStore contract as ari's
// `crates/hologram-ai/src/kstore.rs`, with κ-PARITY across the two substrates: the κ minted in
// JS (`blake3:<hex>`) is byte-identical to ari's `hologram_archive::address_bytes`. Mirrors the
// six ari unit tests (round-trip · L5 re-derive · L3 dedup · distinct · absent · tamper-refuse)
// and adds the wasm Uint8Array seam + a cross-substrate parity check.
//
// Optional cross-substrate proof on the REAL archive (opt-in, skipped if absent):
//   HOLO_KSTORE_PARITY=1  node system/tools/holo-onnx-kstore-witness.mjs
//   (reads ari's spike-web/assets/smollm2-360m-int8.holo and asserts its κ === the κ ari's
//    Rust E2E minted: blake3:767a2ddedfee5fddb9f0200e225e8c404ab90c3e272dac2086dc9835a183af14)

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  makeArchiveStore,
  archiveLabel,
  ingestHolo,
  loadHoloByKappa,
  ingestUrl,
  serveArchiveHex,
  makeStoreRangeResolver,
  fetchArchiveRange,
  makeRangeResolver,
} from "../os/usr/lib/holo/holo-onnx-kstore.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// A counting Map backend (async, mirrors holo-store's memBackend) so the witness can assert
// L3 dedup at the byte level — identical content collapses to ONE stored object.
function countingBackend() {
  const m = new Map();
  return {
    backend: {
      get: async (k) => m.get(k) || null,
      set: async (k, bytes) => {
        m.set(k, bytes);
      },
      has: async (k) => m.has(k),
    },
    map: m,
  };
}

const enc = (s) => new TextEncoder().encode(s);

const checks = {};
let passed = 0,
  failed = 0;
const rec = (name, ok) => {
  checks[name] = !!ok;
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}`);
};

async function main() {
  // 1 · round-trip is byte-identical
  {
    const { backend } = countingBackend();
    const store = makeArchiveStore({ backend });
    const bytes = Uint8Array.from([0x48, 0x4f, 0x4c, 0x4f, 0, 1, 2, 255, 7]); // "HOLO" + bytes
    const k = await store.put(bytes);
    const got = await store.get(k);
    rec(
      "put→get round-trip is byte-identical",
      got && got.length === bytes.length && got.every((b, i) => b === bytes[i]),
    );
  }

  // 2 · κ re-derives from content (Law L5) and matches archiveLabel
  {
    const { backend } = countingBackend();
    const store = makeArchiveStore({ backend });
    const bytes = new Uint8Array(4096).fill(7);
    const k = await store.put(bytes);
    rec("put's κ === the content's re-derived κ (L5)", k === archiveLabel(bytes));
    rec("κ is the substrate σ-axis label blake3:<64hex>", /^blake3:[0-9a-f]{64}$/.test(k));
  }

  // 3 · identical bytes dedup to ONE object (Law L3)
  {
    const { backend, map } = countingBackend();
    const store = makeArchiveStore({ backend });
    const bytes = enc("the same model, twice");
    const a = await store.put(bytes);
    const b = await store.put(bytes);
    rec("identical bytes → identical κ", a === b);
    rec("identical bytes occupy ONE stored object (L3 dedup)", map.size === 1);
  }

  // 4 · distinct bytes → distinct κ
  {
    const { backend } = countingBackend();
    const store = makeArchiveStore({ backend });
    rec("distinct bytes → distinct κ", (await store.put(enc("alpha"))) !== (await store.put(enc("beta"))));
  }

  // 5 · absent κ resolves to null (not an error)
  {
    const { backend } = countingBackend();
    const store = makeArchiveStore({ backend });
    const phantom = archiveLabel(enc("never stored"));
    rec("absent κ resolves to null", (await store.get(phantom)) === null);
  }

  // 6 · a tampered object is refused (Law L5) — get re-derives and throws
  {
    const { backend, map } = countingBackend();
    const store = makeArchiveStore({ backend });
    const bytes = enc("trusted compiled archive");
    const k = await store.put(bytes);
    map.set(k, enc("a different, forged archive")); // corrupt the stored object in place
    let refused = false;
    try {
      await store.get(k);
    } catch {
      refused = true;
    }
    rec("tampered object refused on read (L5)", refused);
  }

  // 7 · the wasm Uint8Array seam — loadHoloByKappa yields bytes, throws on absent
  {
    const { backend } = countingBackend();
    const store = makeArchiveStore({ backend });
    const bytes = enc("a compiled .holo for the wasm verbs");
    const k = await ingestHolo(store, bytes);
    const u8 = await loadHoloByKappa(store, k);
    rec("loadHoloByKappa returns a Uint8Array for the wasm seam", u8 instanceof Uint8Array && u8.length === bytes.length);
    let threw = false;
    try {
      await loadHoloByKappa(store, archiveLabel(enc("absent")));
    } catch {
      threw = true;
    }
    rec("loadHoloByKappa throws on an absent κ (twin of HoloRunner::get)", threw);
  }

  // 8 · ingestUrl — one-time fetch → store by κ (the migration off fetch(path).arrayBuffer())
  {
    const { backend } = countingBackend();
    const store = makeArchiveStore({ backend });
    const served = enc("model bytes served once over HTTP");
    let fetchCount = 0;
    const mockFetch = async (_url) => {
      fetchCount++;
      return { ok: true, arrayBuffer: async () => served.buffer.slice(served.byteOffset, served.byteOffset + served.byteLength) };
    };
    const k = await ingestUrl(store, "http://example/smol.holo", { fetch: mockFetch });
    const round = await store.get(k);
    rec("ingestUrl fetches once and stores by κ (L4 boundary)", fetchCount === 1 && k === archiveLabel(served));
    rec("ingested archive round-trips by κ", round && round.length === served.length);
  }

  // 9 · the SW delivery seam — serveArchiveHex returns by bare hex, re-derived
  {
    const { backend } = countingBackend();
    const store = makeArchiveStore({ backend });
    const bytes = enc("served by the Service Worker κ-route");
    const k = await store.put(bytes); // "blake3:<hex>"
    const hex = k.slice("blake3:".length);
    const served = await serveArchiveHex(store, hex);
    rec("serveArchiveHex(hex) returns the archive (SW /.holo/blake3/<hex> seam)", served && served.length === bytes.length);
    rec("serveArchiveHex returns null for an unknown hex", (await serveArchiveHex(store, "0".repeat(64))) === null);
  }

  // 10 · cross-substrate κ-parity — the canonical BLAKE3 vector (always-on)
  {
    // holo-blake3-witness pins blake3("abc") = 6437b3ac…; the archive label must wrap the SAME hex,
    // i.e. the κ ari's Rust would mint for these bytes. This is the substrate-parity anchor.
    rec(
      "κ-parity: archiveLabel('abc') === the canonical substrate κ",
      archiveLabel(enc("abc")) === "blake3:6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85",
    );
  }

  // 11 · cross-substrate κ-parity on the REAL archive (opt-in; proves OS2 κ === ari Rust κ)
  let parityRealRan = false;
  if (process.env.HOLO_KSTORE_PARITY === "1") {
    const holo = join(
      here,
      "..",
      "..",
      "..",
      "hologram-ai-main (ari)",
      "hologram-ai-main",
      "spike-web",
      "assets",
      "smollm2-360m-int8.holo",
    );
    if (existsSync(holo)) {
      parityRealRan = true;
      const bytes = new Uint8Array(readFileSync(holo));
      const ARI_KAPPA = "blake3:767a2ddedfee5fddb9f0200e225e8c404ab90c3e272dac2086dc9835a183af14";
      rec("κ-parity on the REAL 352MB .holo: OS2 κ === ari Rust κ", archiveLabel(bytes) === ARI_KAPPA);
    } else {
      console.log("skip — real-archive parity (asset not present)");
    }
  } else {
    console.log("skip — real-archive parity (set HOLO_KSTORE_PARITY=1 with ari's asset to run)");
  }

  // 12 · Stage 3 — range streaming (the JS twin of the substrate RangeResolver)
  {
    const { backend } = countingBackend();
    const store = makeArchiveStore({ backend });
    // a stand-in archive whose bytes are positionally distinct, so a wrong offset is caught
    const archive = Uint8Array.from({ length: 4096 }, (_, i) => (i * 37 + 11) & 0xff);
    const k = await store.put(archive);

    // a · store-backed resolver pages an exact interior range (parity twin of SliceResolver)
    const sr = makeStoreRangeResolver(store, k);
    const mid = await sr.fetch(1000, 256);
    rec(
      "store range resolver pages an exact interior range",
      mid.length === 256 && mid.every((b, i) => b === archive[1000 + i]),
    );

    // b · reassembling sequential ranges reconstructs the whole archive (demand-paging is lossless)
    let reassembled = new Uint8Array(0);
    for (let off = 0; off < archive.length; off += 512) {
      const len = Math.min(512, archive.length - off);
      const chunk = await sr.fetch(off, len);
      const next = new Uint8Array(reassembled.length + chunk.length);
      next.set(reassembled);
      next.set(chunk, reassembled.length);
      reassembled = next;
    }
    rec(
      "ranged reassembly equals the whole archive (lossless paging)",
      reassembled.length === archive.length && reassembled.every((b, i) => b === archive[i]),
    );

    // c · HTTP resolver: a mock SW honoring `Range` → 206, the resolver returns exactly the range
    let lastRange = null;
    const mockSW206 = async (_url, init) => {
      lastRange = init.headers.Range;
      const m = init.headers.Range.match(/^bytes=(\d+)-(\d+)$/);
      const start = +m[1], end = +m[2];
      const part = archive.subarray(start, end + 1);
      return { ok: true, status: 206, arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) };
    };
    const r206 = makeRangeResolver(k, { fetch: mockSW206, route: "/" });
    const got206 = await r206.fetch(2048, 100);
    rec(
      "HTTP range resolver gets a 206 sub-range by κ",
      lastRange === "bytes=2048-2147" && got206.length === 100 && got206.every((b, i) => b === archive[2048 + i]),
    );

    // d · a server that IGNORES Range (200 full body) still yields the correct slice
    const mockSW200 = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
    });
    const got200 = await fetchArchiveRange(k, 2048, 100, { fetch: mockSW200, route: "/" });
    rec(
      "range falls back correctly when the server ignores Range (200→slice)",
      got200.length === 100 && got200.every((b, i) => b === archive[2048 + i]),
    );
  }

  const witnessed = failed === 0;
  writeFileSync(
    join(here, "holo-onnx-kstore-witness.result.json"),
    JSON.stringify(
      {
        spec: "ADR-0101 Stage 0 (Seam A), browser half: the OS2 .holo κ-store implements the SAME KappaStore contract as ari's kstore.rs (put/get/has by κ, L5 re-derivation on read), with κ-parity across substrates (blake3:<hex> === hologram_archive::address_bytes); the wasm Uint8Array seam pulls archive bytes by κ.",
        authority:
          "ari crates/hologram-ai/src/kstore.rs (6/6 unit witness) · holo-blake3-witness (blake3 σ-axis === the substrate kappa()) · verify by re-derivation (Law L5) · the OS2 κ-store (holo-store.makeStore, ADR-0026)",
        witnessed,
        covers: ["holo-onnx-forge", "kappa-store", "seam-a", "kappa-parity", "law-l1", "law-l2", "law-l3", "law-l5", "adr-0026"],
        parityRealRan,
        checks,
        passed,
        failed,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`\nholo-onnx-kstore-witness: ${passed} passed, ${failed} failed`);
  process.exit(witnessed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
