// Witness the EXACT crypto the injected isolated-world signer runs (raw->DER + authenticatorData layout +
// clientDataJSON + ECDSA sign), proving it yields an RP-verifiable WebAuthn assertion — independent of the
// C++ host build. If this is GREEN, the browser proof should pass once the host links.
import crypto from 'node:crypto';
const { subtle } = globalThis.crypto;
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = new TextEncoder();

// --- mirror of the signer's der() (raw r||s -> DER ECDSA-Sig-Value) ---
function der(raw) {
  const t = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); if (b[0] & 0x80) { const x = new Uint8Array(b.length + 1); x[0] = 0; x.set(b, 1); b = x; } return b; };
  const r = t(raw.slice(0, 32)), s = t(raw.slice(32, 64));
  const len = 2 + r.length + 2 + s.length, o = new Uint8Array(2 + len); let k = 0;
  o[k++] = 0x30; o[k++] = len; o[k++] = 0x02; o[k++] = r.length; o.set(r, k); k += r.length; o[k++] = 0x02; o[k++] = s.length; o.set(s, k);
  return o;
}
function cat(a, b) { const u = new Uint8Array(a.length + b.length); u.set(a, 0); u.set(b, a.length); return u; }

async function sign(JWKSTR, RPID, USERHANDLE, SIGNCOUNT, CRED, req) {
  const jwk = JSON.parse(JWKSTR);
  const key = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const cd = JSON.stringify({ type: 'webauthn.get', challenge: req.challenge, origin: req.origin, crossOrigin: false });
  const cdb = enc.encode(cd);
  const cdh = new Uint8Array(await subtle.digest('SHA-256', cdb));
  const rph = new Uint8Array(await subtle.digest('SHA-256', enc.encode(RPID)));
  const sc = (SIGNCOUNT + 1) >>> 0;
  const ad = new Uint8Array(37); ad.set(rph, 0); ad[32] = 0x05; ad[33] = (sc >>> 24) & 255; ad[34] = (sc >>> 16) & 255; ad[35] = (sc >>> 8) & 255; ad[36] = sc & 255;
  const raw = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, cat(ad, cdh)));
  return { id: req.id, ok: true, credentialId: CRED, authenticatorData: b64u(ad), clientDataJSON: b64u(cdb), signature: b64u(der(raw)), userHandle: USERHANDLE };
}

async function main() {
  const r = {};
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privJwk = await subtle.exportKey('jwk', kp.privateKey);
  const pubJwk = await subtle.exportKey('jwk', kp.publicKey);
  const RPID = '127.0.0.1', ORIGIN = 'http://127.0.0.1:8496';
  const challenge = b64u(crypto.randomBytes(32)), credId = b64u(crypto.randomBytes(16)), uh = b64u(Buffer.from('op'));

  const asn = await sign(JSON.stringify(privJwk), RPID, uh, 7, credId, { id: 'x', challenge, origin: ORIGIN });
  r.signerProducesAssertion = asn.ok === true;

  const unb = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const authData = unb(asn.authenticatorData), clientDataJSON = unb(asn.clientDataJSON);
  const cd = JSON.parse(clientDataJSON.toString('utf8'));
  const cdHash = crypto.createHash('sha256').update(clientDataJSON).digest();
  const signedData = Buffer.concat([authData, cdHash]);
  const pubKey = crypto.createPublicKey({ key: pubJwk, format: 'jwk' });

  r.derSigVerifiesAtRP = crypto.verify('sha256', signedData, { key: pubKey, dsaEncoding: 'der' }, unb(asn.signature));
  r.rpIdHashCorrect = Buffer.compare(authData.subarray(0, 32), crypto.createHash('sha256').update(RPID).digest()) === 0;
  r.userPresentFlag = (authData[32] & 0x01) === 0x01;
  r.userVerifiedFlag = (authData[32] & 0x04) === 0x04;
  r.signCountAdvanced = ((authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36]) === 8; // 7+1
  r.clientTypeGet = cd.type === 'webauthn.get';
  r.clientOrigin = cd.origin === ORIGIN;
  r.clientChallenge = cd.challenge === challenge;
  r.credIdEcho = asn.credentialId === credId;
  r.userHandleEcho = asn.userHandle === uh;

  // tamper → must FAIL (the signature binds authData+clientData)
  const bad = Buffer.from(signedData); bad[0] ^= 0xff;
  r.tamperRejected = crypto.verify('sha256', bad, { key: pubKey, dsaEncoding: 'der' }, unb(asn.signature)) === false;

  r.ok = Object.entries(r).every(([k, v]) => k === 'ok' || v === true);
  console.log('holo-passkey-shim witness:', JSON.stringify(r, null, 2));
  if (!r.ok) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(2); });
