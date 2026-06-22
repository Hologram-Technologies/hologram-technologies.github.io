<!-- The OS is published as-is and the Service Worker re-derives every byte to its
     pinned κ (Law L5). A PR is mergeable only when its seals are current and the
     fail-closed gates are green. See CONTRIBUTING.md. -->

## What this changes

<!-- One paragraph. Link the affected app / module / doc. -->

## Checklist

- [ ] Commits follow **Conventional Commits** (the changelog is generated from history)
- [ ] If any sealed byte changed, I ran **`npm run reseal`** and committed the result
- [ ] `node system/tools/reseal.mjs --check` reports **SEALED ✓** (served bytes == pinned κ)
- [ ] No secret or key material added (gitleaks must pass)
- [ ] Documented contracts still exist (docs-reference witness passes)
- [ ] No location-as-identity introduced; objects open by κ (no host/path/URL as identity)
- [ ] Authority is only attenuated — no new ambient capability granted to an app

## Verification

<!-- Paste the seal-gate output, witness counts, or browser proof where relevant. -->
