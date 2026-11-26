// Optics pipeline: refraction / reflection for the water surface and the glass panes.
//
//  pass 1  world (everything except the refracting interfaces)  -> rtWorld (HDR colour + depth)
//  pass 2  copy colour and linearised depth                      -> rtCopy   (never bound as a draw target afterwards)
//  pass 3  interfaces, back-to-front, sampling rtCopy             -> rtWorld  (depth from pass 1 is kept for occlusion)
//  pass 4  bloom + tone mapping                                   -> canvas
//
// The copy target is what prevents the recursive feedback that you would get from sampling a
// texture that is still attached to the active draw framebuffer.

const WATER_GLSL = /* glsl */`
#define NUM_WAVES ${WAVE_COUNT}
#define NUM_CAUSTIC_WAVES ${CAUSTIC_WAVE_COUNT}
#define MAX_RIPPLES ${RIPPLE_MAX}
uniform float uTime;
uniform vec4 uWaveA[NUM_WAVES];      // dir.x, dir.z, wavenumber, angular frequency
uniform vec4 uWaveB[NUM_WAVES];      // amplitude, phase, caustic weight, -
uniform vec4 uRipples[MAX_RIPPLES];  // x, z, start time, strength (active first)
uniform int uRippleCount;
uniform vec4 uInner;                 // inner glass faces: xMin, xMax, zMin, zMax
uniform float uWaterLevel;

float rippleShape(float dist, float age, float strength) {
  float q = (dist - age * ${RIPPLE_SPEED.toFixed(3)}) / (0.05 + age * 0.09);
  return 0.02 * strength * exp(-q * q) * exp(-age * 1.5) * cos(q * 3.14159265);
}

float waveHeight(vec2 p, float t) {
  float h = 0.0;
  for (int i = 0; i < NUM_WAVES; i++) {
    vec4 a = uWaveA[i]; vec4 b = uWaveB[i];
    h += b.x * sin(dot(a.xy, p) * a.z - a.w * t + b.y);
  }
  for (int i = 0; i < MAX_RIPPLES; i++) {
    if (i >= uRippleCount) break;
    vec4 r = uRipples[i];
    h += rippleShape(length(p - r.xy), t - r.z, r.w);
  }
  float edge = min(min(p.x - uInner.x, uInner.y - p.x), min(p.y - uInner.z, uInner.w - p.y));
  h += ${MENISCUS_HEIGHT.toFixed(3)} * smoothstep(${MENISCUS_WIDTH.toFixed(3)}, 0.0, edge);
  return h;
}

vec3 waveNormal(vec2 p, float t) {
  float e = 0.012;
  float h = waveHeight(p, t);
  float hx = waveHeight(p + vec2(e, 0.0), t);
  float hz = waveHeight(p + vec2(0.0, e), t);
  return normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
}

// Light focused by the surface, to first order: the curvature (Laplacian) of the same wave field
// sampled at the floor point. Concave-up crests concentrate light into bright ridges that travel
// with the waves; the effect is softer for objects that sit closer to the surface.
float causticLight(vec2 p, float t, float depth) {
  float lap = 0.0, norm = 0.0;
  for (int i = 0; i < NUM_CAUSTIC_WAVES; i++) {
    vec4 a = uWaveA[i]; vec4 b = uWaveB[i];
    float w = b.z * b.x * a.z * a.z;                 // amplitude · k² : how strongly a crest focuses
    lap += w * ( -sin( dot( a.xy, p ) * a.z - a.w * t + b.y ) );
    norm += w;
  }
  float f = clamp( ( lap / norm ) * 1.25, -1.0, 1.0 );   // -1 (defocusing) .. 1 (focusing)
  float k = clamp( depth / 4.3, 0.15, 1.0 );
  float I = pow( max( f * 0.5 + 0.5, 0.0 ), 3.0 ) * 1.5;    // soft net of bright ridges
  float shim = 0.0;
  for (int i = 0; i < MAX_RIPPLES; i++) {
    if (i >= uRippleCount) break;
    vec4 r = uRipples[i];
    shim += rippleShape( length( p - r.xy ), t - r.z, r.w ) * 14.0;
  }
  return 1.0 + I * 1.7 * k - 0.06 + shim * k;
}
`;

const OPTIC_COMMON_GLSL = /* glsl */`
uniform sampler2D uSceneCopy;     // rgb: world colour (linear HDR)   a: linear view-space depth
uniform samplerCube uEnvCube;
uniform mat4 uProj;                      // same object as camera.projectionMatrix
uniform float uEnvIntensity;
uniform vec2 uResolution;
uniform vec3 uAbsorb;             // per-unit extinction of the water
uniform vec3 uScatter;            // faint in-scattered water colour
uniform float uMaxPath;

float fresnelDielectric(float cosI, float eta) {   // eta = n_incident / n_transmitted
  float sinT2 = eta * eta * (1.0 - cosI * cosI);
  if (sinT2 >= 1.0) return 1.0;                     // total internal reflection
  float cosT = sqrt(1.0 - sinT2);
  float rs = (eta * cosI - cosT) / (eta * cosI + cosT);
  float rp = (eta * cosT - cosI) / (eta * cosT + cosI);
  return clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
}

vec2 edgeFade(vec2 uv, float w) {
  return smoothstep(vec2(0.0), vec2(w), uv) * (1.0 - smoothstep(vec2(1.0 - w), vec2(1.0), uv));
}

// Shades the water surface at world point P seen along V (surface -> eye). 'suv' is the screen
// position of the eye ray (S lies on the same ray as the fragment that calls this).
vec3 shadeWaterSurface(vec3 P, vec3 V, vec2 suv, float surfDepth) {
  vec3 N = waveNormal(P.xz, uTime);
  float side = dot(N, V) >= 0.0 ? 1.0 : -1.0;      // +1 seen from above, -1 from below
  vec3 n = N * side;
  float cosI = clamp(dot(n, V), 1e-4, 1.0);
  float eta = side > 0.0 ? ${(1 / WATER_IOR).toFixed(5)} : ${WATER_IOR.toFixed(3)};
  float F = fresnelDielectric(cosI, eta);

  vec3 rv = reflect(-V, n);
  vec3 env = textureLod(uEnvCube, rv, 1.1).rgb * uEnvIntensity;
  if (side < 0.0) env *= vec3(0.08, 0.14, 0.17);   // from below the surface mirrors the dark tank interior

  vec3 trans = vec3(0.0);
  if (F < 0.999) {
    vec3 R = refract(-V, n, eta);
    vec3 Pv = (viewMatrix * vec4(P, 1.0)).xyz;
    vec3 Rv = normalize((viewMatrix * vec4(R, 0.0)).xyz);
    if (Rv.z < -0.02) {
      // March the refracted ray through the depth buffer (coarse steps + bisection) so what we see
      // through the surface is where the bent ray really lands — stable at grazing angles and
      // along depth discontinuities.
      float straight = clamp(texture2D(uSceneCopy, suv).a - surfDepth, 0.0, uMaxPath);
      float Lmax = min(uMaxPath * 1.2, straight * 1.6 + 0.6);
      const int STEPS = 18;
      float dL = Lmax / float(STEPS);
      float L = 0.0, Lprev = 0.0;
      vec2 uv = suv, uvPrev = suv, cand = suv;
      bool hit = false;
      for (int i = 1; i <= STEPS; i++) {
        L = dL * float(i);
        vec4 cp = uProj * vec4(Pv + Rv * L, 1.0);
        cand = cp.xy / cp.w * 0.5 + 0.5;
        if (cand.x < 0.0 || cand.x > 1.0 || cand.y < 0.0 || cand.y > 1.0) break;
        float bufDepth = texture2D(uSceneCopy, cand).a;
        if (bufDepth < surfDepth + 0.02) break;                        // ran into something in front of the surface
        if (surfDepth + (-Rv.z) * L >= bufDepth) { hit = true; break; }  // crossed an opaque surface
        uvPrev = cand; Lprev = L;
      }
      if (hit) {
        uv = cand;
        for (int k = 0; k < 4; k++) {
          float Lm = 0.5 * (Lprev + L);
          vec4 cm = uProj * vec4(Pv + Rv * Lm, 1.0);
          vec2 cu = cm.xy / cm.w * 0.5 + 0.5;
          if (surfDepth + (-Rv.z) * Lm >= texture2D(uSceneCopy, cu).a) { L = Lm; uv = cu; } else { Lprev = Lm; uvPrev = cu; }
        }
      } else {
        uv = Lprev > 0.0 ? uvPrev : suv;
        L = max(Lprev, straight * 0.5);
      }
      vec3 bg = texture2D(uSceneCopy, uv).rgb;
      vec3 atten = exp(-uAbsorb * L);
      trans = bg * atten + uScatter * (1.0 - atten.r);
    } else {
      vec3 bg = texture2D(uSceneCopy, suv).rgb;
      trans = bg * exp(-uAbsorb * (uMaxPath * 0.4));
    }
  }
  return mix(trans, env, F);
}
`;

const FULLSCREEN_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COPY_FS = /* glsl */`
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  gl_FragColor = vec4(c, -perspectiveDepthToViewZ(d, uNear, uFar));
}`;

const BRIGHT_FS = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = (texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
          + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
  float l = max(c.r, max(c.g, c.b));
  float knee = 0.35;
  float s = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
  s = s * s / (4.0 * knee);
  float w = max(s, l - uThreshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * w, 1.0);
}`;

const BLUR_FS = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
  c += (texture2D(tSrc, vUv + uDir * 1.3846).rgb + texture2D(tSrc, vUv - uDir * 1.3846).rgb) * 0.316216;
  c += (texture2D(tSrc, vUv + uDir * 3.2308).rgb + texture2D(tSrc, vUv - uDir * 3.2308).rgb) * 0.070270;
  gl_FragColor = vec4(c, 1.0);
}`;

const FINAL_FS = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uVignette;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  c += texture2D(tBloom, vUv).rgb * uBloom;
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * dot(q, q) * 1.6;
  gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Uniform objects shared by every material that needs the water state (GPU side of the simulation).
const SIM_UNIFORMS = {
  uTime: { value: 0 },
  uWaveA: waveUniforms.uWaveA,
  uWaveB: waveUniforms.uWaveB,
  uRipples: RIPPLES.uniforms.uRipples,
  uRippleCount: RIPPLES.uniforms.uRippleCount,
  uWaterLevel: { value: TANK.waterLevel },
  uPlume: { value: new THREE.Vector3(PLUME.x, PLUME.y, PLUME.z) },
};

class OpticsPipeline {
  constructor(renderer, scene, camera, env) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.optics = [];                 // { mesh, center, outward, material }
    this.useBloom = true;

    const hdr = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
    this.rtWorld = new THREE.WebGLRenderTarget(4, 4, { ...hdr, depthBuffer: true });
    this.rtWorld.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType);
    this.rtCopy = new THREE.WebGLRenderTarget(4, 4, hdr);
    this.rtBloomA = new THREE.WebGLRenderTarget(4, 4, hdr);
    this.rtBloomB = new THREE.WebGLRenderTarget(4, 4, hdr);

    // Shared uniform objects (same references are handed to every interface material).
    this.shared = {
      ...SIM_UNIFORMS,
      uSceneCopy: { value: this.rtCopy.texture },
      uProj: { value: camera.projectionMatrix },
      uEnvCube: { value: env.cube },
      uEnvIntensity: { value: 1.0 },
      uResolution: { value: new THREE.Vector2(4, 4) },
      uAbsorb: { value: new THREE.Vector3(0.032, 0.013, 0.008) },
      uScatter: { value: new THREE.Vector3(0.006, 0.02, 0.026) },
      uMaxPath: { value: 9.0 },
      uInner: { value: new THREE.Vector4(TANK.ixMin, TANK.ixMax, TANK.izMin, TANK.izMax) },
    };

    const fs = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({ uniforms, vertexShader: FULLSCREEN_VS, fragmentShader, depthTest: false, depthWrite: false, ...extra });
    this.copyMat = fs(COPY_FS, { tColor: { value: null }, tDepth: { value: null }, uNear: { value: camera.near }, uFar: { value: camera.far } });
    this.brightMat = fs(BRIGHT_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.7 } });
    this.blurMat = fs(BLUR_FS, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.finalMat = fs(FINAL_FS, { tColor: { value: null }, tBloom: { value: null }, uBloom: { value: 0.2 }, uVignette: { value: 0.12 } }, { depthTest: true, depthWrite: true });

    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.tri = new THREE.Mesh(tri, this.copyMat);
    this.tri.frustumCulled = false;
    this.fsScene = new THREE.Scene();
    this.fsScene.add(this.tri);
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._c = new THREE.Vector3();
    this._o = new THREE.Vector3();
  }

  addOptic(mesh, center, outward) {
    mesh.layers.set(LAYER_OPTIC);
    this.optics.push({ mesh, center, outward, material: mesh.material });
  }

  setSize(width, height, pixelRatio) {
    const w = Math.max(2, Math.round(width * pixelRatio));
    const h = Math.max(2, Math.round(height * pixelRatio));
    this.rtWorld.setSize(w, h);
    this.rtCopy.setSize(w, h);
    const bw = Math.max(2, Math.round(w / 2)), bh = Math.max(2, Math.round(h / 2));
    this.rtBloomA.setSize(bw, bh);
    this.rtBloomB.setSize(bw, bh);
    this.shared.uResolution.value.set(w, h);
    this.width = w; this.height = h;
    this.brightMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.bloomTexel = new THREE.Vector2(1 / bw, 1 / bh);
  }

  // Far panes first, then the surface, then near panes. The camera is always outside, so this
  // yields a correct back-to-front order for the interfaces.
  updateOpticOrder() {
    const cam = this.camera.position;
    const dWater = cam.distanceTo(this._o.set(0, TANK.waterLevel, 0));
    for (let i = 0; i < this.optics.length; i++) {
      const o = this.optics[i];
      const d = cam.distanceTo(o.center);
      o.mesh.renderOrder = d > dWater ? 1 : 3;
      if (o.material.uniforms.uEntry) o.material.uniforms.uEntry.value = this._c.copy(cam).sub(o.center).dot(o.outward) > 0 ? 1 : 0;
    }
  }

  blit(material, target) {
    this.tri.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.fsCam);
  }

  render(time) {
    const r = this.renderer, cam = this.camera;
    this.shared.uTime.value = time;

    // pass 1 — world
    r.shadowMap.needsUpdate = true;
    cam.layers.set(LAYER_WORLD);
    r.setRenderTarget(this.rtWorld);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.render(this.scene, cam);

    // pass 2 — colour + linear depth into the read-only copy
    this.copyMat.uniforms.tColor.value = this.rtWorld.texture;
    this.copyMat.uniforms.tDepth.value = this.rtWorld.depthTexture;
    this.blit(this.copyMat, this.rtCopy);

    // pass 3 — interfaces (no clear: keeps the world colour and depth for occlusion)
    this.updateOpticOrder();
    cam.layers.set(LAYER_OPTIC);
    r.setRenderTarget(this.rtWorld);
    r.render(this.scene, cam);
    cam.layers.set(LAYER_WORLD);

    // pass 4 — bloom and output
    const finalU = this.finalMat.uniforms;
    if (this.useBloom) {
      const t = this.bloomTexel;
      this.brightMat.uniforms.tSrc.value = this.rtWorld.texture;
      this.blit(this.brightMat, this.rtBloomA);
      this.blurMat.uniforms.tSrc.value = this.rtBloomA.texture;
      this.blurMat.uniforms.uDir.value.set(t.x, 0);
      this.blit(this.blurMat, this.rtBloomB);
      this.blurMat.uniforms.tSrc.value = this.rtBloomB.texture;
      this.blurMat.uniforms.uDir.value.set(0, t.y);
      this.blit(this.blurMat, this.rtBloomA);
      this.blurMat.uniforms.tSrc.value = this.rtBloomA.texture;
      this.blurMat.uniforms.uDir.value.set(t.x * 2.0, 0);
      this.blit(this.blurMat, this.rtBloomB);
      this.blurMat.uniforms.tSrc.value = this.rtBloomB.texture;
      this.blurMat.uniforms.uDir.value.set(0, t.y * 2.0);
      this.blit(this.blurMat, this.rtBloomA);
      finalU.tBloom.value = this.rtBloomA.texture;
    } else {
      finalU.tBloom.value = this.rtBloomB.texture;   // an empty target: adds nothing
    }
    finalU.tColor.value = this.rtWorld.texture;
    this.blit(this.finalMat, null);
  }

  dispose() {
    for (const rt of [this.rtWorld, this.rtCopy, this.rtBloomA, this.rtBloomB]) rt.dispose();
    this.tri.geometry.dispose();
    for (const m of [this.copyMat, this.brightMat, this.blurMat, this.finalMat]) m.dispose();
  }
}
