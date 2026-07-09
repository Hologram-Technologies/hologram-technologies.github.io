// holo-portal-pack.mjs — the SINGLE-FILE portal. Take the CANONICAL shell (portal.html — splash · OG · styles,
// authored ONCE) and swap its served boot (fetch-by-κ + Service Worker) for an inline boot that carries the whole
// closure (members base64) + BLAKE3 in the file itself and blob-mounts it — no server, no /_shared, no κ-route,
// no SW. It re-derives every member on load (L5) before it mounts; tamper anywhere → refused. The result is ONE
// static, self-verifying .html you can host on any dumb host (S3 · IPFS CID · a gist · file://). Presentation is
// NOT duplicated: it comes verbatim from portal.html, so the portal looks identical served or packed. ──────────

const b64 = (u8) => { let s = ""; const a = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };

// packSingleFile(sealed, { blake3Source, shellHtml }) → a complete self-verifying HTML document (string). `sealed`
// is a holo-portal closure with .blobs (hex→bytes), .members (path→κ), .manifest["holo:entry"]. `blake3Source` is
// the text of holo-blake3.mjs (inlined so the file self-verifies offline). `shellHtml` is the portal.html source
// (its <script type="module"> boot is replaced; everything else — splash, OG meta, styles — is kept verbatim).
export function packSingleFile(sealed, { blake3Source, shellHtml } = {}) {
  if (!sealed || !sealed.blobs || !sealed.members || !sealed.manifest) throw new Error("packSingleFile needs a sealed closure { blobs, members, manifest }");
  if (!blake3Source || !/blake3hex/.test(blake3Source)) throw new Error("packSingleFile needs the holo-blake3 source (defines blake3hex) to inline");
  if (!shellHtml || !/<script\s+type="module">/.test(shellHtml)) throw new Error("packSingleFile needs the portal.html shell (its module boot script is swapped for the inline-verify boot)");
  const entry = sealed.manifest["holo:entry"];
  const files = {};                                    // path → { hex, b64 } — the whole closure, inline
  for (const p of Object.keys(sealed.members)) {
    const hex = String(sealed.members[p]).split(":").pop();
    const bytes = sealed.blobs[hex];
    if (!bytes) throw new Error("packSingleFile: missing bytes for member " + p);
    files[p] = { hex, b64: b64(bytes) };
  }
  // strip ES `export ` so BLAKE3 inlines into a CLASSIC <script> — lets the file run from file:// (Chrome blocks
  // module scripts on file://). BLAKE3 has no imports, so this is complete + self-contained.
  const b3 = String(blake3Source).replace(/^export\s+/gm, "");
  const boot = BOOT(JSON.stringify({ entry, files }), b3);
  // ONE shell: swap ONLY portal.html's served boot for the inline boot; splash/OG/styles are kept verbatim.
  let html = shellHtml.replace(/<script\s+type="module">[\s\S]*?<\/script>/, boot);
  // bake the experience's own NAME into the preview so an unfurled link shows "Ava's Whiteboard", not a generic title
  return withName(html, sealed.manifest["schema:name"]);
}

// withName(html, name) → the preview title becomes the experience's own name; the plain-English why/how/what stays.
export function withName(html, name) {
  const n = String(name || "").trim();
  if (!n) return html;
  const esc = n.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return html
    .replace(/(<title>)[^<]*(<\/title>)/i, `$1${esc}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(">)/i, `$1${esc}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(">)/i, `$1${esc}$2`);
}

// the inline boot — reuses portal.html's own elements (#stage · #app · #splash · #stitle · #realm), so the single
// file behaves + looks identical to the served loader. Classic <script> (file:// friendly), no external deps.
function BOOT(closureJson, blake3Source) {
  return `<script>
${blake3Source}
(function(){
  const el = (id) => document.getElementById(id);
  const CLOSURE = ${closureJson};
  const dec = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return u; };
  const ct = (p) => ({html:"text/html",css:"text/css",js:"text/javascript",mjs:"text/javascript",svg:"image/svg+xml",json:"application/json",png:"image/png",webp:"image/webp",wasm:"application/wasm"})[(p.split(".").pop()||"").toLowerCase()] || "application/octet-stream";
  const setRealm = (r) => { const e = el("realm"); if (e) e.textContent = r; };
  const done = () => { window.__portal = { ok:true, entry:CLOSURE.entry, members:Object.keys(CLOSURE.files).length }; setRealm("this file"); const st=el("stage"); if(st) st.classList.add("on"); const sp=el("splash"); if(sp) sp.classList.add("gone"); };
  const fail = (m) => { window.__portal = { ok:false, why:m }; const sp=el("splash"); if(sp) sp.classList.add("err"); const t=el("stitle"); if(t) t.textContent="This portal couldn't be verified"; };
  (async () => {
    try {
      setRealm("verifying");
      const bytes = {};   // L5: re-derive EVERY inlined member before anything runs; refuse on any mismatch
      for (const p of Object.keys(CLOSURE.files)) { const f = CLOSURE.files[p]; const b = dec(f.b64); if (blake3hex(b) !== f.hex) return fail("member '"+p+"' failed verification"); bytes[p] = b; }
      const url = {};     // mount with NO server/SW: blob-URL each member, rewrite the entry's relative refs, blob-navigate the iframe
      for (const p of Object.keys(bytes)) url[p] = URL.createObjectURL(new Blob([bytes[p]], { type: ct(p) }));
      let html = new TextDecoder().decode(bytes[CLOSURE.entry]);
      for (const p of Object.keys(url)) { if (p === CLOSURE.entry) continue; html = html.split('"'+p+'"').join('"'+url[p]+'"').split("'"+p+"'").join("'"+url[p]+"'").split("./"+p).join(url[p]); }
      const app = el("app");
      await new Promise((res) => { app.onload = res; app.src = URL.createObjectURL(new Blob([html], { type: "text/html" })); });
      done();
    } catch (e) { fail((e && e.message) || "boot failed"); }
  })();
})();
</script>`;
}

export function describePack() { return { is: "the single-file portal — portal.html's canonical shell with its served boot swapped for an inline verify+mount of the whole closure; ONE self-verifying .html, host it anywhere, no server" }; }
export default { packSingleFile, describePack };
