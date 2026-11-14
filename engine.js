/* ══════════════════════════════════════════════════════════════════════════
   JB Studio — homepage canvas ENGINE (Grid ⇄ Sphere ⇄ Reel), one WebGL scene that morphs the same tiles.
   Loaded by canvas.js only when WebGL2 is available (else canvas.js shows the CMS list as a plain grid).

   Page contract (Webflow):
     <div id="app" data-default-view="grid"></div>          the canvas mounts here (full page, fixed)
     <button data-view="grid|sphere|reel">                    any element with data-view switches view
     <div data-canvas-item data-url data-w data-h data-video data-link data-label data-title data-category>
                                                              hidden CMS list items (else built-in fallback media)
     [data-canvas-loading]                                    optional loader, hidden once images arrive
   Public API: window.setCanvasView(name) · window.JB_CANVAS = { CFG, view(), relayout(view),
     refreshCaptions(view), refreshReelInfo(), destroy() }
   Dev: ?debug → Controls panel (dev-panel.js) + window.__ic · ?freeze → deterministic test mode (tests/parity.py)
   ══════════════════════════════════════════════════════════════════════════ */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";   // full URL: no import map needed
import { createPost } from "./post.js";

/* ---- engine constants (feel/timing); per-view look lives in CFG below ---- */
const SEED=1796, Z_JITTER=0.70;
const MAX_SPEED=1.8, DRAG_SENSITIVITY=1.00, DRAG_CURVE=0.015;
const FOCUS_DIM=0.12, OPACITY_LERP=0.15, FOCUS_LERP=0.12, FOCUS_MARGIN=0.08, FOCUS_DISTANCE=6.0;
const INTRO_DISTANCE=9.0, INTRO_DURATION=1.1, INTRO_WINDOW=1.6;
const OPEN_LERP=0.035, OPEN_BULGE=0.90, OPEN_RIPPLE=0.18;
const ZOOM_DEPTH_STRENGTH=0.32, ZOOM_STAGGER=0.75;
const MIN_Z=18, MAX_Z=28, START_Z=MAX_Z, KEY_SPEED=0.18;
const GLOBE_LERP=0.13, TRANS_DUR=0.55;                // TRANS_DUR = grid<->sphere morph seconds (snappy)
const GLOBE_STRENGTH=0.38;                            // sphere curve seed (live value is CFG.sphere.globe)
/* ---- live-tunable PER-VIEW settings — edit with the on-screen Controls panel ---- */
const CFG={
  grid:   { cols:2, fill:0.8, colW:9.5, colGap:2.4, vGap:2.4, capSize:1.2, capGap:0.45, curveRest:0.04, curveGain:3.5, curveMax:0.52, blur:0.35, aberr:0.5, zoom:0.4, zoomRgb:3 },
  sphere: { cell:5.0, gap:3.20, globe:0.38, capSize:3, capGap:0, blur:0.35, aberr:0.5, parallax:0.56, zoom:0.25, zoomRgb:3, wheelX:0.65, wheelY:0.4 },
  reel:   { cardFill:0.7, peek:0.1, maxAR:1.5, scroll:0.4, titleSize:1.0, metaSize:1.0, infoY:4, curve:0.08, blur:0.35, aberr:0.6, zoom:0.4, zoomRgb:3 },
  shared: { friction:0.860, damping:0.050 },
};
const lifetime=new AbortController();   // destroy() aborts every listener registered with on()
const on=(t,type,fn,o)=>t.addEventListener(type,fn,Object.assign({signal:lifetime.signal},o||{}));
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const rand=(i,salt)=>{const x=Math.sin(i*73.13+salt*9173.7+SEED)*43758.5453;return x-Math.floor(x);};

/* ---- device profile: scale cost + interactions for tablet/mobile ---- */
const COARSE=matchMedia("(pointer: coarse)").matches;
const CAN_HOVER=matchMedia("(hover: hover)").matches;
const MOBILE=COARSE||innerWidth<700;
const MAX_DPR=MOBILE?1.5:2;
const ANTIALIAS=!MOBILE;
const BLUR_TAPS=MOBILE?5:9;
const DEBUG=new URLSearchParams(location.search).has('debug');     // dev panel + window.__ic
const FREEZE=new URLSearchParams(location.search).has('freeze');   // TEST-ONLY: deterministic frames for tests/parity.py
const reduceFactor=matchMedia("(prefers-reduced-motion: reduce)").matches?0.15:1;

/* ---- VIEWS — morph between layouts. Grid = flat (globe 0), Sphere = globe on.
   Wire Webflow buttons with data-view="grid" / data-view="sphere" (and later "list").
   Or call window.setCanvasView('grid'). Default via <div id="app" data-view="grid">. ---- */
const VIEWS={ grid:{grid:1}, sphere:{grid:0}, reel:{grid:1} };   // grid & reel are both "finite"; sphere is infinite
let gridTargetMix=0, gridMix=0, viewReady=false, trans=null, currentView=null, layoutMode='grid';   // layoutMode = which finite layout
function setCanvasView(name){
  if(!(name in VIEWS) || name===currentView) return;   // ignore re-selecting the current view (prevents drag-flicker)
  const prevFinite = currentView && currentView!=='sphere';
  if(currentView==='reel') savedReel=reelIndex;   // remember where we were in the reel
  currentView=name;
  gridTargetMix=VIEWS[name].grid;
  if(name!=='sphere') layoutMode=name;
  if(viewReady) startTransition(gridTargetMix>0.5, prevFinite && name!=='sphere');   // lockstep camera + layout morph
  document.documentElement.setAttribute("data-canvas-view",name);
  document.querySelectorAll("[data-view]").forEach(b=>{ if(b.id!=="app") b.classList.toggle("is-active",b.getAttribute("data-view")===name); });   // any view button (Webflow links too)
}
const gridActive=()=>gridTargetMix>0.5;
window.setCanvasView=setCanvasView;
on(window,"click",e=>{ const b=e.target.closest&&e.target.closest("[data-view]"); if(b&&b.id!=="app"){ e.preventDefault(); setCanvasView(b.getAttribute("data-view")); } });   // any [data-view] button (Webflow too), never the canvas

/* ============================================================
   MEDIA — driven by the Webflow CMS when present, else this fallback list.

   CMS: add a HIDDEN Collection List anywhere on the page whose items are:
     <div data-canvas-item
          data-url="{IMAGE or VIDEO url}"
          data-w="{aspect width}" data-h="{aspect height}"
          data-video="true|false"
          data-link="{project url}" data-label="{button text}"
          data-category="{category}"></div>
   The script reads those and builds the grid. No CMS list -> uses FALLBACK below.
   ============================================================ */
const FALLBACK_MEDIA=[
  { url:'https://cdn.prod.website-files.com/62ff68985599ab85a2c5caa9/6a3cfd73712eaa1f27772ac4_HD.avif',  width:4,  height:5 },
  { url:'https://cdn.prod.website-files.com/62ff68985599ab85a2c5caa9/6a3cfe6af6dc6445e2ba6682_Seven%20(1).avif',  width:5,  height:4 },
  { url:'https://cdn.prod.website-files.com/62ff68985599ab85a2c5caa9/6a3d00b4671fd68450b928b9_SS-(3).avif',  width:3,  height:2 },
  { url:'https://cdn.prod.website-files.com/62ff68985599ab85a2c5caa9/6a3d021f8d5ae8c9e372906d_Truffle-Guys%20(1).avif',   width:1,  height:1 },
  { url:'https://cdn.prod.website-files.com/62ff68985599ab85a2c5caa9/6a3d02d5e2ef287a0b52e9c0_FF-(5).avif',  width:3,  height:4,  link:'https://www.josephberry.co.uk/bfi', button:'See Case Study' },
  { url:'https://cdn.jsdelivr.net/gh/JosephBerry1988/jb_studio@main/HF11-Intro.mp4', width:16, height:9, video:true, link:'https://www.josephberry.co.uk/oilstainlabs', button:'See Case Study' },
  { url:'https://cdn.prod.website-files.com/62ff68985599ab85a2c5caa9/6a3d0efebb798e648d18d8e9_Mask%20group.avif',  width:7,  height:10 },
  { url:'https://cdn.prod.website-files.com/62ff68985599ab85a2c5caa9/6a3d0fbc6099ee307ff79cfb_Mask%20group%20(1).jpg', width:1,  height:1 },
  { url:'https://cdn.prod.website-files.com/62ff68985599ab85a2c5caa9/6a3d107c642eb0df9fab2d61_Clay.jpg',   width:4,  height:3, link:'https://www.josephberry.co.uk/clay', button:'See Case Study' },
  { url:'https://cdn.prod.website-files.com/62ff68985599ab85a2c5caa9/6a3d12db642eb0df9fac6f21_Snatch.avif',  width:8,  height:11 },
  { url:'https://cdn.prod.website-files.com/62ff68985599ab85a2c5caa9/6a3d14aee75fba3ada099cc3_Ledger.avif',  width:11, height:8, link:'https://www.josephberry.co.uk/ledger', button:'See Case Study' },
  { url:'https://cdn.prod.website-files.com/62ff68985599ab85a2c5caa9/6a3d184af2025b6893432c41_Vergo.jpg',   width:1,  height:1},
  { url:'https://cdn.prod.website-files.com/62ff68985599ab85a2c5caa9/6a3d1903bd83322f2b4c640f_Milio%20(1).avif', width:4,  height:5, link:'https://www.josephberry.co.uk/milio', button:'See Case Study'  },
  { url:'https://Savoy-website.b-cdn.net/On-arrival.mp4',  width:5,  height:3, video:true,},
  { url:'https://cdn.jsdelivr.net/gh/JosephBerry1988/jb_studio@main/Quotax-Hero-One.mp4', width:16, height:9, video:true, },
];
/* ---- read projects from a hidden Webflow CMS Collection List (if present) ---- */
function readMediaFromDOM(){
  const els=[...document.querySelectorAll('[data-canvas-item]')];
  if(!els.length) return null;
  const list=els.map(el=>{
    const d=el.dataset, url=(d.url||'').trim(); if(!url) return null;
    const w=parseFloat(d.w), h=parseFloat(d.h);
    const m={ url, width:w||4, height:h||5, autoAspect:!(w&&h) };   // no size given: corrected from the loaded image
    if((d.video||'').toLowerCase()==='true' || /\.(mp4|webm)(\?|$)/i.test(url)) m.video=true;
    if(d.link && d.link.trim() && d.link.trim()!=='#') m.link=d.link.trim();
    if(d.label && d.label.trim()) m.button=d.label.trim();
    m.title=(d.title||'').trim();                      // CMS: missing title/category stay empty (never a filename)
    m.category=(d.category||'').trim();
    if(d.poster && d.poster.trim()) m.poster=d.poster.trim();      // video poster: shown until the first frame / if playback is blocked
    return m;
  }).filter(Boolean);
  return list.length?list:null;
}
const CMS_MEDIA = readMediaFromDOM();
/* ---- or an inline array: window.JB_CANVAS_DATA = [{url,w,h,title,category,link,button,video,poster}, ...] ----
   (set before this script; the hidden CMS Collection List, if present, takes priority) ---- */
function fromData(arr){
  return arr.map(it=>{
    const url=(it.url||'').toString().trim(); if(!url) return null;
    const w=parseFloat(it.w!=null?it.w:it.width), h=parseFloat(it.h!=null?it.h:it.height);
    const m={ url, width:w||4, height:h||5, autoAspect:!(w&&h) };
    if(it.video===true || /\.(mp4|webm)(\?|$)/i.test(url)) m.video=true;
    if(it.link && it.link.toString().trim() && it.link!=='#') m.link=it.link.toString().trim();
    if(it.button) m.button=it.button.toString().trim();
    m.title=(it.title||'').toString().trim(); m.category=(it.category||'').toString().trim();
    if(it.poster) m.poster=it.poster.toString().trim();
    return m;
  }).filter(Boolean);
}
const DATA_MEDIA = (Array.isArray(window.JB_CANVAS_DATA)&&window.JB_CANVAS_DATA.length) ? fromData(window.JB_CANVAS_DATA) : null;
if(!CMS_MEDIA && !DATA_MEDIA) console.warn('[JB canvas] no [data-canvas-item] list or JB_CANVAS_DATA — showing the built-in demo media');
const MEDIA = CMS_MEDIA || DATA_MEDIA || FALLBACK_MEDIA;
const N=MEDIA.length;
/* ---- per-view filter: Grid & Reel show only projects WITH a case-study page (data-link); Sphere shows all ---- */
const GRIDVIS = MEDIA.map(m=>!!m.link);                                     // true = appears in grid/reel
const FITEMS = []; MEDIA.forEach((m,i)=>{ if(m.link) FITEMS.push(i); });    // item indices in grid/reel, in order
const M = FITEMS.length;                                                    // number of grid/reel cards
const RANK = {}; FITEMS.forEach((it,k)=>{ RANK[it]=k; });                   // item index -> reel rank
const reelMax = ()=> Math.max(M-1,0);

/* ---- caption text: CMS supplies data-title/data-category; else known fallback names ---- */
const FALLBACK_META=[['HD','Design & Dev'],['Seven','Brand'],['SS','Design & Dev'],['Truffle Guys','Brand'],
  ['BFI','Brand'],['HF-11','Design & Dev'],['Mask','Design & Dev'],['Mask','Design & Dev'],['Clay','Design & Dev'],
  ['Snatch','Design & Dev'],['Ledger','Design & Dev'],['Vergo','Brand'],['Milio','Design & Dev'],
  ['Savoy','Design & Dev'],['Quotax','Design & Dev']];
MEDIA.forEach((m,i)=>{
  const meta=(MEDIA===FALLBACK_MEDIA)?FALLBACK_META[i]:null;
  if(m.title==null) m.title=(meta&&meta[0])||'';
  if(m.category==null) m.category=(meta&&meta[1])||'';
});

/* ---- uniform grid packer: consistent cell size + gap, aligned, seamless tiling ---- */
function computeLayout(images){
  const n=images.length;
  // landscape tile for any count: cols ≈ √(1.6·N) (15 → 5×3); a partial last row is padded with repeats
  // of the first items (cell c shows item c % N) so the tile stays a full rectangle and tiles seamlessly
  const cols=Math.max(1,Math.round(Math.sqrt(n*1.6))), rows=Math.ceil(n/cols), cells=cols*rows;
  const cell=CFG.sphere.cell;
  const stride=cell+CFG.sphere.gap;
  const tileW=cols*stride, tileH=rows*stride;
  const boxes=Array.from({length:cells},(_,i)=>{
    const im=images[i%n], aspect=im.width/im.height;
    const w=aspect>=1?cell:cell*aspect;     // fit (contain) inside a square cell
    const h=aspect>=1?cell/aspect:cell;     // centred, no cropping
    const col=i%cols, row=Math.floor(i/cols);
    const cx=(col+0.5)*stride - tileW/2;
    const cy=tileH/2 - (row+0.5)*stride;
    return {w,h,cx,cy,z:0};                           // flat grid -> consistent alignment
  });
  return {boxes,tileW,tileH,cells};
}
let {boxes,tileW,tileH,cells:CELLS}=computeLayout(MEDIA);   // CELLS ≥ N sphere cells per tile

/* ---- GRID VIEW: finite staggered 2-column editorial layout (homepage style) ---- */
const GRID_CAP=1.4, GRID_TOP=3.0;
function computeGrid(images){
  const nc=Math.round(CFG.grid.cols), stride=CFG.grid.colW+CFG.grid.colGap;
  const colX=[...Array(nc)].map((_,c)=>(c-(nc-1)/2)*stride);   // centred columns
  const colY=Array(nc).fill(-GRID_TOP);
  return images.map(im=>{
    if(!im.link) return {w:CFG.grid.colW,h:0.001,cx:0,cy:-GRID_TOP};   // not a case study -> hidden in grid, takes no slot
    const ar=im.width/im.height;
    const w=CFG.grid.colW, h=w/ar;
    let c=0; for(let k=1;k<nc;k++) if(colY[k]>colY[c]) c=k;   // masonry: fill the shortest column -> natural stagger
    const cy=colY[c]-h/2;
    colY[c]-=(h+GRID_CAP+CFG.grid.vGap);
    return {w,h,cx:colX[c],cy};
  });
}
const gridBox=computeGrid(MEDIA);
const dispBox=gridBox.map(b=>({x:b.cx,y:b.cy,w:b.w,h:b.h}));   // eased displayed finite layout (morphs grid<->reel)
const gBottom = ()=> M ? Math.min(...FITEMS.map(i=>gridBox[i].cy-gridBox[i].h/2)) : -10;   // over linked items only
let gridBottom=gBottom();   // most-negative bottom edge
let gridZ=START_Z, scrollMin=0, scrollMax=0;
const gOff={x:0,y:0};                               // grid is built around wherever the camera is (no fly-back to origin)
const sLo=()=>scrollMin+gOff.y, sHi=()=>scrollMax+gOff.y;
let savedScroll=null;                                 // grid-local scroll to return to after a sphere visit

/* ---- REEL VIEW: one project at a time, fully visible, vertical snap scroll with a peek ---- */
const REEL_SLOT=10;                                   // world height budget per card (zoom fits it to the viewport)
const reelViewH=()=>REEL_SLOT/clamp(CFG.reel.cardFill,0.3,1);           // world viewport height at reel zoom
const reelStride=()=>REEL_SLOT*0.5 + reelViewH()*(0.5-clamp(CFG.reel.peek,0,0.45));   // gap between card centres
let reelIndex=0, savedReel=null, reelSnapT=0;   // savedReel = remembered position; reelSnapT = snap-on-stop timer
function computeReel(images){
  const maxW=REEL_SLOT*CFG.reel.maxAR, stride=reelStride(); let rank=0;
  return images.map((im)=>{
    if(!im.link) return {w:0.001,h:0.001,cx:0,cy:0};  // not a case study -> not in the reel
    const ar=im.width/im.height; let h=REEL_SLOT, w=REEL_SLOT*ar;
    if(w>maxW){ w=maxW; h=maxW/ar; }                  // contain: whole piece visible, wide media capped by width
    const box={ w, h, cx:0, cy:-rank*stride }; rank++; return box;   // stacked by linked-rank
  });
}
const computeFinite=()=> layoutMode==='reel' ? computeReel(MEDIA) : computeGrid(MEDIA);

function recalcGrid(){
  const asp=(innerWidth>0&&innerHeight>0)?innerWidth/innerHeight:16/9, tanf=Math.tan(camera.fov*Math.PI/360);
  if(layoutMode==='reel'){
    gridZ=clamp(reelViewH()/(2*tanf), 6, 140);
    scrollMax=0; scrollMin=-reelMax()*reelStride();    // scroll top card -> last card (linked items only)
    return;
  }
  const nc=Math.round(CFG.grid.cols), contentW=nc*CFG.grid.colW+(nc-1)*CFG.grid.colGap;
  gridZ=clamp(contentW/(2*tanf*asp*CFG.grid.fill), 8, 80);   // fill = fraction of viewport width the grid occupies
  const viewH=2*tanf*gridZ, pad=1.5;
  scrollMax=(-GRID_TOP+pad) - viewH/2;              // top: first cards sit just under the screen top
  scrollMin=Math.min(scrollMax, gridBottom - pad + viewH/2); // bottom: last cards clear the screen
}
/* ---- relayout when spacing/size changes from the Controls panel (active finite layout) ---- */
function relayoutGrid(){
  const g=computeFinite();
  for(let i=0;i<N;i++){ gridBox[i].w=g[i].w; gridBox[i].h=g[i].h; gridBox[i].cx=g[i].cx; gridBox[i].cy=g[i].cy; }
  gridBottom=gBottom();
  recalcGrid();
  if(gridActive()){ target.z=gridZ; if(layoutMode==='reel'){ target.y=clamp(gOff.y-reelIndex*reelStride(),sLo(),sHi()); } else target.y=clamp(target.y,sLo(),sHi()); }
}
function reelSlotY(i){ return gOff.y - clamp(i,0,reelMax())*reelStride(); }   // i = reel rank (linked items)
function updateReelInfo(i){
  if(i==null||isNaN(i)) return;
  i=clamp(Math.round(i),0,N-1); const it=MEDIA[i]; if(!it) return; const el=document.getElementById('reelInfo');
  const rank=(RANK[i]!=null?RANK[i]:0);                 // position within the linked set
  if(el){ el.querySelector('.t').textContent=it.title||''; el.querySelector('.c').textContent=it.category||'';
    el.querySelector('.n').textContent=`${rank+1} / ${M}`; }
  projectBtn.classList.remove('show');   // reel: no project button (the card itself is the link)
}
function relayoutSphere(){
  const r=computeLayout(MEDIA);
  for(let i=0;i<CELLS;i++){ boxes[i].w=r.boxes[i].w; boxes[i].h=r.boxes[i].h; boxes[i].cx=r.boxes[i].cx; boxes[i].cy=r.boxes[i].cy; boxes[i].z=r.boxes[i].z; }
  tileW=r.tileW; tileH=r.tileH;
}

/* ---- renderer / scene / camera ---- */
const app=document.getElementById("app");
function ensureEl(id, html){ let el=document.getElementById(id); if(!el){ document.body.insertAdjacentHTML("beforeend",html); el=document.getElementById(id); } return el; }
ensureEl("projectBtn",'<a id="projectBtn" href="#">View Project</a>');
ensureEl("reelInfo",'<div id="reelInfo"><div class="t"></div><div class="c"></div><div class="n"></div></div>');
setCanvasView((app&&app.getAttribute("data-default-view"))||"grid"); // initial view (set data-default-view on #app)
const PLUS_SVG=`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><g fill="none" stroke-linecap="round"><path d="M16 7v18M7 16h18" stroke="black" stroke-width="2" opacity=".4"/><path d="M16 7v18M7 16h18" stroke="white" stroke-width="1"/></g></svg>`;
const PLUS_CURSOR=`url("data:image/svg+xml,${encodeURIComponent(PLUS_SVG)}") 16 16, crosshair`;
const projectBtn=document.getElementById("projectBtn");
const renderer=new THREE.WebGLRenderer({antialias:ANTIALIAS,powerPreference:"high-performance"});
const START_DPR=Math.min(devicePixelRatio,MAX_DPR);   // adaptive quality steps down from here (floor 1) and back up
renderer.setPixelRatio(START_DPR);
renderer.setSize(innerWidth,innerHeight);
app.appendChild(renderer.domElement);
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(45,innerWidth/innerHeight,0.1,200);
camera.position.set(0,0,START_Z);

/* ---- textures: images via TextureLoader, videos via VideoTexture ---- */
const loader=new THREE.TextureLoader(); loader.crossOrigin="anonymous"; let loaded=0;
const hideLoading=()=>{const l=document.querySelector("[data-canvas-loading]"); if(l)l.style.display="none";};   // optional page loader
setTimeout(hideLoading,2500);
function placeholderCanvas(){ const c=document.createElement('canvas'); c.width=c.height=2; const x=c.getContext('2d'); x.fillStyle='#1c1c1e'; x.fillRect(0,0,2,2); return c; }
// only a real autoplay refusal blocks a video; an AbortError just means our own pause() interrupted play()
function tryPlay(vs){ vs.v.play().catch(e=>{ if(e && e.name==='NotAllowedError') vs.blocked=true; }); }
function makeTexture(item){
  if(item.video && FREEZE){ const t=new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1); t.needsUpdate=true; return t; }   // test-only: no video timing
  if(item.video){
    const v=document.createElement('video');
    v.crossOrigin='anonymous'; v.loop=true; v.muted=true; v.playsInline=true; v.autoplay=true; v.src=item.url;
    // VideoTexture already uploads only on new video frames (requestVideoFrameCallback)
    const t=new THREE.VideoTexture(v);
    t.colorSpace=THREE.LinearSRGBColorSpace; t.minFilter=THREE.LinearFilter; t.magFilter=THREE.LinearFilter; // shader decodes sRGB
    const vs={v, t, live:false, blocked:false, drawnAt:performance.now()};   // counts as 'drawn' at boot so it isn't paused before the first frame
    if(item.poster){                                   // poster first; swapped for the video on its first decoded frame
      const im=new Image(); im.crossOrigin='anonymous';
      im.onload=()=>{ if(!vs.live){ t.image=im; t.needsUpdate=true; } };
      im.src=item.poster;
    }
    const firstFrame=()=>{ vs.live=true; if(t.image!==v){ t.image=v; t.needsUpdate=true; } };
    if(v.requestVideoFrameCallback) v.requestVideoFrameCallback(firstFrame); else v.addEventListener('loadeddata',firstFrame,{once:true});
    v.addEventListener('loadedmetadata',()=>{ if(item.autoAspect && v.videoWidth){ item.width=v.videoWidth; item.height=v.videoHeight; needsRelayout=true; } },{once:true});
    setTimeout(()=>{ if(!vs.live && t.image===v){ t.image=placeholderCanvas(); t.needsUpdate=true; } },3000);   // no frame, no poster: neutral tile, not a hole
    tryPlay(vs);                                        // Low Power Mode / autoplay blocked: keep the poster, retry on a tap
    videoState[MEDIA.indexOf(item)]=vs;
    return t;
  }
  const t=loader.load(item.url,(tex)=>{
    if(item.autoAspect && tex.image && tex.image.naturalWidth){ item.width=tex.image.naturalWidth; item.height=tex.image.naturalHeight; needsRelayout=true; }
    if(++loaded>=3)hideLoading();
  },undefined,()=>{                                    // broken URL: neutral placeholder tile, keep everything else going
    t.image=placeholderCanvas(); t.needsUpdate=true; if(++loaded>=3)hideLoading();
  });
  t.colorSpace=THREE.LinearSRGBColorSpace; t.generateMipmaps=true; // shader decodes sRGB (consistent with video)
  t.minFilter=THREE.LinearMipmapLinearFilter; t.magFilter=THREE.LinearFilter;
  t.anisotropy=renderer.capabilities.getMaxAnisotropy(); return t;
}
let needsRelayout=false;                               // set when an image's real aspect arrives (CMS item without w/h)
const videoState=[];                                  // per item: {v, t, live, blocked, drawnAt} for video items
const textures=MEDIA.map(makeTexture);

/* ---- image materials: warp on open (uOpen 1=flat -> 0=warped), per-mesh opacity ---- */
const imgVert=`
  uniform float uOpen; varying vec2 vUv;
  void main(){
    vUv=uv;
    vec3 p=position;
    float d=length(position.xy)/0.7071;
    float front=uOpen*1.35;
    float lift=exp(-pow((d-front)/0.6,2.0));
    lift*=(1.0-smoothstep(0.75,1.0,uOpen));
    p.z -= lift*(${OPEN_BULGE.toFixed(2)} - sin(d*5.0 - uOpen*6.0)*${OPEN_RIPPLE.toFixed(2)});
    gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
  }`;
const imgFrag=`
  uniform sampler2D map; uniform float uOpacity; varying vec2 vUv;
  vec3 sRGBToLinear(vec3 c){ return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c)); }
  void main(){ vec4 c=texture2D(map,vUv); if(c.a<0.01) discard; gl_FragColor=vec4(sRGBToLinear(c.rgb), c.a*uOpacity); }`;
const materials=textures.map(t=>new THREE.ShaderMaterial({
  transparent:true,
  uniforms:{map:{value:t},uOpacity:{value:1},uOpen:{value:1}},
  vertexShader:imgVert, fragmentShader:imgFrag
}));

/* ---- fixed pool ---- */
const aspect0=(innerWidth>0&&innerHeight>0)?innerWidth/innerHeight:16/9;   // guard: page can load at zero size
// pool covers the widest shape this screen allows (either orientation), so rotation / maximising never needs new meshes
const sw=(screen&&screen.width)||innerWidth, sh=(screen&&screen.height)||innerHeight;
const aspectMax=Math.max(aspect0, 1/aspect0, sw/sh||1, sh/sw||1);
const vH=2*Math.tan(camera.fov*Math.PI/360)*MAX_Z, vW=vH*aspectMax;
const tilesX=Math.ceil(vW/tileW)+2, tilesY=Math.ceil(vH/tileH)+2;
const count=tilesX*tilesY*CELLS, halfTX=Math.floor(tilesX/2), halfTY=Math.floor(tilesY/2);
const geo=new THREE.PlaneGeometry(1,1,24,24);
const centerTile=halfTY*tilesX+halfTX;             // the one tile copy that becomes the finite grid
const meshes=[], primaryMesh=[];
for(let s=0;s<count;s++){
  const c=s%CELLS, i=c%N, b=boxes[c];                 // cell in its tile -> item shown there
  const m=new THREE.Mesh(geo,materials[i]);
  m.scale.set(b.w,b.h,1); m.userData.op=1; m.userData.intro=0; m.userData.zfollow=START_Z; m.userData.open=1; m.userData.slot=s; m.userData.cell=c; m.userData.item=i;
  m.userData.primary=(Math.floor(s/CELLS)===centerTile && c<N);   // centre tile's first N cells = one of each item m.userData.dupFade=1;
  if(m.userData.primary) primaryMesh[i]=m;
  m.onBeforeRender=()=>{ const vs=videoState[i]; if(vs) vs.drawnAt=frameNow; m.material.uniforms.uOpacity.value=m.userData.op*m.userData.intro*m.userData.dupFade; m.material.uniforms.uOpen.value=m.userData.open; };
  scene.add(m); meshes.push(m);
}

/* ---- WebGL captions (title + category) — only visible in grid view ---- */
function makeCaptionTex(title,category,mult){
  const c=document.createElement('canvas'); c.width=1024; c.height=260; const x=c.getContext('2d');   // tall canvas = headroom for big text
  x.clearRect(0,0,1024,260); x.textBaseline='middle';
  // homepage caption: Helveticaneue Light 300, uppercase; title ~13px & category ~12px over a ~500px card -> 27/24px on this 1024 canvas
  const FONT='"Helveticaneue Light", Helveticaneue, -apple-system, sans-serif', m=mult||1;
  x.fillStyle='#f3eede'; x.font='300 '+(27*m).toFixed(1)+'px '+FONT; x.textAlign='left';
  x.fillText((title||'').toUpperCase(),6,130);
  if(category){ x.fillStyle='rgba(243,238,222,.6)'; x.font='300 '+(24*m).toFixed(1)+'px '+FONT; x.textAlign='right'; x.fillText(category.toUpperCase(),1018,130); }
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.minFilter=THREE.LinearFilter; t.anisotropy=renderer.capabilities.getMaxAnisotropy(); return t;
}
const capGeo=new THREE.PlaneGeometry(1,1);
const caps=MEDIA.map((im,i)=>{
  const g=gridBox[i], capH=g.w*(260/1024);
  const mat=new THREE.MeshBasicMaterial({map:makeCaptionTex(im.title,im.category,CFG.grid.capSize),transparent:true,opacity:0,depthTest:false});
  const m=new THREE.Mesh(capGeo,mat);
  m.scale.set(g.w,capH,1); m.position.set(g.cx, g.cy - g.h/2 - GRID_CAP*0.45, 0.02); m.visible=false; m.renderOrder=5;
  scene.add(m); return m;
});
function redrawGridCaps(){ caps.forEach((c,i)=>{ const o=c.material.map; c.material.map=makeCaptionTex(MEDIA[i].title,MEDIA[i].category,CFG.grid.capSize); c.material.needsUpdate=true; if(o)o.dispose(); }); }
/* sphere hover label: one plane that shows the hovered project's caption under the image (warps with the globe) */
const hoverCap=new THREE.Mesh(capGeo, new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthTest:false}));
hoverCap.renderOrder=6; hoverCap.visible=false; scene.add(hoverCap);
let hoverCapIdx=-1;
/* redraw caption textures once Helveticaneue Light has actually loaded (canvas uses fallback until then) */
if(document.fonts&&document.fonts.load){
  document.fonts.load('300 27px "Helveticaneue Light"').catch(()=>{}).then(()=>document.fonts.ready).then(()=>{ redrawGridCaps(); hoverCapIdx=-1; });
}
const introDelays=meshes.map((_,s)=>rand(s,99)*INTRO_WINDOW);

/* ---- post-process: ONE pass (globe → blur + RGB split → sRGB → hover lens), see post.js ---- */
const velWorld=new THREE.Vector2();
const post=createPost(renderer,BLUR_TAPS);
post.u.uGlobe.value=GLOBE_STRENGTH; post.setSize(innerWidth,innerHeight);
const zMouse={x:-10,y:-10}, zFollow={x:-10,y:-10}, zPrev={x:-10,y:-10}; let zSpeed=0, zSeen=false; const zDir={x:0,y:0};
on(window,"pointermove",e=>{ if(e.pointerType!=="mouse") return;
  zMouse.x=e.clientX/innerWidth; zMouse.y=1-e.clientY/innerHeight;
  if(!zSeen){ zSeen=true; zFollow.x=zPrev.x=zMouse.x; zFollow.y=zPrev.y=zMouse.y; } });

/* ---- input + hover + focus ---- */
const target={x:0,y:0,z:START_Z}, cur={x:0,y:0,z:START_Z}, prev={x:0,y:0}, vel={x:0,y:0};
const smooth=e=>e*e*(3-2*e);
const sstep=(x,a,b)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};   // smoothstep over [a,b]
function startTransition(toFinite, finiteToFinite){   // camera + layout morph move in lockstep -> seamless
  const fromSphere = gridMix<0.5;
  const old = dispBox.map(d=>({x:d.x+gOff.x, y:d.y+gOff.y, w:d.w, h:d.h}));   // current displayed world positions
  if(!toFinite && layoutMode==='grid') savedScroll=cur.y-gOff.y;              // remember grid scroll for later return

  if(toFinite){
    const g=computeFinite();                            // rebuild the active finite layout (grid or reel)
    for(let i=0;i<N;i++){ gridBox[i].w=g[i].w; gridBox[i].h=g[i].h; gridBox[i].cx=g[i].cx; gridBox[i].cy=g[i].cy; }
    gridBottom=gBottom();
    // find the nearest LINKED card to screen-centre now, to land on it
    let best=FITEMS.length?FITEMS[0]:0, bd=Infinity;
    for(const i of FITEMS){ const p=primaryMesh[i].position, d=Math.hypot(p.x-cur.x,p.y-cur.y); if(d<bd){bd=d;best=i;} }
    if(layoutMode==='reel'){
      reelIndex = savedReel!=null ? clamp(savedReel,0,reelMax()) : (RANK[best]||0);   // return to where we left the reel (rank)
      gOff.x=cur.x; gOff.y=cur.y + reelIndex*reelStride();              // anchor that card under the camera -> no fly/lurch
    }
    else { const s = savedScroll!=null ? clamp(savedScroll,scrollMin,scrollMax) : clamp(gridBox[best].cy,scrollMin,scrollMax); gOff.x=cur.x; gOff.y=cur.y-s; }
    recalcGrid();                                       // gridZ / scroll clamps for the new layout + offset
    if(fromSphere){ for(let i=0;i<N;i++){ dispBox[i].x=gridBox[i].cx; dispBox[i].y=gridBox[i].cy; dispBox[i].w=gridBox[i].w; dispBox[i].h=gridBox[i].h; } }  // snap -> clean sphere morph
    else { for(let i=0;i<N;i++){ dispBox[i].x=old[i].x-gOff.x; dispBox[i].y=old[i].y-gOff.y; dispBox[i].w=old[i].w; dispBox[i].h=old[i].h; } }              // keep continuity -> grid<->reel morph
    if(layoutMode==='reel') updateReelInfo(FITEMS[reelIndex]);
  } else recalcGrid();

  const to = toFinite
    ? (layoutMode==='reel' ? {x:gOff.x, y:reelSlotY(reelIndex), z:gridZ} : {x:cur.x, y:cur.y, z:gridZ})
    : {x:cur.x, y:cur.y, z:START_Z};                    // sphere: keep position, only zoom out
  const dist=Math.hypot(cur.x-to.x,cur.y-to.y)+Math.abs(cur.z-to.z);
  const dur=clamp(TRANS_DUR*(dist/14), TRANS_DUR*0.85, TRANS_DUR*1.9);
  const keepMix = toFinite && finiteToFinite && gridMix>0.5;   // finite<->finite: don't dip through sphere
  trans={ t:0, dur, from:{x:cur.x,y:cur.y,z:cur.z}, to, toGrid:toFinite, keepMix };
  target.x=to.x; target.y=to.y; target.z=to.z; vel.x=vel.y=0;
}
viewReady=true; recalcGrid();
if(gridTargetMix>0.5){ gridMix=1; target.x=0; target.y=sHi(); cur.y=sHi(); target.z=gridZ; cur.z=gridZ; }   // honour data-view="grid" default
const keys=new Set();
const worldPerPixel=()=>(2*Math.tan(camera.fov*Math.PI/360)*target.z)/Math.max(1,innerHeight);  // guard: innerHeight can momentarily be 0
const pointers=new Map(); let dragging=false,lastX=0,lastY=0,pinchPrev=0,moved=false,downX=0,downY=0,activeId=null;
const raycaster=new THREE.Raycaster(), ndc=new THREE.Vector2();
let hoveredMesh=null, focus=null;
const v3a=new THREE.Vector3(), v3b=new THREE.Vector3();
function pick(cx,cy){ ndc.set((cx/innerWidth)*2-1,-(cy/innerHeight)*2+1); raycaster.setFromCamera(ndc,camera); const hits=raycaster.intersectObjects(meshes,false); return hits.length?hits[0].object:null; }
function showButton(mesh){ const item=MEDIA[mesh.userData.item]; if(item&&item.link){ projectBtn.href=item.link; projectBtn.textContent=item.button||'View Project'; projectBtn.classList.add('show'); } else projectBtn.classList.remove('show'); }
function focusOn(mesh){ if(focus)return; focus={mesh,dir:'in',op:0}; hoveredMesh=null; vel.x=vel.y=0; showButton(mesh); }
function closeFocus(){ if(focus&&focus.dir==='in'){ focus.dir='out'; focus.op=0; projectBtn.classList.remove('show'); } }
function resetDrag(){ dragging=false; if(activeId!=null){try{app.releasePointerCapture(activeId);}catch(_){} activeId=null;} pointers.clear(); pinchPrev=0; app.style.cursor="grab"; }
const dist2=()=>{const p=[...pointers.values()];return Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);};

on(app,"pointerdown",e=>{
  moved=false; downX=e.clientX; downY=e.clientY;
  if(focus||trans) return;
  try{app.setPointerCapture(e.pointerId);}catch(_){} activeId=e.pointerId;
  pointers.set(e.pointerId,{x:e.clientX,y:e.clientY}); app.style.cursor="grabbing";
  if(pointers.size===1){dragging=true;lastX=e.clientX;lastY=e.clientY;vel.x=vel.y=0;}else if(pointers.size===2){dragging=false;pinchPrev=dist2();}
});
on(app,"pointermove",e=>{
  if(focus)return;
  if(pointers.has(e.pointerId)){
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===2){ if(!gridActive()){const d=dist2();target.z=clamp(target.z-(d-pinchPrev)*0.03,MIN_Z,MAX_Z);pinchPrev=d;} return;}
    if(dragging){
      if(Math.hypot(e.clientX-downX,e.clientY-downY)>4)moved=true;
      let pdx=e.clientX-lastX, pdy=e.clientY-lastY;
      const pmag=Math.hypot(pdx,pdy); if(pmag>1e-6){const s=1/(1+DRAG_CURVE*pmag);pdx*=s;pdy*=s;}
      const k=worldPerPixel()*DRAG_SENSITIVITY; let wdx=pdx*k, wdy=pdy*k;
      if(gridActive()){ wdx=0; target.y+=wdy; target.y=clamp(target.y,sLo(),sHi()); target.x=gOff.x; vel.x=0; vel.y=wdy;
        if(layoutMode==='reel'){ const idx=clamp(Math.round((gOff.y-target.y)/reelStride()),0,reelMax()); if(idx!==reelIndex){reelIndex=idx;updateReelInfo(FITEMS[reelIndex]);} } }
      else { target.x-=wdx;target.y+=wdy;vel.x=-wdx;vel.y=wdy; }
      lastX=e.clientX;lastY=e.clientY;return;
    }
  }
  if(CAN_HOVER){ hoveredMesh=pick(e.clientX,e.clientY);
    app.style.cursor = (!hoveredMesh||focus) ? "grab" : (gridActive() ? "pointer" : PLUS_CURSOR); }
});
function onUp(e){
  const wasTap=!moved;
  pointers.delete(e.pointerId);
  if(activeId===e.pointerId){try{app.releasePointerCapture(e.pointerId);}catch(_){} activeId=null;}
  if(pointers.size<2)pinchPrev=0; if(pointers.size===0){dragging=false;app.style.cursor="grab";}
  if(!focus && !trans && gridActive() && layoutMode==='reel'){        // reel: snap to nearest card on release
    reelIndex=clamp(Math.round((gOff.y-target.y)/reelStride()),0,reelMax());
    target.y=reelSlotY(reelIndex); updateReelInfo(FITEMS[reelIndex]);
  }
  if(focus){ if(wasTap) closeFocus(); return; }
  if(wasTap && !trans){
    const m=pick(e.clientX,e.clientY); if(!m) return;
    if(gridActive()){ const it=MEDIA[m.userData.item]; if(it&&it.link) window.open(it.link,'_blank','noopener'); }  // grid: cards are links (no popup)
    else focusOn(m);                                                                                                 // sphere: click-to-focus
  }
}
on(app,"pointerup",onUp);
on(app,"pointercancel",resetDrag);
on(app,"pointerleave",resetDrag);
on(app,"lostpointercapture",resetDrag);
on(window,"blur",resetDrag);
on(document,"visibilitychange",()=>{ if(document.hidden){ resetDrag(); videoState.forEach(vs=>vs&&vs.v.pause()); } });
// a tap/click may unblock autoplay: call play() INSIDE the gesture (iOS requires it; pointerdown isn't an activation)
const retryBlocked=()=>videoState.forEach(vs=>{ if(vs && vs.blocked){ vs.blocked=false; tryPlay(vs); } });
on(window,"pointerup",retryBlocked,{capture:true}); on(window,"touchend",retryBlocked,{capture:true});
on(app,"wheel",e=>{e.preventDefault();if(focus||trans)return;
  if(gridActive() && layoutMode==='reel'){                 // reel: free scroll, speed = scroll x sensitivity, magnetic snap on stop
    const k=0.03*clamp(CFG.reel.scroll,0.05,4);
    target.y=clamp(target.y - e.deltaY*k, sLo(), sHi());
    const idx=clamp(Math.round((gOff.y-target.y)/reelStride()),0,reelMax());
    if(idx!==reelIndex){ reelIndex=idx; updateReelInfo(FITEMS[reelIndex]); }   // live info as you pass each card
    clearTimeout(reelSnapT);
    reelSnapT=setTimeout(()=>{ if(layoutMode!=='reel')return; reelIndex=clamp(Math.round((gOff.y-target.y)/reelStride()),0,reelMax()); target.y=reelSlotY(reelIndex); updateReelInfo(FITEMS[reelIndex]); },110);
  }
  else if(gridActive()){ target.y=clamp(target.y - e.deltaY*0.012, sLo(), sHi()); }
  else if(e.ctrlKey||e.metaKey){ target.z=clamp(target.z+e.deltaY*0.02,MIN_Z,MAX_Z); }   // ⌘/ctrl + wheel = zoom
  else { const k=worldPerPixel(); target.x+=e.deltaX*k*CFG.sphere.wheelX; target.y-=e.deltaY*k*CFG.sphere.wheelY; }   // wheel / trackpad = pan the sphere (per-axis speed)
},{passive:false});
on(window,"keydown",e=>{const k=e.key.toLowerCase();
  if(gridActive()&&layoutMode==='reel'&&!trans&&["arrowup","arrowdown","w","s"].includes(k)){ e.preventDefault();
    reelIndex=clamp(reelIndex+((k==='arrowdown'||k==='s')?1:-1),0,reelMax()); target.y=reelSlotY(reelIndex); updateReelInfo(FITEMS[reelIndex]); return; }
  if(["arrowup","arrowdown","arrowleft","arrowright","w","a","s","d"].includes(k)){keys.add(k);e.preventDefault();}});
on(window,"keyup",e=>keys.delete(e.key.toLowerCase()));
on(window,"resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);post.setSize(innerWidth,innerHeight);recalcGrid();
  if(gridActive()){ target.z=gridZ; if(layoutMode==='reel'){ target.y=reelSlotY(reelIndex); } else { if(!isFinite(target.y))target.y=sHi(); target.y=clamp(target.y,sLo(),sHi()); } if(!isFinite(cur.y))cur.y=target.y; if(!isFinite(cur.z))cur.z=gridZ; }});
["gesturestart","gesturechange","gestureend"].forEach(t=>on(document,t,e=>e.preventDefault(),{passive:false}));
on(document,"dblclick",e=>e.preventDefault());

/* ---- frame loop ---- */
let waveTime=FREEZE?100:0, lastT=0, rafId=0, destroyed=false, frameNow=0, frameCount=0;   // FREEZE: intro already finished
function frame(now){
  if(destroyed) return;
  if(isPaused()){ rafId=0; lastT=0; return; }          // stopped; resumeLoop() restarts it (dt resets, no jump)
  frameNow=now; frameCount++;
  if(needsRelayout){ needsRelayout=false; relayoutSphere(); relayoutGrid(); }
  if(!FREEZE && lastT) adaptQuality(now, now-lastT);
  for(const vs of videoState){ if(!vs) continue;      // only videos drawn in the last second keep decoding
    const want = now-vs.drawnAt<1000 && !document.hidden;
    if(want && vs.v.paused && !vs.blocked) tryPlay(vs);
    else if(!want && !vs.v.paused) vs.v.pause();
  }
  if(!lastT)lastT=now; const dt=FREEZE?1/60:Math.min((now-lastT)/1000,0.05); lastT=now; waveTime+=dt;
  const DMP=CFG.shared.damping, FRI=CFG.shared.friction;

  if(trans){                                            // grid<->sphere morph: drive camera + mix from one eased value
    trans.t=Math.min(1, trans.t + dt/trans.dur); const e=smooth(trans.t);
    cur.x=trans.from.x+(trans.to.x-trans.from.x)*e;
    cur.y=trans.from.y+(trans.to.y-trans.from.y)*e;
    cur.z=trans.from.z+(trans.to.z-trans.from.z)*e;
    gridMix = trans.keepMix ? gridMix : (trans.toGrid ? e : 1-e);   // finite<->finite keeps full morph
    if(trans.t>=1) trans=null;
  } else if(!focus){
    const step=KEY_SPEED*(target.z/START_Z);
    if(keys.has("arrowleft")||keys.has("a"))target.x-=step;
    if(keys.has("arrowright")||keys.has("d"))target.x+=step;
    if(keys.has("arrowup")||keys.has("w"))target.y+=step;
    if(keys.has("arrowdown")||keys.has("s"))target.y-=step;
    if(Math.abs(vel.x)>1e-4||Math.abs(vel.y)>1e-4){target.x+=vel.x;target.y+=vel.y;vel.x*=FRI;vel.y*=FRI;}
    if(gridTargetMix>0.5){ target.x+=(gOff.x-target.x)*0.3; target.y=clamp(target.y,sLo(),sHi()); }
    let dx=(target.x-cur.x)*DMP, dy=(target.y-cur.y)*DMP;
    const sp=Math.hypot(dx,dy); if(sp>MAX_SPEED){const s=MAX_SPEED/sp; dx*=s; dy*=s;}
    cur.x+=dx; cur.y+=dy; cur.z+=(target.z-cur.z)*DMP;
    gridMix += (gridTargetMix - gridMix)*GLOBE_LERP;
  }
  camera.position.set(cur.x,cur.y,cur.z); camera.lookAt(cur.x,cur.y,0);

  velWorld.set(cur.x-prev.x,cur.y-prev.y); prev.x=cur.x; prev.y=cur.y;
  const worldH=2*Math.tan(camera.fov*Math.PI/360)*cur.z, worldW=worldH*(innerWidth/innerHeight);
  const inGrid = gridTargetMix>0.5;
  const FX = inGrid ? (layoutMode==='reel'?CFG.reel:CFG.grid) : CFG.sphere;   // active view's effect set
  post.u.uVel.value.set(velWorld.x/worldW, velWorld.y/worldH);
  post.u.uBlur.value=FX.blur*reduceFactor;
  post.u.uAberr.value=FX.aberr*reduceFactor;   // RGB split shares the same velocity
  { const k=Math.max(dt*60,1e-3), a=1-Math.pow(0.9,k);   // hover zoom: same constants as the demo, normalised to 60fps
    const sp=Math.hypot(zPrev.x-zMouse.x,zPrev.y-zMouse.y)/k;
    zDir.x-=a*(zDir.x-(zMouse.x-zPrev.x)/k); zDir.y-=a*(zDir.y-(zMouse.y-zPrev.y)/k);
    zSpeed-=a*(zSpeed-sp); zFollow.x-=a*(zFollow.x-zMouse.x); zFollow.y-=a*(zFollow.y-zMouse.y);
    zPrev.x=zMouse.x; zPrev.y=zMouse.y;
    const zu=post.u; zu.uMouse.value.set(zFollow.x,zFollow.y); zu.uVelo.value=Math.min(zSpeed,0.05); zSpeed*=Math.pow(0.999,k);
    zu.uDir.value.set(zDir.x,zDir.y*innerHeight/Math.max(1,innerWidth));
    const fz = layoutMode==='reel'?CFG.reel:CFG.grid;
    zu.uSplit.value=CFG.sphere.zoomRgb+(fz.zoomRgb-CFG.sphere.zoomRgb)*gridMix;
    zu.uZoom.value=CAN_HOVER ? (CFG.sphere.zoom+(fz.zoom-CFG.sphere.zoom)*gridMix)*reduceFactor : 0; }
  let gTarget;
  if(focus){ gTarget=0; }
  else {                                                 // blend sphere curve <-> finite scroll-curve by the morph amount
    const sv=Math.abs(velWorld.y)/Math.max(1e-3,worldH);
    const fCurve = layoutMode==='reel'
      ? CFG.reel.curve + Math.min(0.3, sv*4)
      : CFG.grid.curveRest + Math.min(CFG.grid.curveMax, sv*CFG.grid.curveGain);
    gTarget = CFG.sphere.globe + (fCurve - CFG.sphere.globe)*gridMix;
  }
  post.u.uGlobe.value += (gTarget - post.u.uGlobe.value)*GLOBE_LERP;

  for(let i=0;i<N;i++){ const db=dispBox[i], g=gridBox[i], r=0.16;   // ease displayed layout -> active layout (grid<->reel morph)
    db.x+=(g.cx-db.x)*r; db.y+=(g.cy-db.y)*r; db.w+=(g.w-db.w)*r; db.h+=(g.h-db.h)*r; }

  const cTX=Math.round(cur.x/tileW), cTY=Math.round(cur.y/tileH);
  let slot=0;
  for(let b=0;b<tilesY;b++)for(let a=0;a<tilesX;a++){
    const baseX=(cTX+a-halfTX)*tileW, baseY=(cTY+b-halfTY)*tileH;
    for(let c=0;c<CELLS;c++,slot++){
      const i=c%N;
      if(focus&&meshes[slot]===focus.mesh)continue;
      const m=meshes[slot];
      const local=Math.max(0,Math.min(1,(waveTime-introDelays[slot])/INTRO_DURATION));
      const eased=1-Math.pow(1-local,3); m.userData.intro=eased;
      const introZ=INTRO_DISTANCE*(1-eased);
      const dnorm=boxes[c].z/Z_JITTER;
      const f=clamp(DMP*(1+ZOOM_STAGGER*dnorm),0.001,1);
      const zf=m.userData.zfollow+(cur.z-m.userData.zfollow)*f; m.userData.zfollow=zf;
      const depthZ=dnorm*ZOOM_DEPTH_STRENGTH*(START_Z-zf);
      const pf=boxes[c].z*CFG.sphere.parallax;
      const sx=baseX+boxes[c].cx - velWorld.x*pf, sy=baseY+boxes[c].cy - velWorld.y*pf, sz=boxes[c].z + depthZ - introZ;
      const inGridNow = m.userData.primary && GRIDVIS[i];   // this mesh becomes a grid/reel card (linked items only)
      if(inGridNow && gridMix>0.001){
        const g=dispBox[i], gx=g.x+gOff.x, gy=g.y+gOff.y;
        m.position.set(sx+(gx-sx)*gridMix, sy+(gy-sy)*gridMix, sz*(1-gridMix));
        m.scale.set(boxes[c].w+(g.w-boxes[c].w)*gridMix, boxes[c].h+(g.h-boxes[c].h)*gridMix, 1);
        m.userData.dupFade=1; m.visible=true;
      } else {
        m.position.set(sx,sy,sz);
        if(inGridNow){ m.userData.dupFade=1; m.visible=true; }   // eligible primary while in sphere
        else { m.scale.set(boxes[c].w,boxes[c].h,1); m.userData.dupFade=1-sstep(gridMix,0,0.4); m.visible=gridMix<0.99; }  // duplicates + non-linked items fade out in grid/reel
      }
    }
  }
  const capReel = layoutMode==='reel';   // reel uses the DOM #reelInfo overlay instead of WebGL captions
  for(let i=0;i<N;i++){ const c=caps[i], g=dispBox[i];
    c.scale.set(g.w, g.w*(260/1024), 1);
    c.position.set(g.x+gOff.x, g.y-g.h/2-CFG.grid.capGap+gOff.y, 0.02);
    c.material.opacity=(capReel||!GRIDVIS[i])?0:sstep(gridMix,0.45,1)*(primaryMesh[i]?primaryMesh[i].userData.intro:1);
    c.visible=!capReel && GRIDVIS[i] && gridMix>0.02; }

  for(const m of meshes){
    let tOp=1;
    if(focus) tOp = (m===focus.mesh)?1:FOCUS_DIM;
    m.userData.op += (tOp - m.userData.op)*OPACITY_LERP;
  }

  // sphere hover label: show the hovered project's title/category under the image
  if(gridMix<0.5 && hoveredMesh && !focus){
    const i=hoveredMesh.userData.item;
    if(i!==hoverCapIdx){ hoverCapIdx=i; const o=hoverCap.material.map; hoverCap.material.map=makeCaptionTex(MEDIA[i].title,'',CFG.sphere.capSize); hoverCap.material.needsUpdate=true; if(o)o.dispose(); }   // sphere label: title only (no category)
    const w=hoveredMesh.scale.x, h=hoveredMesh.scale.y, capH=w*(260/1024);
    hoverCap.scale.set(w,capH,1);    // plane = image width -> label stays within the image; size comes from the text
    hoverCap.position.set(hoveredMesh.position.x, (hoveredMesh.position.y - h/2 - CFG.sphere.capGap) - capH/2, hoveredMesh.position.z+0.03);
    hoverCap.visible=true; hoverCap.material.opacity += (1-hoverCap.material.opacity)*0.25;
  } else {
    hoverCap.material.opacity += (0-hoverCap.material.opacity)*0.25;
    if(hoverCap.material.opacity<0.01){ hoverCap.visible=false; hoverCapIdx=-1; }
  }

  if(focus){
    const m=focus.mesh, i=m.userData.item, bc=boxes[m.userData.cell], ar=bc.w/bc.h;
    const d=FOCUS_DISTANCE, visH=2*Math.tan(camera.fov*Math.PI/360)*d, visW=visH*(innerWidth/innerHeight);
    const fillH=Math.min(visH*(1-FOCUS_MARGIN), visW*(1-FOCUS_MARGIN)/ar);
    let tp,ts;
    if(focus.dir==='in'){ tp=v3a.set(cur.x,cur.y,cur.z-d); ts=v3b.set(fillH*ar,fillH,1); }
    else if(gridMix>0.5 && m.userData.primary){
      const g=dispBox[i]; tp=v3a.set(g.x+gOff.x,g.y+gOff.y,0); ts=v3b.set(g.w,g.h,1);
    }
    else {
      const tileSlot=Math.floor(m.userData.slot/CELLS), a=tileSlot%tilesX, b=Math.floor(tileSlot/tilesX);
      const baseX=(cTX+a-halfTX)*tileW, baseY=(cTY+b-halfTY)*tileH;
      tp=v3a.set(baseX+bc.cx, baseY+bc.cy, bc.z); ts=v3b.set(bc.w,bc.h,1);
    }
    m.position.lerp(tp,FOCUS_LERP); m.scale.lerp(ts,FOCUS_LERP); m.renderOrder=10;
    m.userData.intro=1;
    focus.op += (1-focus.op)*OPEN_LERP; m.userData.open=focus.op;
    if(focus.dir==='out'&&m.position.distanceTo(tp)<0.03&&focus.op>0.9){ m.userData.open=1; m.renderOrder=0; focus=null; }
  }

  post.render(scene,camera);
  if(!FREEZE) rafId=requestAnimationFrame(frame);
}
/* adaptive quality: judged on the last 2 s of frames (>= 6 frames spanning >= 1 s), every 0.5 s, max one step/s:
   p95 frame time > 20 ms -> pixel ratio -0.25 (floor 1); 5 s with p95 < 12 ms -> +0.25 (never above START_DPR). */
const qTimes=[]; let qLastChange=0, qLastEval=0;
function applyPixelRatio(pr){ renderer.setPixelRatio(pr); renderer.setSize(innerWidth,innerHeight); post.setSize(innerWidth,innerHeight); }
function adaptQuality(now, dt){
  qTimes.push(now, dt); while(qTimes.length && now-qTimes[0]>2000) qTimes.splice(0,2);
  if(now-qLastEval<500 || now-qLastChange<1000) return;
  if(qTimes.length<12 || now-qTimes[0]<1000) return;      // >= 6 frames over >= 1 s (very slow devices must adapt too)
  qLastEval=now;
  const d=[]; for(let i=1;i<qTimes.length;i+=2) d.push(qTimes[i]); d.sort((a,b)=>a-b);
  const p95=d[Math.floor(d.length*0.95)], pr=renderer.getPixelRatio();
  if(p95>20 && pr>1){ applyPixelRatio(Math.max(1,pr-0.25)); qLastChange=now; qTimes.length=0; }
  else if(p95<12 && pr<START_DPR && now-qLastChange>5000){ applyPixelRatio(Math.min(START_DPR,pr+0.25)); qLastChange=now; qTimes.length=0; }
}

/* pause while a Webflow overlay covers the page (<html data-canvas-pause>, e.g. toggled by the menu) or the tab is hidden */
let contextLost=false, lostTimer=0;
function isPaused(){ return contextLost || document.hidden || document.documentElement.hasAttribute('data-canvas-pause'); }
on(renderer.domElement,"webglcontextlost",e=>{ e.preventDefault(); contextLost=true;      // GPU reset: wait for restore
  lostTimer=setTimeout(()=>document.documentElement.classList.add('jb-canvas-fallback'),3000); });
on(renderer.domElement,"webglcontextrestored",()=>{ contextLost=false; clearTimeout(lostTimer);   // three re-uploads resources lazily
  document.documentElement.classList.remove('jb-canvas-fallback'); resumeLoop(); });
function resumeLoop(){ if(!FREEZE && !destroyed && !rafId && !isPaused()) rafId=requestAnimationFrame(frame); }
const pauseObserver=new MutationObserver(resumeLoop);
pauseObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-canvas-pause']});
on(document,"visibilitychange",resumeLoop);
if(FREEZE) window.__step=(n=1)=>{ for(let i=0;i<n;i++) frame(performance.now()); };   // test-only: advance n fixed frames
else rafId=requestAnimationFrame(frame);

if(DEBUG||FREEZE) window.__ic={cur,target,velWorld,count,N,cells:CELLS,media:MEDIA,textures,videoState,frames:()=>frameCount,
  pixelRatio:()=>renderer.getPixelRatio(),tileW,tileH,tilesX,tilesY,boxes,meshes,
  ready:()=>loaded>=MEDIA.filter(m=>!m.video).length,   // all image textures loaded
  pick,focusAt:(x,y)=>{const m=pick(x,y);if(m)focusOn(m);return m?m.userData.slot:null;},close:()=>closeFocus(),
  hold:()=>{if(focus)focus.dir='in';},focusInfo:()=>focus?{slot:focus.mesh.userData.slot,dir:focus.dir}:null,
  btnShown:()=>projectBtn.classList.contains('show'), btnHref:()=>projectBtn.getAttribute('href'),
  getGlobe:()=>post.u.uGlobe.value, aberration:()=>post.u.uAberr.value,
  zoom:()=>{const u=post.u;return {velo:u.uVelo.value,strength:u.uZoom.value,mouse:[u.uMouse.value.x,u.uMouse.value.y]};},
  reel:()=>({layout:layoutMode, index:reelIndex, z:+gridZ.toFixed(2), stride:+reelStride().toFixed(2)})};

/* ---- public API (Webflow / page transitions / dev panel) ---- */
window.JB_CANVAS={
  CFG,
  view:()=>currentView,
  relayout(view){ if(view==='sphere') relayoutSphere(); else relayoutGrid(); },
  refreshCaptions(view){ if(view==='grid') redrawGridCaps(); else hoverCapIdx=-1; },
  refreshReelInfo(){ const el=document.getElementById('reelInfo'); el.style.setProperty('--rt',CFG.reel.titleSize); el.style.setProperty('--rm',CFG.reel.metaSize); el.style.setProperty('--iy',CFG.reel.infoY); },
  destroy(){
    if(destroyed) return; destroyed=true;
    cancelAnimationFrame(rafId); lifetime.abort(); pauseObserver.disconnect();
    textures.forEach(t=>{ if(t.image&&t.image.pause) t.image.pause(); t.dispose(); });
    materials.forEach(m=>m.dispose()); caps.forEach(c=>{ c.material.map&&c.material.map.dispose(); c.material.dispose(); });
    post.dispose(); renderer.dispose(); renderer.domElement.remove();
    window.setCanvasView=()=>{};
  },
};
JB_CANVAS.refreshReelInfo();                           // apply CFG.reel title/meta size + text position at load
if(DEBUG) import('./dev-panel.js');

