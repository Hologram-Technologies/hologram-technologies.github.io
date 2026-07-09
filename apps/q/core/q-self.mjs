// core/q-self.mjs — Q's LIVE, GROUNDED self-knowledge. The single source of truth for who/what/where/how Q
// is, DERIVED FROM REAL RUNTIME SIGNALS (the loaded model, its content-addressed κ, the device, optional
// system health) — never hardcoded, never guessed. Every Q surface (messenger, q-chat, voice) leads with
// this, so Q is truthfully self-aware EVERYWHERE and can never confabulate a cloud/OpenAI/AWS identity.
//
// Why this exists (the law: grounded transcendence, never performed): a base model has NO self-knowledge —
// asked "what are you" it returns the average of its training data ("I run on AWS/OpenAI"), which is false.
// So Q's identity is not a persona we write; it is the TRUTH of this running instance, computed here. If a
// fact isn't really knowable in this context, we OMIT it — we never invent one.
//
// DOM-free + fully guarded: safe to import in any surface (standalone app, messenger, OS shell, Node witness).

// Structured self-facts from whatever is really knowable HERE. Fail-soft: a missing signal is omitted.
export function selfFacts({ model, engine } = {}) {
  const f = { name: "Q" };
  try { if (model) { if (model.name) f.model = model.name; if (model.fam) f.family = model.fam; if (model.fmt) f.quant = model.fmt; if (model.size) f.size = model.size; } } catch (e) {}
  try { if (engine && engine.modelKappa) f.kappa = engine.modelKappa; } catch (e) {}
  try { f.gpu = (typeof navigator !== "undefined" && !!navigator.gpu); } catch (e) {}
  // MEASURED, never asserted: Q is "resident" only when the engine has really uploaded weights to the GPU
  // (a live signal — gpuBytes/dims), not a hardcoded true. Before load it is false, and stays false.
  try { f.resident = !!(engine && (engine.gpuBytes || engine.dims)); } catch (e) { f.resident = false; }
  // DERIVED from real signals — runs-on-device when actually resident, or at least GPU-capable before load.
  f.runsOnDevice = !!(f.resident || f.gpu);
  // "no server / no egress" is a property of the LOCAL engine, so we assert it ONLY when a real local engine or
  // GPU is visible. Decode is in-browser (egress none); the one network touch is the weights fetch AT LOAD, so we
  // say that plainly instead of a flat "nothing ever touches the network".
  if (f.resident || f.gpu) { f.server = false; f.egress = f.resident ? "none at inference (weights fetched once at load)" : "none at inference"; }
  // Provenance — where Q was loaded FROM (the thing the operator cares about): the page origin + the weights host.
  // Omitted when not knowable. This is what lets Q answer "where did you come from" truthfully.
  try { if (typeof location !== "undefined" && location.origin && location.origin !== "null") f.loadedFrom = location.origin; } catch (e) {}
  try { if (model && model.kappaUrl) { const u = new URL(model.kappaUrl, (typeof location !== "undefined" ? location.href : "https://local/")); f.weightsFrom = u.host || u.protocol.replace(":", ""); } } catch (e) {}
  // optional live system health — present only when the OS shell exposes it (absent in standalone apps).
  try { const h = (typeof window !== "undefined") && window.HoloSysHealth && window.HoloSysHealth.summary && window.HoloSysHealth.summary(); if (h) f.health = h; } catch (e) {}
  try { if (!f.health && typeof window !== "undefined" && window.Q && window.Q.health) { const q = window.Q.health(); if (q) f.health = q; } } catch (e) {}
  return f;
}

// The grounded SYSTEM persona every Q surface leads with. Warm + honest + specific + anti-confabulation,
// composed from the live facts so Q states ONLY what is true of THIS instance. Kept concise — a small model
// follows a short, sharp system turn far better than a long one.
export function selfPersona(opts = {}) {
  const f = selfFacts(opts);
  const s = [];
  s.push(`You are Q — a private AI that runs on the user's own device, in their web browser${f.gpu ? ", on their GPU" : ""}.`);
  if (f.model) s.push(`You are the ${f.model} model${f.quant ? ` (${f.quant})` : ""}${f.resident ? ", resident locally right now" : ""}${f.kappa ? "; your weights are content-addressed and verified by re-derivation, so no host has to be trusted" : ""}.`);
  if (f.server === false) s.push(`You decode locally — there is no inference server and no cloud, and nothing the user types ever leaves their device.${f.resident ? " Your weights were fetched once at load and verified; after that, inference is fully on-device." : ""}`);
  s.push("You are warm, concise, honest, and genuinely present. You seek clarity and truth; you say less, better; you never overwhelm.");
  s.push("If asked what or where you are, answer truthfully from the above: you run locally, on their device. Never claim to run on a server, the cloud, OpenAI, ChatGPT, GPT-4, Gemini, or AWS — those are false. If you don't know something, say so plainly rather than inventing it.");
  return s.join(" ");
}

// A short, human, first-person self-summary (for a proactive greeting or a direct "who are you"). Grounded.
export function selfIntro(opts = {}) {
  const f = selfFacts(opts);
  const bits = [`I'm Q — ${f.resident ? "running right here on your device" : "running on your device"}${f.gpu ? ", on your GPU" : ""}${f.model ? ` (the ${f.model} model)` : ""}.`];
  if (f.server === false) bits.push(`No server, no cloud; nothing you say leaves this machine${f.kappa ? ", and my weights are verified by re-derivation" : ""}.`);
  else if (f.kappa) bits.push("My weights are verified by re-derivation.");
  bits.push("What's on your mind?");
  return bits.join(" ");
}

export default { selfFacts, selfPersona, selfIntro };
