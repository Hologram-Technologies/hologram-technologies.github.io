// holo-pair-roamkey-witness.mjs — both paired devices derive the SAME session-roam key (never on the wire),
// and a different pairing yields a different key. Run: node tools/holo-pair-roamkey-witness.mjs
import { createPairOffer, mintDeviceGrant, acceptGrant, addressOf } from "../os/usr/lib/holo/holo-pair.mjs";

const SUB = globalThis.crypto.subtle, te = new TextEncoder();
const b64 = (b) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("base64");
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.error("  ✗ " + n); } };

// a minimal real operator principal (ECDSA P-256; κ = its pubkey's content address, like holo-identity)
async function makeOperator() {
  const kp = await SUB.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pubRaw = new Uint8Array(await SUB.exportKey("raw", kp.publicKey));
  const kappa = await addressOf(pubRaw);
  return { kappa, label: "Op", alg: "ECDSA", pub: b64(pubRaw), sign: async (s) => b64(new Uint8Array(await SUB.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, te.encode(s)))) };
}

(async () => {
  const operator = await makeOperator();

  // pairing 1: desktop offers → phone (operator) grants → desktop accepts. Both sides return a roamKey.
  const { offer, secrets } = await createPairOffer({ deviceName: "Desktop" });
  const mint = await mintDeviceGrant(operator, { ...offer, deviceKappa: secrets.deviceKappa });
  const accept = await acceptGrant(secrets, mint.blob);
  ok("mint returns a roamKey", typeof mint.roamKey === "string" && mint.roamKey.length >= 40);
  ok("accept returns a roamKey", typeof accept.roamKey === "string" && accept.roamKey.length >= 40);
  ok("BOTH devices derive the IDENTICAL roam key", mint.roamKey === accept.roamKey);
  ok("operator κ round-trips through the grant", accept.operator === operator.kappa);

  // pairing 2: a fresh offer (new ephemeral + channel) → a DIFFERENT roam key (per-pairing isolation)
  const p2 = await createPairOffer({ deviceName: "Desktop2" });
  const mint2 = await mintDeviceGrant(operator, { ...p2.offer, deviceKappa: p2.secrets.deviceKappa });
  const accept2 = await acceptGrant(p2.secrets, mint2.blob);
  ok("second pairing also agrees", mint2.roamKey === accept2.roamKey);
  ok("different pairing → different roam key", mint2.roamKey !== mint.roamKey);

  console.log(`holo-pair-roamkey-witness: ${pass}/${pass + fail} green`);
  process.exit(fail ? 1 : 0);
})();
