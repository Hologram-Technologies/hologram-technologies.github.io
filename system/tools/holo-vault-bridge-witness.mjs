// holo-vault-bridge-witness.mjs — proves the capability bridge narrows the app's authority (SEC-2,
// holo-apps §2.9): the app surface exposes ONLY {list,put,remove,reveal,generate,head}; list leaks no
// secret; reveal is the only path to a secret and it is step-up gated (fail-closed); the postMessage
// dispatch refuses any verb outside the allow-list; the generator is crypto-strong.
//   node holo-vault-bridge-witness.mjs
import { enroll } from "../os/usr/lib/holo/holo-login.mjs";
import { openVault, forgetVault } from "../os/usr/lib/holo/holo-vault.mjs";
import { vaultSurface, installVaultBridge, generatePassword } from "../os/usr/lib/holo/holo-vault-bridge.mjs";

const SECRET = "bridge-witness-prf-secret-0002";
const r = {};
const throws = async (fn) => { try { await fn(); return false; } catch { return true; } };

const main = async () => {
  const { principal } = await enroll({ label: "operator", secret: SECRET, allowPhrase: true });
  const OP = principal.kappa;
  await forgetVault(OP).catch(() => {});
  const handle = await openVault(OP, SECRET);
  await handle.put({ origin: "https://mail.google.com", kind: "password", username: "ilya", secret: "topsecret-xyz" });

  const surface = vaultSurface(handle);

  // 1) the surface is EXACTLY the narrowed verb set — no leaky extras
  r.surfaceNarrowed = JSON.stringify(Object.keys(surface).sort()) === JSON.stringify(["generate", "head", "list", "put", "remove", "reveal"]);

  // 2) list leaks no secret; the secret string appears in NO surface output except gated reveal
  const listed = await surface.list();
  r.listNoSecret = listed.every((e) => !("secret" in e)) && !JSON.stringify(listed).includes("topsecret-xyz");
  r.headNoSecret = !String(await surface.head()).includes("topsecret-xyz");

  // 3) reveal is the ONLY secret path and it is STEP-UP gated → fail-closed under Node (no TEE)
  r.revealGated = await throws(() => surface.reveal(listed[0].id));

  // 4) generator: length, class coverage, no ambiguous glyphs, uniform/unique
  const pw = surface.generate({ length: 20 });
  r.genLen = pw.length === 20;
  r.genClasses = /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
  r.genNoAmbiguous = !/[O0Il1]/.test(pw);
  const many = Array.from({ length: 200 }, () => generatePassword({ length: 24 }));
  r.genUnique = new Set(many).size === 200;

  // 5) postMessage dispatch: allow-listed verb works; UNKNOWN verb refused (capability attenuation)
  const captured = [];
  const fakeWin = { addEventListener(_t, fn) { this._fn = fn; }, removeEventListener() {} };
  installVaultBridge(fakeWin, surface);
  const send = (t, arg) => new Promise((res) => { const id = Math.random(); const src = { postMessage: (m) => { if (m.id === id) res(m); } }; fakeWin._fn({ data: { t, id, arg }, origin: "", source: src }); });
  const okList = await send("holo-vault:list");
  r.bridgeAllows = okList.ok === true && Array.isArray(okList.result);
  const bad1 = await send("holo-vault:export");          // not in the allow-list
  const bad2 = await send("holo-vault:rawSecret");       // not in the allow-list
  const bad3 = await send("holo-vault:unlock");          // never exposed
  r.bridgeRefusesUnknown = bad1.ok === false && bad2.ok === false && bad3.ok === false && /not permitted/.test(bad1.error);
  const okGen = await send("holo-vault:generate", { length: 16 });
  r.bridgeGenerate = okGen.ok === true && okGen.result.length === 16;

  r.ok = Object.values(r).every((x) => x === true);
  console.log("holo-vault-bridge witness:", JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
};
main().catch((e) => { console.error("WITNESS ERROR", e); process.exit(2); });
