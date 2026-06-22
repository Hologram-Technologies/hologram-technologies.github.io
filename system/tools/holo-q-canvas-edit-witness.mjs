// holo-q-canvas-edit-witness.mjs — re-derivable proof that the two edit doors are ONE operation (S3): a direct
// on-canvas gesture (retext / restyle-with-token / drag) and a follow-up prompt that expresses the same change
// land on the IDENTICAL new κ — speak == touch. Restyle accepts only --holo-* tokens (beauty invariant). Undo
// returns the previous κ exactly (immutable history, L3). Pure Node. Run: node holo-q-canvas-edit-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const dag = await imp("../os/usr/lib/holo/q/holo-q-app-dag.mjs");
const { applyGesture, gestureSetText, gestureSetStyle, gestureMove, createHistory, kAtPath } = await imp("../os/usr/lib/holo/q/holo-q-canvas-edit.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

const DOC = '<!doctype html><html><body><main><section><div class="tier"><h2>Starter</h2><p>Free</p>'
  + '<button class="cta">Go</button></div><div class="tier"><h2>Pro</h2><p>$9</p></div></section></main></body></html>';

const { root, store } = dag.decompose(DOC);
const pathTo = (htmlOfNode) => { const k = Object.keys(store).find((x) => { try { return dag.recompose(x, store) === htmlOfNode; } catch (e) { return false; } }); return dag.findPaths(root, store, k)[0]; };

console.log("\nholo-q canvas edit — speak == touch: both doors converge on the same κ\n");

// ── 1) CONVERGENCE: a retext gesture and a prompt-edit to the same HTML → identical new root κ ─────────────
console.log("convergence — direct retext == prompt-edit (same κ):");
{
  const path = pathTo("<h2>Starter</h2>");
  const viaTouch = applyGesture(root, store, path, (h) => gestureSetText(h, "Starter Plus"));   // drag-select + type
  const viaPrompt = dag.editAtPath(root, store, path, "<h2>Starter Plus</h2>");                  // "rename the heading to Starter Plus"
  ok(viaTouch.root === viaPrompt.root, "touch (retext) and prompt land on the IDENTICAL new root κ — one operation");
  ok(dag.recompose(viaTouch.root, store).includes("Starter Plus"), "the new app reflects the edit");
  ok(dag.recompose(root, store) === DOC, "the original root is untouched (immutable; L3)");
}

// ── 2) restyle with a --holo-* token (beauty invariant) ───────────────────────────────────────────────────
console.log("\nrestyle is token-only (beauty by construction):");
{
  const path = pathTo('<button class="cta">Go</button>');
  const r = applyGesture(root, store, path, (h) => gestureSetStyle(h, { color: "var(--holo-accent)" }));
  const out = dag.recompose(r.root, store);
  ok(out.includes('style="color:var(--holo-accent)"') || /style="[^"]*--holo-accent/.test(out), "restyle applied a --holo-* token to the element");
  ok(r.root !== root, "restyle minted a new version");
  let rejected = false;
  try { gestureSetStyle('<button>Go</button>', { color: "#ff0000" }); } catch (e) { rejected = true; }
  ok(rejected, "a raw hex color is REJECTED — only design tokens are allowed (stays on-brand)");
}

// ── 3) drag (move) → a transform translate; same DAG mutation path ────────────────────────────────────────
console.log("\ndrag → transform; structurally shared:");
{
  const path = pathTo('<button class="cta">Go</button>');
  const r = applyGesture(root, store, path, (h) => gestureMove(h, 12, -4));
  ok(dag.recompose(r.root, store).includes("transform:translate(12px, -4px)"), "drag wrote a transform onto the element");
  // a sibling the gesture didn't touch keeps its κ
  const proK = Object.keys(store).find((k) => { try { return dag.recompose(k, store) === "<h2>Pro</h2>"; } catch (e) { return false; } });
  ok(dag.findPaths(r.root, store, proK).length === 1, "untouched sibling keeps its κ (structural sharing)");
}

// ── 4) undo/redo over the immutable root-κ history ────────────────────────────────────────────────────────
console.log("\nundo = the previous κ, exactly (immutable history):");
{
  const hist = createHistory(root);
  const path = pathTo("<h2>Pro</h2>");
  const v1 = applyGesture(hist.root(), store, path, (h) => gestureSetText(h, "Pro Max"));
  hist.push(v1.root);
  ok(hist.root() === v1.root && dag.recompose(hist.root(), store).includes("Pro Max"), "after a gesture, current version shows the edit");
  const back = hist.undo();
  ok(back === root && dag.recompose(back, store) === DOC, "undo → the exact previous root κ, recomposes to the original byte-for-byte");
  const fwd = hist.redo();
  ok(fwd === v1.root && dag.recompose(fwd, store).includes("Pro Max"), "redo → the edited version's exact κ (nothing lost, re-derived)");
  ok(hist.versions().length === 2 && !hist.canRedo(), "history is a clean immutable version line");
}

// ── 5) robustness: a gesture on a void/textless element is a safe no-op ───────────────────────────────────
console.log("\nrobustness:");
{
  ok(gestureSetText("<img src=x>", "hi") === "<img src=x>", "retext on a void element is a no-op (no corruption)");
  ok(applyGesture(root, store, pathTo("<h2>Starter</h2>"), (h) => h).root === root, "an identity gesture yields the same κ (no spurious version)");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
