// holo-onion-snowflake-encap.mjs — Component B, first brick: Snowflake's `encapsulation` codec in JS.
//
// Snowflake layers a length-prefixed packet framing over the (stream-oriented) WebRTC DataChannel so KCP's
// datagrams survive. Each chunk = a variable-length prefix then that many bytes. Prefix (from the Tor source,
// common/encapsulation/encapsulation.go, v2.14.1):
//   first byte  dcxxxxxx   d=1 data / 0 padding · c=continuation · xxxxxx = top 6 length bits
//   cont bytes  cyyyyyyy   c=continuation · yyyyyyy = next 7 length bits  (max 3 bytes total → max len 0xFFFFF)
// This is the exact wire format the Snowflake bridge expects; get it byte-right or the bridge drops us.
//
// Session open (per DataChannel), handled by the CALLER not here: write Token(8)=0x1293605d278175f5 ‖
// ClientID(8 random) ‖ then encapsulated KCP packets via writeData(). See HOLO-BROWSER-TOR-ONION-B-PROMPT.md
// §B1 for the KCP(conv0·win65535·nodelay 0,0,0,1·stream·noFEC/crypto) + smux(v2) stack that rides on this.

export const TURBOTUNNEL_TOKEN = Uint8Array.of(0x12, 0x93, 0x60, 0x5d, 0x27, 0x81, 0x75, 0xf5);
export const MAX_DATA = 0xfffff; // 1048575 — the largest length a 3-byte prefix can encode

// writeData(payload) → Uint8Array: one data chunk (minimal 1–3 byte prefix + payload).
export function writeData(payload) {
  const n = payload.length;
  if (n > MAX_DATA) throw new Error("encapsulation: chunk too long (" + n + " > " + MAX_DATA + ")");
  const pfx = [];
  if (n < (1 << 6)) { pfx.push(0x80 | n); }                            // 10xxxxxx
  else if (n < (1 << 13)) { pfx.push(0xc0 | (n >> 7)); pfx.push(n & 0x7f); }            // 11xxxxxx 0yyyyyyy
  else { pfx.push(0xc0 | (n >> 14)); pfx.push(0x80 | ((n >> 7) & 0x7f)); pfx.push(n & 0x7f); } // 11.. 1.. 0..
  const out = new Uint8Array(pfx.length + n);
  out.set(pfx, 0); out.set(payload, pfx.length);
  return out;
}

// Streaming reader: feed(bytes) as they arrive; returns complete DATA payloads, skipping padding, buffering
// partial prefixes/chunks across feeds.
export function makeReader() {
  let buf = new Uint8Array(0);
  const cat = (a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; };
  return {
    feed(bytes) {
      buf = cat(buf, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      const out = [];
      for (;;) {
        if (buf.length < 1) break;
        let i = 0; const b0 = buf[i++];
        const isData = (b0 & 0x80) !== 0; let more = (b0 & 0x40) !== 0; let len = b0 & 0x3f;
        let bad = false, need = false;
        for (let k = 0; more; k++) {
          if (k >= 2) { bad = true; break; }
          if (i >= buf.length) { need = true; break; }
          const bb = buf[i++]; more = (bb & 0x80) !== 0; len = (len << 7) | (bb & 0x7f);
        }
        if (bad) throw new Error("encapsulation: length prefix too long");
        if (need) break;
        if (buf.length < i + len) break;
        const chunk = buf.slice(i, i + len);
        buf = buf.slice(i + len);
        if (isData) out.push(chunk);
      }
      return out;
    },
  };
}

export default { TURBOTUNNEL_TOKEN, MAX_DATA, writeData, makeReader };
