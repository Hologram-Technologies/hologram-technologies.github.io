# License note — jellyfin-web

This app serves the **jellyfin-web** front-end (`web/`), version **10.11.11**, distributed as **unmodified
upstream bytes** except for a single deployment-configuration file (`web/config.json`, which jellyfin-web is
designed to have edited for a deployment — here it pins the server address and disables the multi-server
picker). jellyfin-web is licensed **GPL-2.0-only**.

- Upstream: https://github.com/jellyfin/jellyfin-web (dist obtained from the official Debian package,
  `repo.jellyfin.org`).
- Source for the exact version shipped: https://github.com/jellyfin/jellyfin-web/releases/tag/v10.11.11
- These bytes are redistributed verbatim under GPL-2.0; no changes to the program itself were made.

Everything OUTSIDE `web/` — the Service Worker (`holo-jellyfin-sw.js`), the pure core
(`holo-jellyfin-core.mjs`), the music provider (`holo-jellyfin-music.mjs`), and the wrapper (`index.html`) —
is Hologram's own code (MIT), kept strictly separate from the GPL front-end: they communicate only over the
Jellyfin HTTP API contract, never by linking. The Service Worker answers that contract from the κ substrate;
no Jellyfin server code (.NET) is used or distributed.
