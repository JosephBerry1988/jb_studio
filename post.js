/* JB Studio homepage canvas — ONE post-processing pass (replaces EffectComposer: globe → motion blur +
   RGB split → sRGB output → hover zoom lens + hover RGB split). Same maths, same order, one draw:
   - the scene renders into an sRGB 8-bit target (hardware decodes to linear on read, so blur is in linear light)
   - S(q) = globe-bent scene sample; blur taps average S in linear; then linear→sRGB (as OutputPass)
   - the Codrops hover lens warps the lookup position first; its RGB split is folded into each blur tap
     (blur is a linear filter, so this equals splitting the blurred image) */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export function createPost(renderer, taps) {
  const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  target.texture.colorSpace = THREE.SRGBColorSpace;            // SRGB8_ALPHA8: linear in, linear out, 8-bit storage

  const u = {
    tScene: { value: target.texture },
    uGlobe: { value: 0 },                                       // GlobeDistort strength
    uVel: { value: new THREE.Vector2() },                       // screen-space velocity (fraction of view per frame)
    uBlur: { value: 0 }, uAberr: { value: 0 },                  // motion blur + RGB split along the velocity
    uMouse: { value: new THREE.Vector2(-10, -10) }, uVelo: { value: 0 },
    uDir: { value: new THREE.Vector2() }, uZoom: { value: 1 }, uSplit: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms: u, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv=position.xy*0.5+0.5; gl_Position=vec4(position.xy,0.0,1.0); }`,
    fragmentShader: `
      uniform sampler2D tScene; uniform float uGlobe; uniform vec2 uVel; uniform float uBlur; uniform float uAberr;
      uniform vec2 uMouse; uniform vec2 uRes; uniform vec2 uDir; uniform float uVelo; uniform float uZoom; uniform float uSplit;
      varying vec2 vUv;
      // GlobeDistort; q clamped first = the old chain's clamp-to-edge on its intermediate (bent) image
      vec3 S(vec2 q){ vec2 c=clamp(q,0.0,1.0)-0.5; return texture2D(tScene, 0.5+c*(1.0-uGlobe*dot(c,c))).rgb; }
      vec3 toSRGB(vec3 v){ return mix(pow(v,vec3(0.41666))*1.055-vec3(0.055), v*12.92, vec3(lessThanEqual(v,vec3(0.0031308)))); }
      float circle(vec2 uv, vec2 c, float r, float b){ uv-=c; uv*=uRes; return smoothstep(r+b, r-b, length(uv)); }
      void main(){
        float c=circle(vUv,uMouse,0.0,0.1+uVelo*2.0)*40.0*uVelo*uZoom;                  // Codrops zoom lens
        vec2 w=mix(vUv,uMouse,c*0.99);
        vec2 d=length(uDir)>1e-5 ? normalize(uDir) : normalize(vUv-uMouse+1e-6);
        vec2 hca=d*c*0.008*uSplit;                                                      // hover RGB split
        vec2 v=uVel*uBlur, ca=uVel*uAberr;                                              // scroll blur + RGB split
        vec3 col;
        if(length(v)<0.0008 && length(ca)<0.0006){
          col=vec3(S(w+hca).r, S(w).g, S(w-hca).b);
        } else {
          col=vec3(0.0);
          for(int i=0;i<${taps};i++){
            float t=float(i)/float(${taps - 1})-0.5; vec2 b=w+v*t;
            col+=vec3(S(b+ca+hca).r, S(b).g, S(b-ca-hca).b);
          }
          col/=float(${taps});
        }
        gl_FragColor=vec4(toSRGB(col)*(1.0+c),1.0);
      }`,
  });
  const tri = new THREE.BufferGeometry();                         // one oversized triangle covers the screen
  tri.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(tri, material); quad.frustumCulled = false;
  const postScene = new THREE.Scene(); postScene.add(quad);
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    u,
    setSize(w, h) {                                               // CSS px; the target follows the renderer's pixel ratio
      const pr = renderer.getPixelRatio();
      target.setSize(Math.max(1, Math.round(w * pr)), Math.max(1, Math.round(h * pr)));
      u.uRes.value.set(1, h / Math.max(1, w));
    },
    render(scene, camera) {
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      const ac = renderer.autoClear; renderer.autoClear = false;     // the triangle covers every pixel: clearing the
      renderer.render(postScene, postCam); renderer.autoClear = ac;    // (multisampled) screen first is wasted bandwidth
    },
    dispose() { target.dispose(); material.dispose(); tri.dispose(); },
  };
}
