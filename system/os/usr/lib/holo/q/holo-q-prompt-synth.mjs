// holo-q-prompt-synth.mjs — INTENT → EXECUTION PROMPT. The user's only input is intent; before Q runs the
// heavy faculty it writes its OWN prompt from that intent — query/instruction expansion that materially lifts
// the answer — but it is fail-closed and verify-before-use: a deterministic baseline ALWAYS produces a valid
// prompt, and an optional fast-model upgrade is ACCEPTED only if it provably preserves the user's intent and
// faculty. So Q can sharpen the request, but it can never hijack, drop, or re-route it. Same pattern as
// holo-spaces-plan / holo-insight (baseline = witnessed, model = silent validated upgrade).
//
// Runs AFTER the one classifier (holo-intent route → {kind,target}) and BEFORE the faculty executes (the
// cascade / facultySampler). It does NOT re-classify or re-route — routing is the classifier's job.
//
//   synthesizePrompt(intent, { faculty, context, generate, signal, maxExpand }) →
//     { rendered, system, task, faculty, source:"model"|"baseline", intent, expanded? }
//   - intent   : the user's terse request (string) — always preserved verbatim in `intent`.
//   - faculty  : "respond" | "code" | "create" (the routed faculty; framing only, never changed here).
//   - generate : optional async (metaPrompt)->string — Q's fast/draft brain. Absent ⇒ pure baseline.
//   - rendered : the final prompt string to feed the faculty.

const STOP = new Set("a an the to of for and or in on at is are be do does i you my me we it this that with from into as your our please can could would should will help want need make get use".split(" "));
function contentWords(s) { return (String(s == null ? "" : s).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w)); }

// the deterministic per-faculty framing (the always-valid baseline). Small on purpose: the seam matters, not
// elaborate templates. Q-as-on-device, brief, first-principles — Ilya's house style, applied to Q itself.
const FRAMES = {
  respond: { system: "You are Q, a calm on-device assistant. Answer clearly and concisely, from first principles. Be brief.", verb: "Answer the user's request" },
  code:    { system: "You are Q in coding mode, running on-device. Produce correct, minimal code that fits the user's project; explain only what's necessary.", verb: "Implement the user's request" },
  create:  { system: "You are Q. Build what the user asked for — simply, completely, on-device.", verb: "Build what the user asked for" },
};
const frameFor = (f) => FRAMES[f] || FRAMES.respond;

// does `out` preserve the user's intent? require a strong overlap of the intent's content words (all of them
// for a very short intent). This is the gate that stops a model upgrade from drifting into a DIFFERENT request.
function preservesIntent(intent, out) {
  const want = contentWords(intent);
  if (!want.length) return true;                       // no content words (e.g. "hi") → nothing to preserve
  const have = new Set(contentWords(out));
  const hit = want.filter((w) => have.has(w)).length;
  const need = want.length <= 3 ? want.length : Math.ceil(want.length * 0.6);
  return hit >= need;
}

function render(system, task) { return system + "\n\n" + task; }

// the meta-prompt Q answers to expand the intent. Deliberately constrains it to a faithful rewrite.
function metaPrompt(intent, ctx) {
  const c = ctx ? ("\nContext: " + String(ctx).slice(0, 500)) : "";
  return "Rewrite the user's request below as a single clear, complete instruction to yourself. Preserve its exact meaning; add only implied detail and success criteria. Do not answer it. Reply with the instruction only.\n\nRequest: " + String(intent || "").trim() + c;
}

export async function synthesizePrompt(intent, opts = {}) {
  const faculty = opts.faculty || "respond";
  const frame = frameFor(faculty);
  const baselineTask = frame.verb + ": " + String(intent == null ? "" : intent).trim();
  const baseline = { rendered: render(frame.system, baselineTask), system: frame.system, task: baselineTask, faculty, source: "baseline", intent };

  if (typeof opts.generate !== "function") return baseline;        // no brain → the baseline always stands
  if (opts.signal && opts.signal.aborted) return baseline;         // cancelled → don't wait on a model

  let expanded = null;
  try { expanded = await opts.generate(metaPrompt(intent, opts.context), { signal: opts.signal }); }
  catch (e) { return baseline; }                                   // model failed → baseline (never blocks)

  expanded = (typeof expanded === "string" ? expanded : (expanded && expanded.text) || "").trim();
  const intentLen = String(intent || "").length;
  const maxLen = opts.maxExpand || (intentLen * 40 + 600);
  // verify-before-use: well-formed length AND preserves the user's intent. Any failure ⇒ baseline.
  if (!expanded || expanded.length < 3 || expanded.length > maxLen) return baseline;
  if (!preservesIntent(intent, expanded)) return baseline;         // Q drifted → reject, keep the user's request

  const task = frame.verb + ":\n" + expanded;
  return { rendered: render(frame.system, task), system: frame.system, task, faculty, source: "model", intent, expanded };
}

export default { synthesizePrompt };
