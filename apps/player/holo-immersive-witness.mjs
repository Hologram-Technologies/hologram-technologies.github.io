#!/usr/bin/env node
// holo-immersive-witness.mjs — proves the P3 immersive layer: Skip-Intro chapters (κ-bound), autoplay
// Up-Next (binge ordering + countdown), and κ-addressed subtitles (SRT→VTT, verifiable).
//
// Checks:
//   1 skipWindow      — activeSkip shows "Skip Intro" inside the intro window, nothing outside it.
//   2 chaptersKappa   — chapters seal to a κ and re-derive (tamper flips the id).
//   3 nextEpisode     — up-next steps to the next episode, crosses a season boundary, ends at null.
//   4 promptNext      — the Up-Next card fires within the lead window, not early; countdown counts down.
//   5 srtToVtt        — an SRT parses to cues and renders canonical WebVTT (header + dotted timestamps).
//   6 subtitleKappa   — a track seals to a κ and re-derives; a tampered VTT is refused.
//
// node holo-immersive-witness.mjs   (from holo-apps/apps/player/)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sealChapters, verifyChapters, activeSkip } from "./holo-chapters.mjs";
import { nextEpisode, shouldPromptNext, countdown } from "./holo-upnext.mjs";
import { parseSRT, toVTT, sealTrack, verifyTrack } from "./holo-subtitles.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };

const chapters = [{ kind: "intro", start: 8, end: 38 }, { kind: "credits", start: 1400, end: 1440 }];
// 1
{
  const inIntro = activeSkip(20, chapters), outside = activeSkip(300, chapters), inCredits = activeSkip(1410, chapters);
  ok("skipWindow", inIntro && inIntro.label === "Skip Intro" && inIntro.target === 38 && outside === null && inCredits && inCredits.label === "Skip Credits", JSON.stringify({ inIntro, outside, inCredits }));
}
// 2
{
  const sealed = await sealChapters("sha256:title", chapters);
  const good = await verifyChapters(sealed);
  const tampered = { ...sealed, chapters: [{ kind: "intro", start: 0, end: 999 }] };
  ok("chaptersKappa", sealed.id.startsWith("sha256:") && good === true && (await verifyChapters(tampered)) === false, JSON.stringify({ id: sealed.id.slice(0, 16) }));
}
// 3
{
  const eps = [
    { id: "s1e1", seasonNumber: 1, episodeNumber: 1 }, { id: "s1e2", seasonNumber: 1, episodeNumber: 2 },
    { id: "s2e1", seasonNumber: 2, episodeNumber: 1 },
  ];
  const after1 = nextEpisode(eps[0], eps), crossSeason = nextEpisode(eps[1], eps), end = nextEpisode(eps[2], eps);
  ok("nextEpisode", after1.id === "s1e2" && crossSeason.id === "s2e1" && end === null, JSON.stringify({ after1: after1 && after1.id, crossSeason: crossSeason && crossSeason.id, end }));
}
// 4
{
  const early = shouldPromptNext({ currentTime: 600, duration: 1440 });
  const late = shouldPromptNext({ currentTime: 1425, duration: 1440 });
  const cd = countdown({ currentTime: 1430, duration: 1440 });
  ok("promptNext", early === false && late === true && cd === 10, JSON.stringify({ early, late, cd }));
}
// 5
{
  const srt = "1\n00:00:01,000 --> 00:00:04,000\nHello there.\n\n2\n00:00:05,500 --> 00:00:08,000\nGeneral Kenobi.";
  const cues = parseSRT(srt);
  const vtt = toVTT(srt);
  ok("srtToVtt", cues.length === 2 && cues[0].text === "Hello there." && cues[1].start === 5.5 && /^WEBVTT/.test(vtt) && vtt.includes("00:00:01.000 --> 00:00:04.000"), JSON.stringify({ cues: cues.length, head: vtt.slice(0, 7) }));
}
// 6
{
  const t = await sealTrack("sha256:title", "en", "1\n00:00:01,000 --> 00:00:02,000\nHi");
  const good = await verifyTrack(t);
  const tampered = { ...t, vtt: t.vtt.replace("Hi", "Hacked") };
  ok("subtitleKappa", t.id.startsWith("sha256:") && good === true && (await verifyTrack(tampered)) === false, JSON.stringify({ id: t.id.slice(0, 16) }));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-immersive — the binge layer: Skip-Intro/Credits chapters bound to a title κ (detect once, reuse, verifiable), autoplay Up-Next (next-episode ordering across seasons + lead-window countdown), and κ-addressed subtitles (SRT→canonical WebVTT, content-addressed, tamper-refused).",
  authority: "rests on #holo-chapters + #holo-upnext + #holo-subtitles — Phase 3 of the streaming/metadata plan",
  witnessed,
  covers: witnessed ? ["skip-window", "chapters-kappa", "next-episode", "prompt-next", "srt-to-vtt", "subtitle-kappa"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-immersive-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-immersive witness — Skip Intro · autoplay Up Next · κ-subtitles\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the magical binge layer, κ-native + verifiable" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
