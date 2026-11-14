/* JB Studio homepage canvas — dev-only Controls panel (loaded by canvas.js when the URL has ?debug).
   Live per-view tuning of JB_CANVAS.CFG; "Copy values" copies CFG as JSON to bake in as defaults. */
const CFG=window.JB_CANVAS.CFG;
const STYLE=`#panel{position:fixed;top:16px;right:16px;z-index:12;width:252px;color:#f3eede;
  background:rgba(18,18,20,.82);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.1);
  border-radius:14px;font:500 12px/1.2 -apple-system,system-ui,sans-serif;overflow:hidden}
#panel .phead{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08)}
#panel #panelToggle{all:unset;cursor:pointer;font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:11px;color:#f3eede}
#panel:not(.open) .phead{border-bottom:0}
#panel:not(.open) .ptabs,#panel:not(.open) #panelCopy{display:none}
#panel #panelToggle::after{content:' ▸';opacity:.6}
#panel.open #panelToggle::after{content:' ▾'}
#panel .ptabs{display:flex;gap:4px}
#panel .ptabs button{all:unset;cursor:pointer;flex:1;text-align:center;padding:6px 0;border-radius:8px;font-size:11px;
  letter-spacing:.06em;text-transform:uppercase;color:rgba(243,238,222,.55);background:rgba(255,255,255,.05)}
#panel .ptabs button.on{background:#f3eede;color:#0e0e0f;font-weight:700}
#panel #panelCopy{all:unset;cursor:pointer;text-align:center;padding:6px 0;border-radius:8px;font-size:11px;
  letter-spacing:.06em;text-transform:uppercase;color:rgba(243,238,222,.7);background:rgba(255,255,255,.07)}
#panelBody{display:none;padding:10px 12px;max-height:58vh;overflow:auto}
#panel.open #panelBody{display:block}
.prow{display:block;margin:0 0 12px}
.prow .lab{display:flex;justify-content:space-between;margin-bottom:5px}
.prow .lab span{opacity:.65}.prow .lab b{opacity:.95;font-weight:600}
.prow input[type=range]{width:100%;accent-color:#f3eede;height:16px;margin:0}
@media (max-width:700px){#panel{display:none}}
`;
document.head.insertAdjacentHTML('beforeend','<style>'+STYLE+'</style>');
document.body.insertAdjacentHTML('beforeend',`<div id="panel" class="open">
  <div class="phead">
    <button id="panelToggle">Controls</button>
    <div class="ptabs"><button data-tab="grid" class="on">Grid</button><button data-tab="sphere">Sphere</button><button data-tab="reel">Reel</button><button data-tab="shared">Shared</button></div>
    <button id="panelCopy">Copy values</button>
  </div>
  <div id="panelBody"></div>
</div>`);
(function(){
  const SPEC={
    grid:[['cols','Columns',2,4,1],['fill','Image size',0.5,1.0,0.01],['colGap','Column gap',0,5,0.05],['vGap','Row gap',0,6,0.05],
      ['capSize','Caption size',0.4,3,0.05],['capGap','Text offset',0,5,0.05],
      ['curveRest','Curve at rest',0,0.6,0.01],['curveGain','Curve on scroll',0,15,0.1],['curveMax','Max curve',0,0.8,0.01],
      ['blur','Motion blur',0,1.5,0.05],['aberr','RGB split',0,1.5,0.05],['zoom','Hover zoom',0,2,0.05],['zoomRgb','Hover RGB split',0,3,0.05]],
    sphere:[['cell','Image size',2,10,0.1],['gap','Spacing',0,8,0.1],['globe','Globe curve',0,0.8,0.01],
      ['capSize','Hover label size',0.4,6,0.05],['capGap','Text offset',0,5,0.05],
      ['blur','Motion blur',0,1.5,0.05],['aberr','RGB split',0,1.5,0.05],['parallax','Parallax',0,1.5,0.05],['zoom','Hover zoom',0,2,0.05],['zoomRgb','Hover RGB split',0,3,0.05],
      ['wheelX','Wheel speed X',0,4,0.05],['wheelY','Wheel speed Y',0,4,0.05]],
    reel:[['cardFill','Card size',0.5,0.95,0.01],['peek','Peek amount',0,0.45,0.01],['maxAR','Max width',0.8,3,0.05],
      ['scroll','Scroll sensitivity',0.2,2,0.05],['titleSize','Title size',0.4,4,0.05],['metaSize','Meta size',0.4,2,0.05],['infoY','Text position',0,40,1],
      ['curve','Curve',0,0.6,0.01],['blur','Motion blur',0,1.5,0.05],['aberr','RGB split',0,1.5,0.05],['zoom','Hover zoom',0,2,0.05],['zoomRgb','Hover RGB split',0,3,0.05]],
    shared:[['friction','Glide / inertia',0.5,0.98,0.005],['damping','Smoothing',0.01,0.2,0.005]],
  };
  const RELAYOUT=new Set(['cols','fill','colGap','vGap','cell','gap','cardFill','peek','maxAR']);
  const panel=document.getElementById('panel'), pbody=document.getElementById('panelBody');
  const tabs=[...panel.querySelectorAll('[data-tab]')]; let tab='grid';
  const fmt=(v,step)=>(+v).toFixed(step>=1?0:(step<0.01?3:(step<0.1?2:1)));
  function render(){
    pbody.innerHTML='';
    SPEC[tab].forEach(([key,label,min,max,step])=>{
      const row=document.createElement('div'); row.className='prow';
      row.innerHTML=`<div class="lab"><span>${label}</span><b>${fmt(CFG[tab][key],step)}</b></div>`+
                    `<input type="range" min="${min}" max="${max}" step="${step}" value="${CFG[tab][key]}">`;
      const inp=row.querySelector('input'), out=row.querySelector('b');
      inp.addEventListener('input',()=>{ const v=parseFloat(inp.value); CFG[tab][key]=v; out.textContent=fmt(v,step);
        if(RELAYOUT.has(key)) JB_CANVAS.relayout(tab);
        if(key==='capSize') JB_CANVAS.refreshCaptions(tab);   // redraw caption texture at new size
        if(key==='titleSize'||key==='metaSize'||key==='infoY') JB_CANVAS.refreshReelInfo(); });
      pbody.appendChild(row);
    });
  }
  tabs.forEach(t=>t.addEventListener('click',()=>{ tab=t.dataset.tab; tabs.forEach(x=>x.classList.toggle('on',x===t)); if(!panel.classList.contains('open'))panel.classList.add('open'); render(); }));
  document.getElementById('panelToggle').addEventListener('click',()=>panel.classList.toggle('open'));
  document.getElementById('panelCopy').addEventListener('click',async e=>{ e.stopPropagation();
    try{ await navigator.clipboard.writeText(JSON.stringify(CFG,null,2)); e.target.textContent='Copied!'; setTimeout(()=>e.target.textContent='Copy values',1200);}catch(_){ } });
  render();
})();
