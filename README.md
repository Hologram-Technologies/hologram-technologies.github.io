# Holo Messenger — serverless

Every messenger in one inbox — running 100% in your browser. No backend, no account, no phone number:
your identity lives on your device (TEE biometric — Windows Hello / Touch ID), every shell byte is
content-addressed and verified before it paints, and repeat opens work fully offline.

**Open it:** serve this tree from any static host (GitHub Pages works as-is, root or subpath) and visit
`apps/holo-messenger/app.html` — or the root `index.html`, which forwards there.
Instant ephemeral tour, no biometric: append `?guest=1`.

## What holds it together
- **κ-verified shell (Law L5).** `apps/holo-messenger/shell-manifest.json` commits the SHA-256 of every
  shell byte (aggregate κ `a7801bc7f1fdf961…`). The service worker refuses any byte that does not
  re-derive to its committed κ, and can recover the whole shell from the content-addressed store in `b/`
  — the origin is untrusted plumbing.
- **Sovereign identity.** Sign-in is your device's authenticator; fail-closed, nothing confidential paints
  before identity. Guest sessions persist nothing.
- **Serverless by construction.** Assembled by dependency-closure inclusion from the Hologram OS tree —
  dev servers, platform bridges, and credentials are structurally absent. Platform connections are made
  by each user, from their own browser, private to their device.
- **Offline after first open.** The worker precaches the verified shell; the second open needs zero
  network bytes to paint.

Assembled by `assemble-q-bundle.mjs` in the Hologram monorepo — do not edit files here by hand;
regenerate the bundle from canonical source.
