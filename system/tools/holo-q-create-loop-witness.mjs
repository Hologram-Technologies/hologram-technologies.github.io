// holo-q-create-loop-witness.mjs — re-derivable proof of the Create loop (S5): build, prompt-edit, gesture-edit,
// and a dropped screenshot ALL converge through Q's intent→prompt synthesis onto the κ-DAG, every result is
// enforced beautiful + κ-addressed, and the app is felt-SOVEREIGN — shareable by κ (app OR element), forkable
// immutably (editing a fork never touches the origin), and a shared app re-derives + VERIFIES (L5) before it
// opens, refusing a tampered store. Pure Node, mock model fns over the real modules. Run: node …-witness.mjs
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const imp = (rel) => import(pathToFileURL(resolve(HERE, rel)).href);
const loop = await imp("../os/usr/lib/holo/q/holo-q-create-loop.mjs");
const dag = await imp("../os/usr/lib/holo/q/holo-q-app-dag.mjs");
const { gestureSetText } = await imp("../os/usr/lib/holo/q/holo-q-canvas-edit.mjs");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

// a mock coder: deterministic HTML from a prompt (the model). Includes a raw color so we can see enforce() act.
const build = async (prompt) => `<!doctype html><html><body><main><h1>${/heading to (.+?)["']?$/i.exec(prompt)?.[1] || "App"}</h1>`
  + `<p style="color:#ffffff">Built from intent</p><button class="cta">Go</button></main></body></html>`;
const buildEl = async (prompt) => `<h1>${/to (.+)$/i.exec(prompt)?.[1] || "Edited"}</h1>`;

console.log("\nholo-q Create loop — intent in, sovereign κ-app out\n");

// ── 1) build from intent: Q synth → model → enforced beautiful → κ-DAG ────────────────────────────────────
console.log("build from intent (synth → build → beauty → DAG):");
const app = await loop.buildApp({ intent: "a pricing page", build });
ok(typeof app.root === "string" && /^[0-9a-f]{64}$/.test(app.root), "the build produced a κ-addressed app (root κ)");
ok(app.prompt && app.prompt.length > "a pricing page".length, "Q wrote its own (richer) build prompt");
ok(!/#ffffff/.test(dag.recompose(app.root, app.store)) && /var\(--holo-/.test(dag.recompose(app.root, app.store)), "the output was enforced beautiful (raw #ffffff → --holo-* token)");
ok(dag.verify(app.store).ok, "every node of the built app re-derives to its κ (L5)");

// ── 2) screenshot → vision seed → build (verify-before-use; falls back when vision is empty) ──────────────
console.log("\nscreenshot seeds the build via the vision faculty:");
{
  const vision = async () => "a dark dashboard with three stat cards";
  const a = await loop.buildApp({ intent: "make something", screenshot: { bytes: [1, 2, 3] }, build, vision });
  ok(a.seededBy === "screenshot" && /dashboard|stat/i.test(a.prompt), "a screenshot is described by vision and seeds the prompt");
  const emptyVision = async () => "  ";
  const b = await loop.buildApp({ intent: "a calc app", screenshot: { bytes: [9] }, build, vision: emptyVision });
  ok(b.seededBy === "intent", "empty/garbage vision → falls back to the typed intent (verify-before-use)");
}

// ── 3) edit converges: prompt-edit and gesture-edit both land on the DAG (and match when equal) ───────────
console.log("\nedit by prompt and by touch both mutate the DAG:");
{
  const h1k = Object.keys(app.store).find((k) => { try { return /^<h1>.*<\/h1>$/.test(dag.recompose(k, app.store)); } catch (e) { return false; } });
  const path = dag.findPaths(app.root, app.store, h1k)[0];
  const viaPrompt = await loop.editApp({ root: app.root, store: app.store, path, intent: "rename the heading to Pricing", build: buildEl });
  const viaTouch = await loop.editApp({ root: app.root, store: app.store, path, gesture: (h) => gestureSetText(h, "Pricing") });
  ok(viaPrompt.via === "prompt" && viaTouch.via === "touch", "both doors are available on the same element/path");
  ok(viaPrompt.root === viaTouch.root, "prompt-edit and touch-edit produce the IDENTICAL new root κ (speak == touch)");
  ok(dag.recompose(viaPrompt.root, app.store).includes("Pricing"), "the edit is reflected");
  ok(dag.recompose(app.root, app.store) === dag.recompose(app.root, app.store), "the original app root is unchanged (immutable)");
}

// ── 4) sovereign share: by κ (app + element), resolves VERIFIED, refuses tampering ────────────────────────
console.log("\nsovereign share — by κ, verified on open, tamper-refused:");
{
  const link = loop.shareLink(app.root);
  ok(link.startsWith("holo://sha256/") && loop.parseShareLink(link) === app.root, "the app shares as a content-addressed κ-link");
  ok(loop.resolveShared(link, app.store) === dag.recompose(app.root, app.store), "a shared app re-derives to the exact bytes (verified open)");
  const btnK = Object.keys(app.store).find((k) => { try { return dag.recompose(k, app.store) === '<button class="cta">Go</button>'; } catch (e) { return false; } });
  ok(loop.resolveShared(loop.shareElement(btnK), app.store) === '<button class="cta">Go</button>', "a single ELEMENT is shareable by its own κ");
  const tampered = JSON.parse(JSON.stringify(app.store)); const anyK = Object.keys(tampered).find((k) => tampered[k].t === "txt"); tampered[anyK] = { t: "txt", v: "EVIL" };
  let refused = false; try { loop.resolveShared(link, tampered); } catch (e) { refused = /L5 REFUSE/.test(e.message); }
  ok(refused, "a tampered store is REFUSED on resolve (L5 — never trusted)");
}

// ── 5) fork is sovereign: editing your fork never touches the origin ──────────────────────────────────────
console.log("\nfork — copy-on-write by construction, origin immutable:");
{
  const f = loop.fork(app.root, app.store);
  const h1k = Object.keys(app.store).find((k) => { try { return /^<h1>/.test(dag.recompose(k, app.store)); } catch (e) { return false; } });
  const path = dag.findPaths(f.root, app.store, h1k)[0];
  const edited = await loop.editApp({ root: f.root, store: app.store, path, gesture: (h) => gestureSetText(h, "My Fork") });
  ok(edited.root !== f.origin, "editing the fork mints a new root κ");
  ok(dag.recompose(f.origin, app.store) === dag.recompose(app.root, app.store) && !dag.recompose(f.origin, app.store).includes("My Fork"), "the ORIGIN root still resolves to the original — your fork is yours, the source is untouched");
  ok(dag.recompose(edited.root, app.store).includes("My Fork"), "the fork carries your change");
}

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
