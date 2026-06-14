// holo-mcp-jupyter-test.mjs — drive holo_jupyter_run over REAL MCP, exactly as an agent host would:
// spawn the launcher as a stdio MCP server, initialize, tools/list, tools/call. Verifies the wiring.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));                       // system/tools
const launcher = join(here, "..", "os", "usr", "lib", "holo", "mcp", "holo-mcp-launch.mjs");
const APPS = "C:/Users/pavel/Desktop/Hologram Apps/apps";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [launcher],
  env: { ...process.env, HOLO_APPS_DIR: APPS },
  stderr: "inherit",
});
const client = new Client({ name: "holo-agent-test", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);
console.log("connected to hologram-mcp (stdio)");

const tools = await client.listTools();
const hj = tools.tools.find((t) => t.name === "holo_jupyter_run");
console.log("tools/list count:", tools.tools.length, "| holo_jupyter_run listed:", !!hj);
if (hj) console.log("  description:", (hj.description || "").slice(0, 90) + "…");

const ms = () => Number(process.hrtime.bigint() / 1000000n);
let t = ms();
const r1 = await client.callTool({ name: "holo_jupyter_run", arguments: {
  code: "import numpy as np\ndata = np.arange(50)\nprint('agent defined data, sum =', int(data.sum()))\nresult = int(data.sum())",
} }, undefined, { timeout: 180000 });
console.log(`\ncall 1 (boots warm kernel): ${ms() - t} ms`);
console.log("  ", (r1.content?.[0]?.text || "").slice(0, 500));

t = ms();
const r2 = await client.callTool({ name: "holo_jupyter_run", arguments: {
  code: "print('data persists across MCP calls; mean =', float(data.mean()))\nresult = float(data.mean())",
} }, undefined, { timeout: 180000 });
console.log(`\ncall 2 (warm + stateful): ${ms() - t} ms`);
console.log("  ", (r2.content?.[0]?.text || "").slice(0, 500));

// call 3 — launch an AUTONOMOUS study in ONE MCP call (reuses the warm session)
t = ms();
const r3 = await client.callTool({ name: "holo_research_run", arguments: {
  goal: "Estimate pi by Monte-Carlo, sampling adaptively until stderr < 0.0012",
  init: "import numpy as np, math, json\nrng = np.random.default_rng(0)\nhits = 0\ntotal = 0",
  step: "m = 250000\np = rng.random((m,2))\nhits += int((p[:,0]**2 + p[:,1]**2 <= 1.0).sum())\ntotal += m\nphat = hits/total\nest = 4.0*phat\nstderr = 4.0*math.sqrt(phat*(1-phat)/total)\nresult = json.dumps({'n': total, 'est': est, 'stderr': stderr})",
  metric: "stderr", comparator: "<", threshold: 0.0012, maxSteps: 20,
} }, undefined, { timeout: 180000 });
const study = JSON.parse(r3.content?.[0]?.text || "{}");
console.log(`\ncall 3 holo_research_run (autonomous study): ${ms() - t} ms`);
console.log("  steps:", (study.steps || []).length, "| stop:", study.stopReason);
console.log("  conclusion:", JSON.stringify(study.conclusion));
console.log("  sealed report κ:", study.reportKappa);

await client.close();
console.log("\nclosed.");
