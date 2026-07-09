// holo-embed.js — the ONE embed guard. When a holospace runs EMBEDDED in the canonical shell
// (shell.html), the shell frame OWNS the chrome — tabs · address bar · nav — so an app must not
// draw its own. This sets `data-embedded` on <html> the instant it loads (before paint, so there
// is no flash), and the app's stylesheet hides its duplicate chrome under `html[data-embedded]`.
// Standalone (top-level), nothing is set and the app keeps its full chrome. One rule, every app:
// drop it in the <head> and gate your own tabstrip / address bar / nav with html[data-embedded].
//
//   <script src="_shared/holo-embed.js"></script>
//   html[data-embedded] #tabs, html[data-embedded] #addressbar { display: none; }
(function () {
  try { if (window.top !== window.self) document.documentElement.setAttribute("data-embedded", ""); }
  catch (e) { document.documentElement.setAttribute("data-embedded", ""); }   // cross-origin parent ⇒ embedded
})();
