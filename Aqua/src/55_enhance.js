// Shared material enhancements: caustic light from the water above, plus optional vertex
// deformation and procedural colour injected into any MeshStandard/Physical material.

let materialSeq = 0;
const CAUSTIC_STRENGTH_UNIFORMS = [];   // every uCausticStrength uniform object (dev tuning)

const CAUSTIC_INJECT = /* glsl */`
getDirectionalLightInfo( directionalLight, directLight );
#if ( UNROLLED_LOOP_INDEX == 0 )
{
  float causDepth = max( uWaterLevel - vCausWorld.y, 0.0 );
  float caus = causticLight( vCausWorld.xz, uTime, causDepth );
  vec3 causWorldN = inverseTransformDirection( geometryNormal, viewMatrix );     // geometryNormal is view-space
  float causUp = 0.12 + 0.88 * saturate( causWorldN.y );
  float causOn = step( vCausWorld.y, uWaterLevel );
  float causV = clamp( caus - 1.0, -0.25, 2.5 );
  directLight.color *= 1.0 + 1.1 * causV * causUp * causOn * uCausticStrength;
}
#endif`;

// opts: { id, uniforms, caustics, vertexHead, vertexNormal, vertexBody, fragmentHead,
//         fragmentColor, fragmentRough, fragmentEmissive, varyWorld }
function enhanceMaterial(material, opts = {}) {
  const id = opts.id || ('m' + (materialSeq++));
  const caustics = opts.caustics ?? 0;
  const wantWorld = caustics > 0 || !!opts.varyWorld;
  const uniforms = Object.assign({}, opts.uniforms || {});
  if (caustics > 0) { Object.assign(uniforms, SIM_UNIFORMS); uniforms.uCausticStrength = { value: caustics, base: caustics }; CAUSTIC_STRENGTH_UNIFORMS.push(uniforms.uCausticStrength); }

  const worldCode = /* glsl */`
{
  vec4 aqW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    aqW = instanceMatrix * aqW;
  #endif
  vCausWorld = ( modelMatrix * aqW ).xyz;
}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader;
    if (wantWorld) vs = vs.replace('#include <common>', '#include <common>\nvarying vec3 vCausWorld;');
    if (opts.vertexHead) vs = vs.replace('#include <common>', '#include <common>\n' + opts.vertexHead);
    if (opts.vertexNormal) vs = vs.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + opts.vertexNormal);
    if (opts.vertexBody) vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + opts.vertexBody);
    if (wantWorld) vs = vs.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + worldCode);
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    if (wantWorld) fs = fs.replace('#include <common>', '#include <common>\nvarying vec3 vCausWorld;');
    if (caustics > 0) fs = fs.replace('#include <common>', '#include <common>\n' + WATER_GLSL + '\nuniform float uCausticStrength;');
    if (opts.fragmentHead) fs = fs.replace('#include <common>', '#include <common>\n' + opts.fragmentHead);
    if (opts.fragmentColor) fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + opts.fragmentColor);
    if (opts.fragmentRough) fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + opts.fragmentRough);
    if (opts.fragmentEmissive) fs = fs.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + opts.fragmentEmissive);
    // Includes are still unexpanded at this point: splice the caustics into the light loop chunk.
    if (caustics > 0) fs = fs.replace('#include <lights_fragment_begin>', () => THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', () => CAUSTIC_INJECT));
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => 'aq-' + id;
  return material;
}

// Depth (shadow) material that applies the same vertex deformation as the surface material.
function deformedDepthMaterial(opts) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: opts.side ?? THREE.FrontSide });
  const uniforms = Object.assign({}, opts.uniforms || {});
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader;
    if (opts.vertexHead) vs = vs.replace('#include <common>', '#include <common>\n' + opts.vertexHead);
    if (opts.vertexBody) vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + opts.vertexBody);
    shader.vertexShader = vs;
  };
  m.customProgramCacheKey = () => 'aq-depth-' + (opts.id || (materialSeq++));
  return m;
}
