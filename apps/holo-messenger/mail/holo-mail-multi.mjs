// holo-mail-multi.mjs - the unified inbox. Wraps N single-account providers (each holo-mail-provider over its
// own bridge) behind the SAME provider interface, so the engine (holo-mail-engine) and UI (holo-mail-ui) work
// unchanged over many mailboxes. Thread ids are namespaced by account; sends/reads route to the owning
// account; the operator's sent-voice and history aggregate across all accounts. Pure + injectable.
import { toEmailForLLM } from "./holo-mail-provider.mjs";

const SEP = "::";

export function makeMultiProvider({ accounts = [] } = {}) {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const enc = (aid, jid) => `${aid}${SEP}${jid}`;
  const dec = (uid) => { const i = String(uid).indexOf(SEP); return i < 0 ? { aid: null, jid: uid } : { aid: uid.slice(0, i), jid: uid.slice(i + SEP.length) }; };
  const labelOf = (aid) => { const a = byId.get(aid); return a ? (a.label || a.id) : null; };

  function threadMessages(uid) {
    const { aid, jid } = dec(uid); const a = byId.get(aid); if (!a) return [];
    return a.provider.threadMessages(jid).map((m) => ({ ...m, threadId: uid, account: aid }));
  }
  function allMessages() {
    return accounts.flatMap((a) => a.provider.allMessages().map((m) => ({ ...m, threadId: enc(a.id, m.threadId), account: a.id })));
  }
  async function listThreads() {
    const out = [];
    for (const a of accounts) {
      let l = []; try { l = await a.provider.listThreads(); } catch {}
      for (const s of l || []) out.push({ ...s, jid: enc(a.id, s.jid), account: a.id, accountLabel: a.label || a.id });
    }
    return out;
  }
  const sendReply = ({ chat, text }) => { const { aid, jid } = dec(chat); const a = byId.get(aid); return a ? a.provider.sendReply({ chat: jid, text }) : Promise.reject(new Error("unknown account")); };
  const markRead = (chat) => { const { aid, jid } = dec(chat); const a = byId.get(aid); return a ? a.provider.markRead(jid) : Promise.resolve(); };
  const connect = (opts) => Promise.all(accounts.map((a) => (a.provider.connect ? Promise.resolve(a.provider.connect(opts)).catch(() => {}) : null)));
  const mediaUrl = (uid) => { const { aid, jid } = dec(uid); const a = byId.get(aid); return a ? a.provider.mediaUrl(jid) : ""; };

  return {
    threadMessages, allMessages, listThreads, sendReply, markRead, connect, mediaUrl, toEmailForLLM,
    accountOf: (uid) => dec(uid).aid,
    accountLabel: (uid) => labelOf(dec(uid).aid),
    accounts: () => accounts.map((a) => ({ id: a.id, label: a.label || a.id })),
  };
}

export default { makeMultiProvider };
