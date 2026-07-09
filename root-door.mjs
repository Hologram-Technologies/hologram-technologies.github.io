// root-door.mjs — CSP-safe root redirect (no inline script: Discord Activities block it).
// Discord marks its Activity iframe with ?frame_id (and serves through *.discordsays.com); everything
// else is a plain browser. The query string MUST survive the hop — the Embedded App SDK reads frame_id
// from location.search of the document it boots in.
var inDiscord = false;
try { inDiscord = /(^|\.)discordsays\.com$/.test(location.hostname) || new URLSearchParams(location.search).has("frame_id"); } catch (e) {}
var page = inDiscord ? "discord.html" : "app.html";
location.replace(new URL("./apps/holo-messenger/" + page, location.href).href + location.search + location.hash);
