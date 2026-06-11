// bip39-shim.js — the `bip39` npm-package API the vendored @tetherto/wdk-wallet base class
// expects (`import * as bip39 from 'bip39'`), satisfied by our audited @scure/bip39 bundle.
// The two libraries implement the identical BIP-39 standard; the only surface difference is
// that @scure takes an explicit wordlist (the `bip39` package defaults to english). This shim
// supplies the english wordlist and matches the `bip39` package signatures byte-for-byte.
import { generateMnemonic as gen, validateMnemonic as val, mnemonicToSeedSync as seedSync, mnemonicToSeed as seed, mnemonicToEntropy as toEnt, entropyToMnemonic as fromEnt, wordlist } from "../wdk-crypto/wdk-crypto.bundle.mjs";

export const generateMnemonic = (strength = 128) => gen(wordlist, strength);
export const validateMnemonic = (mnemonic) => val(mnemonic, wordlist);
export const mnemonicToSeedSync = (mnemonic, passphrase) => seedSync(mnemonic, passphrase);
export const mnemonicToSeed = (mnemonic, passphrase) => seed(mnemonic, passphrase);
export const mnemonicToEntropy = (mnemonic) => toEnt(mnemonic, wordlist);
export const entropyToMnemonic = (entropy) => fromEnt(entropy, wordlist);
