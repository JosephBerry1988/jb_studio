{\rtf1\ansi\ansicpg1252\cocoartf2870
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fmodern\fcharset0 Courier;}
{\colortbl;\red255\green255\blue255;\red255\green255\blue255;}
{\*\expandedcolortbl;;\cssrgb\c100000\c100000\c100000;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\deftab720
\pard\pardeftab720\partightenfactor0

\f0\fs26 \cf2 \expnd0\expndtw0\kerning0
\outl0\strokewidth0 \strokec2 /* \uc0\u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \
   JB Studio \'97 project page WebGL FX\
   Same look as the homepage canvas: hover zoom lens (Codrops "webgl-mouseover-effects"\
   demo 3) + hover RGB split, and scroll-speed motion blur + RGB split.\
\
   How it works: the gallery images/videos are redrawn in ONE fixed WebGL layer that reads\
   each card's live DOM position every frame (so Lenis, the img-scroll parallax and the\
   click-to-fullscreen interaction are all followed automatically). The real <img>/<video>\
   stay in the page for layout + clicks and are only made invisible once their WebGL copy\
   is ready. If WebGL or a texture fails, that card simply stays as normal HTML.\
\
   Install (Webflow page settings \uc0\u8594  Before </body>):\
     <script src="https://YOUR-HOST/project-fx.js" defer></script>\
   Optional overrides BEFORE that tag:  <script>window.JB_FX=\{hoverZoom:1, ...\}</script>\
   Tune live: open the page with ?fx-debug \uc0\u8594  controls panel \u8594  "Copy values".\
   \uc0\u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552 \u9552  */\
(function () \{\
  "use strict";\
  if (window.__jbfx) return;\
  window.__jbfx = true;\
\
  const CFG = Object.assign(\{\
    // defaults = the homepage GRID view (demo.html CFG.grid) so both pages feel identical\
    hoverZoom: 0.4,     // Codrops zoom lens strength (1 = exact demo, 0 = off)\
    hoverRgb: 3.0,      // RGB split inside the lens, along the mouse's travel\
    scrollBlur: 0.5,    // motion blur from scroll speed\
    scrollRgb: 0.5,     // RGB split from scroll speed\
    curveRest: 0.04,    // lens bend at rest\
    curveGain: 5.0,     // extra bend per unit of scroll speed\
    curveMax: 0.52,     // bend cap\
    minWidth: 900,      // below this width the page stays plain HTML\
    cards: ".img-parent.project",\
    media: ".img-scroll img, .img-scroll video",\
    clip: ".img-child",\
  \}, window.JB_FX || \{\});\
\
  const DEBUG = /[?&]fx-debug/.test(location.search);\
  const FINE = matchMedia("(hover: hover) and (pointer: fine)").matches;\
  if (!FINE && !DEBUG) return;                       // touch devices keep the plain page\
  const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0.15 : 1;\
  const TAPS = 9;\
\
  /* videos must be CORS-enabled before they load, or WebGL can't read them */\
  function prepVideos() \{\
    document.querySelectorAll(CFG.cards).forEach((card) => card.querySelectorAll("video").forEach((v) => \{\
      if (v.crossOrigin === "anonymous") return;\
      const loaded = !!(v.currentSrc || v.getAttribute("src"));\
      v.crossOrigin = "anonymous";\
      if (loaded) \{ v.load(); v.play().catch(() => \{\}); \}\
    \}));\
  \}\
  prepVideos();\
\
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);\
  else init();\
\
  function init() \{\
    prepVideos();\
    const viewW = () => document.documentElement.clientWidth;\
    const viewH = () => document.documentElement.clientHeight;\
\
    /* ---- canvas + GL ---- */\
    const canvas = document.createElement("canvas");\
    canvas.setAttribute("aria-hidden", "true");\
    canvas.className = "jbfx-canvas";\
    canvas.style.cssText = "position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:1;";\
    const css = document.createElement("style");\
    css.textContent = ".jbfx-hide\{opacity:0!important\}";\
    const opts = \{ alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false \};\
    let gl = canvas.getContext("webgl2", opts);\
    const GL2 = !!gl;\
    if (!gl) gl = canvas.getContext("webgl", opts);\
    if (!gl) return;                                  // no WebGL: page stays as-is\
    document.head.appendChild(css);\
    document.body.insertBefore(canvas, document.body.firstChild);   // z-index 1, first in DOM \uc0\u8594  card borders/icons (z1, later) stay on top\
\
    function compile(type, src) \{\
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);\
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));\
      return s;\
    \}\
    function program(vs, fs) \{\
      const p = gl.createProgram();\
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));\
      gl.bindAttribLocation(p, 0, "aPos"); gl.linkProgram(p);\
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));\
      const u = \{\}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);\
      for (let i = 0; i < n; i++) \{ const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); \}\
      return \{ p, u \};\
    \}\
\
    /* one textured card: positioned in CSS px, object-fit:cover via uUv (scale.xy, offset.zw) */\
    const sceneProg = program(`\
      attribute vec2 aPos; uniform vec4 uRect; uniform vec2 uView; uniform vec4 uUv; varying vec2 vUv;\
      void main()\{ vec2 px=uRect.xy+aPos*uRect.zw;\
        gl_Position=vec4(px.x/uView.x*2.0-1.0, 1.0-px.y/uView.y*2.0, 0.0, 1.0); vUv=aPos*uUv.xy+uUv.zw; \}`, `\
      precision mediump float; uniform sampler2D uTex; varying vec2 vUv;\
      void main()\{ gl_FragColor=vec4(texture2D(uTex,vUv).rgb,1.0); \}`);\
\
    /* final pass: scroll motion blur + RGB split, then the Codrops hover zoom lens + hover RGB split */\
    const finalProg = program(`\
      attribute vec2 aPos; varying vec2 vUv;\
      void main()\{ vUv=aPos; gl_Position=vec4(aPos*2.0-1.0,0.0,1.0); \}`, `\
      precision highp float;\
      uniform sampler2D uScene; uniform vec2 uVel; uniform float uBlur; uniform float uAberr;\
      uniform vec2 uMouse; uniform vec2 uRes; uniform vec2 uDir; uniform float uVelo; uniform float uZoom; uniform float uSplit;\
      uniform float uGlobe; uniform float uGlobeX;\
      varying vec2 vUv;\
      float circle(vec2 uv, vec2 c, float r, float b)\{ uv-=c; uv*=uRes; return smoothstep(r+b, r-b, length(uv)); \}\
      // homepage GlobeDistort (scroll bend), centred on the gallery column\
      vec4 S(vec2 q)\{ vec2 o=vec2(uGlobeX,0.5), c=q-o; return texture2D(uScene, o+c*(1.0-uGlobe*dot(c,c))); \}\
      // homepage blurs in linear light (images decoded to linear, OutputPass re-encodes)\
      vec3 toLin(vec3 c)\{ return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c)); \}\
      vec3 toSRGB(vec3 c)\{ return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(0.0031308, c)); \}\
      void main()\{\
        float c=circle(vUv,uMouse,0.0,0.1+uVelo*2.0)*40.0*uVelo*uZoom;   // Codrops zoom lens\
        vec2 w=mix(vUv,uMouse,c*0.99);\
        vec2 d=length(uDir)>1e-5 ? normalize(uDir) : normalize(vUv-uMouse+1e-6);\
        vec2 hca=d*c*0.008*uSplit;                                         // hover RGB split\
        vec2 v=uVel*uBlur, sca=uVel*uAberr;                                // scroll blur + RGB split\
        vec3 col=vec3(0.0); vec3 al=vec3(0.0);\
        if(length(v)<0.0008 && length(sca)<0.0006)\{\
          vec4 r=S(w+hca), g=S(w), b=S(w-hca);\
          col=toLin(vec3(r.r,g.g,b.b)); al=vec3(r.a,g.a,b.a);\
        \} else \{\
          for(int i=0;i<$\{TAPS\};i++)\{\
            float t=float(i)/float($\{TAPS - 1\})-0.5; vec2 base=w+v*t;\
            vec4 r=S(base+sca+hca), g=S(base), b=S(base-sca-hca);\
            col+=toLin(vec3(r.r,g.g,b.b)); al+=vec3(r.a,g.a,b.a);\
          \}\
          col/=float($\{TAPS\}); al/=float($\{TAPS\});\
        \}\
        col=toSRGB(col);\
        float a=max(al.r,max(al.g,al.b));                                  // keep colour fringes outside card edges\
        gl_FragColor=vec4(min(col*(1.0+c),vec3(a)),a);\
      \}`);\
\
    const quad = gl.createBuffer();\
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);\
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);\
    gl.enableVertexAttribArray(0);\
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);\
\
    /* offscreen scene target */\
    let fbo = null, fboTex = null, W = 0, H = 0, DPR = 1;\
    function resize() \{\
      DPR = Math.min(devicePixelRatio || 1, 2);\
      const w = Math.max(1, Math.round(viewW() * DPR)), h = Math.max(1, Math.round(viewH() * DPR));\
      if (w === W && h === H) return;\
      W = canvas.width = w; H = canvas.height = h;\
      if (fboTex) gl.deleteTexture(fboTex);\
      if (fbo) gl.deleteFramebuffer(fbo);\
      fboTex = gl.createTexture();\
      gl.bindTexture(gl.TEXTURE_2D, fboTex);\
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);\
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);\
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);\
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);\
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);\
      fbo = gl.createFramebuffer();\
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);\
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);\
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);\
    \}\
\
    /* ---- media items ---- */\
    const items = [];\
    document.querySelectorAll(CFG.cards).forEach((card) => card.querySelectorAll(CFG.media).forEach((el) => \{\
      items.push(\{ el, clip: el.closest(CFG.clip) || el.parentElement, isVideo: el.tagName === "VIDEO",\
        tex: null, ready: false, failed: false, loading: false, tw: 1, th: 1, lastT: -1, retried: false \});\
    \}));\
\
    function upload(item, source, mips) \{\
      if (!item.tex) item.tex = gl.createTexture();\
      gl.bindTexture(gl.TEXTURE_2D, item.tex);\
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);\
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);   // throws if CORS-tainted\
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);\
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);\
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);\
      if (mips && GL2) \{ gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); \}\
      else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);\
    \}\
    function markReady(item, w, h) \{ item.tw = w; item.th = h; item.ready = true; if (active) item.el.classList.add("jbfx-hide"); \}\
\
    function trySetup(item) \{\
      if (item.ready || item.failed || item.loading) return;\
      const el = item.el;\
      if (item.isVideo) \{\
        if (el.crossOrigin !== "anonymous") \{ prepVideos(); return; \}\
        if (el.readyState < 2 || !el.videoWidth) return;\
        try \{ upload(item, el, false); markReady(item, el.videoWidth, el.videoHeight); item.lastT = el.currentTime; \}\
        catch (e) \{ item.failed = true; \}\
        return;\
      \}\
      const src = el.currentSrc || el.src;\
      if (!src || !el.complete || !el.naturalWidth) return;          // lazy image not in yet\
      item.loading = true;\
      const im = new Image();\
      im.crossOrigin = "anonymous";\
      im.onload = () => \{\
        item.loading = false;\
        try \{ upload(item, im, true); markReady(item, im.naturalWidth, im.naturalHeight); \}\
        catch (e) \{ item.failed = true; \}\
      \};\
      im.onerror = () => \{                                           // one retry past any non-CORS cached copy\
        if (!item.retried) \{ item.retried = true; im.src = src + (src.includes("?") ? "&" : "?") + "jbfx=1"; \}\
        else \{ item.loading = false; item.failed = true; \}\
      \};\
      im.src = src;\
    \}\
\
    /* object-fit:cover (+ object-position) \uc0\u8594  uv scale/offset */\
    function coverUv(item, rw, rh) \{\
      const pos = getComputedStyle(item.el).objectPosition.split(" ");\
      const px = pos[0] && pos[0].endsWith("%") ? parseFloat(pos[0]) / 100 : 0.5;\
      const py = pos[1] && pos[1].endsWith("%") ? parseFloat(pos[1]) / 100 : 0.5;\
      const ra = rw / rh, ta = item.tw / item.th;\
      if (ta > ra) \{ const s = ra / ta; return [s, 1, (1 - s) * px, 0]; \}\
      const s = ta / ra; return [1, s, 0, (1 - s) * py];\
    \}\
\
    /* ---- enable/disable (small screens, lost context) ---- */\
    let active = true;\
    function setActive(on) \{\
      active = on;\
      canvas.style.display = on ? "" : "none";\
      items.forEach((it) => it.el.classList.toggle("jbfx-hide", on && it.ready));\
    \}\
    const checkWidth = () => setActive(viewW() >= CFG.minWidth && !lost);\
    let lost = false;\
    canvas.addEventListener("webglcontextlost", (e) => \{ e.preventDefault(); lost = true; setActive(false); \});\
    addEventListener("resize", checkWidth);\
    checkWidth();\
\
    /* ---- mouse (hover lens), same constants as the Codrops demo, normalised to 60fps ---- */\
    const mouse = \{ x: -10, y: -10 \}, follow = \{ x: -10, y: -10 \}, prev = \{ x: -10, y: -10 \}, dir = \{ x: 0, y: 0 \};\
    let speed = 0, seen = false;\
    addEventListener("pointermove", (e) => \{\
      if (e.pointerType !== "mouse") return;\
      mouse.x = e.clientX / viewW(); mouse.y = 1 - e.clientY / viewH();\
      if (!seen) \{ seen = true; follow.x = prev.x = mouse.x; follow.y = prev.y = mouse.y; \}\
    \}, \{ passive: true \});\
\
    /* ---- frame ---- */\
    let last = 0, prevScroll = scrollY, scrollVel = 0;\
    const MAX_SCROLL = 0.11;                                         // = homepage MAX_SPEED (1.8 world/frame) at the grid's zoom\
    let globe = CFG.curveRest, globeX = 0.5;\
    const rectOf = (el) => el.getBoundingClientRect();\
    function frame(now) \{\
      requestAnimationFrame(frame);\
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60; last = now;\
      const k = Math.max(dt * 60, 1e-3), a = 1 - Math.pow(0.9, k);\
\
      // hover lens state\
      const sp = Math.hypot(prev.x - mouse.x, prev.y - mouse.y) / k;\
      dir.x -= a * (dir.x - (mouse.x - prev.x) / k); dir.y -= a * (dir.y - (mouse.y - prev.y) / k);\
      speed -= a * (speed - sp); follow.x -= a * (follow.x - mouse.x); follow.y -= a * (follow.y - mouse.y);\
      prev.x = mouse.x; prev.y = mouse.y;\
      const velo = Math.min(speed, 0.05); speed *= Math.pow(0.999, k);\
\
      // scroll speed (screen heights per 60fps frame); same sign convention as the homepage camera\
      let dy = (scrollY - prevScroll) / k; prevScroll = scrollY;\
      if (Math.abs(dy) > viewH()) dy = 0;                           // ignore instant jumps\
      const sv = Math.max(-MAX_SCROLL, Math.min(MAX_SCROLL, -dy / viewH()));   // cap like the homepage's MAX_SPEED\
      scrollVel += (sv - scrollVel) * (1 - Math.pow(0.5, k));     // light smoothing, no one-frame spikes\
      const gT = CFG.curveRest + Math.min(CFG.curveMax, Math.abs(scrollVel) * CFG.curveGain);   // homepage grid curve\
      globe += (gT - globe) * (1 - Math.pow(1 - 0.13, k));          // GLOBE_LERP 0.13, normalised to 60fps\
\
      if (!active) return;\
      items.forEach(trySetup);\
      resize();\
      const vw = viewW(), vh = viewH();\
\
      // pass 1: cards \uc0\u8594  offscreen target\
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);\
      gl.viewport(0, 0, W, H);\
      gl.disable(gl.BLEND);\
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);\
      gl.enable(gl.SCISSOR_TEST);\
      gl.useProgram(sceneProg.p);\
      gl.uniform2f(sceneProg.u.uView, vw, vh);\
      gl.uniform1i(sceneProg.u.uTex, 0);\
      gl.activeTexture(gl.TEXTURE0);\
      let gx0 = Infinity, gx1 = -Infinity;                           // horizontal extent of the visible gallery\
      for (const it of items) \{\
        if (!it.ready) continue;\
        const r = rectOf(it.el);\
        if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;\
        const cr = rectOf(it.clip), sx = it.clip.offsetWidth ? cr.width / it.clip.offsetWidth : 1;\
        const bl = it.clip.clientLeft * sx, bt = it.clip.clientTop * sx;            // stay inside the card border\
        const x0 = Math.max(0, cr.left + bl), y0 = Math.max(0, cr.top + bt);\
        const x1 = Math.min(vw, cr.right - bl), y1 = Math.min(vh, cr.bottom - bt);\
        if (x1 <= x0 || y1 <= y0) continue;\
        gx0 = Math.min(gx0, x0); gx1 = Math.max(gx1, x1);\
        gl.scissor(Math.round(x0 * DPR), Math.round(H - y1 * DPR), Math.round((x1 - x0) * DPR), Math.round((y1 - y0) * DPR));\
        gl.bindTexture(gl.TEXTURE_2D, it.tex);\
        if (it.isVideo && it.el.currentTime !== it.lastT) \{\
          try \{ gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, it.el); it.lastT = it.el.currentTime; \} catch (e) \{\}\
        \}\
        const uv = coverUv(it, r.width, r.height);\
        gl.uniform4f(sceneProg.u.uRect, r.left, r.top, r.width, r.height);\
        gl.uniform4f(sceneProg.u.uUv, uv[0], uv[1], uv[2], uv[3]);\
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);\
      \}\
      gl.disable(gl.SCISSOR_TEST);\
      if (gx1 > gx0) globeX += ((gx0 + gx1) / 2 / vw - globeX) * 0.2;   // bend centred on the gallery (= screen centre in fullscreen)\
\
      // pass 2: effects \uc0\u8594  screen\
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);\
      gl.viewport(0, 0, W, H);\
      gl.clear(gl.COLOR_BUFFER_BIT);\
      gl.useProgram(finalProg.p);\
      const u = finalProg.u;\
      gl.bindTexture(gl.TEXTURE_2D, fboTex);\
      gl.uniform1i(u.uScene, 0);\
      gl.uniform2f(u.uVel, 0, scrollVel);\
      gl.uniform1f(u.uBlur, CFG.scrollBlur * REDUCE);\
      gl.uniform1f(u.uAberr, CFG.scrollRgb * REDUCE);\
      gl.uniform2f(u.uMouse, follow.x, follow.y);\
      gl.uniform2f(u.uRes, 1, vh / vw);\
      gl.uniform2f(u.uDir, dir.x, dir.y * vh / vw);\
      gl.uniform1f(u.uVelo, velo);\
      gl.uniform1f(u.uZoom, (FINE ? CFG.hoverZoom : 0) * REDUCE);\
      gl.uniform1f(u.uSplit, CFG.hoverRgb);\
      gl.uniform1f(u.uGlobe, globe);\
      gl.uniform1f(u.uGlobeX, globeX);\
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);\
    \}\
    requestAnimationFrame(frame);\
\
    window.JB_FX_DEBUG = \{ CFG, items, globe: () => (\{ globe, globeX, scrollVel \}), info: () => items.map((i) => (\{ src: (i.el.currentSrc || "").split("/").pop().slice(0, 40), video: i.isVideo, ready: i.ready, failed: i.failed \})) \};\
    if (DEBUG) panel();\
  \}\
\
  /* ---- ?fx-debug controls panel ---- */\
  function panel() \{\
    const SPEC = [["hoverZoom", "Hover zoom", 0, 2, 0.05], ["hoverRgb", "Hover RGB split", 0, 3, 0.05],\
      ["scrollBlur", "Scroll motion blur", 0, 1.5, 0.05], ["scrollRgb", "Scroll RGB split", 0, 1.5, 0.05],\
      ["curveRest", "Curve at rest", 0, 0.6, 0.01], ["curveGain", "Curve on scroll", 0, 15, 0.1], ["curveMax", "Max curve", 0, 0.8, 0.01]];\
    const p = document.createElement("div");\
    p.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:99999;width:240px;padding:12px;border-radius:14px;" +\
      "background:rgba(18,18,20,.88);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.1);color:#f3eede;" +\
      "font:500 12px/1.2 -apple-system,system-ui,sans-serif";\
    p.innerHTML = '<div style="font-weight:700;letter-spacing:.14em;font-size:11px;margin-bottom:10px">FX CONTROLS</div>';\
    SPEC.forEach(([key, label, min, max, step]) => \{\
      const row = document.createElement("label");\
      row.style.cssText = "display:block;margin:0 0 10px";\
      row.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="opacity:.65">$\{label\}</span><b>$\{CFG[key].toFixed(2)\}</b></div>` +\
        `<input type="range" min="$\{min\}" max="$\{max\}" step="$\{step\}" value="$\{CFG[key]\}" style="width:100%;accent-color:#f3eede">`;\
      const inp = row.querySelector("input"), out = row.querySelector("b");\
      inp.addEventListener("input", () => \{ CFG[key] = parseFloat(inp.value); out.textContent = CFG[key].toFixed(2); \});\
      p.appendChild(row);\
    \});\
    const btn = document.createElement("button");\
    btn.textContent = "Copy values";\
    btn.style.cssText = "all:unset;cursor:pointer;display:block;text-align:center;padding:7px 0;border-radius:8px;background:rgba(255,255,255,.08);letter-spacing:.06em;text-transform:uppercase;font-size:11px";\
    btn.addEventListener("click", async () => \{\
      const v = \{\}; SPEC.forEach(([key]) => (v[key] = CFG[key]));\
      try \{ await navigator.clipboard.writeText(JSON.stringify(v)); btn.textContent = "Copied!"; setTimeout(() => (btn.textContent = "Copy values"), 1200); \} catch (_) \{\}\
    \});\
    p.appendChild(btn);\
    document.body.appendChild(p);\
  \}\
\})();\
}