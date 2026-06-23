// holo-autofill-witness.mjs — proves the autofill engine's pure detection logic (the brittle part):
// username↔password association across common layouts, and signup-form rejection (never autofill a saved
// login into a create-account/change-password form). DOM-level fill + save-capture + anti-phishing are
// proven in the browser demo (holo-autofill-demo.html).
//   node holo-autofill-witness.mjs
import { associateLogin, isSignup } from "../os/usr/lib/holo/holo-autofill.mjs";

const r = {};
const F = (arr) => arr.map((f, idx) => ({ idx, tag: "INPUT", type: f.type || "text", name: f.name || "", id: f.id || "", autocomplete: f.ac || "" }));

// 1) email + password
{ const a = associateLogin(F([{ type: "email", name: "email" }, { type: "password", name: "pw" }])); r.emailPw = a.user === 0 && a.pass === 1; }
// 2) username(text) + password
{ const a = associateLogin(F([{ type: "text", name: "username" }, { type: "password" }])); r.userPw = a.user === 0 && a.pass === 1; }
// 3) autocomplete-tagged username wins even with a decoy text field before it
{ const a = associateLogin(F([{ type: "text", name: "decoy" }, { type: "text", ac: "username" }, { type: "password" }])); r.acWins = a.user === 1 && a.pass === 2; }
// 4) password-only (some 2-step flows) → pass found, user null
{ const a = associateLogin(F([{ type: "password" }])); r.passOnly = a && a.user === null && a.pass === 0; }
// 5) no password → null (not a login form)
{ const a = associateLogin(F([{ type: "text", name: "q" }])); r.noPass = a === null; }
// 6) signup / change-password (two password fields) → rejected by isSignup
{ r.signupRejected = isSignup(F([{ type: "password", name: "new" }, { type: "password", name: "confirm" }])) === true; }
{ r.loginNotSignup = isSignup(F([{ type: "email" }, { type: "password" }])) === false; }

r.ok = Object.values(r).every((x) => x === true);
console.log("holo-autofill witness:", JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 1);
