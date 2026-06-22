// holo-q-app-agent.mjs — Stage H: the full-stack agent loop. One sentence → a sealed, conformant holo-app. It
// composes A–G: plan (intent → typed spec) → compileSpec (A: validate+repair into the bundle) → wire (B cap
// bridge · C collections · E membership · F REST/MCP, all derived from the manifest) → SELF-TEST (assert the
// laws on the produced app — L1/L5/SEC-2/§2.9/§3 + beauty) → SELF-FIX (repair + recompile if a check fails) →
// sealApp (G: one κ) → κ-CHECKPOINT (every build is a manifest-κ version; rollback = a prior κ, free). The agent
// never authors data autonomously (§2.9): writes flow through the bridge as proposals. 100% in-browser,
// serverless. Pure orchestration over the real modules → Node-witnessed.
//
//   buildFullStackApp(intent, { plan, pricing, history }) -> { app, api, bridge, sealed, manifestK, test, checkpoints, spec }
//   conformanceCheck(app, api) -> { ok, checks }

import { compileSpec, PLATFORM_KINDS } from "./holo-q-app-spec.mjs";
import { sealApp } from "./holo-q-app-seal.mjs";
import { deriveApi } from "./holo-q-app-api.mjs";
import { createCapBridge } from "./holo-q-cap-bridge.mjs";
import { audit } from "./holo-q-design-conscience.mjs";
import * as dag from "./holo-q-app-dag.mjs";
import { sha256hex, jcs } from "../holo-uor.mjs";

// the deterministic self-test: the produced app must satisfy the laws. (The compiler already enforces them by
// construction, so this PROVES conformance and is the safety net the self-fix loop watches.)
export function conformanceCheck(app, api) {
  const checks = [];
  const C = (rule, ok) => checks.push({ rule, ok: !!ok });
  C("manifest-κ-rederives", sha256hex(jcs(app.manifest)) === app.manifestK);                                   // L1/L5 — identity is content
  C("projection-dag-verifies", dag.verify(app.projectionDAG.store).ok);                                        // L5 — every element re-derives
  C("projection-beautiful", audit(app.projectionHtml).clean);                                                  // S4 — on-brand by construction
  C("caps-only-declared-collections", app.capabilities.every((c) => app.collections.some((col) => col.name === c.collection)));   // §3
  C("no-platform-kind-authoring", !app.manifest.kinds.app.some((k) => PLATFORM_KINDS.includes(k)));            // §2.9/§3
  C("api-within-caps", (api.routes || []).concat(api.tools || []).every((r) => app.capabilities.some((c) => c.collection === r.collection)));   // F/SEC-2
  return { ok: checks.every((c) => c.ok), checks };
}

const defaultSpec = (intent) => ({ name: String(intent || "App").slice(0, 60), ui: { type: "page", children: [{ type: "hero", props: { title: String(intent || "App").slice(0, 60) } }] }, collections: [], capabilities: [] });

// inferPricing(intent, collections) → { <collection>: { amount, currency } } when the intent both names a price
// AND signals monetization (paid/subscribe/premium/unlock/access…). Picks the collection whose name reads like
// membership/access, else the first. Deterministic (a weak model needn't emit pricing); explicit pricing overrides.
export function inferPricing(intent, collections = []) {
  const t = String(intent || "").toLowerCase();
  const m = t.match(/\$\s?(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:dollars?|usd|bucks|\/\s*mo(?:nth)?|a\s*month|per\s*month|monthly)/);
  const amount = m ? parseFloat(m[1] || m[2]) : 0;
  if (!amount) return {};
  if (!/\b(paid|pay|subscribe|subscription|premium|pro|unlock|access|member(?:ship)?|buy|purchase|upgrade|donat|tip)\b/.test(t)) return {};
  const names = (collections || []).map((c) => c && c.name).filter(Boolean);
  const pick = names.find((n) => /(subscrib|member|access|pro|premium|plan|tier|donor|supporter)/i.test(n)) || names[0];
  return pick ? { [pick]: { amount, currency: "USD" } } : {};
}

export async function buildFullStackApp(intent, { plan = null, pricing = {}, history = [] } = {}) {
  // 1) PLAN: intent → a typed spec (the structured synth; injected). Any failure → a minimal valid app.
  let spec = null;
  try { spec = plan ? await plan(intent) : null; } catch (e) { spec = null; }
  if (!spec || typeof spec !== "object") spec = defaultSpec(intent);

  // 2–3) COMPILE + WIRE. Pricing the intent implies (e.g. "$5 to subscribe") is inferred and assigned to the
  // most likely collection, so deriveApi emits the POST /<col>/access purchase route (pay → grant). Explicit
  // pricing always wins. The /access route stays WITHIN the capability model (a purchase op on a declared
  // collection) — api-within-caps still holds; nothing ambient is created.
  const wire = (s) => { const app = compileSpec(s); const priced = Object.assign(inferPricing(intent, app.collections), pricing); const api = deriveApi(app.manifest, { pricing: priced }); const bridge = createCapBridge({ capabilities: app.capabilities, read: () => null }); return { app, api, bridge }; };
  let { app, api, bridge } = wire(spec);

  // 4) SELF-TEST
  let test = conformanceCheck(app, api);

  // 5) SELF-FIX: if any law check fails, fall back to a guaranteed-valid spec and recompile, then re-test.
  if (!test.ok) { spec = defaultSpec(spec && spec.name || intent); ({ app, api, bridge } = wire(spec)); test = conformanceCheck(app, api); }

  // 6) SEAL → one κ.  7) κ-CHECKPOINT (this build is a version; the chain enables free rollback).
  const sealed = sealApp(app);
  const checkpoints = history.concat([sealed.manifestK]);
  return { app, api, bridge, sealed, manifestK: sealed.manifestK, test, checkpoints, spec };
}

export default { buildFullStackApp, conformanceCheck };
