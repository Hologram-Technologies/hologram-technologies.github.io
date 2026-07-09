// core/skills.js — SELF-EVOLVING AGENT SKILLS, 100% agentskills.io-compatible, enhanced by the UOR
// substrate. A skill is a folder with SKILL.md (name + description frontmatter + instructions) —
// the open Anthropic/agentskills.io format, portable to any skills-compatible agent. The Hermes
// idea (the agent autonomously CREATES and IMPROVES skills from experience) is realized as the
// agent's own tools. The substrate enhancement: every skill version is content-addressed (κ) and
// chained — a tamper-proof PROVENANCE of how the skill evolved (Holo Prov). Skills live in OPFS
// "/skills/<name>/SKILL.md"; the chain log in "/skills/<name>/.prov" (one κ per version).
//
// Progressive disclosure (the spec): DISCOVERY (names+descriptions injected at session start) →
// ACTIVATION (read_skill loads full SKILL.md) → EXECUTION (the agent follows it, using file tools).

import { skillAsHowTo, verifySemantic } from "./semantic.js";

const te = new TextEncoder(), td = new TextDecoder();
const sha = async (s) => "did:holo:sha256:" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "skill";

async function skillsRoot() { const d = await navigator.storage.getDirectory(); const a = await d.getDirectoryHandle("skills", { create: true }); return a; }
async function skillDir(name, create = false) { return (await skillsRoot()).getDirectoryHandle(slug(name), { create }); }
async function readText(dir, file) { const fh = await dir.getFileHandle(file); return td.decode(await (await fh.getFile()).arrayBuffer()); }
async function writeText(dir, file, text) { const fh = await dir.getFileHandle(file, { create: true }); const w = await fh.createWritable(); await w.write(te.encode(text)); await w.close(); }

// SKILL.md = YAML-ish frontmatter (name, description) + markdown instructions (verbatim spec form).
function buildSkillMd({ name, description, instructions }) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions || ""}\n`;
}
function parseSkillMd(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  const meta = {}; if (m) for (const line of m[1].split("\n")) { const i = line.indexOf(":"); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  return { name: meta.name || "", description: meta.description || "", instructions: m ? m[2].trim() : text.trim() };
}

export async function listSkills() {
  const out = [];
  try { const root = await skillsRoot();
    for await (const [n, h] of root.entries()) { if (h.kind !== "directory") continue;
      try { const sk = parseSkillMd(await readText(h, "SKILL.md")); out.push({ slug: n, name: sk.name || n, description: sk.description }); } catch {} } }
  catch {}
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readSkill(name) { const dir = await skillDir(name); return parseSkillMd(await readText(dir, "SKILL.md")); }

// save = create OR improve (self-evolution). Appends a κ to the provenance chain — every version
// sealed + chained to its parent, so the skill's evolution is verifiable (Holo Prov shape).
export async function saveSkill({ name, description, instructions }) {
  const dir = await skillDir(name, true);
  const md = buildSkillMd({ name, description, instructions });
  const kappa = await sha(md);
  let prov = []; try { prov = JSON.parse(await readText(dir, ".prov")); } catch {}
  const parent = prov.length ? prov[prov.length - 1].kappa : null;
  prov.push({ v: prov.length + 1, kappa, parent, descKappa: await sha(description || "") });
  await writeText(dir, "SKILL.md", md);
  await writeText(dir, ".prov", JSON.stringify(prov, null, 1));
  // semantic skin (C2): emit the W3C linked-data view — schema:HowTo + PROV-O revision chain.
  const ld = skillAsHowTo({ name, description, instructions, kappa, prov });
  await writeText(dir, "skill.jsonld", JSON.stringify(ld, null, 1));
  return { slug: slug(name), kappa, version: prov.length, parent, semantic: verifySemantic(ld).ok };
}

// the W3C linked-data view of a skill (schema:HowTo + PROV-O), for export / validation / agents.
export async function skillLinkedData(name) { try { return JSON.parse(await readText(await skillDir(name), "skill.jsonld")); } catch { return null; } }

export async function skillProvenance(name) { try { return JSON.parse(await readText(await skillDir(name), ".prov")); } catch { return []; } }

// DISCOVERY block (progressive disclosure stage 1): names + descriptions only — small footprint.
export async function skillsDiscoveryPrompt() {
  const sk = await listSkills();
  if (!sk.length) return "";
  return "You have these learned SKILLS available (each a verifiable, content-addressed capability you built from experience). " +
    "When a task matches a skill's description, call read_skill to load its full instructions, then follow them. " +
    "When you complete a non-trivial task worth reusing, call save_skill to capture it (or improve an existing one):\n" +
    sk.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}

// the agent's skill tools (Hermes self-evolution: the agent creates/improves/uses skills itself)
export function skillTools() {
  return [
    {
      def: { name: "list_skills", description: "List the learned skills available (name + description).", inputSchema: { type: "object", properties: {}, required: [] } },
      serverName: "skills", call: async () => { const s = await listSkills(); return { text: s.length ? s.map((x) => `${x.name}: ${x.description}`).join("\n") : "(no skills yet)", isError: false }; },
    },
    {
      def: { name: "read_skill", description: "Load a skill's full instructions by name, to follow them for the current task.", inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
      serverName: "skills", call: async ({ name }) => { try { const s = await readSkill(name); return { text: `# ${s.name}\n${s.description}\n\n${s.instructions}`, isError: false }; } catch (e) { return { text: "no such skill: " + name, isError: true }; } },
    },
    {
      def: { name: "save_skill", description: "Capture a reusable skill from what you just did (or improve an existing one). name: short; description: one line of WHEN to use it; instructions: the step-by-step procedure. Each save is sealed + chained (verifiable provenance).", inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, instructions: { type: "string" } }, required: ["name", "description", "instructions"] } },
      serverName: "skills", call: async ({ name, description, instructions }) => { try { const r = await saveSkill({ name, description, instructions }); return { text: `skill "${name}" saved (v${r.version}, ${r.kappa.slice(0, 28)}…${r.parent ? `, evolved from ${r.parent.slice(0, 20)}…` : ", first version"})`, isError: false }; } catch (e) { return { text: "save error: " + (e.message || e), isError: true }; } },
    },
  ];
}
