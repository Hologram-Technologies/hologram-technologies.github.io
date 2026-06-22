// holo-q-app-dag-witness.mjs — re-derivable proof that an app is a κ-DAG of addressable elements (S2):
// decompose→recompose is byte-IDENTITY; every node re-derives to its κ (L5); identical subtrees are stored ONCE
// (L2 dedup); editing one element mints a NEW κ + re-links only its ancestors while siblings are structurally
// shared; and the OLD root still recomposes to the original (immutable version history, L3). Pure Node, the
// substrate hash. Run: node holo-q-app-dag-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const { decompose, recompose, verify, findPaths, editAtPath, stats, kid } = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-app-dag.mjs")).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// an app with nesting, void elements, an attr containing '>', a <style>, a <script>, and a REPEATED element
// (two identical <button class="cta">Go</button>) so dedup is observable.
const DOC = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<style>:root{--holo-bg:#0b0e16}body{background:var(--holo-bg)}</style></head>',
  '<body><main class="wrap"><section class="tiers">',
  '<div class="tier"><h2>Starter</h2><p data-note="a>b">Free</p><button class="cta">Go</button></div>',
  '<div class="tier"><h2>Pro</h2><p>$9</p><button class="cta">Go</button></div>',
  '</section><footer>On-device</footer></main>',
  '<script>console.log("hi")<\/script></body></html>',
].join("");

console.log("\nholo-q app DAG — every element is a κ-object; edits mint new κ, siblings shared\n");

// ── 1) decompose → recompose is byte-IDENTICAL ────────────────────────────────────────────────────────────
const { root, store } = decompose(DOC);
console.log("decompose → recompose round-trips exactly:");
ok(recompose(root, store) === DOC, "recompose(root) === the original document, byte-for-byte");
ok(typeof root === "string" && /^[0-9a-f]{64}$/.test(root), "the app has a single root κ (sha256)");
ok(kid(root).startsWith("did:holo:sha256:"), "the root is a first-class substrate identity (did:holo:sha256:…)");

// ── 2) L5: every node re-derives to its κ ─────────────────────────────────────────────────────────────────
console.log("\nL5 — every node re-derives to its κ:");
{
  const v = verify(store);
  ok(v.ok && v.bad.length === 0, `all ${v.checked} nodes re-derive to their content κ (L5), 0 bad`);
}

// ── 3) L2 dedup: the two identical buttons are stored ONCE ────────────────────────────────────────────────
console.log("\nL2 — identical subtrees are stored once (dedup):");
{
  const st = stats(store, root);
  ok(st.dedup >= 1, `${st.nodes} node instances → ${st.unique} unique κ (${st.dedup} deduped by content)`);
  // the button subtree appears at two paths but is one κ
  const btnK = Object.keys(store).find((k) => { try { return recompose(k, store) === '<button class="cta">Go</button>'; } catch (e) { return false; } });
  ok(!!btnK, "the repeated <button> is addressable by a single κ");
  ok(findPaths(root, store, btnK).length === 2, "…that one κ occurs at BOTH locations (shared, not duplicated)");
}

// ── 4) every element is independently addressable + recomposable ──────────────────────────────────────────
console.log("\nevery element is its own κ-object:");
const starterK = Object.keys(store).find((k) => { try { return recompose(k, store) === "<h2>Starter</h2>"; } catch (e) { return false; } });
ok(!!starterK, "an inner element (<h2>Starter</h2>) has its own κ");
ok(recompose(starterK, store) === "<h2>Starter</h2>", "…and recomposes independently to just that element");

// ── 5) edit one element → new root κ, ancestors re-linked, siblings shared, OLD root immutable ────────────
console.log("\nedit one element — new κ up the path, siblings shared, old version preserved:");
{
  const path = findPaths(root, store, starterK)[0];
  const proK = Object.keys(store).find((k) => { try { return recompose(k, store) === "<h2>Pro</h2>"; } catch (e) { return false; } });
  const before = recompose(root, store);
  const r2 = editAtPath(root, store, path, "<h2>Starter Plus</h2>");
  ok(r2.root !== root, "editing mints a NEW root κ (the app version changed)");
  ok(recompose(r2.root, store).includes("Starter Plus") && !recompose(r2.root, store).includes(">Starter<"), "the new app reflects the edit");
  ok(recompose(root, store) === before && before === DOC, "the OLD root still recomposes to the original — immutable version history (L3)");
  // the untouched sibling (<h2>Pro</h2>) keeps its κ — structural sharing, only the edited path re-minted
  ok(findPaths(r2.root, store, proK).length === 1, "the untouched sibling <h2>Pro</h2> keeps its κ (structural sharing, not re-minted)");
  ok(recompose(r2.root, store) !== recompose(root, store), "new and old versions are distinct re-derivable documents");
}

// ── 6) robustness ─────────────────────────────────────────────────────────────────────────────────────────
console.log("\nrobustness:");
{
  for (const h of ["", "<div>x</div>", "plain text", "<img src=x>", "<br/>", "<p>a<p>b</p>"]) {
    const d = decompose(h);
    if (recompose(d.root, d.store) !== h) { ok(false, "round-trip failed for: " + JSON.stringify(h)); }
    if (!verify(d.store).ok) { ok(false, "L5 failed for: " + JSON.stringify(h)); }
  }
  ok(true, "empty / fragments / void / self-close / implicit-nest all round-trip byte-identical + L5-clean");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
