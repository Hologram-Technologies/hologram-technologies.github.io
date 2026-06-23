// holo-walletconnect-witness.mjs — proves the WalletConnect connector routes every dApp signing request
// through the step-up gate to the wallet, over an in-memory relay (no network). Asserts the happy path
// (gated sign returns a signature) AND the refusals: ungated sign fail-closed, unsupported method, and a
// tampered/foreign envelope ignored (SEC-1). Transport + wallet + stepup are injected (the design seam).
//   node holo-walletconnect-witness.mjs
import { parsePairingUri, makeEnvelope, createConnector } from "../os/usr/lib/holo/holo-walletconnect.mjs";

const r = {};
const OP = "did:holo:sha256:" + "ab".repeat(32);
const symKey = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join("");
const topic = "a1b2c3d4e5f6";
const uri = `wc:${topic}@2?relay-protocol=irn&symKey=${symKey}`;

// in-memory relay bus (same topic both directions; each side filters req vs resp)
function makeBus() { const subs = []; return { subscribe: (t, h) => subs.push({ t, h }), publish: async (t, raw) => { for (const s of subs) if (s.t === t) s.h(raw); } }; }

// a mock dApp speaking the protocol over the bus
async function makeDapp(bus) {
  const env = await makeEnvelope(symKey); const pend = new Map(); let id = 0;
  bus.subscribe(topic, async (raw) => { const m = await env.open(raw); if (m && !m.method && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params) => new Promise(async (res) => { const i = ++id; pend.set(i, res); await bus.publish(topic, await env.seal({ id: i, jsonrpc: "2.0", method, params })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); res({ id: i, timeout: true }); } }, 3000); });
  return {
    propose: () => send("wc_sessionPropose", { proposer: { publicKey: "00", metadata: { name: "TestDApp" } } }),
    request: (m, p, chainId = "eip155:1") => send("wc_sessionRequest", { request: { method: m, params: p }, chainId }),
    rawPublish: (s) => bus.publish(topic, s),
  };
}

const mockWallet = {
  accounts: async () => [{ address: "0xAbC0000000000000000000000000000000000001", chainId: "eip155:1" }],
  personalSign: async ({ message }) => "0xSIGNED(" + String(message).slice(0, 16) + ")",
  signTypedData: async () => "0xTYPEDSIG",
  sendTransaction: async (tx) => "0xTXHASH_to_" + (tx && tx.to || "?"),
};

const main = async () => {
  // 0) URI + envelope round-trip
  r.uriParse = parsePairingUri(uri).symKey === symKey && parsePairingUri(uri).topic === topic;
  const env = await makeEnvelope(symKey);
  const round = await env.open(await env.seal({ hello: "world", n: 7 }));
  r.envelopeRoundTrip = round && round.hello === "world" && round.n === 7;

  // ── HAPPY PATH: a stub step-up that approves (Node has no TEE; the gate seam is injected) ──
  const gateCalls = [];
  const stepupOK = async (action) => { gateCalls.push(action); return { id: "did:holo:sha256:" + "cd".repeat(32) }; };
  {
    const bus = makeBus();
    const dapp = await makeDapp(bus);
    const conn = createConnector({ transport: bus, wallet: mockWallet, operator: OP, stepup: stepupOK, approveSession: async () => ({ namespaces: { eip155: { accounts: ["eip155:1:0xAbC0000000000000000000000000000000000001"] } } }) });
    await conn.pair(uri);
    const sess = await dapp.propose();
    r.sessionApproved = !!(sess.result && Array.isArray(sess.result.accounts) && sess.result.accounts.length);
    const sig = await dapp.request("personal_sign", ["0x48656c6c6f", "0xAbC0000000000000000000000000000000000001"]);
    r.signGatedHappy = sig.result === "0xSIGNED(0x48656c6c6f)";
    const tx = await dapp.request("eth_sendTransaction", [{ to: "0xdead", value: "0x1" }]);
    r.sendGatedHappy = tx.result === "0xTXHASH_to_0xdead";
    r.gateInvoked = gateCalls.length === 2 && gateCalls[0].kind === "wallet.sign" && gateCalls[1].kind === "wallet.send" && gateCalls[0].payload.method === "personal_sign";
    const bad = await dapp.request("eth_getBalance", ["0xabc", "latest"]);
    r.unsupportedRejected = !!(bad.error && bad.error.code === 4200);
  }

  // ── FAIL-CLOSED: default requireStepUp under Node (no TEE) → every sign request is DECLINED ──
  {
    const bus = makeBus();
    const dapp = await makeDapp(bus);
    const conn = createConnector({ transport: bus, wallet: mockWallet, operator: OP, /* default stepup */ approveSession: async () => ({}) });
    await conn.pair(uri);
    const sig = await dapp.request("personal_sign", ["0x48656c6c6f", "0xAbC0000000000000000000000000000000000001"]);
    r.signFailClosed = !!(sig.error && /step-up/.test(sig.error.message));
  }

  // ── TAMPER: a foreign/garbled envelope is ignored (no crash, no action) — SEC-1 ──
  {
    const bus = makeBus();
    const dapp = await makeDapp(bus);
    let signed = false;
    const conn = createConnector({ transport: bus, wallet: { ...mockWallet, personalSign: async () => { signed = true; return "x"; } }, operator: OP, stepup: stepupOK, approveSession: async () => ({}) });
    await conn.pair(uri);
    await dapp.rawPublish("AAAAnot-a-valid-envelope====");
    await new Promise((res) => setTimeout(res, 300));
    r.tamperedIgnored = signed === false;
  }

  r.ok = Object.values(r).every((x) => x === true);
  console.log("holo-walletconnect witness:", JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
};
main().catch((e) => { console.error("WITNESS ERROR", e); process.exit(2); });
