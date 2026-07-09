// holo-onion-endpoint.node.mjs — the HOST half of rung 1. Mount this next to the host's /web handler so
// the browser page's hostOnionFetch("/onion?url=…") reaches a real Tor/Arti client running in this process.
//
// Split of concerns: RTC + the exit-peer framing live in the browser page (peer-host.html); the raw SOCKS5
// socket to Arti lives HERE, in the host process, behind one same-origin endpoint. Keeps the browser bundle
// free of node:net and the host free of RTC.
//
// Mount (any node:http server that already serves /web):
//     import { onionRequestHandler } from "./_shared/holo-onion-endpoint.node.mjs";
//     const onion = onionRequestHandler();               // or ({ socksHost, socksPort })
//     // inside your request router:
//     if (url.pathname === "/onion") return onion(req, res);
//
// Requires a running Arti with a SOCKS listener:  arti proxy   (default 127.0.0.1:9150).
// If Arti is down / the onion is unreachable, responds 502 so hostOnionFetch throws and the ladder falls
// past this device to arti-wasm. STATUS: UNVERIFIED in this build env (no Arti daemon here).

import { nodeArtiFetch } from "./holo-onion-arti.node.mjs";
import { rewriteHtml, rewriteCss, defaultProxy } from "./holo-onion-rewrite.mjs";

// CORS so the deployed https origin (github.io/Q) can read the x-holo-onion markers from this http loopback
// host (127.0.0.1 is a secure context, so the fetch itself is allowed; CORS lets the SW READ the response).
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "x-holo-onion, x-holo-onion-verified, content-type",
};

export function onionRequestHandler({ socksHost = "127.0.0.1", socksPort = 9150 } = {}) {
  const onionFetch = nodeArtiFetch({ socksHost, socksPort });
  return async function handle(req, res) {
    try {
      const u = new URL(req.url, "http://host");
      const target = u.searchParams.get("url");
      const rw = u.searchParams.get("rw") === "1";   // standalone-demo mode: rewrite the graph to this endpoint
      // probe / invalid: still advertise x-holo-onion so the SW's probeOnionHosts DISCOVERS this endpoint.
      if (!target || !/^[a-z2-7]{16}\.onion$|^[a-z2-7]{56}\.onion$/i.test(target.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0].split(":")[0].toLowerCase())) {
        res.writeHead(target ? 400 : 200, { "content-type": "text/plain", "x-holo-onion": "ready", ...CORS });
        return res.end(target ? "not a .onion" : "holo onion endpoint ready");
      }

      const r = await onionFetch(target);
      const headers = Object.assign({}, r.headers || {}, CORS);
      headers["x-holo-onion"] = "routed";
      headers["x-holo-onion-verified"] = r.verified ? "1" : "0";

      // By DEFAULT serve raw onion bytes — the caller (deployed browser SW) does its own <base>+rewrite of the
      // whole graph. Only when a standalone caller passes rw=1 do we rewrite links/subresources back to THIS
      // endpoint (so an iframe pointed straight at /onion is browsable without the SW).
      let bytes = Buffer.from(r.bytes);
      const ct = (headers["content-type"] || "").toLowerCase();
      let rewritten = false;
      if (rw) {
        const proxy = (abs) => "/onion?url=" + encodeURIComponent(abs) + "&rw=1";
        if (ct.includes("text/html")) { bytes = Buffer.from(rewriteHtml(bytes.toString("utf8"), target, proxy), "utf8"); rewritten = true; }
        else if (ct.includes("text/css")) { bytes = Buffer.from(rewriteCss(bytes.toString("utf8"), target, proxy), "utf8"); rewritten = true; }
      }

      delete headers["content-length"]; delete headers["transfer-encoding"];
      if (rewritten) delete headers["content-encoding"];
      if (rw) { delete headers["content-security-policy"]; delete headers["x-frame-options"]; }  // let the demo iframe render
      res.writeHead(r.status || 200, headers);
      res.end(bytes);
    } catch (e) {
      // Arti down or onion unreachable → 502 so the caller falls past this device to the next rung.
      res.writeHead(502, { "content-type": "text/plain", "x-holo-onion": "unavailable", ...CORS });
      res.end("onion route failed: " + (e && e.message || e));
    }
  };
}

export default { onionRequestHandler };
