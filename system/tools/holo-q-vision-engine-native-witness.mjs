#!/usr/bin/env node
// holo-q-vision-engine-native-witness.mjs — THE 3B DOCUMENT-ENGINE BRIDGE, proven in pure Node against a
// fake native transport. The 3B runs only on the GPU host; this proves the request-shaping + result-
// mapping are correct so that, on the host, the κ-addressed weights produce a sealed κ with grounding.
//   REQUEST  → read() invokes "vision.read" with the model's κ, a base64 PNG, and the prompt
//   GROUND   → the native model's coords flow through to the sealed κ (grounding the browser engine lacks)
//   HONEST   → no host transport ⇒ read() returns null, never a fabricated read (Law L5)
//
//   node tools/holo-q-vision-engine-native-witness.mjs
//
// Authority: ADR-0052 (κ-disk weights) · ADR-0084 (mux vision specialist) · UOR envelope · Law L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createNativeEngine, UNLIMITED_OCR } from "../os/usr/lib/holo/q/holo-q-vision-engine-native.mjs";
import { createVisionSpecialist } from "../os/usr/lib/holo/q/holo-q-vision.mjs";
import { verify } from "../os/usr/lib/holo/holo-object.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// ── 1 · REQUEST — read() shapes the host call: verb, model κ, base64 image, prompt ──
let captured = null;
const invoke = async (verb, payload) => {
  captured = { verb, payload };
  return { markdown: "# Invoice 1042\n| item | qty |\n|---|---|\n| widget | 3 |", coords: [{ text: "Invoice 1042", box: [12, 8, 220, 40] }] };
};
{
  const eng = createNativeEngine({ invoke, modelKappa: "did:holo:sha256:" + "a".repeat(64) });
  const out = await eng.read(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), "document parsing.");
  ok("request-shapes-host-call",
    captured && captured.verb === "vision.read" &&
    captured.payload.kappa === "did:holo:sha256:" + "a".repeat(64) &&
    typeof captured.payload.image === "string" && captured.payload.image.length > 0 &&
    captured.payload.prompt === "document parsing.",
    captured && captured.verb);
  ok("maps-markdown-and-grounding-coords",
    out && /Invoice 1042/.test(out.markdown) && Array.isArray(out.coords) && out.coords[0].box.length === 4,
    out && JSON.stringify(out.coords));
}

// ── 2 · GROUND — through the specialist, coords are sealed INTO the κ (verifiable grounding) ──
{
  const eng = createNativeEngine({ invoke });
  const sp = createVisionSpecialist({ engine: eng });
  const r = await sp.infer({ imageBytes: new Uint8Array([1, 2, 3]) });
  ok("specialist-seals-grounding-into-kappa",
    r && verify(r.object) && r.object.id === r.kappa &&
    Array.isArray(r.object["holo:coords"]) && r.object["holo:coords"][0].text === "Invoice 1042",
    r && r.kappa);
}

// ── 3 · HONEST — no host transport ⇒ null, never a fabricated read (Law L5) ──
{
  const eng = createNativeEngine({ invoke: null });
  const r = await eng.read(new Uint8Array([1, 2, 3]));
  ok("no-host-honest-null", r === null && UNLIMITED_OCR.id === "unlimited-ocr-3b", String(r));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "REQUEST — read() invokes the host verb 'vision.read' with the κ-addressed model (ADR-0052), a base64 PNG image, and the parsing prompt",
    "GROUND — the native 3B's grounding coords flow through read() and are sealed into the perception κ (holo:coords), verifiable (the browser TrOCR lacks this)",
    "HONEST — with no native transport the bridge returns null; it never fabricates a read; the mux falls back to the browser engine, then main (Law L5)",
  ],
  checks, failed: fail,
  authority: "ADR-0052 (κ-disk weights) · ADR-0084 (mux vision specialist) · UOR object envelope · holospaces Law L5",
};
writeFileSync(join(here, "holo-q-vision-engine-native-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Q Vision native-engine witness — the 3B document bridge (κ-addressed)\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
