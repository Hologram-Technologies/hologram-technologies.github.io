// Witness: the hand-written docs reference must not diverge from the implementation.
//
// The generated pages (conformance, ADRs) cannot drift — they are produced from
// source on every build. The hand-written Reference (the Q verbs, the κ-route, the
// app model) CAN drift if someone renames an export or moves a file. This witness
// checks that every contract the docs assert by name still exists in the real
// source, and fails closed (exit 1) when one doesn't — so a stale doc cannot ship.
//
//   node system/tools/docs-reference-witness.mjs   → writes docs-reference.result.json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const R = (p) => resolve(HERE, '..', p); // repo system/ root
const read = (p) => { try { return readFileSync(R(p), 'utf8'); } catch { return ''; } };

// Each assertion: a doc claim → the source that must still back it.
const claims = [
  { doc: 'Q.fuse export', file: 'os/usr/lib/holo/q/holo-q-fuse.js', needle: 'export function createFuse' },
  { doc: 'Q.recall export', file: 'os/usr/lib/holo/q/holo-q-recall.js', needle: 'export function createRecall' },
  { doc: 'Q.factory wiring', file: 'os/usr/lib/holo/holo-mind-ui.js', needle: 'factory' },
  { doc: 'κ-route (sha256)', file: 'os/holo-fhs-sw.js', needle: '.holo/sha256' },
  { doc: 'κ-route (blake3)', file: 'os/holo-fhs-sw.js', needle: '.holo/blake3' },
  { doc: 'scaffold()', file: 'os/usr/lib/holo/holo-scaffold.js', needle: 'function scaffold' },
  { doc: 'capabilitiesToSandbox()', file: 'os/lib/holo-launch.mjs', needle: 'capabilitiesToSandbox' },
  { doc: 'reseal-drift --check', file: 'tools/reseal-drift.mjs', needle: '--check' },
  { doc: 'conformance catalog', file: 'os/etc/conformance.jsonld', needle: 'hosc:ConformanceAssertion' },
  { doc: 'agent door: agents.json', file: 'os/.well-known/agents.json', needle: 'schema:WebAPI' },
];

const checks = claims.map((c) => {
  const src = read(c.file);
  const ok = src.includes(c.needle);
  return { ...c, found: ok };
});

const failed = checks.filter((c) => !c.found);
const result = {
  spec: 'The docs Reference asserts only contracts that exist in the implementation (no stale names/paths).',
  witnessed: failed.length === 0,
  passed: checks.length - failed.length,
  failed: failed.length,
  checks: Object.fromEntries(checks.map((c) => [`${c.doc} ← ${c.file}`, c.found])),
};

writeFileSync(resolve(HERE, 'docs-reference.result.json'), JSON.stringify(result, null, 2) + '\n');

if (failed.length) {
  console.error('docs-reference-witness FAILED — the docs name something the code no longer has:');
  for (const c of failed) console.error(`  missing: ${c.doc} — expected "${c.needle}" in system/${c.file}`);
  process.exit(1);
}
console.log(`docs-reference-witness OK — ${checks.length}/${checks.length} documented contracts exist.`);
