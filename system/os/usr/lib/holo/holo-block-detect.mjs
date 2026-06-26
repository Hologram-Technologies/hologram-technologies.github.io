// holo-block-detect.mjs — CLASSIFY A NAME-SHAPED ISP BLOCK, WITHOUT FALSE-POSITIVING A LEGITIMATE REDIRECT.
// An ISP content filter (Virgin Media WebSafe / Child Safe and kin) acts on NAMES: it poisons the DNS answer
// or resets the TLS handshake on the SNI, then lands the browser on an operator block page
// (websafe.virginmedia.com/childsafe-blocked.html). We do not fight the wire; we recognise that landing — a
// navigation whose FINAL host is a known filter host, a 3xx toward one, or a hard name/SNI net error on a
// fresh top-level load — and hand the ORIGINAL target to the nameless κ-deliver path (holo-deliver).
//
// Discipline (Law of least surprise): fail OPEN on ambiguity. A normal same-site 302, a 404, a slow load —
// none of these are censorship, so they classify blocked:false and the network load proceeds untouched. The
// net-error signals (NAME_NOT_RESOLVED / CONNECTION_RESET) are only honoured when the caller asserts the host
// was expected to resolve (opts.expectResolvable) — otherwise a genuinely dead host would read as a block.
// Pure ESM, no I/O. The host list is data: extend it per connection without touching the logic.

// Known ISP filter LANDING hosts (hostnames only — match is exact or a subdomain suffix). Conservative on
// purpose: a host here means "the operator redirected me to its block notice," not "this site is bad."
export const ISP_BLOCK_HOSTS = [
  "websafe.virginmedia.com",        // Virgin Media WebSafe / Child Safe (the enclosed case)
  "contentblocked.virginmedia.com",
  "blackhole.virginmedia.com",
  "homesafe.talktalk.co.uk",        // TalkTalk HomeSafe
  "barred.sky.com",                 // Sky Broadband Shield
  "blocked.bt.com",                 // BT Parental Controls
  "ee.co.uk",                       // EE Content Lock landing (subdomain-scoped below)
];

const hostOf = (u) => { try { return new URL(String(u)).host.toLowerCase(); } catch { return ""; } };

// isFilterHost(host, hosts) — exact host or a subdomain of a listed host (foo.websafe.virginmedia.com matches).
export function isFilterHost(host, hosts = ISP_BLOCK_HOSTS) {
  const h = String(host || "").toLowerCase();
  if (!h) return false;
  return hosts.some((b) => h === b || h.endsWith("." + b));
}

// detectBlock(obs, opts) — obs is what the browser observed for ONE navigation:
//   { requestedUrl, finalUrl?, status?, location?, netError? }
// returns { blocked:true, signal, original } when it is an ISP name-block, else { blocked:false }.
//   signals: "isp-block-page" (landed on a filter host) · "isp-redirect" (3xx toward one) ·
//            "isp-dns" (NAME_NOT_RESOLVED) · "isp-sni-reset" (CONNECTION_RESET on a load that should resolve).
export function detectBlock(obs = {}, opts = {}) {
  const hosts = opts.hosts || ISP_BLOCK_HOSTS;
  const { requestedUrl = "", finalUrl = "", status = 0, location = "", netError = "" } = obs;

  // Never treat a deliberate visit TO a filter host as a block (the user typed it / we landed there already).
  const requestedIsFilter = isFilterHost(hostOf(requestedUrl), hosts);

  // 1 · landed on a filter host after asking for something else → the block page itself.
  if (!requestedIsFilter && finalUrl && isFilterHost(hostOf(finalUrl), hosts))
    return { blocked: true, signal: "isp-block-page", original: requestedUrl };

  // 2 · a redirect pointing at a filter host (caught one hop early, before the landing renders).
  if (!requestedIsFilter && status >= 300 && status < 400 && location && isFilterHost(hostOf(location), hosts))
    return { blocked: true, signal: "isp-redirect", original: requestedUrl };

  // 3 · a hard name / SNI failure — ONLY when the caller vouches the host should have resolved (else a dead
  //     host would read as censorship). DNS poisoning often surfaces as NAME_NOT_RESOLVED; SNI reset as RST.
  if (netError && opts.expectResolvable && !requestedIsFilter) {
    if (netError === "NAME_NOT_RESOLVED") return { blocked: true, signal: "isp-dns", original: requestedUrl };
    if (netError === "CONNECTION_RESET") return { blocked: true, signal: "isp-sni-reset", original: requestedUrl };
  }

  return { blocked: false };
}

export default { ISP_BLOCK_HOSTS, isFilterHost, detectBlock };
