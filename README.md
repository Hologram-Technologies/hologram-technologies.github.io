# Hologram OS — the universal resolver

**[Open it →](https://hologram-technologies.github.io/hologram-os)** · one link verifies itself into a whole
operating system, in any browser, no server, no install, no account.

> This is the `main` branch — the tree GitHub Pages serves. For the human introduction, see the
> [**cover on `home`**](https://github.com/Hologram-Technologies/hologram-os).

## One law

**A thing's name is the hash of its bytes.** Nothing is fetched by location — everything by identity,
and re-derived on arrival. A byte that doesn't equal its name doesn't exist. Everything else — leanness,
security, offline, portability — follows from that.

Ask for something and it streams the bytes from wherever it can reach them (this origin, a mirror, the
IPFS network, a peer), checks each against its fingerprint, and shows them only if they match. So it never
has to trust any single host to be online, or honest. Take every host away but one, and it still resolves.

## What this branch is

The whole tree GitHub Pages serves. The front door is `index.html`; it reads a name or link as an object
and unfolds it. The apps, the runtime, and the history mostly **aren't here as bytes** — they stream on
demand, verified, from the [content store](https://github.com/Hologram-Technologies/hologram-apps) and the
open web. What stays is the seed and the machinery that resolves and proves.

## Run it

Serve this tree from any static host — GitHub Pages as-is, root or subpath, or copy it anywhere and it
boots byte-identically. No backend. Try it without signing in: `?guest=1`. The engine updates upstream
from [holospaces](https://github.com/Hologram-Technologies/holospaces) — improvements arrive with nothing
to install.

<sub>MIT · verify by re-derivation, or refuse.</sub>
