// core/code-tools.js — NATIVE agentic-coding tools for Holo Q's Code mode. Self-contained over the
// browser's OPFS (navigator.storage.getDirectory) — no external VFS, works in any browser, 100%
// serverless. Each tool returns Holo Q's agent-tool shape { def, serverName:"code", call }, so the
// Coder-7B brain drives real file work through the existing agentic loop + conscience gate + receipts.
// The workspace is an OPFS "workspace" dir = the agent's writable home; every result is content-addressable.
//
// C2 semantic skin (extended to all κ-objects): build_app emits a schema:SoftwareApplication node and
// verify_object returns the file's schema.org @type — so every object the agent makes is W3C-legible.

import { appAsSoftware, fileAsDocument } from "./semantic.js";

const te = new TextEncoder(), td = new TextDecoder();
const sha256Hex = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const norm = (p) => ("/" + String(p || "").replace(/^\/+/, "").replace(/\/+/g, "/")).replace(/\/$/, "") || "/";

async function root() { const d = await navigator.storage.getDirectory(); return d.getDirectoryHandle("workspace", { create: true }); }
async function dirOf(parts, create = false) {
  let h = await root();
  for (const p of parts) if (p) h = await h.getDirectoryHandle(p, { create });
  return h;
}
function split(path) { const parts = norm(path).split("/").filter(Boolean); const name = parts.pop(); return { parts, name }; }

async function readFile(path) {
  const { parts, name } = split(path);
  const dir = await dirOf(parts);
  const fh = await dir.getFileHandle(name);
  const f = await fh.getFile();
  return new Uint8Array(await f.arrayBuffer());
}
async function writeFile(path, content) {
  const { parts, name } = split(path);
  const dir = await dirOf(parts, true);
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable(); await w.write(te.encode(String(content ?? ""))); await w.close();
}
async function walk(dirHandle, prefix, out) {
  for await (const [n, h] of dirHandle.entries()) {
    const p = prefix + "/" + n;
    if (h.kind === "file") out.push(p);
    else await walk(h, p, out);
  }
}
async function listAll() { const out = []; await walk(await root(), "", out); return out.sort(); }

function globToRe(glob) {
  let re = "^";
  for (let i = 0; i < glob.length; i++) { const c = glob[i];
    if (c === "*") { if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; } else re += "[^/]*"; }
    else if (c === "?") re += "[^/]"; else if ("\\^$.|+()[]{}".includes(c)) re += "\\" + c; else re += c; }
  return new RegExp(re + "$");
}

export function codeTools() {
  return [
    {
      def: { name: "read_file", description: "Read a text file from the workspace. Returns its content.", inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
      serverName: "code", call: async ({ path }) => {
        try { const bytes = await readFile(path); return { text: td.decode(bytes), isError: false }; }
        catch (e) { return { text: "read error: " + (e.message || e), isError: true }; }
      },
    },
    {
      def: { name: "write_file", description: "Create or overwrite a file in the workspace with the given content.", inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
      serverName: "code", call: async ({ path, content }) => {
        try { await writeFile(path, content); const k = await sha256Hex(te.encode(String(content ?? ""))); return { text: `wrote ${norm(path)} (${String(content ?? "").length} bytes) · did:holo:sha256:${k.slice(0, 16)}`, isError: false }; }
        catch (e) { return { text: "write error: " + (e.message || e), isError: true }; }
      },
    },
    {
      def: { name: "edit_file", description: "Replace the first exact occurrence of old_text with new_text in a file.", inputSchema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" } }, required: ["path", "old_text", "new_text"] } },
      serverName: "code", call: async ({ path, old_text, new_text }) => {
        try { const cur = td.decode(await readFile(path)); if (!cur.includes(old_text)) return { text: "edit error: old_text not found", isError: true };
          const next = cur.replace(old_text, new_text); await writeFile(path, next); return { text: `edited ${norm(path)} (${cur.length}→${next.length} bytes)`, isError: false }; }
        catch (e) { return { text: "edit error: " + (e.message || e), isError: true }; }
      },
    },
    {
      def: { name: "list_files", description: "List all files in the workspace, optionally filtered by a glob (e.g. **/*.py).", inputSchema: { type: "object", properties: { glob: { type: "string" } }, required: [] } },
      serverName: "code", call: async ({ glob }) => {
        try { let files = await listAll(); if (glob) { const re = globToRe(glob); files = files.filter((f) => re.test(f)); }
          return { text: files.length ? files.join("\n") : "(workspace empty)", isError: false }; }
        catch (e) { return { text: "list error: " + (e.message || e), isError: true }; }
      },
    },
    {
      def: { name: "grep", description: "Search file contents for a regular expression. Returns matching path:line: text.", inputSchema: { type: "object", properties: { pattern: { type: "string" }, glob: { type: "string" } }, required: ["pattern"] } },
      serverName: "code", call: async ({ pattern, glob }) => {
        try { const re = new RegExp(pattern); let files = await listAll(); if (glob) { const g = globToRe(glob); files = files.filter((f) => g.test(f)); }
          const hits = [];
          for (const f of files) { let text; try { text = td.decode(await readFile(f)); } catch { continue; }
            text.split("\n").forEach((ln, i) => { if (re.test(ln) && hits.length < 100) hits.push(`${f}:${i + 1}: ${ln.trim().slice(0, 160)}`); }); }
          return { text: hits.length ? hits.join("\n") : "(no matches)", isError: false }; }
        catch (e) { return { text: "grep error: " + (e.message || e), isError: true }; }
      },
    },
    // ── κ-NATIVE: build a RENDERABLE app object, sealed (the neural-computer flagship: an agent
    // produces a real app, content-addressed, that renders + re-derives — serverless, verifiable) ──
    {
      def: { name: "build_app", description: "Build a complete self-contained HTML app (one file, inline CSS/JS) and seal it as a content-addressed object. Returns its did:holo κ; the app renders live in the preview pane. Use for 'build me an app/page/tool' requests.", inputSchema: { type: "object", properties: { name: { type: "string" }, html: { type: "string" } }, required: ["name", "html"] } },
      serverName: "code", call: async ({ name, html }) => {
        try {
          const path = (name.endsWith(".html") ? name : name + ".html");
          await writeFile(path, html);
          const bytes = te.encode(String(html));
          const kappa = "did:holo:sha256:" + await sha256Hex(bytes);
          // semantic skin: the app object carries a W3C @type (schema:SoftwareApplication + prov:Entity),
          // written as a sidecar .jsonld so the object is self-describing to any agent / RDF tool.
          const ld = appAsSoftware({ name: path, kappa, bytes: bytes.length });
          await writeFile(path.replace(/\.html$/i, "") + ".app.jsonld", JSON.stringify(ld, null, 1));
          return { text: `built app "${path}" (${html.length} bytes), sealed ${kappa.slice(0, 30)}… · typed ${ld["@type"].join("+")} — renders in the preview, re-derivable (Law L5).`, isError: false, render: { kind: "app", path: norm(path), kappa, html: String(html), ld } };
        } catch (e) { return { text: "build_app error: " + (e.message || e), isError: true }; }
      },
    },
    {
      def: { name: "verify_object", description: "Re-derive a workspace file's content address and confirm it matches (Law L5 — verify every byte). Returns whether the bytes are authentic.", inputSchema: { type: "object", properties: { path: { type: "string" }, kappa: { type: "string" } }, required: ["path"] } },
      serverName: "code", call: async ({ path, kappa }) => {
        try {
          const bytes = await readFile(path);
          const got = "did:holo:sha256:" + await sha256Hex(bytes);
          const ok = !kappa || got === kappa || got.startsWith(kappa) || kappa.startsWith(got.slice(0, kappa.length));
          // verify = re-derive κ (Law L5) AND emit the W3C @type — apps are SoftwareApplication, all else DigitalDocument.
          const ld = /\.html$/i.test(path) ? appAsSoftware({ name: norm(path), kappa: got, bytes: bytes.length })
                                           : fileAsDocument({ path: norm(path), kappa: got, bytes: bytes.length });
          return { text: `${norm(path)} re-derives to ${got.slice(0, 34)}…${kappa ? (ok ? " ✓ matches (authentic)" : " ✗ MISMATCH") : ""} · @type ${ld["@type"].join("+")}`, isError: false, render: { kind: "linked-data", ld } };
        } catch (e) { return { text: "verify error: " + (e.message || e), isError: true }; }
      },
    },
  ];
}
