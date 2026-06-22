// holo-ton-witness.mjs — proves the TON wallet on the VENDORED, κ-sealed @ton/core: the bundle re-derives
// to its sha256 pin (a tampered vendor file is refused), the v4r2 address derivation matches the pinned
// VECTOR (and @ton/ton — cross-validated in the browser), the code-hash matches, holo-wdk registers TON,
// and verify-before-sign refuses a message whose recipient/amount don't match intent. Network-free.
//
//   node system/tools/holo-ton-witness.mjs

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tonAddress, tonAddressRaw, codeHashHex, buildSigningMessage, verifyTransfer, WALLET_ID } from "../os/usr/lib/holo/holo-ton.mjs";
import { deriveAddress, makeWDK, generateMnemonic, seedFromMnemonic } from "../os/usr/lib/holo/holo-wdk.js";
import { ed25519 } from "../os/usr/lib/holo/wdk-crypto/wdk-crypto.bundle.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { (c ? pass++ : fail++); console.log(`  ${c ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };

console.log("Holo TON — vendored @ton/core, validated v4r2 derivation\n");

// 1) PROVENANCE — the vendored bundle re-derives to its sha256 pin (tamper-refuse, Law L5 / SEC-1).
const V = join(here, "../os/usr/lib/holo/vendor/ton");
const pins = JSON.parse(readFileSync(join(V, "vendor.pins.json"), "utf8"))["@ton/core"];
const bundleSha = createHash("sha256").update(readFileSync(join(V, "ton-core.bundle.mjs"))).digest("hex");
ok("vendored @ton/core re-derives to its sha256 pin", bundleSha === pins.sha256, bundleSha.slice(0, 16) + "…");
ok("the pin records the validation vector + bundler", pins.vector.walletV4R2Address.startsWith("0:") && /esbuild/.test(pins.bundler));

// 2) the v4r2 derivation matches the pinned VECTOR (and @ton/ton — see browser cross-validation).
const PK = new Uint8Array(32); for (let i = 0; i < 32; i++) PK[i] = (i * 7 + 3) & 0xff;
ok("tonAddress(vector pubkey) == the pinned v4r2 raw address", tonAddressRaw(PK) === pins.vector.walletV4R2Address, tonAddressRaw(PK).slice(0, 22) + "…");
ok("the wallet code-hash matches the pinned vector", codeHashHex() === pins.vector.codeHash);
ok("v4r2 subwallet id is 0x29a9a317", WALLET_ID === 0x29a9a317);
ok("user-friendly address is non-bounceable UQ…", /^UQ/.test(tonAddress(PK)), tonAddress(PK).slice(0, 12) + "…");

// 3) holo-wdk integration — deriveAddress('ton') + makeWDK register the TON manager (Ed25519 SLIP-0010).
const seed = seedFromMnemonic(generateMnemonic(12));
const tAddr = deriveAddress("ton", seed, 0);
ok("holo-wdk deriveAddress('ton') yields a TON address (m/44'/607')", /^UQ[A-Za-z0-9_-]{46}$/.test(tAddr), tAddr.slice(0, 14) + "…");
const wdk = makeWDK(seed, { chains: ["ton"] });
const acc = await wdk.getAccount("ton", 0);
ok("makeWDK registers the TON wallet manager (getAddress matches)", (await acc.getAddress()) === tAddr);

// 4) verify-before-sign (L5): a built transfer must match the requested recipient + amount, else refused.
const TO = tonAddressRaw(ed25519.getPublicKey(new Uint8Array(32).fill(9)));
const OTHER = tonAddressRaw(ed25519.getPublicKey(new Uint8Array(32).fill(13)));
const signing = buildSigningMessage({ toAddr: TO, amountNano: "1000000000", seqno: 0, validUntil: 0xffffffff });
ok("a transfer matching intent passes verify", verifyTransfer(signing, { toAddr: TO, amountNano: "1000000000" }) === true);
const refuse = (mut) => { try { verifyTransfer(signing, mut); return false; } catch { return true; } };
ok("a transfer to a DIFFERENT recipient is refused", refuse({ toAddr: OTHER, amountNano: "1000000000" }));
ok("a transfer with a DIFFERENT amount is refused", refuse({ toAddr: TO, amountNano: "999" }));

console.log(`\n${fail ? "WITNESS FAILED" : "WITNESSED ✓"}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
