// holo-walletconnect.mjs — connect any dApp to Hologram's sovereign wallet through the ONE TEE gate.
//
// The web3 half of Holo Pass: a WalletConnect-v2-shaped connector where EVERY signing request a dApp
// makes (personal_sign, eth_signTypedData, eth_sendTransaction) is routed through the payload-bound
// biometric step-up (holo-stepup; wallet.sign/wallet.send are VALUE-level → always ask) and signed by
// the existing 17-chain WDK wallet. The dApp never sees a key; the relay is content-blind (SEC-7); the
// human approves THIS exact action at the device enclave. Transport (relay) and signer (wallet) are
// INJECTED — the real WalletConnect relay + holo-wallet-agent in production, in-memory + mock in tests.
//
// Honest wire-compat note: the on-the-wire envelope here is AES-256-GCM (type‖iv‖ct, base64); exact
// WalletConnect interop additionally needs the @walletconnect ChaCha20-Poly1305 envelope + the `irn`
// relay protocol (a vendored dependency). The connector logic, gating, routing, and refusals are faithful.

import { requireStepUp } from "./holo-stepup.mjs";

const SUB = (globalThis.crypto && globalThis.crypto.subtle) || null;
const te = new TextEncoder(); const td = new TextDecoder();
const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = (s) => Uint8Array.from(atob(String(s)), (c) => c.charCodeAt(0));
const hexToBytes = (h) => { const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };

// parse a `wc:<topic>@2?relay-protocol=irn&symKey=<hex>` pairing URI
export function parsePairingUri(uri) {
  const m = /^wc:([0-9a-f]+)@(\d+)\?(.*)$/i.exec(String(uri || ""));
  if (!m) throw new Error("walletconnect: bad pairing URI");
  const q = Object.fromEntries(new URLSearchParams(m[3]));
  if (!q.symKey || !/^[0-9a-f]{64}$/i.test(q.symKey)) throw new Error("walletconnect: missing/invalid symKey");
  return { topic: m[1], version: +m[2], relayProtocol: q["relay-protocol"] || "irn", symKey: q.symKey };
}

// AEAD envelope under the pairing/session symmetric key (type-0 shape: 0x00 ‖ iv(12) ‖ ct, base64).
export async function makeEnvelope(symKeyHex) {
  const key = await SUB.importKey("raw", hexToBytes(symKeyHex), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return {
    async seal(obj) { const iv = globalThis.crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await SUB.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj)))); const out = new Uint8Array(1 + 12 + ct.length); out[0] = 0; out.set(iv, 1); out.set(ct, 13); return b64(out); },
    async open(b64s) { try { const u = unb64(b64s); if (u[0] !== 0) return null; const pt = await SUB.decrypt({ name: "AES-GCM", iv: u.slice(1, 13) }, key, u.slice(13)); return JSON.parse(td.decode(new Uint8Array(pt))); } catch { return null; } },
  };
}

// classify a JSON-RPC method into a step-up kind + a human reason (payload-bound consent).
const SIGN = new Set(["personal_sign", "eth_sign", "eth_signTypedData", "eth_signTypedData_v4", "eth_signTypedData_v3"]);
const SEND = new Set(["eth_sendTransaction", "eth_sendRawTransaction"]);
function classify(method) { if (SIGN.has(method)) return "wallet.sign"; if (SEND.has(method)) return "wallet.send"; return null; }
function describe(method, params) {
  if (method === "personal_sign") { try { return "Sign a message: " + td.decode(hexToBytes(String(params[0]).replace(/^0x/, ""))).slice(0, 80); } catch { return "Sign a message"; } }
  if (SEND.has(method)) { const t = (params && params[0]) || {}; return "Send a transaction to " + (t.to || "?") + (t.value ? " (value " + t.value + ")" : ""); }
  if (method.startsWith("eth_signTypedData")) return "Sign typed data (EIP-712)";
  return method;
}

// the wallet (signer) interface the connector depends on — satisfied by holo-wallet-agent in production:
//   { accounts(): [{address, chainId}], personalSign({message,address}), signTypedData({data,address}), sendTransaction(tx) }

// create the wallet-side connector. `stepup` defaults to the canonical requireStepUp (fail-closed without
// a fresh biometric); `approveSession(proposal)` decides accounts/chains (the user's consent to connect).
export function createConnector({ transport, wallet, operator, credentialId = null, stepup = requireStepUp, approveSession }) {
  if (!transport || !wallet || !operator || !approveSession) throw new Error("walletconnect: missing deps");
  let env = null, topic = null;

  async function respond(id, body) { await transport.publish(topic, await env.seal({ id, jsonrpc: "2.0", ...body })); }

  async function onMessage(raw) {
    const msg = await env.open(raw);
    if (!msg || !msg.method) return;                                   // tampered/foreign → ignore (SEC-1)
    if (msg.method === "wc_sessionPropose") {
      const approved = await approveSession(msg.params || {});         // user consent to CONNECT
      if (!approved) return respond(msg.id, { error: { code: 5000, message: "user rejected" } });
      return respond(msg.id, { result: { accounts: await wallet.accounts(), namespaces: approved.namespaces || null } });
    }
    if (msg.method === "wc_sessionRequest") {
      const { request, chainId } = msg.params || {};
      const method = request && request.method, params = (request && request.params) || [];
      const kind = classify(method);
      if (!kind) return respond(msg.id, { error: { code: 4200, message: "unsupported method: " + method } });
      // THE GATE: payload-bound biometric for THIS exact action (fail-closed; VALUE level → always asks)
      let token; try { token = await stepup({ kind, operator, appId: "walletconnect", payload: { method, params, chainId }, reason: describe(method, params) }, { credentialId }); }
      catch (e) { return respond(msg.id, { error: { code: 4001, message: "step-up declined: " + (e && e.message || e) } }); }
      if (!token) return respond(msg.id, { error: { code: 4001, message: "step-up denied" } });
      // SIGN with the sovereign wallet (keys never leave it)
      try {
        let result;
        if (method === "personal_sign") result = await wallet.personalSign({ message: params[0], address: params[1] });
        else if (method.startsWith("eth_signTypedData")) result = await wallet.signTypedData({ address: params[0], data: params[1] });
        else if (SEND.has(method)) result = await wallet.sendTransaction(params[0]);
        else return respond(msg.id, { error: { code: 4200, message: "unsupported" } });
        return respond(msg.id, { result });
      } catch (e) { return respond(msg.id, { error: { code: 5000, message: String(e && e.message || e) } }); }
    }
  }

  return {
    async pair(uri) { const p = parsePairingUri(uri); topic = p.topic; env = await makeEnvelope(p.symKey); await transport.subscribe(topic, onMessage); return { topic }; },
    topic: () => topic,
  };
}
