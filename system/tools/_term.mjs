import { chromium } from "playwright";
const O="https://humuhumu33.github.io/os-holo/os/";
const b=await chromium.launch({headless:true,args:["--enable-unsafe-webgpu","--use-gl=swiftshader"]});const c=await b.newContext();const p=await c.newPage();
await p.goto(O,{waitUntil:"load"}).catch(()=>{});
await p.evaluate(async()=>{try{await navigator.serviceWorker.register("holo-fhs-sw.js",{type:"module"});await navigator.serviceWorker.ready;}catch(e){}}).catch(()=>{});
await p.waitForTimeout(5000);await p.goto(O,{waitUntil:"load"}).catch(()=>{});await p.waitForTimeout(2000);
await p.goto(O+"apps/holo-linux/index.html",{waitUntil:"load"}).catch(()=>{});
let last="";
for(let i=0;i<18;i++){await p.waitForTimeout(14000);
  const s=await p.evaluate(()=>{const term=document.querySelector(".xterm-rows,.xterm-screen,.terminal,canvas.xterm-link-layer")?.parentElement?.innerText||document.querySelector(".xterm")?.innerText||"";const status=[...document.querySelectorAll("*")].map(e=>e.childNodes.length===1?e.textContent:"").find(t=>t&&/loading|fetching|verif|assembl|provision|booting|kernel|rootfs|Boot failed/i.test(t)&&t.length<40)||"";return {status:status.slice(0,40),term:term.replace(/\s+/g," ").slice(-120)};}).catch(()=>({}));
  const line=`${(i+1)*14}s | st:${s.status||'-'} | term:${s.term||'-'}`;
  if(line!==last){console.log(line);last=line;}
  if(/debian@|root@|login:|\$ |# $/i.test(JSON.stringify(s)))break;
}
await b.close();
