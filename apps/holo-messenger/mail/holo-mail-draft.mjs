// holo-mail-draft.mjs - M2/5: Instant Reply. A ready reply, written in the operator's voice, waiting above
// the thread. Voice is learned on-device from the operator's OWN sent mail (fromMe messages in the corpus) -
// nothing leaves the device. On Q via Seam A qGenerateText; the draft is a κ-link (kind:"mail:draft").
//
// Law L5: no brain / empty generation → NO draft (returns null), never a fabricated one.

const SYS =
  "You draft a reply to the latest message in an email thread, in the reader's own voice (voice examples are " +
  "given). Output the body ONLY - no subject, no signature. Match the thread's language. Be concise and direct. " +
  "Never invent facts; use a [placeholder] only where needed information is genuinely missing.";

export function makeMailDraft({ ai, provider, strand = null, now = () => new Date().toISOString(), voiceSamples = 4 } = {}) {
  // learn the operator's voice: a few of their most recent sent bodies (fromMe), across threads.
  function voiceProfile() {
    const sent = (provider.allMessages ? provider.allMessages() : [])
      .filter((m) => m.fromMe && m.text)
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .slice(0, voiceSamples)
      .map((m) => `· ${m.text.replace(/\s+/g, " ").slice(0, 240)}`);
    return sent.length ? `Voice examples (how the reader writes):\n${sent.join("\n")}` : "";
  }

  function promptFor(msgs) {
    const thread = msgs
      .map((m) => `${m.fromMe ? "You" : (m.fromName || m.from)} - ${m.subject}\n${(m.text || "").slice(0, 800)}`)
      .join("\n---\n");
    const voice = voiceProfile();
    return `${voice ? voice + "\n\n" : ""}Email thread (oldest to newest):\n${thread}\n\nWrite the reader's reply body to the latest message.`;
  }

  async function draft(jid) {
    const msgs = provider.threadMessages(jid);
    if (!msgs || !msgs.length) return null;
    const latest = msgs[msgs.length - 1];
    if (latest.fromMe) return null;   // ball is not in the reader's court - nothing to reply to

    let text;
    try {
      text = (await ai.qGenerateText({ system: SYS, prompt: promptFor(msgs), label: "draft-reply" })).trim();
    } catch {
      return null;   // Law L5: no generation → no draft (never fabricate)
    }
    if (!text) return null;

    const ts = now();
    let kappa = null;
    if (strand && typeof strand.append === "function") {
      const rec = await strand.append({ kind: "mail:draft", payload: { jid, lastId: latest.id, text, ts } });
      kappa = rec.id;
    }
    return { jid, lastId: latest.id, text, kappa, ts };
  }

  return { draft, voiceProfile };
}

export default { makeMailDraft };
