// render/artifacts.js — ARTIFACTS: self-contained creations the model emits inside a message,
// rendered live in the side panel (the Claude-desktop signature feature). Wire format (the
// remark-directive container convention, LibreChat-compatible):
//
//   :::artifact{identifier="kebab-id" type="text/html" title="My page"}
//   ```html
//   …content…
//   ```
//   :::
//
// Types: text/html · image/svg+xml · text/markdown · application/vnd.mermaid · application/vnd.react.
// Re-emitting the same identifier is an UPDATE (a new version). Substrate twist: every version
// seals as its own κ-object — an artifact is a verifiable, shareable, teleportable creation.

export const ARTIFACT_TYPES = ["text/html", "image/svg+xml", "text/markdown", "text/md", "application/vnd.mermaid", "application/vnd.react"];

const BLOCK_RE = /:::artifact\{([^}]*)\}\s*\n([\s\S]*?)\n:::/g;
const ATTR_RE = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;

export function parseArtifacts(text) {
  const out = []; let m;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(text || ""))) {
    const attrs = {}; let a;
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(m[1]))) attrs[a[1]] = a[2];
    let content = m[2].trim();
    const fence = content.match(/^```[\w./+-]*\s*\n([\s\S]*?)\n```$/);
    if (fence) content = fence[1];
    out.push({
      identifier: attrs.identifier || "lc-no-identifier",
      type: attrs.type || "unknown",
      title: attrs.title || "untitled",
      content,
    });
  }
  return out;
}

// Replace artifact blocks in message text with a compact reference marker the renderer turns
// into an "open artifact" card (the panel owns the content).
export function stripArtifacts(text) {
  let i = 0;
  return (text || "").replace(BLOCK_RE, (mm) => {
    const arts = parseArtifacts(mm);
    const a = arts[0]; i++;
    return a ? `\n> ⧉ **${a.title}** · \`${a.type}\` — open in the Artifacts panel\n` : "";
  });
}

// The instruction block that arms the model to emit artifacts (appended to the system turn when
// artifacts are enabled). Written for small local models: explicit, short, format-exact.
export function artifactInstructions() {
  return [
    "# Artifacts",
    "When the user asks you to CREATE something self-contained (a web page, an SVG image, a diagram, a document), wrap it in an artifact block:",
    "",
    ':::artifact{identifier="kebab-case-id" type="text/html" title="Short title"}',
    "```html",
    "...the complete content...",
    "```",
    ":::",
    "",
    'Types: "text/html" (a complete page), "image/svg+xml" (an SVG), "application/vnd.mermaid" (a mermaid diagram), "text/markdown" (a document).',
    "Rules: always complete content (never placeholders); reuse the SAME identifier when updating a previous artifact; one artifact per block.",
  ].join("\n");
}

// Render one artifact version into a host element (preview tab). HTML/SVG render inside a
// sandboxed iframe (no scripts escape into the app); mermaid + markdown reuse the message
// pipeline; react sources show as highlighted code (no bundler on the substrate — honest).
export async function renderArtifact(host, art) {
  host.innerHTML = "";
  const type = art.type === "text/md" ? "text/markdown" : art.type;
  if (type === "text/html" || type === "image/svg+xml") {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts");        // scripts run INSIDE the sandbox only; no same-origin, no top access
    f.style.cssText = "width:100%;height:100%;border:0;background:#fff;border-radius:0 0 12px 12px";
    f.srcdoc = type === "image/svg+xml"
      ? `<!doctype html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#fff">${art.content}</body>`
      : art.content;
    host.appendChild(f);
    return;
  }
  if (type === "application/vnd.mermaid") {
    const { renderMarkdown } = await import("./markdown.js");
    const d = document.createElement("div"); d.style.cssText = "padding:14px;overflow:auto;height:100%";
    await renderMarkdown(d, "```mermaid\n" + art.content + "\n```");
    host.appendChild(d);
    return;
  }
  if (type === "text/markdown") {
    const { renderMarkdown } = await import("./markdown.js");
    const d = document.createElement("div"); d.style.cssText = "padding:14px;overflow:auto;height:100%";
    await renderMarkdown(d, art.content);
    host.appendChild(d);
    return;
  }
  // application/vnd.react and unknown types: code view only
  const { renderMarkdown } = await import("./markdown.js");
  const d = document.createElement("div"); d.style.cssText = "padding:14px;overflow:auto;height:100%";
  await renderMarkdown(d, "```jsx\n" + art.content + "\n```");
  host.appendChild(d);
}
