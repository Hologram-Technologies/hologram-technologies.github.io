// holo-dat.mjs — the hash-identity resolver: a ROM's hash IS its identity.
//
// The retro-preservation world already content-addresses games: No-Intro (cartridge) and
// Redump (disc) publish logiqx DAT files mapping a ROM's SHA-1 → canonical
// {title, system, region, revision}. A ROM's hash is also its κ. So this one module turns
// "any ROM you're entitled to" into a standardized, deduped identity with zero manual
// tagging — the spine of Holo Games' auto-library. Identity is *data about* a game; it
// never requires or distributes the game.
//
// Works in node (node:crypto) and the browser (crypto.subtle) — same hashes either way.

export async function sha1Hex(bytes) {
  if (globalThis.crypto && globalThis.crypto.subtle) {
    const b = await crypto.subtle.digest("SHA-1", bytes);
    const v = new Uint8Array(b); let h = ""; for (let i = 0; i < v.length; i++) h += v[i].toString(16).padStart(2, "0"); return h;
  }
  const { createHash } = await import("node:crypto");
  return createHash("sha1").update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest("hex");
}

// Parse a No-Intro-style game name → standardized fields.
//   "Super Mario World (USA) (Rev 1)" → { title:"Super Mario World", region:"USA", rev:"1", flags:[] }
const REGIONS = ["USA", "Europe", "Japan", "World", "Asia", "Australia", "Germany", "France", "Spain", "Italy", "Korea", "Brazil", "Netherlands", "Sweden", "China", "Canada", "UK"];
export function parseName(name) {
  const parens = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
  const title = name.replace(/\s*\([^)]*\)/g, "").trim();
  let region = null, rev = null; const flags = [];
  for (const p of parens) {
    const parts = p.split(",").map((s) => s.trim());
    for (const part of parts) {
      if (REGIONS.includes(part)) region = region ? region + "," + part : part;
      else if (/^Rev\s*([0-9A-Za-z.]+)$/i.test(part)) rev = part.replace(/^Rev\s*/i, "");
      else flags.push(part);
    }
  }
  return { title, region, rev, flags };
}

export class DatIndex {
  constructor() {
    this.bySha1 = new Map();   // sha1(hex,lower) -> { title, system, region, rev, flags, romName, size, gameName }
    this.systems = new Set();
    this.stats = { dats: 0, games: 0, roms: 0 };
  }

  // Ingest a logiqx/No-Intro DAT (XML string). System name comes from <header><name>.
  // Lightweight regex parse (DATs are regular) — no XML dependency.
  addDat(xml) {
    // a file may concatenate several <datafile> sections (one per system); handle each
    const blocks = xml.match(/<datafile\b[\s\S]*?<\/datafile>/g) || [xml];
    for (const block of blocks) {
      this.stats.dats++;
      const sysM = /<header>[\s\S]*?<name>([^<]*)<\/name>/.exec(block);
      const system = sysM ? sysM[1].trim() : "Unknown";
      this.systems.add(system);
      const gameRe = /<game\b[^>]*\bname="([^"]*)"[^>]*>([\s\S]*?)<\/game>/g;
      let g;
      while ((g = gameRe.exec(block))) {
        const gameName = decodeEntities(g[1]);
        const parsed = parseName(gameName);
        this.stats.games++;
        const romRe = /<rom\b[^>]*>/g; let r;
        while ((r = romRe.exec(g[2]))) {
          const tag = r[0];
          const sha1 = attr(tag, "sha1"); if (!sha1) continue;
          this.stats.roms++;
          this.bySha1.set(sha1.toLowerCase(), { ...parsed, system, gameName, romName: decodeEntities(attr(tag, "name") || ""), size: +(attr(tag, "size") || 0) });
        }
      }
    }
    return this;
  }

  identify(sha1hex) { return this.bySha1.get((sha1hex || "").toLowerCase()) || null; }
  async identifyBytes(bytes) { return this.identify(await sha1Hex(bytes)); }
}

function attr(tag, name) { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? m[1] : null; }
function decodeEntities(s) { return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"); }

// libretro-thumbnails URL for a game's box art, keyed by the No-Intro identity.
// System dir = No-Intro name with spaces→"_"; filename = game name with the forbidden
// set [&*/:`<>?\|] → "_", then URL-encoded (encodeURIComponent leaves ()! unescaped, which
// matches the repo's paths). type: "Named_Boxarts" | "Named_Titles" | "Named_Snaps".
export function thumbUrl(noIntroSystem, gameName, type = "Named_Boxarts") {
  if (!noIntroSystem || !gameName) return null;
  const dir = noIntroSystem.replace(/ /g, "_");
  const file = encodeURIComponent(gameName.replace(/[&*/:`<>?\|]/g, "_")) + ".png";
  return `https://raw.githubusercontent.com/libretro-thumbnails/${dir}/master/${type}/${file}`;
}
