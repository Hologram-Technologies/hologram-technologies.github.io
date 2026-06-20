// holo-q-model-steer.mjs — the INTENTION door to model wiring (ADR-0084). "Use a bigger brain for coding",
// "switch listening to hi-fi", "what are you using", "reset coding to auto" — plain language → a real change
// in the holo-q-mux (bindSpecialist / unbindAll) or an honest description. This is the conversational mirror
// of the Mind panel: same registry, same writes, two doors. The sole input is intention.
//
// PURE + injected: parseModelSteer(text) is a deterministic, network-free classifier; applyModelSteer(parse,
// {mux, bridge}) performs the registry write and returns a spoken-ready summary. A witness drives the real
// mux+bridge; the shell registers it as the "model" intent kind so typed + spoken converge (holo-intent.mjs).

// faculty words → faculty id. Longest/most-specific phrases first (matched as substrings on lowered text).
const FACULTY = [
  ["respond", ["respond", "reply", "answer", "chat", "chatting", "talk to me", "think", "thinking", "reason", "main brain", "conversation"]],
  ["listen",  ["listen", "hear", "hearing", "ear", "transcrib", "dictation", "speech to text", "speech-to-text", "asr"]],
  ["speak",   ["speak", "voice", "read aloud", "text to speech", "text-to-speech", "tts", "narrat", "say things", "talk back"]],
  ["code",    ["cod", "program", "developer", "dev work", "agentic", "engineer"]],   // "cod" covers code/coding/coder
];
// quality intent → a tier preference within the faculty. "bigger" = the upgrade tier; "faster" = the instant tier.
const UP = ["bigger", "biggest", "larger", "large", "smarter", "stronger", "strongest", "more powerful", "powerful", "better", "best", "higher quality", "high quality", "hi-fi", "hifi", "highest", "capable", "heavier", "accurate", "premium", "upgrade"];
const DOWN = ["smaller", "smallest", "faster", "fastest", "lighter", "lightest", "light", "quick", "instant", "snappy", "low latency", "low-latency", "tiny", "leaner", "lean"];
const AUTO = ["auto", "automatic", "default", "reset", "back to normal", "you choose", "you decide", "let you", "whatever you"];
// explicit model tokens → a concrete pinned tier id (only those the OS actually ships; specById validates).
const TOKEN = [
  [/\b0\.?5\s?b\b/, "qwen2.5-0.5b"], [/\b1\.?5\s?b\b/, "qwen2.5-1.5b"],
  [/\b(coder|3\s?b)\b/, "qwen-coder-3b"],
  [/\bf?16\b|hi-?fi/, "moonshine-tiny-f16"], [/\bint8\b|8-?bit/, "moonshine-tiny-int8"],
  [/\bkokoro\b/, "kokoro-82m"],
];
const has = (t, words) => words.some((w) => t.includes(w));

// parseModelSteer(text) → null (not a model command) | { action, faculty?, want?, token? }
//   action: "describe" | "bind" | "auto"
//   want:  "up" | "down" | null   (a tier preference)   ·   token: an explicit model id | null
export function parseModelSteer(text) {
  const t = String(text == null ? "" : text).toLowerCase().trim();
  if (!t) return null;
  const faculty = (FACULTY.find(([, ws]) => has(t, ws)) || [null])[0];
  const token = (TOKEN.find(([re]) => re.test(t)) || [])[1] || null;
  const aboutModels = /\b(model|models|brain|brains|mind|minds|engine|running|powered|using|use)\b/.test(t);

  // a question about what's running → describe (needs a model/using word; a faculty alone isn't a question).
  if (/\b(what|which|show|list|tell me|how)\b/.test(t) && aboutModels && !has(t, UP) && !has(t, DOWN) && !token) {
    return { action: "describe", faculty };
  }
  // "reset coding to auto" / "use the default for listening"
  if (faculty && has(t, AUTO)) return { action: "auto", faculty };
  // a real change needs a faculty AND a direction (a tier word or an explicit model token).
  if (faculty && (token || has(t, UP) || has(t, DOWN))) {
    return { action: "bind", faculty, want: has(t, UP) ? "up" : has(t, DOWN) ? "down" : null, token };
  }
  // a bare "what are you using" with no faculty still describes everything.
  if (/\b(what|which|show|list)\b/.test(t) && aboutModels) return { action: "describe", faculty: null };
  return null;   // not a model-steer utterance — let the normal classifier handle it
}

// choose the concrete tier id for a bind, from the faculty's CLOSED choice set (tiersFor). Honest when there
// is only one tier ("code already runs the most capable on-device tier").
function chooseTier(parse, tiers) {
  if (!tiers.length) return { id: null, note: "that faculty is auto-managed. Q picks its specialist." };
  if (parse.token) { const m = tiers.find((x) => x.id === parse.token); return m ? { id: m.id } : { id: null, note: `${parse.token} isn't available for this faculty.` }; }
  const instant = tiers.find((x) => x.tier === "instant"), upgrade = tiers.find((x) => x.tier === "upgrade");
  if (parse.want === "up") return upgrade ? { id: upgrade.id } : { id: instant.id, note: "this is already the most capable on-device tier." };
  if (parse.want === "down") return { id: instant.id };
  return { id: (upgrade || instant).id };
}

// applyModelSteer(parse, {mux, bridge}) → { ok, action, faculty?, model?, say, state? }
//   performs the registry write (bindSpecialist / unbindAll) and returns a spoken-ready line. Idempotent.
export function applyModelSteer(parse, { mux, bridge }) {
  if (!parse) return { ok: false, say: null };
  if (parse.action === "describe") {
    const facs = ["respond", "listen", "speak", "code"].map((f) => {
      const r = mux.resolveModel(f); const id = r.source === "pinned" ? r.spec.instant.id : r.id;
      return `${f}: ${id}${r.source === "override" ? " (you chose)" : ""}`;
    });
    return { ok: true, action: "describe", say: `Running on your device, auto-picking per task. ${facs.join(" · ")}.`, state: mux.describeMux() };
  }
  if (parse.action === "auto") {
    mux.bindSpecialist(parse.faculty, null);
    return { ok: true, action: "auto", faculty: parse.faculty, say: `Back to auto for ${parse.faculty}. I'll pick the best mind for it.` };
  }
  // bind
  const tiers = bridge.tiersFor(parse.faculty);
  const pick = chooseTier(parse, tiers);
  if (!pick.id) return { ok: false, action: "bind", faculty: parse.faculty, say: pick.note || "I couldn't map that to a model I run." };
  const spec = bridge.specById(pick.id);   // a real, κ-addressed tier (validates the id is OS-pinned)
  if (!spec) return { ok: false, action: "bind", faculty: parse.faculty, say: `${pick.id} isn't a model I have.` };
  mux.bindSpecialist(parse.faculty, { id: pick.id, faculty: parse.faculty, source: "user", kappa: spec.kappa });
  const tail = pick.note ? ` (${pick.note})` : "";
  return { ok: true, action: "bind", faculty: parse.faculty, model: pick.id, kappa: spec.kappa, say: `Done. ${parse.faculty} now uses ${pick.id}${tail}.` };
}

// steer(text, {mux, bridge}) — the one call a host makes: parse + apply. Returns {handled, ...result}.
export function steer(text, deps) {
  const p = parseModelSteer(text);
  if (!p) return { handled: false };
  return { handled: true, ...applyModelSteer(p, deps) };
}

export default { parseModelSteer, applyModelSteer, steer };
