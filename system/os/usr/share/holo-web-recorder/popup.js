// popup.js — attach toggle + live O(1) stats for the Hologram Web Recorder.
const $ = (id) => document.getElementById(id);
let attached = false;

const kb = (n) => (n / 1024).toFixed(n >= 1024 * 100 ? 0 : 1);
function render(attachedUrl, s) {
  attached = s.attachedTab != null;
  $("toggle").textContent = attached ? "Detach" : "Attach to this tab";
  $("toggle").classList.toggle("on", attached);
  $("url").textContent = attached ? (attachedUrl || "(attached)") : "— not attached —";
  $("stats").style.display = (s.minted || s.hits) ? "grid" : "none";
  $("kobjects").textContent = s.kobjects;
  $("hits").innerHTML = s.hits + ' <small>O(1)</small>';
  $("minted").textContent = s.minted;
  $("dedup").textContent = s.dedup;
  $("bcache").innerHTML = kb(s.bytesCache) + "<small>KB</small>";
  $("bnet").innerHTML = kb(s.bytesNet) + "<small>KB</small>";
  $("cold").textContent = s.coldMs; $("warm").textContent = s.warmMs;
  $("speedup").textContent = (s.warmMs > 0 && s.coldMs > 0) ? (s.coldMs / s.warmMs).toFixed(0) + "×" : (s.hits ? "fast" : "—");
}

function poll() { chrome.runtime.sendMessage({ type: "getStats" }, (r) => { if (chrome.runtime.lastError || !r) return; render(r.attachedUrl, r.stats); }); }

$("toggle").addEventListener("click", () => {
  $("toggle").disabled = true;
  chrome.runtime.sendMessage({ type: attached ? "detach" : "attach" }, (r) => {
    $("toggle").disabled = false;
    if (chrome.runtime.lastError || !r) { $("url").textContent = "error: " + (chrome.runtime.lastError && chrome.runtime.lastError.message || "no response"); return; }
    if (!r.ok) { $("url").textContent = "error: " + r.error; return; }
    render(r.url, r.stats);
  });
});

chrome.runtime.onMessage.addListener((msg) => { if (msg.type === "holo-stats") render($("url").textContent, msg.stats); });
poll(); setInterval(poll, 800);
