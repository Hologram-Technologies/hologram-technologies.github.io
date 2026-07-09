// holo-solana.js — the Solana source for Holo Etherscan (the non-EVM unification).
//
// Solana is NOT EVM: no keccak/RLP, no 0x addresses, no mempool. Identities are ed25519
// and base58 — a transaction's id is its first signature; an account is a pubkey; a block
// is a slot. So the UOR "verify by re-derivation" takes its Solana-native form:
//   • κ = ed25519 SIGNATURE VERIFICATION — we re-serialize the transaction MESSAGE and
//     verify the signer's ed25519 signature over it (WebCrypto Ed25519). This proves the
//     transaction is cryptographically AUTHENTIC — stronger than a hash match.
//   • content address = holo://<base58(SHA-256(message))> — a real content hash.
// History is native (getSignaturesForAddress), holdings are native
// (getTokenAccountsByOwner), and the live firehose is logsSubscribe (see holo-solana-stream.js).

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function bs58enc(buf) {
  const d = [0]; for (const b of buf) { let c = b; for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } }
  let s = ""; for (const b of buf) { if (b === 0) s += "1"; else break; } return s + d.reverse().map((x) => B58[x]).join("");
}
export function bs58dec(str) {
  const d = [0]; for (const ch of str) { const v = B58.indexOf(ch); if (v < 0) throw new Error("bad base58"); let c = v; for (let i = 0; i < d.length; i++) { c += d[i] * 58; d[i] = c & 0xff; c >>= 8; } while (c) { d.push(c & 0xff); c >>= 8; } }
  let zeros = 0; for (const ch of str) { if (ch === "1") zeros++; else break; } return new Uint8Array([...Array(zeros).fill(0), ...d.reverse()]);
}
const b64dec = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const shortvec = (buf, off) => { let v = 0, shift = 0, p = off; for (;;) { const b = buf[p++]; v |= (b & 0x7f) << shift; if ((b & 0x80) === 0) break; shift += 7; } return [v, p]; };
const u8concat = (...a) => { let n = 0; for (const x of a) n += x.length; const o = new Uint8Array(n); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };

// ── Metaplex on-chain token metadata (names/symbols) — UOR-pure, no external service ───
// The metadata account is a Program-Derived Address (deterministic from the mint), so
// reading a token's name is reading on-chain CONTENT addressed by its PDA. Deriving the
// PDA needs an ed25519 on-curve test (findProgramAddress wants the first OFF-curve bump).
const ED_P = 2n ** 255n - 19n, ED_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
const modpow = (b, e, m) => { b = ((b % m) + m) % m; let r = 1n; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; };
const modinv = (a, m) => modpow(a, m - 2n, m);
function isOnCurve(bytes) { let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]); y &= (1n << 255n) - 1n; if (y >= ED_P) return false; const y2 = y * y % ED_P; const u = (y2 - 1n + ED_P) % ED_P; const v = (ED_D * y2 + 1n) % ED_P; const x2 = u * modinv(v, ED_P) % ED_P; return x2 === 0n || modpow(x2, (ED_P - 1n) / 2n, ED_P) === 1n; }
const MPL = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
export async function metadataPda(mint) {
  const mpl = bs58dec(MPL), seeds = [new TextEncoder().encode("metadata"), mpl, bs58dec(mint)], tail = new TextEncoder().encode("ProgramDerivedAddress");
  for (let bump = 255; bump >= 0; bump--) { const h = new Uint8Array(await crypto.subtle.digest("SHA-256", u8concat(...seeds, new Uint8Array([bump]), mpl, tail))); if (!isOnCurve(h)) return bs58enc(h); }
  return null;
}
function parseMetadata(data) { const rd = (o) => { const len = data[o] | data[o + 1] << 8 | data[o + 2] << 16 | data[o + 3] << 24; return [new TextDecoder().decode(data.subarray(o + 4, o + 4 + len)).replace(/\0+$/, ""), o + 4 + len]; }; let off = 1 + 32 + 32; let name, symbol, uri; [name, off] = rd(off); [symbol, off] = rd(off); [uri, off] = rd(off); return { name: name.trim(), symbol: symbol.trim(), uri: uri.trim() }; }

export const isSolAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || ""));
export const isSolSig = (s) => /^[1-9A-HJ-NP-Za-km-z]{86,90}$/.test(String(s || ""));
export const LAMPORTS = 1e9;
export const fmtSol = (lamports, dp = 6) => (Number(lamports || 0) / LAMPORTS).toLocaleString(undefined, { maximumFractionDigits: dp });

// Known program ids → friendly names (the Solana analog of a 4-byte method dictionary).
export const PROGRAMS = {
  "11111111111111111111111111111111": "System", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "Token", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb": "Token-2022",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": "Associated Token", "ComputeBudget111111111111111111111111111111": "Compute Budget",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": "Jupiter v6", "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc": "Orca Whirlpool",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM", "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr": "Memo", "vote111111111111111111111111111111111111111": "Vote",
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s": "Token Metadata", "BPFLoaderUpgradeab1e11111111111111111111111": "BPF Upgradeable Loader",
};
export const progName = (id) => PROGRAMS[id] || (id ? id.slice(0, 4) + "…" + id.slice(-4) : "?");

export class SolanaSource {
  constructor(rpc) { this.url = rpc; this.id = 0; this.api = rpc; this._cache = new Map(); this._price = undefined; }
  async call(method, params = [], { signal } = {}) {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 18000); const onAb = () => ac.abort(); if (signal) signal.addEventListener("abort", onAb, { once: true });
    try { const r = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }), signal: ac.signal }); const j = await r.json(); if (j.error) throw new Error(j.error.message || JSON.stringify(j.error)); return j.result; }
    catch (e) { if (e.name === "AbortError") throw new Error("request timed out"); throw e; } finally { clearTimeout(to); if (signal) signal.removeEventListener("abort", onAb); }
  }
  async batch(calls) {
    const body = calls.map((c) => ({ jsonrpc: "2.0", id: ++this.id, method: c.method, params: c.params || [] }));
    const r = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const arr = await r.json();
    const byId = new Map((Array.isArray(arr) ? arr : [arr]).map((x) => [x.id, x])); return body.map((b) => byId.get(b.id)?.result ?? null);
  }
  getSlot() { return this.call("getSlot", [{ commitment: "confirmed" }]); }
  async perf() { const s = await this.call("getRecentPerformanceSamples", [1]).catch(() => null); const x = s && s[0]; return x ? { tps: x.numTransactions / x.samplePeriodSecs, slot: x.slot } : null; }
  async price() {
    if (this._price !== undefined) return this._price;
    try { const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true&include_market_cap=true"); const j = await r.json(); this._price = j.solana || null; } catch { this._price = null; }
    return this._price;
  }
  block(slot, full = false) { return this.call("getBlock", [Number(slot), { maxSupportedTransactionVersion: 0, transactionDetails: full ? "full" : "signatures", rewards: false, commitment: "confirmed" }]).catch(() => null); }
  async recentBlocks(n = 8) {
    const slot = await this.getSlot();
    const blocks = await this.batch(Array.from({ length: n }, (_, i) => ({ method: "getBlock", params: [slot - i, { maxSupportedTransactionVersion: 0, transactionDetails: "signatures", rewards: false, commitment: "confirmed" }] })));
    return blocks.map((b, i) => b ? { slot: slot - i, blockhash: b.blockhash, parent_slot: b.parentSlot, block_time: b.blockTime, tx_count: (b.signatures || []).length, leader: null } : null).filter(Boolean);
  }
  // tx: jsonParsed for rich display + base64 for the ed25519 κ check
  async tx(sig) {
    const [parsed, raw] = await Promise.all([
      this.call("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]).catch(() => null),
      this.call("getTransaction", [sig, { encoding: "base64", maxSupportedTransactionVersion: 0, commitment: "confirmed" }]).catch(() => null),
    ]);
    if (!parsed) return null;
    let kappa = null; try { if (raw?.transaction?.[0]) kappa = await verifyTxRaw(b64dec(raw.transaction[0])); } catch {}
    return { ...parsed, _kappa: kappa };
  }
  accountTxns(addr, before) { return this.call("getSignaturesForAddress", [addr, { limit: 25, ...(before ? { before } : {}), commitment: "confirmed" }]).catch(() => []); }
  account(addr) { return this.call("getAccountInfo", [addr, { encoding: "jsonParsed", commitment: "confirmed" }]).catch(() => null); }
  balance(addr) { return this.call("getBalance", [addr, { commitment: "confirmed" }]).then((r) => r?.value ?? 0).catch(() => 0); }
  async tokenAccounts(addr) {
    const r = await this.call("getTokenAccountsByOwner", [addr, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed", commitment: "confirmed" }]).catch(() => null);
    return (r?.value || []).map((a) => { const info = a.account?.data?.parsed?.info; return { mint: info?.mint, amount: info?.tokenAmount?.uiAmountString, decimals: info?.tokenAmount?.decimals, raw: info?.tokenAmount?.amount }; }).filter((t) => t.mint && +t.raw > 0);
  }
  async mint(addr) { const a = await this.account(addr); const info = a?.value?.data?.parsed?.info; if (!info) return null; return { address: addr, supply: info.supply, decimals: info.decimals, mintAuthority: info.mintAuthority, isInitialized: info.isInitialized }; }
  // on-chain Metaplex name/symbol (cached); returns {symbol,name} or nulls for the long tail
  async tokenMeta(mint) {
    if (!this._tmeta) this._tmeta = new Map(); if (this._tmeta.has(mint)) return this._tmeta.get(mint);
    let meta = { symbol: null, name: null };
    try { const pda = await metadataPda(mint); const acc = pda && await this.call("getAccountInfo", [pda, { encoding: "base64" }]); if (acc?.value?.data?.[0]) { const m = parseMetadata(b64dec(acc.value.data[0])); meta = { symbol: m.symbol || null, name: m.name || null }; } } catch {}
    this._tmeta.set(mint, meta); return meta;
  }
}

// ── ed25519 κ — verify the signer's signature over the re-serialized message ──────────
// WebCrypto Ed25519 (modern Chromium / Node 22 webcrypto). Returns the signer, the
// signature count, and the content address (base58 of SHA-256(message)).
export async function verifyTxRaw(raw) {
  const subtle = (globalThis.crypto && globalThis.crypto.subtle) || null; if (!subtle) throw new Error("no WebCrypto");
  const [numSigs, p1] = shortvec(raw, 0);
  const sig0 = raw.subarray(p1, p1 + 64);
  const msg = raw.subarray(p1 + 64 * numSigs);
  let off = 0; if (msg[0] & 0x80) off = 1; off += 3;            // optional version byte + 3-byte header
  const [, p2] = shortvec(msg, off); const key0 = msg.subarray(p2, p2 + 32);    // first account key = first signer
  const key = await subtle.importKey("raw", key0, { name: "Ed25519" }, false, ["verify"]);
  const ok = await subtle.verify("Ed25519", key, sig0, msg);
  const ch = new Uint8Array(await subtle.digest("SHA-256", msg));
  return { ok, signer: bs58enc(key0), sigCount: numSigs, contentHash: bs58enc(ch) };
}

// hermetic self-test (base58 round-trip + a known Ed25519 vector) for the witness
export async function selfTest() {
  const r = []; const chk = (n, c) => r.push({ name: n, ok: !!c });
  chk("base58('Hello World!')", bs58enc(new TextEncoder().encode("Hello World!")) === "2NEpo7TZRRrLZSi2U");
  chk("base58 round-trip", bs58enc(bs58dec("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")) === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  try { chk("Metaplex metadata PDA(USDC)", (await metadataPda("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")) === "5x38Kp4hvdomTCnCrAny4UtMUt5rQBdB6px2K1Ui45Wq"); } catch { chk("Metaplex metadata PDA(USDC)", false); }
  // RFC 8032 Ed25519 test vector 1
  try {
    const subtle = globalThis.crypto.subtle;
    const pub = Uint8Array.from([0xd7,0x5a,0x98,0x01,0x82,0xb1,0x0a,0xb7,0xd5,0x4b,0xfe,0xd3,0xc9,0x64,0x07,0x3a,0x0e,0xe1,0x72,0xf3,0xda,0xa6,0x23,0x25,0xaf,0x02,0x1a,0x68,0xf7,0x07,0x51,0x1a]);
    const sig = Uint8Array.from([0xe5,0x56,0x43,0x00,0xc3,0x60,0xac,0x72,0x90,0x86,0xe2,0xcc,0x80,0x6e,0x82,0x8a,0x84,0x87,0x7f,0x1e,0xb8,0xe5,0xd9,0x74,0xd8,0x73,0xe0,0x65,0x22,0x49,0x01,0x55,0x5f,0xb8,0x82,0x15,0x90,0xa3,0x3b,0xac,0xc6,0x1e,0x39,0x70,0x1c,0xf9,0xb4,0x6b,0xd2,0x5b,0xf5,0xf0,0x59,0x5b,0xbe,0x24,0x65,0x51,0x41,0x43,0x8e,0x7a,0x10,0x0b]);
    const k = await subtle.importKey("raw", pub, { name: "Ed25519" }, false, ["verify"]);
    chk("Ed25519 RFC8032 vector verifies", await subtle.verify("Ed25519", k, sig, new Uint8Array(0)));
  } catch (e) { chk("Ed25519 RFC8032 vector verifies", false); r[r.length - 1].err = String(e.message || e); }
  return { ok: r.every((x) => x.ok), results: r };
}
