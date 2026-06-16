#!/usr/bin/env node
// holo-onion-witness.mjs — proves the omni resolver gains a Tor v3 .onion leg that is CRYPTOGRAPHICALLY
// honest (Law L5) and TRANSPORT-honest. An onion address is admitted only if it re-derives to itself —
// base32(ed25519_pubkey ‖ SHA3-256-checksum ‖ version=3) — with NO network. And because a tab cannot join
// the Tor network natively, a valid address still resolves to an HONEST NULL until an explicit transport is
// configured, sealing an egress receipt that PINS the transport (or null) and never claims direct routing.
//
// Checks (all must hold):
//   1 sha3Vector        — the SHA3-256 primitive matches the FIPS-202 empty-string vector (NOT keccak256).
//   2 validV3Accepts    — a minted v3 address (pubkey→checksum→base32) validates ok; a real Tor Project address validates too.
//   3 corruptRejected   — flipping one base32 char of a valid address fails the checksum → refused.
//   4 v2Rejected        — a 16-char (v2) address is refused with an honest "deprecated/unsupported" reason.
//   5 notOnionNull      — a non-onion host (example.com) is NOT claimed by the onion parser (returns null).
//   6 transportAbsent   — resolveOnion(validAddr) with no transport → ok:false, validated card sealed, reason names the transport need.
//   7 egressReceipt     — the receipt is a hosc:Egress that pins transport=null, grant="none", outcome="refused", directTor=false, and RE-DERIVES (Law L5).
//   8 cardReDerives     — the descriptor card's κ = address(card) (Law L5 on the card itself).
//   9 unifiedOnionLane  — classifyUnified + resolveUnified route the address through the "onion" lane with the same honest-null envelope.
//
// Authority (external): Tor rendezvous spec v3 (onion address = base32(PUBKEY ‖ CHECKSUM ‖ VERSION),
// CHECKSUM = SHA3-256(".onion checksum" ‖ PUBKEY ‖ VERSION)[:2]) · NIST FIPS-202 SHA-3 · W3C DID Core +
// multiformats (κ = did:holo:sha256) · W3C PROV-O (egress receipt) · holospaces Laws L1/L5. Usage:
// node tools/holo-onion-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import { sha3_256, parseOnionRef, validateOnion, onionAddressFromPubkey, resolveOnion } from "../os/sbin/holo-omni-onion.mjs";
import { classifyUnified, resolveUnified } from "../os/sbin/holo-omni-unified.mjs";
import { normalizeTransport, gatewayUrl, fetchViaGateway, socks5ConnectByDomain, parseSocks5ConnectReply, fetchViaSocks5, probeLocalTor, resolveActiveTransport } from "../os/sbin/holo-omni-onion-transport.mjs";
import { parseAhmia, searchOnionWeb } from "../os/sbin/holo-onion-discover.mjs";
import { address } from "../os/usr/lib/holo/q/holo-q-receipt.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const write = (r) => writeFileSync(join(here, "holo-onion-witness.result.json"), JSON.stringify(r, null, 2) + "\n");
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
const checks = {};

// ── 1 · SHA3-256 against the FIPS-202 anchor — proves we did not accidentally ship keccak256 ─────────
{
  const empty = hex(sha3_256(new Uint8Array(0)));
  checks.sha3Vector = empty === "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a";
}

// mint a guaranteed-valid v3 address from a fixed 32-byte key (no network, no fixtures).
const pub = new Uint8Array(32); for (let i = 0; i < 32; i++) pub[i] = (i * 7 + 3) & 0xff;
const minted = onionAddressFromPubkey(pub);

// ── 2 · a minted v3 validates; a real-world Tor Project address validates too (external truth anchor) ─
{
  const m = validateOnion(minted);
  const torProject = validateOnion("2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion");
  checks.validV3Accepts = m.ok === true && m.version === 3 && m.pubkeyHex === hex(pub) && torProject.ok === true && torProject.version === 3;
}

// ── 3 · corrupt one char → checksum mismatch → refused ───────────────────────────────────────────────
{
  const host = minted.replace(/\.onion$/, "");
  const flip = (host[0] === "a" ? "b" : "a") + host.slice(1);   // change the first base32 char
  const bad = validateOnion(flip + ".onion");
  checks.corruptRejected = bad.ok === false && /checksum/i.test(bad.reason);
}

// ── 4 · v2 (16-char) → refused with an honest deprecation reason ─────────────────────────────────────
{
  const v2 = validateOnion("expyuzz4wqqyqhjn.onion");          // a 16-char v2-shaped address
  checks.v2Rejected = v2.ok === false && v2.version === 2 && /deprecat|unsupported/i.test(v2.reason);
}

// ── 5 · a non-onion host is not hijacked by the onion parser ─────────────────────────────────────────
{
  checks.notOnionNull = parseOnionRef("example.com") === null && parseOnionRef("https://news.ycombinator.com") === null && parseOnionRef(minted) !== null;
}

// ── 6 · transport absent → honest null (valid address, no render, clear reason) ──────────────────────
let out;
{
  out = await resolveOnion(minted);
  checks.transportAbsent = out.ok === false && out.subkind === "v3" && !!out.kappa && !!out.card && out.transport === null && /transport/i.test(out.reason);
}

// ── 7 · the egress receipt pins the (null) transport, refuses honestly, and re-derives (Law L5) ──────
{
  const r = out.receipt, b = r && r.body;
  const shape = !!b && Array.isArray(b["@type"]) && b["@type"].includes("hosc:Egress") &&
    b["hosc:network"] === "tor" && b["hosc:transport"] === null && b["hosc:grant"] === "none" &&
    b["hosc:outcome"] === "refused" && b["hosc:directTor"] === false && b["prov:generated"]["@id"] === out.kappa;
  const reDerives = shape && (await address(b)) === r.id;
  checks.egressReceipt = shape && reDerives;
}

// ── 8 · the descriptor card is content-addressed: its κ = address(card) (Law L5) ─────────────────────
{
  checks.cardReDerives = (await address(out.card)) === out.kappa;
}

// ── 9 · the unified one-door routes the address through the onion lane, same honest-null envelope ────
{
  const cls = classifyUnified(minted);
  const u = await resolveUnified(minted);
  checks.unifiedOnionLane = cls.lane === "onion" && cls.label === "Tor onion service" &&
    u.lane === "onion" && u.ok === false && !!u.card && !!u.receipt && (await address(u.card)) === u.kappa;
}

// ── 10 · transport config gate: only a known, endpoint-bearing transport survives normalization ──────
{
  const ok = normalizeTransport({ kind: "gateway", endpoint: "onion.ws" });
  checks.transportNormalize = !!ok && ok.kind === "gateway" &&
    normalizeTransport(null) === null && normalizeTransport({ kind: "none" }) === null &&
    normalizeTransport({ kind: "gateway" }) === null && normalizeTransport({ kind: "bogus", endpoint: "x" }) === null;
}

// ── 11 · gateway URL mapping — both the suffix-domain and the {template} styles ───────────────────────
{
  const suffix = gatewayUrl("http://" + minted + "/a/b?q=1", "onion.ws");
  const templ = gatewayUrl("http://" + minted + "/a/b?q=1", "https://gw.example/proxy?u={host}&p={path}");
  checks.gatewayUrlMaps = suffix === "https://" + minted + ".onion.ws/a/b?q=1" &&
    templ === "https://gw.example/proxy?u=" + minted + "&p=a/b?q=1";
}

// ── 12 · gateway fetch — a fake gateway serves bytes; the adapter returns them + the via URL ───────────
{
  const body = new TextEncoder().encode("<html>onion via gateway</html>");
  const fakeFetch = async (url) => ({ ok: true, status: 200, headers: { get: (h) => h === "content-type" ? "text/html" : null }, arrayBuffer: async () => body.buffer });
  const got = await fetchViaGateway("http://" + minted + "/", normalizeTransport({ kind: "gateway", endpoint: "onion.ws" }), fakeFetch);
  checks.gatewayFetch = !!got && got.ok === true && new TextDecoder().decode(got.bytes) === "<html>onion via gateway</html>" && /onion\.ws/.test(got.via);
}

// ── 13 · socks5 CONNECT names the host BY DOMAIN (atyp 0x03) — Tor resolves the .onion, not us ────────
{
  const host = minted;                                       // <addr>.onion, 56+6 chars
  const frame = socks5ConnectByDomain(host, 80);
  const hb = new TextEncoder().encode(host);
  const named = frame[0] === 0x05 && frame[1] === 0x01 && frame[3] === 0x03 && frame[4] === hb.length &&
    new TextDecoder().decode(frame.subarray(5, 5 + hb.length)) === host &&
    frame[frame.length - 2] === 0 && frame[frame.length - 1] === 80;       // port 80, big-endian
  const reply = parseSocks5ConnectReply(Uint8Array.of(0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0));
  checks.socks5ByDomain = named && reply.ok === true && reply.headerLen === 10;
}

// ── 14 · socks5 fetch — drive the full client state machine against a fake Tor SOCKS5 socket ──────────
{
  const httpResp = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n<html>onion via tor</html>";
  const fakeNet = {
    connect(_opts, onConnect) {
      const s = new EventEmitter();
      s.write = (buf) => {
        const b = new Uint8Array(buf);
        if (b[0] === 0x05 && b[1] === 0x01 && b[2] === 0x00 && b.length === 3) { setImmediate(() => s.emit("data", Buffer.from([0x05, 0x00]))); return true; }   // greeting → no-auth
        if (b[0] === 0x05 && b[1] === 0x01 && b[3] === 0x03) { setImmediate(() => s.emit("data", Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))); return true; }   // CONNECT → success
        setImmediate(() => { s.emit("data", Buffer.from(httpResp, "latin1")); s.emit("end"); }); return true;   // HTTP request → response then close
      };
      s.setTimeout = () => {}; s.destroy = () => {};
      setImmediate(onConnect);
      return s;
    },
  };
  const got = await fetchViaSocks5("http://" + minted + "/", normalizeTransport({ kind: "socks5", endpoint: "127.0.0.1:9050" }), { net: fakeNet });
  checks.socks5Fetch = !!got && got.ok === true && got.status === 200 && new TextDecoder().decode(got.bytes) === "<html>onion via tor</html>" && /socks5:\/\/127\.0\.0\.1:9050/.test(got.via);
}

// ── 15 · transport-ready: with a transport configured, resolveOnion marks the service browsable, pins
//        the transport in the receipt, keeps directTor=false, and the card still re-derives (Law L5) ──
{
  const r = await resolveOnion(minted, { transport: { kind: "gateway", endpoint: "onion.ws" } });
  const b = r.receipt && r.receipt.body;
  checks.transportReady = r.ok === true && r.subkind === "v3" && !!r.browse && r.browse.via === "gateway" &&
    r.browse.url === "http://" + minted + "/" && r.transport && r.transport["hosc:kind"] === "gateway" &&
    b["hosc:outcome"] === "transport-ready" && b["hosc:directTor"] === false && b["hosc:grant"] === "onion-transport" &&
    (await address(r.card)) === r.kappa;
}

// ── 16 · auto-detect local Tor — paste-and-go: a listening 9050/9150 yields a socks5 transport, none → null ──
{
  const fakeNet = (listening) => ({ connect(opts, onConnect) { const s = new EventEmitter(); s.setTimeout = () => {}; s.destroy = () => {}; setImmediate(() => { if (listening.includes(opts.port)) onConnect(); else s.emit("error", new Error("ECONNREFUSED")); }); return s; } });
  const up = await probeLocalTor({ net: fakeNet([9050]) });
  const browserPort = await probeLocalTor({ net: fakeNet([9150]) });
  const down = await probeLocalTor({ net: fakeNet([]) });
  checks.autoTorProbe = !!up && up.kind === "socks5" && up.endpoint === "127.0.0.1:9050" &&
    !!browserPort && browserPort.endpoint === "127.0.0.1:9150" && down === null;
}

// ── 17 · transport priority — explicit override beats autodetect; with none, autodetected Tor is used ──
{
  const fakeNet = { connect(_o, cb) { const s = new EventEmitter(); s.setTimeout = () => {}; s.destroy = () => {}; setImmediate(cb); return s; } };
  const explicit = await resolveActiveTransport({ override: { kind: "gateway", endpoint: "onion.ws" }, net: fakeNet });
  const auto = await resolveActiveTransport({ net: fakeNet });
  checks.transportPriority = explicit.kind === "gateway" && auto.kind === "socks5" && auto.label === "local-tor";
}

// ── 18 · discover: parse a clearnet onion-index (Ahmia) result page → v3 onion results (no network) ──
{
  const fixture = `<ol><li class="result"><h4><a href="/search/redirect?redirect_url=http://${minted}/">The Hidden Service</a></h4><cite>http://${minted}/wiki</cite><p>A sample onion service description.</p></li>` +
    `<li class="result"><h4><a>Second Service</a></h4><cite>http://2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion/</cite><p>Tor Project mirror.</p></li></ol>`;
  const rows = parseAhmia(fixture);
  const a = rows.find((r) => r.host === minted);
  checks.discoverParse = rows.length === 2 && !!a && a.title === "The Hidden Service" && /sample onion/.test(a.snippet) &&
    rows.some((r) => r.host === "2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid.onion");
}

// ── 19 · discover: searchOnionWeb routes through the injected fetch and returns results / honest null ──
{
  const fakeFetch = async (url) => ({ ok: true, status: 200, text: async () => `<li class="result"><cite>http://${minted}/</cite><h4><a>Hit</a></h4></li>` });
  const got = await searchOnionWeb("hidden wiki", { fetchImpl: fakeFetch });
  const down = await searchOnionWeb("x", { fetchImpl: async () => ({ ok: false, status: 503 }) });
  checks.discoverSearch = got.ok === true && got.via === "ahmia" && got.results.length === 1 && got.results[0].host === minted &&
    down.ok === false && /503/.test(down.reason);
}

const witnessed = Object.values(checks).every(Boolean);
write({
  spec: "Holo omnisearch resolves Tor v3 .onion addresses: cryptographically validated from first principles (ed25519 pubkey · SHA3-256 checksum, no network), sealed as a κ-addressed descriptor card, TRANSPORT-honest (a valid address is an honest null until an explicit Tor transport is set), and BROWSABLE through one of two configured transports — an onion HTTP gateway or a local Tor SOCKS5 proxy (CONNECT by domain so Tor resolves the .onion) — every fetch pinning its transport with directTor=false, never disguised as direct anonymous routing (Law L5)",
  authority: "Tor rendezvous spec v3 · SOCKS5 (RFC 1928) · NIST FIPS-202 SHA-3 · W3C DID Core + multiformats · W3C PROV-O · holospaces Laws L1/L5",
  witnessed,
  covers: witnessed ? ["v3-checksum-sha3-256", "v2-rejected", "corrupt-rejected", "transport-absent-honest-null", "egress-receipt-pins-transport", "law-l5-card", "unified-onion-lane", "transport-config-gate", "gateway-adapter", "socks5-connect-by-domain", "socks5-adapter", "transport-ready-browse", "auto-detect-local-tor", "transport-priority", "discover-parse-ahmia", "discover-search"] : [],
  checks,
});
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓ Tor v3 .onion resolves through omnisearch — cryptographically + transport honest (Law L5)" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
