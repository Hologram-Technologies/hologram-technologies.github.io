// holo-proquint.mjs — the ONE human-pronounceable encoding for any run of bytes
// (Daniel Wilkerson's proquint, the open spec). A 16-bit word ⇄ a 5-letter
// pronounceable quint (consonant-vowel-consonant-vowel-consonant); words joined by
// "-". Bijective, deterministic, reversible, dependency-free — no wordlist, no
// registry, no network. Proquints were invented to make IP addresses speakable, so
// the SAME codec serves both a κ-tail (holo-truename) and an IPv6 address
// (holo-locator): one alphabet for identity and location alike.
//
// Authority: proquint (arXiv:0901.4016 / the canonical reference vectors below).

// 16 consonants (4 bits) · 4 vowels (2 bits) → 4+2+4+2+4 = 16 bits per quint.
const CON = "bdfghjklmnprstvz";
const VOW = "aiou";
const CONI = Object.fromEntries([...CON].map((c, i) => [c, i]));
const VOWI = Object.fromEntries([...VOW].map((v, i) => [v, i]));

const quint16 = (n) =>
  CON[(n >>> 12) & 0x0f] + VOW[(n >>> 10) & 0x03] + CON[(n >>> 6) & 0x0f] +
  VOW[(n >>> 4) & 0x03] + CON[n & 0x0f];

function unquint(q) {
  if (q.length !== 5) throw new Error("proquint: a quint is 5 letters, got " + JSON.stringify(q));
  const slot = [CONI, VOWI, CONI, VOWI, CONI];
  const v = [];
  for (let i = 0; i < 5; i++) {
    const idx = slot[i][q[i]];
    if (idx === undefined) throw new Error("proquint: bad letter " + JSON.stringify(q[i]) + " at " + i);
    v.push(idx);
  }
  return (v[0] << 12) | (v[1] << 10) | (v[2] << 6) | (v[3] << 4) | v[4];
}

// encode(u8) → "lusab-babad" — requires an even byte length (whole 16-bit words).
export function encode(u8) {
  const b = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
  if (b.length % 2) throw new Error("proquint: even byte length required, got " + b.length);
  const quints = [];
  for (let i = 0; i < b.length; i += 2) quints.push(quint16((b[i] << 8) | b[i + 1]));
  return quints.join("-");
}

// decode("lusab-babad") → Uint8Array — the exact inverse of encode().
export function decode(s) {
  const quints = String(s).toLowerCase().split("-").filter(Boolean);
  const out = new Uint8Array(quints.length * 2);
  for (let i = 0; i < quints.length; i++) {
    const w = unquint(quints[i]);
    out[i * 2] = (w >>> 8) & 0xff;
    out[i * 2 + 1] = w & 0xff;
  }
  return out;
}

// a well-formed proquint string: dash-joined 5-letter quints over the fixed alphabet.
export function isProquint(s) {
  return /^[bdfghjklmnprstvz][aiou][bdfghjklmnprstvz][aiou][bdfghjklmnprstvz](-[bdfghjklmnprstvz][aiou][bdfghjklmnprstvz][aiou][bdfghjklmnprstvz])*$/.test(String(s).toLowerCase());
}

export const ALPHABET = { consonants: CON, vowels: VOW };
