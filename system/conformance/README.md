# conformance/

**Retired (2026-06-10).** Hologram OS2 is the lean, content-addressed OS image. Its
conformance gate is **`tools/gate.mjs`** over **`os/etc/conformance.jsonld`** — run it with
**`npm run gate`** (from `system/`). That gate re-runs each pure-Node witness live, joins it
to the catalog, fails closed on any unwitnessed required row, and emits a W3C **EARL** report
(`os/etc/earl-report.jsonld`). The catalog is itself valid JSON-LD.

The inherited `w3c-conformance.jsonld` + `w3c-gate.mjs` (a ~95-row W3C landscape from the full
hologram-os product) were retired here: their witnesses live in that product's `os/`, not in
this lean image, so the catalog pointed at witnesses OS2 does not carry (`w3c-gate --strict`
could never pass). The W3C / open-semantic-web standards OS2 actually enforces — JSON-LD, DID
Core, SHACL, PROV-O, EARL, Service Workers, WebAssembly, MCP, … — are the witnessed rows of
`os/etc/conformance.jsonld`. Discipline is unchanged (ADR-024): every required row is witnessed
against an external authority, never self-reference; required rows are refuse-on-red.
