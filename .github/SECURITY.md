# Security Policy

## The model

Hologram OS is serverless and content-addressed, which shapes its security model:

- **Integrity is intrinsic (Law L5).** Every object's identity is the hash of its content
  (`did:holo:sha256:…`). Resolving = re-deriving the hash and refusing a mismatch — the
  open-web form of this is W3C Subresource Integrity. No object is trusted because of where
  it came from; it is trusted because its bytes prove themselves.
- **Authenticity is separate, and explicit.** A content address says *what* the bytes are,
  never *who* authored them. Attribution across a trust boundary is carried by W3C
  Verifiable Credentials over the κ — not by the address. Do not treat "verified hash" as
  "verified author".
- **No ambient authority.** Resolution can run fully offline against a local store; there
  is no registry or server to compromise or to leak lookups to.

## Reporting a vulnerability

Please report suspected vulnerabilities privately rather than opening a public issue. Open
a GitHub security advisory on this repository (Security → Report a vulnerability), or
contact the maintainers. Include reproduction steps and the affected component / witness.

We aim to acknowledge within a few days. Fixes land with a witness that demonstrates the
issue is closed, where applicable.

## Scope

This repo carries product only. Engine-level issues belong upstream in
[holospaces](https://github.com/Hologram-Technologies/holospaces); we will help route them.
