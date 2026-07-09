// holo-onion-smux2.test.mjs — validates the smux v2 frame codec against ground-truth wire bytes captured from
// the real xtaci/smux v1.5.57 (Version=2), the exact lib the Snowflake bridge runs.
// Vectors from a live Go client<->server session: scratchpad/oracle/main.go (SYN → PSH → UPD → PSH).
// Run:  node holo-onion-smux2.test.mjs
import { synFrame, pshFrame, updFrame, parseUPD, makeFrameReader, makeStreamIdGen, CMD } from "./holo-onion-smux2.mjs";

let pass = 0, tot = 0;
const ok = (c, m) => { tot++; if (c) pass++; console.log((c ? "✓" : "✗") + " " + m); if (!c) process.exitCode = 1; };
const hex = (u) => Buffer.from(u).toString("hex");
const te = new TextEncoder();

// Ground truth captured from real xtaci/smux v1.5.57, Version=2:
const V_SYN = "0200000003000000";                     // ver2 cmd=SYN len0 sid3
const V_PSH_HELLO = "020205000300000048454c4c4f";     // ver2 cmd=PSH len5 sid3 "HELLO"
const V_UPD = "02040800030000000500000000001000";     // ver2 cmd=UPD len8 sid3 consumed=5 window=1048576
const V_PSH_PONG = "0202050003000000504f4e4721";      // ver2 cmd=PSH len5 sid3 "PONG!"

ok(hex(synFrame(3)) === V_SYN, "encode SYN sid=3 == real bytes");
ok(hex(pshFrame(3, te.encode("HELLO"))) === V_PSH_HELLO, "encode PSH HELLO == real bytes");
ok(hex(updFrame(3, 5, 1048576)) === V_UPD, "encode UPD consumed=5 window=1MiB == real bytes");
ok(hex(pshFrame(3, te.encode("PONG!"))) === V_PSH_PONG, "encode PSH PONG! == real bytes");

{ const g = makeStreamIdGen("client"); ok(g() === 3 && g() === 5, "client stream ids 3,5 (odd, pre-inc)"); }
{ const g = makeStreamIdGen("server"); ok(g() === 2, "server stream ids even"); }

{
  const wire = Buffer.from(V_SYN + V_PSH_HELLO + V_UPD + V_PSH_PONG, "hex");
  const fr = makeFrameReader().feed(new Uint8Array(wire));
  ok(fr.length === 4, "reader splits 4 concatenated frames");
  ok(fr[0].cmd === CMD.SYN && fr[0].streamID === 3 && fr[0].length === 0, "frame0 SYN sid3 len0");
  ok(fr[1].cmd === CMD.PSH && Buffer.from(fr[1].payload).toString() === "HELLO", "frame1 PSH HELLO");
  const u = parseUPD(fr[2]);
  ok(fr[2].cmd === CMD.UPD && u.consumed === 5 && u.window === 1048576, "frame2 UPD consumed5 window1MiB");
  ok(fr[3].cmd === CMD.PSH && Buffer.from(fr[3].payload).toString() === "PONG!", "frame3 PSH PONG!");
}

{
  const wire = Buffer.from(V_SYN + V_PSH_HELLO + V_UPD + V_PSH_PONG, "hex");
  const r = makeFrameReader(); let got = [];
  for (const byte of wire) got = got.concat(r.feed(Uint8Array.of(byte)));
  ok(got.length === 4 && got[3].payload.length === 5, "drip-fed 1 byte/time recovers 4 frames");
}

console.log("\n" + pass + "/" + tot + (pass === tot ? "  SMUX-V2 FRAME CODEC GREEN (vs real xtaci/smux v1.5.57)" : "  FAIL"));
