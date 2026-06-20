import { chromium } from "playwright";
const O="https://humuhumu33.github.io/os-holo/os/";
const b=await chromium.launch({headless:true});const c=await b.newContext();const p=await c.newPage();
const cdp=await c.newCDPSession(p);await cdp.send("Network.enable");await cdp.send("Target.setAutoAttach",{autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
const hits=[];
cdp.on("Network.requestWillBeSent",e=>{const u=e.request.url;if(/os-kernel|os-rootfs|\/ipfs\/bafy|holospaces_web/.test(u))hits.push((u.includes("ipfs")?"IPFS ":"")+u.replace("https://humuhumu33.github.io/os-holo/os/","").replace(/https:\/\//,"").slice(0,46));});
// also attach to workers
cdp.on("Target.attachedToTarget",async({sessionId})=>{try{const s=cdp._connection?.session?.(sessionId);}catch(e){}});
await p.goto(O,{waitUntil:"load"}).catch(()=>{});
await p.evaluate(async()=>{try{await navigator.serviceWorker.register("holo-fhs-sw.js",{type:"module"});await navigator.serviceWorker.ready;}catch(e){}});
await p.waitForTimeout(1500);
await p.goto(O+"apps/holo-linux/index.html",{waitUntil:"load"}).catch(()=>{});
await p.waitForTimeout(25000);
console.log("artifact/ipfs requests seen:");
console.log("  "+([...new Set(hits)].join("\n  ")||"(NONE — worker not reaching artifact fetch)"));
await b.close();
