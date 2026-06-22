// holo-q-app-api.mjs — Stage F: auto-wire the unified holo-api (REST) + optional monetization + the MCP agent
// surface, ALL DERIVED from the app manifest's capabilities. Per the holo-apps spec these are "integration
// choices, not gaps" (§4.4): they RIDE the capability model, they never bypass it. So the surfaces are
// capability-scoped BY CONSTRUCTION — a route/tool exists only for a declared capability; every call delegates
// to the Stage-B capability bridge (SEC-2); a WRITE returns a proposal, never an autonomously-authored event
// (§2.9 — humans and agents alike must authorize); token-gating is a membership grant; monetization is pay→grant
// (the wallet buys a grant, the grant unlocks the gate). Egress is content-blind (SEC-7): the surface routes by
// capability, it does not interpret payloads. Pure + injected effects → Node-witnessed; runs in the sandboxed
// peer, serverless.
//
//   deriveApi(manifest, { pricing }) -> { routes, tools }     // capability-scoped REST + MCP surface
//   serveApi({ api, bridge, hasGrant, purchase }) -> handle(req)
//   serveMcp({ api, bridge }) -> callTool(name, args)

const list = (v) => Array.isArray(v) ? v : (v == null ? [] : [v]);

// derive the surface from the manifest. Only declared (collection, op) pairs get a route/tool — nothing else.
export function deriveApi(manifest = {}, { pricing = {} } = {}) {
  const routes = [], tools = [];
  for (const cap of list(manifest.capabilities)) {
    const col = cap && cap.collection; if (!col) continue;
    const ops = list(cap.ops), price = pricing[col] || null;
    if (ops.includes("read")) {
      routes.push({ method: "GET", path: `/${col}`, op: "read", collection: col, gated: !!price });
      routes.push({ method: "GET", path: `/${col}/:id`, op: "read", collection: col, gated: !!price });
      tools.push({ name: `read_${col}`, op: "read", collection: col, kind: "read", gated: !!price });
    }
    if (ops.includes("write")) {
      routes.push({ method: "POST", path: `/${col}`, op: "write", collection: col, gated: true });   // writes ALWAYS need authorization (§2.9)
      tools.push({ name: `propose_${col}`, op: "write", collection: col, kind: "propose", gated: true });
    }
    if (ops.includes("admin")) routes.push({ method: "POST", path: `/${col}/members`, op: "admin", collection: col, gated: true });
    if (price) routes.push({ method: "POST", path: `/${col}/access`, op: "purchase", collection: col, price });   // monetization: pay → grant
  }
  return { routes, tools, app: manifest.manifestK || null };
}

const matchPath = (pattern, path) => {
  const a = pattern.split("/"), b = String(path || "").split("/");
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg.startsWith(":") || seg === b[i]);
};

// the REST handler. Every request is routed by capability through the bridge; gated routes need a grant;
// purchase routes turn payment into a grant; writes come back as proposals. A request outside the caps → 404.
export function serveApi({ api, bridge, hasGrant = () => false, purchase = null } = {}) {
  return function handle(req = {}) {
    const route = (api.routes || []).find((r) => r.method === req.method && matchPath(r.path, req.path));
    if (!route) return { status: 404, refused: "no-route" };                       // surface can't exceed the caps
    if (route.op === "purchase") {
      if (!purchase) return { status: 402, refused: "no-purchase" };
      const grant = purchase(route.collection, req.payment, route.price);          // pay → a membership grant proposal
      return grant ? { status: 200, grant } : { status: 402, refused: "payment-required" };
    }
    if (route.gated && !hasGrant(route.collection, route.op)) return { status: 401, refused: "token-required" };   // token-gating
    const r = bridge.request({ op: route.op, collection: route.collection, payload: req.body });
    if (!r.ok) return { status: 403, refused: r.refused };                         // capability gate (SEC-2)
    if (r.proposal) return { status: 200, proposal: r.proposal };                  // write → proposal (§2.9), never authored here
    return { status: 200, value: r.value };                                        // read → state
  };
}

// the MCP agent surface. Tools are the capability-scoped operations; a call routes through the SAME bridge, so
// an agent gets EXACTLY the app's declared, attenuated authority — a write tool returns a proposal the human must
// authorize; the agent can never author on the user's key, and can never call a tool outside the caps.
export function serveMcp({ api, bridge } = {}) {
  return function callTool(name, args = {}) {
    const tool = (api.tools || []).find((t) => t.name === name);
    if (!tool) return { error: "no-tool" };                                        // agent can't reach outside the caps
    const r = bridge.request({ op: tool.op, collection: tool.collection, payload: args });
    if (!r.ok) return { error: r.refused };
    return r.proposal ? { proposal: r.proposal } : { value: r.value };
  };
}

export default { deriveApi, serveApi, serveMcp };
