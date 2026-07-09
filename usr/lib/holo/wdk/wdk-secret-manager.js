// wdk-secret-manager.js — a BYTE-COMPATIBLE re-encoding of @tetherto/wdk-secret-manager
// (github.com/tetherto/wdk-secret-manager, Apache-2.0) for the browser + the OS witness.
//
// Why re-encoded, not vendored verbatim: upstream imports b4a + sodium-native + node:crypto,
// none of which are browser-portable. This module reproduces the EXACT documented vault format
// and the EXACT public API, over the audited @noble crypto we already vendor. A vault written
// here decrypts in upstream WDK and vice-versa:
//
//   Header (50B): version(1)=2 · kdf_alg(1)=1(PBKDF2-SHA256) · iterations(u32le) ·
//                 reserved(u32le=0) · salt(16) · nonce(24)
//   Body:         secretbox_easy( [len(1) ‖ data(16..64)] )   (XSalsa20-Poly1305, MAC-prefixed)
//   key:          PBKDF2-SHA256(passkey, salt, iterations, 32)  — or a supplied 32-byte master key
import { secretbox, pbkdf2, sha256, entropyToMnemonic as _entToMnemonic, mnemonicToEntropy as _mnemonicToEnt, mnemonicToSeed as _mnemonicToSeed, wordlist } from "../wdk-crypto/wdk-crypto.bundle.mjs";

const VERSION = 2;
const KDF_ALG = { PBKDF2_SHA256: 1 };
const SALT_BYTES = 16, NONCE_BYTES = 24, MAC_BYTES = 16, KEY_BYTES = 32;
const MIN_PLAINTEXT = 16, MAX_PLAINTEXT = 64;
const DEFAULT_PBKDF2_ITERATIONS = 100_000;
const HEADER_BYTES = 1 + 1 + 4 + 4 + SALT_BYTES + NONCE_BYTES; // 50

const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const u8 = (x) => (typeof x === "string" ? new TextEncoder().encode(x) : x instanceof Uint8Array ? x : new Uint8Array(x));
const concat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a, 0); o.set(b, a.length); return o; };
const writeU32LE = (b, o, v) => { b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff; };
const readU32LE = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const safeZero = (b) => { if (b) b.fill(0); };

export default class WdkSecretManager {
  /**
   * @param {Uint8Array|string} passKey - The passkey used for encryption (min 12 chars).
   * @param {Uint8Array} salt - A 16-byte salt for key derivation.
   * @param {{iterations?: number}} [kdfParams]
   */
  constructor (passKey, salt, kdfParams = {}) {
    this._validatePassKey(passKey);
    this._validateSalt(salt);
    /** @private */ this._passkey = u8(passKey).slice();
    /** @private */ this._salt = u8(salt).slice();
    /** @private */ this._iterations = kdfParams.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  }

  /** A 16-byte random salt, unique per passkey, stored alongside the encrypted data. */
  static generateSalt () { return randomBytes(SALT_BYTES); }

  /**
   * Generate 16-byte entropy, derive mnemonic + seed, and encrypt both.
   * @returns {Promise<{encryptedSeed: Uint8Array, encryptedEntropy: Uint8Array}>}
   */
  async generateAndEncrypt (entropyOpt = null, masterKeyOpt = null) {
    const entropy = entropyOpt ? this._validateEntropy(entropyOpt) : this.generateRandomBuffer();
    const mnemonic = _entToMnemonic(entropy, wordlist);
    const seed = await _mnemonicToSeed(mnemonic); // 64 bytes
    const encryptedEntropy = this.encrypt(entropy, masterKeyOpt);
    const encryptedSeed = this.encrypt(seed, masterKeyOpt);
    safeZero(seed);
    return { encryptedSeed, encryptedEntropy };
  }

  /** Encrypt 16–64 bytes with the versioned header + libsodium secretbox. */
  encrypt (data, masterKeyOpt = null) {
    this._validatePassKey(this._passkey);
    this._validateSalt(this._salt);
    data = u8(data);
    const len = data.byteLength;
    if (len < MIN_PLAINTEXT || len > MAX_PLAINTEXT) throw new Error(`Data length must be between ${MIN_PLAINTEXT} and ${MAX_PLAINTEXT} bytes`);

    const header = new Uint8Array(HEADER_BYTES);
    header[0] = VERSION;
    header[1] = KDF_ALG.PBKDF2_SHA256;
    writeU32LE(header, 2, this._iterations >>> 0);
    writeU32LE(header, 6, 0);
    header.set(this._salt, 10);
    const nonce = header.subarray(26, 26 + NONCE_BYTES);
    nonce.set(randomBytes(NONCE_BYTES));

    const key = masterKeyOpt ? this._validateKey32(masterKeyOpt) : this._deriveKeyPBKDF2(this._passkey, this._salt, this._iterations);
    const plain = new Uint8Array(1 + len);
    plain[0] = len;
    plain.set(data, 1);
    const cipher = secretbox(key, nonce).seal(plain); // (1+len) + MAC
    const payload = concat(header, cipher);
    safeZero(plain);
    if (!masterKeyOpt) safeZero(key);
    return payload;
  }

  /** Decrypt a payload produced by this manager (or by upstream WDK). */
  decrypt (payload, masterKeyOpt = null) {
    this._validatePassKey(this._passkey);
    this._validateSalt(this._salt);
    payload = u8(payload);
    if (payload.byteLength < HEADER_BYTES + 1 + MAC_BYTES) throw new Error("Invalid payload: too short");

    const header = payload.subarray(0, HEADER_BYTES);
    if (header[0] !== VERSION) throw new Error("Unsupported payload version");
    if (header[1] !== KDF_ALG.PBKDF2_SHA256) throw new Error("Unsupported KDF algorithm");
    const iterations = readU32LE(header, 2);
    const salt = header.subarray(10, 10 + SALT_BYTES);
    const nonce = header.subarray(26, 26 + NONCE_BYTES);
    const cipher = payload.subarray(HEADER_BYTES);

    const key = masterKeyOpt ? this._validateKey32(masterKeyOpt) : this._deriveKeyPBKDF2(this._passkey, salt, iterations);
    let plain;
    try { plain = secretbox(key, nonce).open(cipher); } catch { plain = null; }
    if (!masterKeyOpt) safeZero(key);
    if (!plain) throw new Error("Decryption failed");

    const len = plain[0];
    if (len < MIN_PLAINTEXT || len > MAX_PLAINTEXT) { safeZero(plain); throw new Error("Invalid decrypted length"); }
    if (plain.byteLength < 1 + len) { safeZero(plain); throw new Error("Invalid decrypted payload: inconsistent length"); }
    const out = plain.slice(1, 1 + len);
    safeZero(plain);
    return out;
  }

  /** 16 bytes of cryptographically secure entropy. */
  generateRandomBuffer () { return randomBytes(16); }

  /** 16-byte entropy → 12-word BIP-39 mnemonic. */
  entropyToMnemonic (entropy) { this._validateEntropy(entropy); return _entToMnemonic(u8(entropy), wordlist); }

  /** 12-word BIP-39 mnemonic → its original 16-byte entropy. */
  mnemonicToEntropy (mnemonic) {
    if (typeof mnemonic !== "string" || !mnemonic.trim()) throw new Error("Mnemonic must be a non-empty string");
    const buf = _mnemonicToEnt(mnemonic, wordlist);
    if (buf.byteLength !== 16) throw new Error("This manager expects 12-word mnemonics (16-byte entropy)");
    return buf;
  }

  /** Zero and release sensitive state. */
  dispose () {
    safeZero(this._salt); safeZero(this._passkey);
    this._salt = null; this._passkey = null; this._iterations = null;
  }

  /** @private */ _deriveKeyPBKDF2 (passkey, salt, iterations) { return pbkdf2(sha256, u8(passkey), u8(salt), { c: iterations, dkLen: KEY_BYTES }); }
  /** @private */ _validatePassKey (pk) { const b = u8(pk); if (b.byteLength < 12) throw new Error("Passkey must be at least 12 bytes/chars"); return b; }
  /** @private */ _validateSalt (salt) { const b = u8(salt); if (b.byteLength !== SALT_BYTES) throw new Error(`Salt must be ${SALT_BYTES} bytes`); return b; }
  /** @private */ _validateEntropy (e) { const b = u8(e); if (b.byteLength !== 16) throw new Error("Entropy must be 16 bytes"); return b; }
  /** @private */ _validateKey32 (k) { const b = u8(k); if (b.byteLength !== KEY_BYTES) throw new Error(`Master key must be ${KEY_BYTES} bytes`); return b; }
}
