// holo-msg-mount.mjs — the ADDITIVE live surface (M3c-live) for the vodozemac + κ-DAG stack. It wires
// `makeMsg` to the REAL spine (as the content mesh) and the vault store (for seal2 account/session pickles),
// and exposes `window.HoloMsg` for the UI + harnesses. It is fully ADDITIVE: it touches NOTHING in the
// shipped Holo Direct path (`window.HoloDirect`) — the live experience is unchanged until a surface opts in.
// This is the engine seam the WhatsApp UI will call once M3c-live's UI wiring lands.
//
//   window.HoloMsg = { boot(), init()→{id,bundleKappa}, open(peerId,bundleKappa)→conv, send(peerId,text),
//                      deliver(conv,heads)→[msg], history(peerId), on(cb), id() }
//
// Mesh = the real spine: put = cn_put + announce; get = local κ-store else cn_fetch over any live link
// (the low-latency p2p path is TURN-capable, N9/T1; N7 proved cn_fetch over a real WebRtcLink). Seal2 state
// lives in the vault store (getMeta/setMeta, AES-GCM at rest). pickleKey is a 32-byte key minted once and
// vault-persisted. ZERO hand-written crypto — vodozemac does the sealing.

let msg = null, bootP = null;

function _rand32b64() { const a = new Uint8Array(32); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)); }

async function _boot() {
  if (msg) return msg;
  if (bootP) return bootP;
  bootP = (async () => {
    const { makeSpine } = await import("./holo-net.mjs");
    const { makeMsg } = await import("./holo-msg.mjs");
    // vodozemac (the crypto wasm) — loaded the spine's way; lazy, first-use only
    const vbase = new URL("./_vendor/vodozemac/", import.meta.url);
    const voz = await import(new URL("holo_vodozemac.js", vbase));
    await voz.default({ module_or_path: new URL("holo_vodozemac_bg.wasm", vbase) });

    // operator namespace (same rule as Holo Direct): signed-in id else "guest"
    let ns = "guest";
    try {
      const auth = await Promise.race([window.__holoAuthP, new Promise((r) => setTimeout(() => r(null), 3000))]);
      const stable = auth && (auth.principal && (auth.principal.id || auth.principal) || auth.operator);
      if (stable) ns = String(stable).slice(0, 64);
    } catch {}

    // the vault store for seal2 pickles (reuse the Holo Direct store's vault-encrypted meta)
    const { getVaultKey } = await import("./holo-direct-id.mjs");
    const { openStore } = await import("./holo-direct-store.mjs");
    const store = await openStore({ ns, vaultKey: await getVaultKey({ ns }) });
    let pickleKey = await store.getMeta("voz:pk").catch(() => null);
    if (!pickleKey) { pickleKey = _rand32b64(); await store.setMeta("voz:pk", pickleKey); }
    const seal2Store = {
      getState: (k) => store.getMeta("voz:" + k).catch(() => null),
      putState: (k, v) => store.setMeta("voz:" + k, v).catch(() => {}),
    };

    const spine = await makeSpine();
    const mesh = {
      kappa: (b) => spine.kappa(b),
      verify: (b, k) => spine.verify(b, k),
      put: async (k, b) => { try { spine.put(b); spine.announce(k); } catch {} },
      get: async (k) => {
        try { const local = spine.resolve(k); if (local) return local; } catch {}
        try { return await spine.fetch(k, { timeoutMs: 12000 }); } catch { return null; }
      },
    };
    msg = makeMsg({ voz, mesh, seal2Store, pickleKey, now: () => Date.now() });
    return msg;
  })();
  return bootP;
}

function _start() {
  if (typeof window === "undefined") return;
  if (window.__holoMsgMount) return; window.__holoMsgMount = true;
  window.HoloMsg = {
    boot: _boot,
    init: async () => { await _boot(); return msg.init(); },
    open: async (peerId, bundleKappa) => { await _boot(); return msg.open(peerId, bundleKappa); },
    send: async (peerId, text) => { await _boot(); return msg.send(peerId, text); },
    deliver: async (conv, heads) => { await _boot(); return msg.deliver(conv, heads); },
    history: async (peerId) => { await _boot(); return msg.history(peerId); },
    on: async (cb) => { await _boot(); return msg.on(cb); },
    id: async () => { await _boot(); return msg.id(); },
  };
}
_start();
