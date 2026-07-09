// holo-mail-ai.mjs - SEAM A: structured output over ANY Q brain.
//
// The whole email brain funnels through two calls: qGenerateText (freeform) and qGenerateObject
// (schema-constrained JSON). Q's brains expose ONE contract - an async token stream:
//     for await (const delta of brain.generate(messages, { signal })) { ... }   // yields string deltas
// (see holo-q-contact.mjs, holo-q-fabric.js, holo-q-active.mjs). There is no native "generateObject".
// So THIS module IS the structured-output layer: it drains the stream, extracts + repairs JSON, and
// validates it against a tiny schema, retrying once with a corrective nudge on mismatch.
//
// No model lives here. No network. We WRAP a provider: at runtime the real Q brain (WebGPU/κ-disk)
// binds via holo-q-mux; the Node gate binds a deterministic mock. Same contract, both sides. Law L5:
// never fake a result - a brain that yields nothing throws, it does not invent.

// ── tiny schema validator (clean-room, dependency-free) ──────────────────────────────────────────────
// Mini-DSL, just enough for the mail contracts:
//   { type:'object', required:[...], fields:{ k:<schema> } }
//   { type:'enum', values:[...] }
//   { type:'array', items:<schema> }
//   { type:'string'|'number'|'boolean' }
//   any node may set nullable:true to also accept null.
export function validate(value, schema, path = "$") {
  const errs = [];
  const fail = (msg) => errs.push(`${path}: ${msg}`);
  if (value === null) { if (!schema.nullable) fail("null not allowed"); return errs; }
  switch (schema.type) {
    case "string": if (typeof value !== "string") fail(`expected string, got ${typeof value}`); break;
    case "number": if (typeof value !== "number" || Number.isNaN(value)) fail("expected number"); break;
    case "boolean": if (typeof value !== "boolean") fail("expected boolean"); break;
    case "enum": if (!schema.values.includes(value)) fail(`expected one of ${schema.values.join("|")}, got ${JSON.stringify(value)}`); break;
    case "array":
      if (!Array.isArray(value)) { fail("expected array"); break; }
      value.forEach((v, i) => errs.push(...validate(v, schema.items, `${path}[${i}]`)));
      break;
    case "object":
      if (typeof value !== "object" || Array.isArray(value)) { fail("expected object"); break; }
      for (const k of schema.required || []) if (!(k in value)) fail(`missing required field "${k}"`);
      for (const [k, sub] of Object.entries(schema.fields || {}))
        if (k in value) errs.push(...validate(value[k], sub, `${path}.${k}`));
      break;
    default: fail(`unknown schema type "${schema.type}"`);
  }
  return errs;
}

// ── JSON extraction + light repair ───────────────────────────────────────────────────────────────────
// Models wrap JSON in prose or ```fences``` and leak trailing commas / smart quotes. Pull the object out
// and make a couple of conservative repairs - never "guess" structure, just clean well-known noise.
export function extractJson(text) {
  if (typeof text !== "string") return { ok: false, reason: "not-a-string" };
  let t = text.replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{"), end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return { ok: false, reason: "no-json-object", raw: t };
  let body = t.slice(start, end + 1);
  const attempts = [
    body,
    body.replace(/,\s*([}\]])/g, "$1"),                    // trailing commas
    body.replace(/,\s*([}\]])/g, "$1").replace(/[“”]/g, '"').replace(/[‘’]/g, "'"), // smart quotes
  ];
  for (const a of attempts) { try { return { ok: true, value: JSON.parse(a), raw: body }; } catch {} }
  return { ok: false, reason: "unparseable", raw: body };
}

// ── drain a token stream (or accept an already-complete string) ───────────────────────────────────────
export async function drain(streamOrString) {
  if (typeof streamOrString === "string") return streamOrString;
  let s = "";
  for await (const d of streamOrString) s += typeof d === "string" ? d : (d && d.delta) || "";
  return s;
}

// ── describe a schema back to the model as a compact shape hint (our own words, not a copied prompt) ───
function shapeHint(schema) {
  switch (schema.type) {
    case "object": {
      const inner = Object.entries(schema.fields || {}).map(([k, s]) => `"${k}": ${shapeHint(s)}`).join(", ");
      return `{ ${inner} }`;
    }
    case "array": return `[ ${shapeHint(schema.items)}, ... ]`;
    case "enum": return schema.values.map((v) => JSON.stringify(v)).join(" | ");
    default: return schema.type;
  }
}

// ── the two front doors ────────────────────────────────────────────────────────────────────────────
// makeMailAI({ brain })            - one brain for everything, or
// makeMailAI({ route })            - route(label) -> brain, so classifiers get a nano brain and drafting
//                                    gets the reasoning brain (holo-q-mux tiers). route wins if both given.
export function makeMailAI({ brain, route } = {}) {
  const pick = async (label) => {
    const b = route ? await route(label) : brain;
    if (!b || typeof b.generate !== "function") throw new Error(`holo-mail-ai: no brain for "${label || "default"}"`);
    return b;
  };
  const toMessages = (system, prompt) => {
    const m = [];
    if (system) m.push({ role: "system", content: system });
    m.push({ role: "user", content: prompt });
    return m;
  };

  async function qGenerateText({ system, prompt, label, maxTokens, signal } = {}) {
    const b = await pick(label);
    const text = (await drain(b.generate(toMessages(system, prompt), { maxTokens, signal }))).trim();
    if (!text) throw new Error(`holo-mail-ai: empty generation for "${label || "text"}"`);
    return text;
  }

  async function qGenerateObject({ system, prompt, schema, label, maxTokens, signal, retries = 1 } = {}) {
    if (!schema) throw new Error("holo-mail-ai: qGenerateObject requires a schema");
    const b = await pick(label);
    const jsonRule = `Respond with ONE JSON object and nothing else - no prose, no code fences. Shape:\n${shapeHint(schema)}`;
    const sys = system ? `${system}\n\n${jsonRule}` : jsonRule;
    let corrective = "";
    for (let attempt = 0; attempt <= retries; attempt++) {
      const userPrompt = corrective ? `${prompt}\n\n${corrective}` : prompt;
      const raw = await drain(b.generate(toMessages(sys, userPrompt), { maxTokens, signal }));
      const ext = extractJson(raw);
      if (ext.ok) {
        const errs = validate(ext.value, schema);
        if (!errs.length) return ext.value;
        corrective = `Your previous reply did not match the required shape (${errs.slice(0, 3).join("; ")}). Return corrected JSON only.`;
      } else {
        corrective = `Your previous reply was not valid JSON (${ext.reason}). Return ONE JSON object only, matching the shape above.`;
      }
    }
    throw new Error(`holo-mail-ai: could not obtain schema-valid JSON for "${label || "object"}" after ${retries + 1} attempts`);
  }

  return { qGenerateText, qGenerateObject };
}

export default { makeMailAI, validate, extractJson, drain };
