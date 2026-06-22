// holo-q-spec-coder.mjs — make the on-device coder emit a TYPED app SPEC (JSON), not free-form HTML. A weak
// model fills typed slots far more reliably than it writes a whole document (the pseudo-code failure we saw), and
// a spec compiles to a beautiful UI + a full-stack bundle (data/auth/REST/MCP, Stages A–H). A strong few-shot
// anchors the format; extraction is forgiving (fences/prose stripped, outermost JSON taken); a bad/empty reply
// returns null so the agent loop falls back to a valid default app. Pure (model injected) → Node-witnessed.
//
//   specPrompt(intent) -> messages          // system + few-shot + the user's intent
//   extractSpec(text)  -> spec | null        // forgiving JSON extraction from a model reply
//   makePlan(generate, opts) -> plan(intent) // the `plan` buildFullStackApp expects (model → spec)

const COMPONENT_HELP = "page(children) · nav{brand,links} · hero{title,subtitle,cta} · section{title}(children) · "
  + "cardGrid{cards:[{title,value,body,cta}]} · card{title,value,body,cta} · stat{label,value} · button{label} · "
  + "input{label,name,type} · form{fields:[{label,name,type}],submit} · list{items} · text{content,muted} · footer{text}";

const EXAMPLE_INTENT = "a simple todo list you can add to";
const EXAMPLE_SPEC = {
  name: "Todo",
  ui: { type: "page", children: [
    { type: "hero", props: { title: "Todo", subtitle: "Keep track of what matters", cta: "Add task" } },
    { type: "form", props: { fields: [{ label: "Task", name: "title", type: "text" }], submit: "add-todo" } },
    { type: "list", props: { items: ["Buy milk", "Call Sam"] } },
  ] },
  collections: [{ name: "todos", kind: "todo", fields: [{ name: "title", type: "string" }, { name: "done", type: "bool" }] }],
  capabilities: [{ collection: "todos", ops: ["read", "write"] }],
  identity: "open",
};

export function specPrompt(intent) {
  const sys = "You design web apps as a JSON SPEC for the Holo app compiler. Reply with ONE JSON object and NOTHING "
    + "else — no prose, no markdown, no code fences. Shape: { name, ui (a tree of {type,props,children}), "
    + "collections:[{name,kind,fields:[{name,type}]}], capabilities:[{collection,ops:[\"read\"|\"write\"|\"admin\"]}], "
    + "identity:\"open\"|\"required\" }. UI components (use ONLY these): " + COMPONENT_HELP + ". Field types: string, "
    + "number, bool, ref, timestamp. Declare a collection for any data the app stores, and a capability over it. "
    + "Keep it focused and complete.";
  return [
    { role: "system", content: sys },
    { role: "user", content: "Spec for: " + EXAMPLE_INTENT },
    { role: "assistant", content: JSON.stringify(EXAMPLE_SPEC) },
    { role: "user", content: "Spec for: " + String(intent || "").trim() },
  ];
}

// forgiving extraction: strip a ```json fence, try a direct parse, else take the outermost {...}. null on failure.
export function extractSpec(text) {
  let s = String(text == null ? "" : text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) s = fence[1].trim();
  try { const o = JSON.parse(s); if (o && typeof o === "object" && !Array.isArray(o)) return o; } catch (e) {}
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i >= 0 && j > i) { try { const o = JSON.parse(s.slice(i, j + 1)); if (o && typeof o === "object" && !Array.isArray(o)) return o; } catch (e) {} }
  return null;
}

async function collectStream(out) {
  if (out == null) return "";
  if (typeof out === "string") return out;
  if (typeof out.then === "function") return collectStream(await out);
  if (typeof out[Symbol.asyncIterator] === "function") { let s = ""; for await (const d of out) s += (d && d.delta != null ? d.delta : d); return s; }
  return String(out);
}

// makePlan — the `plan(intent)->spec` buildFullStackApp expects, backed by a real coder. generate(messages,opts)
// is the codegen sampler (async-iterable of deltas) or a function returning text. A failed/garbled reply → null
// → the agent loop falls back to a valid default app (never a broken one).
export function makePlan(generate, { maxTokens = 1200, signal = null } = {}) {
  return async function plan(intent) {
    if (typeof generate !== "function") return null;
    let text = ""; try { text = await collectStream(generate(specPrompt(intent), { maxTokens, signal })); } catch (e) { return null; }
    return extractSpec(text);   // null if the model didn't produce parseable JSON → buildFullStackApp's safe fallback
  };
}

export default { specPrompt, extractSpec, makePlan };
