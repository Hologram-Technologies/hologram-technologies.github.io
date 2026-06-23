#!/usr/bin/env node
// holo-q-vision-cdp-witness.mjs — THE NATIVE CROSS-ORIGIN LEG, proven in pure Node against a fake CDP
// transport. The browser cannot read another origin's pixels; the native Hologram browser can, over CDP.
// This proves the message-shaping + frame-selection are correct so that, on the native host, only the
// cross-origin frames are screenshotted and handed to the same ambient watcher.
//   SELECT   → crossOriginFrames walks Page.getFrameTree and returns ONLY the frames whose origin ≠ top
//   CAPTURE  → captureFrame issues Page.captureScreenshot for the named frame → PNG bytes island
//   SCAN     → notices every cross-origin frame (with pixels) and never the same-origin ones
//
//   node tools/holo-q-vision-cdp-witness.mjs
//
// Authority: ADR-0095 (κ-CDP backend) · ADR-0081 (perception) · Law L5 (never fakes).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createCdpCapture, crossOriginFrames, originOf } from "../os/usr/lib/holo/q/holo-q-vision-cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

// a page at origin A with: a same-origin child (A), a cross-origin child (B), and B's nested child (C)
const FRAME_TREE = {
  frame: { id: "top", url: "https://app.example/index.html" },               // top origin = https://app.example
  childFrames: [
    { frame: { id: "f-same", url: "https://app.example/widget.html" } },     // same origin → skip
    { frame: { id: "f-b", url: "https://maps.other.com/embed" }, childFrames: [
      { frame: { id: "f-c", url: "https://ads.third.net/banner" } },         // nested cross-origin → include
    ] },
    { frame: { id: "f-blank", url: "about:blank" } },                        // no distinct origin → skip
  ],
};

// ── 1 · SELECT — only the cross-origin frames are chosen ──
{
  const xo = crossOriginFrames(FRAME_TREE);
  const ids = xo.map((f) => f.frameId).sort();
  ok("selects-only-cross-origin-frames",
    JSON.stringify(ids) === JSON.stringify(["f-b", "f-c"]) &&
    originOf("https://maps.other.com/embed") === "https://maps.other.com" &&
    originOf("about:blank") === null,
    ids.join(","));
}

// ── 2 · CAPTURE + 3 · SCAN — screenshot each cross-origin frame; notice it with real PNG bytes ──
{
  const sent = [];
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]).toString("base64");
  const send = async (method, params) => {
    sent.push({ method, params });
    if (method === "Page.getFrameTree") return { frameTree: FRAME_TREE };
    if (method === "Page.captureScreenshot") return { data: PNG };
    return {};
  };
  const noticed = [];
  const cap = createCdpCapture({ send, notice: (isl) => { noticed.push(isl); } });
  const out = await cap.scan();

  const shotFrameIds = sent.filter((s) => s.method === "Page.captureScreenshot").map((s) => s.params.frameId).sort();
  ok("screenshots-each-cross-origin-frame-by-id",
    JSON.stringify(shotFrameIds) === JSON.stringify(["f-b", "f-c"]) &&
    sent.find((s) => s.method === "Page.captureScreenshot").params.format === "png",
    shotFrameIds.join(","));

  ok("notices-islands-with-real-png-bytes",
    noticed.length === 2 &&
    noticed.every((i) => i.pixels instanceof Uint8Array && i.pixels[0] === 0x89 && i.pixels[1] === 0x50) &&
    noticed.every((i) => i.kind === "raster") &&
    JSON.stringify(out.sort()) === JSON.stringify(["frame:f-b", "frame:f-c"]),
    noticed.map((i) => i.id).join(","));

  ok("same-origin-and-blank-frames-never-shot",
    !shotFrameIds.includes("f-same") && !shotFrameIds.includes("f-blank") && cap.stats().noticed === 2,
    JSON.stringify(cap.stats()));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "SELECT — crossOriginFrames walks Page.getFrameTree and returns only frames whose origin differs from the top page (nested included; same-origin + about:blank skipped)",
    "CAPTURE — captureFrame issues Page.captureScreenshot (format png) for the named frameId and decodes the base64 to PNG bytes",
    "SCAN — every cross-origin frame is noticed as a raster island with real bytes; same-origin/blank frames are never screenshotted",
  ],
  checks, failed: fail,
  authority: "ADR-0095 (κ-CDP backend) · ADR-0081 (perception) · holospaces Law L5",
};
writeFileSync(join(here, "holo-q-vision-cdp-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Q Vision CDP witness — the native cross-origin leg\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
