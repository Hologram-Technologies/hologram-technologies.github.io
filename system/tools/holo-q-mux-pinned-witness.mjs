// holo-q-mux-pinned-witness.mjs — re-derivable proof that the canonical model registry (holo-q-mux.js)
// now carries Q's CORE I/O faculties as κ-pinned .holo specialists, and that those κs are the SAME bytes
// pinned in apps/q/forge/.models/holo-ipfs-pins.json (one source of truth, Law L1). Pure Node — no network,
// no GPU, no browser. Exit 0 = green; exit 1 = a real divergence. Run: node holo-q-mux-pinned-witness.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const mux = await import(pathToFileURL(resolve(HERE, "../os/usr/lib/holo/q/holo-q-mux.js")).href);
const PINS = JSON.parse(readFileSync(resolve(HERE, "../../../holo-apps/apps/q/forge/.models/holo-ipfs-pins.json"), "utf8")).models;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

console.log("\nholo-q-mux — core-faculty κ-pinning witness\n");

// 1) the four core I/O faculties exist as pinned rows
console.log("core I/O faculties present + pinned:");
for (const id of ["respond", "listen", "speak", "code"]) {
  const t = mux.TASKS.find((x) => x.id === id);
  ok(t && t.pinned === true, `task "${id}" exists and is pinned:true`);
}

// 2) pinned tasks return a κ plan, NEVER an HF call (fetch is poisoned to prove no network is touched)
console.log("\npickSpecialist on pinned tasks = κ plan, zero network:");
const poison = () => { throw new Error("network touched — pinned task must NOT discover"); };
for (const id of ["respond", "listen", "speak", "code"]) {
  const plan = await mux.pickSpecialist(id, { fetch: poison });
  ok(plan.pinned === true && plan.specialist && /^[0-9a-f]{64}$/.test(plan.specialist.kappa || ""),
     `"${id}" → pinned plan with a 64-hex κ (${plan.specialist && plan.specialist.id})`);
}

// 3) the pinned κs MATCH the IPFS-pinned .holo footers (one source of truth)
console.log("\npinned κ == holo-ipfs-pins.json archiveKappa (same bytes):");
const map = { respond: "qwen2.5-0.5b-instruct", code: "qwen2.5-coder-3b-instruct", listen: "moonshine-tiny-int8", speak: "kokoro-82m" };
for (const [fac, pinKey] of Object.entries(map)) {
  const muxKappa = mux.PINNED[fac].instant.kappa, pinKappa = PINS[pinKey] && PINS[pinKey].archiveKappa;
  ok(muxKappa === pinKappa, `${fac}: ${muxKappa.slice(0, 12)}… == pins[${pinKey}] ${(pinKappa || "MISSING").slice(0, 12)}…`);
}
// upgrade tier κs too (respond→1.5b, listen→f16)
ok(mux.PINNED.respond.upgrade.kappa === PINS["qwen2.5-1.5b-instruct"].archiveKappa, "respond upgrade κ == qwen2.5-1.5b pin");
ok(mux.PINNED.listen.upgrade.kappa === PINS["moonshine-tiny-f16"].archiveKappa, "listen upgrade κ == moonshine-f16 pin");

// 4) HELPER tasks still discover + rank (the existing behavior is intact) — with an injected fetch
console.log("\nhelper tasks still HF-discover (regression):");
const fakeFetch = async () => ({ json: async () => ([
  { id: "Xenova/distilbart-cnn", pipeline_tag: "summarization", tags: ["onnx"], downloads: 9000, likes: 40 },
]) });
const plan = await mux.pickSpecialist("web-extract", { fetch: fakeFetch });
ok(plan.specialist && plan.specialist.id === "Xenova/distilbart-cnn", "web-extract discovers + ranks the runnable candidate");

// 5) deterministic + routeFallback unchanged
console.log("\ninvariants (deterministic + main fallback) intact:");
const det = await mux.pickSpecialist("import", { fetch: poison });
ok(det.deterministic === true && det.specialist === null, "import stays deterministic (no model, no network)");
ok(mux.routeTask("respond").id === "main" && mux.routeTask("respond").fallback === true, "unbound route → main sentinel (caller binds the brain)");

// 6) resolveModel — the single front door: override → pinned → main, one precedence everywhere
console.log("\nresolveModel() precedence (the one front door):");
mux.unbindAll();
ok(mux.resolveModel("respond").source === "pinned" && mux.resolveModel("respond").id === "qwen2.5-0.5b", "respond (unbound) → pinned κ brain");
ok(mux.resolveModel("ask").source === "main", "ask (helper, unbound) → main brain");
ok(mux.resolveModel("import").source === "deterministic", "import → deterministic encoder");
mux.bindSpecialist("respond", { id: "user-picked-7b", generate: () => {} });   // the settings picker writes here
ok(mux.resolveModel("respond").source === "override" && mux.resolveModel("respond").id === "user-picked-7b", "respond after a user override → that exact model (override wins over pinned)");
mux.unbindAll();
ok(mux.resolveModel("respond").source === "pinned", "unbind restores the pinned default");

// 7) describeMux surfaces the pinned plane
const d = mux.describeMux();
ok(d.pinned && d.pinned.respond && d.pinned.listen && d.pinned.speak && d.pinned.code, "describeMux() exposes the pinned faculty plane");

console.log(`\n${fail === 0 ? "GREEN" : "RED"} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
