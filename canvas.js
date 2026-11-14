/* ══════════════════════════════════════════════════════════════════════════
   JB Studio — homepage canvas LOADER (this is the file the page includes).
   WebGL2 available → loads engine.js (the Grid ⇄ Sphere ⇄ Reel canvas).
   Otherwise → adds .jb-canvas-fallback to <html>: canvas.css reveals the CMS list ([data-canvas-list])
   as a plain, accessible grid of project links, and window.JB_CANVAS is a no-op stub.

   Page contract (Webflow):
     <div id="app" data-default-view="grid"></div>          the canvas mounts here (full page, fixed)
     <button data-view="grid|sphere|reel">                    any element with data-view switches view
     <div data-canvas-list>                                   CMS Collection List (hidden; shown only as the fallback)
       <div data-canvas-item data-url data-w data-h data-video data-poster data-link data-label data-title data-category>
         (visible markup for the fallback: <a href><img alt><span>title</span></a>) </div></div>
     [data-canvas-loading]                                    optional loader, hidden once images arrive
     <html data-canvas-pause>                                 set while an overlay (menu) covers the page
   Public API: window.setCanvasView(name) · window.JB_CANVAS = { CFG, view(), relayout(view),
     refreshCaptions(view), refreshReelInfo(), destroy() }
   Dev: ?debug → Controls panel + window.__ic · ?freeze → deterministic test mode (tests/parity.py)
   ══════════════════════════════════════════════════════════════════════════ */
function fallback(reason) {
  if (reason) console.warn("[JB canvas] fallback:", reason);
  document.documentElement.classList.add("jb-canvas-fallback");
  window.setCanvasView = window.setCanvasView || (() => {});
  window.JB_CANVAS = window.JB_CANVAS || { CFG: {}, view: () => null, relayout() {}, refreshCaptions() {},
    refreshReelInfo() {}, destroy() {}, fallback: true };
}
let webgl2 = false;
try { webgl2 = !!document.createElement("canvas").getContext("webgl2"); } catch (_) {}
if (webgl2) import("./engine.js").catch((e) => { console.error("[JB canvas]", e); fallback("engine failed to load"); });
else fallback("WebGL2 unavailable");
