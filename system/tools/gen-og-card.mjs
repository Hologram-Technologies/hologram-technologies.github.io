#!/usr/bin/env node
// gen-og-card.mjs — render the Open-Graph preview card (1200×630) that chats unfurl when a Hologram
// OS / shared-app link is pasted. On-brand: the cube mark + the three verbs over the dark gradient.
// Rasterised from an inline SVG via the project's Chromium (Playwright), so it's a real PNG every
// crawler accepts. Output: os/usr/share/icons/og-card.png.  Re-run after editing the copy.
//
//   node tools/gen-og-card.mjs

import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "../os/usr/share/icons/og-card.png");
const ORIG = "C:/Users/pavel/Desktop/hologram-os/os";

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1200" y2="630"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#2dd4bf"/></linearGradient>
    <radialGradient id="glow" cx="84%" cy="-8%" r="75%"><stop offset="0" stop-color="#8b5cf6" stop-opacity=".34"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow2" cx="6%" cy="112%" r="60%"><stop offset="0" stop-color="#2dd4bf" stop-opacity=".18"/><stop offset="1" stop-color="#2dd4bf" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#0b071e"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>
  <g transform="translate(92 86)" fill="none" stroke="url(#g)" stroke-width="9" stroke-linejoin="round" stroke-linecap="round">
    <path d="M52 4 L96 30 V74 L52 100 L8 74 V30 Z"/><path d="M8 30 L52 56 L96 30"/><path d="M52 56 V100"/>
  </g>
  <text x="226" y="158" fill="#ffffff" font-family="${FONT}" font-size="54" font-weight="700" letter-spacing="-1">Hologram OS</text>
  <text x="92" y="332" fill="#ffffff" font-family="${FONT}" font-size="94" font-weight="800" letter-spacing="-3">Create · Play · Share</text>
  <text x="94" y="416" fill="#c9c3ea" font-family="${FONT}" font-size="38" font-weight="500">Serverless apps you share with a link.</text>
  <text x="94" y="470" fill="#c9c3ea" font-family="${FONT}" font-size="38" font-weight="500">Opens instantly — no install, no sign-in.</text>
  <text x="94" y="566" fill="#857fa6" font-family="ui-monospace, SFMono-Regular, monospace" font-size="25">a sovereign internet computer · runs in your browser</text>
</svg>`;

const require = createRequire(pathToFileURL(join(ORIG, "package.json")));
const { chromium } = require("playwright");
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#0b071e">${svg}</body></html>`, { waitUntil: "load" });
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log("✓ wrote " + OUT + " (1200×630)");
} finally { await browser.close(); }
