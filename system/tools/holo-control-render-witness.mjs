#!/usr/bin/env node
// holo-control-render-witness.mjs — proves Holo Control (the telemetry monitoring & control command
// center, ADR-0073 consumer) actually RENDERS and FUNCTIONS in a real browser: it boots, binds the
// Holo UI theme tokens, loads the signal-processing core, populates REAL edges from the live app
// catalog, ranks them by salience, switches lenses, opens the edge inspector, and runs a control
// action that updates the edge state AND produces a verifiable receipt. Honest where a feed is
// unwired (wallet/social show "no signal", not a fake).
//
//   node tools/holo-control-render-witness.mjs        (needs the FHS serve on :8300)
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const ORIG = "C:/Users/pavel/Desktop/hologram-os";
const { chromium } = createRequire(pathToFileURL(join(ORIG, "package.json")))("playwright");
const BASE = "http://127.0.0.1:8300";
const results = [];
const ok = (name, pass, detail = "") => { results.push({ name, ok: !!pass, detail }); console.log(`  ${pass ? "✓" : "✗"}  ${name}${detail ? " — " + detail : ""}`); };

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/apps/control/index.html`, { waitUntil: "load" });

  // ── 1 · the app boots: the command center mounts, no page errors ──
  await page.waitForSelector("#top .brand", { timeout: 6000 });
  const brand = await page.$eval("#top .brand", (e) => e.textContent.trim());
  ok("boots — the command center mounts", /Holo Control/.test(brand), brand);
  ok("no uncaught page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

  // ── 2 · Holo UI theme tokens are bound (it loaded holo-theme.js/.css) ──
  const tk = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement); return { bg: cs.getPropertyValue("--holo-bg").trim(), ink: cs.getPropertyValue("--holo-ink").trim(), accent: cs.getPropertyValue("--holo-accent").trim() }; });
  ok("Holo UI tokens bound (--holo-bg/-ink/-accent)", tk.bg && tk.ink && tk.accent, `bg=${tk.bg} accent=${tk.accent}`);

  // ── 3 · the signal-processing core loaded + computes ──
  const dsp = await page.evaluate(() => { const D = window.HoloControl && window.HoloControl.DSP; if (!D) return null; return { v: D.DSP_VERSION, z: D.zScore(40, [10, 10, 11, 9, 10, 10]) > 5, snr: D.aggregateSnr([{ salience: 1 }, { salience: 0 }]).ratio }; });
  ok("DSP core loaded and computes", dsp && dsp.z === true && Math.abs(dsp.snr - 0.5) < 1e-9, dsp ? `v${dsp.v}` : "absent");

  // ── 4 · REAL edges populate from the live app catalog (not mocked) ──
  await page.waitForFunction(() => window.HoloControl && [...window.HoloControl.edges.values()].some((e) => e.kind === "app"), { timeout: 6000 }).catch(() => {});
  const counts = await page.evaluate(() => { const es = [...window.HoloControl.edges.values()]; const by = {}; for (const e of es) by[e.kind] = (by[e.kind] || 0) + 1; return { total: es.length, app: by.app || 0, ingress: by.ingress || 0 }; });
  ok("real edges populate from the app catalog", counts.app >= 5, `${counts.app} app edges, ${counts.total} total`);
  ok("real network ingress edges appear (Performance API)", counts.ingress >= 1, `${counts.ingress} ingress`);

  // ── 5 · live vitals render: the SNR hero gauge + big stat tiles ──
  const top = await page.evaluate(() => ({ snr: document.querySelector("#snrNum")?.textContent || "", arc: document.querySelector("#snrArc")?.getAttribute("stroke-dasharray") || "", stats: [...document.querySelectorAll("#stats .stat .l")].map((e) => e.textContent) }));
  ok("SNR hero + stat tiles render", /%$/.test(top.snr) && top.stats.length >= 3 && top.stats.some((s) => /EDGES/i.test(s)), `snr=${top.snr} stats=${top.stats.join(",")}`);

  // ── 6 · lens switch → Apps & Agents shows ranked edge cards ──
  await page.evaluate(() => window.HoloControl.setLens("apps"));
  await page.waitForSelector("#view .card", { timeout: 4000 });
  const cards = await page.$$eval("#view .card .name", (els) => els.map((e) => e.textContent));
  ok("Apps & Agents lens renders ranked edge cards", cards.length >= 5, `${cards.length} cards`);

  // ── 7 · the edge inspector opens with the control plane ──
  await page.click("#view .card:first-of-type");
  await page.waitForSelector("#inspector.open", { timeout: 3000 });
  const ctlCount = await page.$$eval("#inspector .controls .ctl", (els) => els.length);
  ok("inspector opens with throttle/restrict/pause/cut controls", ctlCount === 4, `${ctlCount} controls`);

  // ── 8 · a control action updates the edge state AND seals a verifiable receipt ──
  const throttleBtn = await page.$("#inspector .controls .ctl:first-of-type");
  await throttleBtn.click();
  await page.waitForTimeout(300);
  const ctlState = await page.evaluate(() => { const es = [...window.HoloControl.edges.values()]; const t = es.find((e) => e.control !== "open"); return t ? { control: t.control, receipts: t.receipts.length, kappa: t.receipts[0] && t.receipts[0].kappa } : null; });
  ok("a control action changes the edge state", ctlState && ctlState.control === "throttled", ctlState ? ctlState.control : "none");
  ok("the control action seals a verifiable receipt (κ)", ctlState && ctlState.receipts >= 1 && /^did:holo:sha256:/.test(ctlState.kappa || ""), ctlState ? (ctlState.kappa || "").slice(0, 24) + "…" : "none");

  // ── 8b · the FULL telemetry surface is wired: a runtime is live, real signals stream, verify re-derives ──
  const telWired = await page.evaluate(() => window.HoloControl.telemetryWired());
  ok("a Holo Telemetry runtime is live (own or system)", telWired === true, telWired ? "wired" : "absent");
  await page.evaluate(() => window.HoloControl.setLens("telemetry"));
  await page.waitForFunction(() => window.HoloControl.stream.length >= 1, { timeout: 4000 }).catch(() => {});
  const sig = await page.evaluate(() => { const s = window.HoloControl.stream; return { n: s.length, kinds: [...new Set(s.map((x) => x.kind))], hasK: s.every((x) => /^did:holo:sha256:/.test(x.kappa)) }; });
  ok("real telemetry signals stream (spans/metrics/logs as κ-objects)", sig.n >= 2 && sig.hasK, `${sig.n} signals · ${sig.kinds.join("/")}`);
  await page.waitForSelector("#view .sig .verify", { timeout: 3000 });
  await page.click("#view .sig:first-of-type .verify");
  await page.waitForFunction(() => { const b = document.querySelector("#view .sig:first-of-type .verify"); return b && (b.classList.contains("ok") || b.classList.contains("bad")); }, { timeout: 4000 });
  const verified = await page.$eval("#view .sig:first-of-type .verify", (b) => b.classList.contains("ok"));
  ok("a streamed signal VERIFIES live — re-derives (Law L5)", verified === true);
  const tp = await page.$eval("#telTp", (e) => e.textContent);
  ok("W3C traceparent / runtime status shown in the header", tp && tp !== "offline", tp);

  // ── 8d · inject⇄extract round-trips a W3C traceparent (propagation), all-zero refused ──
  const rt = await page.evaluate(() => { const c = window.HoloControl, ctx = { traceId: "a".repeat(32), spanId: "b".repeat(16) }; const ex = c.extract(c.inject(ctx)); const bad = c.extract("00-" + "0".repeat(32) + "-" + "0".repeat(16) + "-01"); return { ok: ex.valid && ex.traceId === ctx.traceId && ex.spanId === ctx.spanId, bad: bad.valid }; });
  ok("inject⇄extract round-trips W3C Trace Context", rt.ok === true && rt.bad === false);

  // ── 8e · seal the whole trace → one PROV-O trace κ that verifies the DAG (tracer.seal + Trace verify) ──
  await page.evaluate(() => window.HoloControl.sealTrace());
  await page.waitForFunction(() => window.HoloControl.stream.some((s) => s.kind === "trace"), { timeout: 3000 });
  const traceK = await page.evaluate(() => window.HoloControl.stream.find((s) => s.kind === "trace").kappa);
  const traceOk = await page.evaluate(async (k) => (await window.HoloControl.verify(k)).ok, traceK);
  ok("seal trace → one PROV-O trace κ; verify re-derives the DAG", /^did:holo:sha256:/.test(traceK) && traceOk === true, traceK.slice(0, 22) + "…");

  // ── 8f · adopt an external traceparent → a correlated child span (extract → child) ──
  const adopted = await page.evaluate(async () => { const c = window.HoloControl, ext = "00-" + "c".repeat(32) + "-" + "d".repeat(16) + "-01"; await c.adoptContext(ext); const s = c.stream.find((x) => /adopted\.context/.test(x.name)); return !!s; });
  ok("adopt context → correlated child span under the external trace", adopted === true);

  // ── 8g · toOtlp() emits a genuine OpenTelemetry envelope; verifyAttestation runs on a measurement ──
  const interop = await page.evaluate(() => { const c = window.HoloControl, spans = c.stream.filter((s) => s.kind === "span" && s.object).map((s) => s.object); const otlp = c.toOtlp(spans); const m = c.stream.find((s) => s.measurement); const att = m ? c.verifyAttestation(m.measurement) : null; return { otlp: !!(otlp && otlp.resourceSpans && otlp.resourceSpans[0].scopeSpans[0].spans.length), att: att && typeof att.ok === "boolean" }; });
  ok("toOtlp() emits OpenTelemetry OTLP + verifyAttestation() runs", interop.otlp && interop.att === true);

  // ── 9 · honesty: an unwired feed (wallet) shows "no signal", not a fake ──
  await page.evaluate(() => window.HoloControl.setLens("wallet"));
  await page.waitForSelector("#view .empty", { timeout: 3000 });
  const walletMsg = await page.$eval("#view .empty", (e) => e.textContent);
  ok("unwired feed shows honest 'no signal' (no fabricated balance)", /no wallet|no signal|connect/i.test(walletMsg), walletMsg.slice(0, 40) + "…");

  // ── 10 · the birds-eye renders the radial edge graph ──
  await page.evaluate(() => window.HoloControl.setLens("orbit"));
  await page.waitForTimeout(400);
  const orbit = await page.evaluate(() => { const s = document.querySelector("#view svg#orbit"); return s ? { lines: s.querySelectorAll("line").length, nodes: s.querySelectorAll("circle").length } : null; });
  ok("birds-eye renders the radial edge graph", orbit && orbit.lines >= 5 && orbit.nodes >= 5, orbit ? `${orbit.lines} edges, ${orbit.nodes} nodes` : "none");

  await page.screenshot({ path: join(ORIG, "..", "Hologram OS2", "system", "tools", "holo-control-render-witness.png"), fullPage: false }).catch(() => {});
} finally {
  await browser.close();
}

const witnessed = results.every((r) => r.ok);
writeFileSync(new URL("./holo-control-render-witness.result.json", import.meta.url),
  JSON.stringify({ "@type": "earl:TestResult", spec: "Holo Control renders + functions in a real browser: boots, binds Holo UI tokens, loads the DSP core, populates real edges from the live catalog, ranks/switches/inspects, runs a conscience-gated control action that seals a receipt, and is honest where a feed is unwired", witnessed, results }, null, 2) + "\n");
console.log(`\n${witnessed ? "PASS" : "FAIL"} — Holo Control render witness (${results.filter((r) => r.ok).length}/${results.length})`);
process.exit(witnessed ? 0 : 1);
