// Renderer, camera, controls, lights, studio environment and the room the tank stands in.

const RENDER_BUDGET_PIXELS = 4.6e6;   // cap on internal resolution (device pixels)

function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;   // the optics pipeline triggers exactly one shadow update per frame
  renderer.autoClear = false;
  container.appendChild(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  return renderer;
}

function createCamera() {
  const camera = new THREE.PerspectiveCamera(34, 1, 0.4, 140);
  camera.layers.enable(LAYER_WORLD);
  camera.layers.enable(LAYER_OPTIC);
  return camera;
}

const VIEW_HOME = { target: new THREE.Vector3(0.1, 2.3, 0.15), azimuth: 0.62, polar: 1.12, distance: 11.5 };

// Keeps the camera outside the tank and above the floor while panning / zooming.
const CAMERA_LIMITS = {
  targetMin: new THREE.Vector3(-1.6, 1.0, -0.9),
  targetMax: new THREE.Vector3(1.6, 3.6, 0.9),
  minDistance: 5.2,
  maxDistance: 23,
  minPolar: 0.30,
  maxPolar: 1.50,
  tankBox: new THREE.Box3(new THREE.Vector3(TANK.xMin - 0.35, -0.5, TANK.zMin - 0.35), new THREE.Vector3(TANK.xMax + 0.35, TANK.h + 0.45, TANK.zMax + 0.35)),
  minY: 0.9,
};

function createControls(camera, dom) {
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.8;
  controls.panSpeed = 0.55;
  controls.screenSpacePanning = true;
  controls.minDistance = CAMERA_LIMITS.minDistance;
  controls.maxDistance = CAMERA_LIMITS.maxDistance;
  controls.minPolarAngle = CAMERA_LIMITS.minPolar;
  controls.maxPolarAngle = CAMERA_LIMITS.maxPolar;
  controls.zoomToCursor = false;
  return controls;
}

// Distance needed so the whole tank fits, depending on the viewport aspect.
function homeDistance(aspect, fovDeg) {
  const fov = THREE.MathUtils.degToRad(fovDeg);
  const base = VIEW_HOME.distance * (Math.tan(THREE.MathUtils.degToRad(17)) / Math.tan(fov / 2));
  // narrow screens need to back off so the 8-unit width still fits
  const narrow = aspect < 1.5 ? Math.pow(1.5 / Math.max(aspect, 0.45), 0.8) : 1;
  return clamp(base * narrow, 9.5, 30);
}

function applyHomeView(camera, controls, aspect) {
  const d = homeDistance(aspect, camera.fov);
  const sph = new THREE.Spherical(d, VIEW_HOME.polar, VIEW_HOME.azimuth);
  camera.position.setFromSpherical(sph).add(VIEW_HOME.target);
  controls.target.copy(VIEW_HOME.target);
  controls.update();
}

const _boxClamp = new THREE.Vector3();
function enforceCameraLimits(camera, controls) {
  const t = controls.target;
  t.x = clamp(t.x, CAMERA_LIMITS.targetMin.x, CAMERA_LIMITS.targetMax.x);
  t.y = clamp(t.y, CAMERA_LIMITS.targetMin.y, CAMERA_LIMITS.targetMax.y);
  t.z = clamp(t.z, CAMERA_LIMITS.targetMin.z, CAMERA_LIMITS.targetMax.z);
  // Never let the eye point sit inside the tank (or its margin), nor under the floor line.
  const box = CAMERA_LIMITS.tankBox;
  if (box.containsPoint(camera.position)) {
    _boxClamp.copy(camera.position).sub(controls.target);
    // push out along the dominant horizontal axis, or upward
    const p = camera.position;
    const dx = p.x > 0 ? box.max.x - p.x + 0.05 : p.x - box.min.x + 0.05;
    const dz = p.z > 0 ? box.max.z - p.z + 0.05 : p.z - box.min.z + 0.05;
    const dy = box.max.y - p.y + 0.05;
    if (dy <= dx && dy <= dz) p.y = box.max.y + 0.05;
    else if (dx < dz) p.x = p.x > 0 ? box.max.x + 0.05 : box.min.x - 0.05;
    else p.z = p.z > 0 ? box.max.z + 0.05 : box.min.z - 0.05;
  }
  if (camera.position.y < CAMERA_LIMITS.minY) camera.position.y = CAMERA_LIMITS.minY;
}

function createLights(scene) {
  const key = new THREE.DirectionalLight(0xfff3e2, 4.2);
  key.position.set(2.2, 13.5, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const cam = key.shadow.camera;
  cam.left = -6.2; cam.right = 6.2; cam.top = 6.8; cam.bottom = -6.8; cam.near = 2; cam.far = 32;
  key.shadow.bias = -0.00035;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 2.5;
  key.target.position.set(0, 1.5, 0);
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(0xc4d6ea, 0.45);   // restrained cool fill from the front-left
  fill.position.set(-7, 5, 9);
  const rim = new THREE.DirectionalLight(0x9fd6e6, 0.35);   // cool rim from behind
  rim.position.set(-3, 6, -9);
  const hemi = new THREE.HemisphereLight(0xcfe0ec, 0x4a4038, 0.5);
  scene.add(fill, rim, hemi);
  return { key, fill, rim, hemi, keyDir: key.position.clone().normalize() };
}

// A procedural studio: navy-teal gradient with a warm softbox overhead and cool side cards.
function buildStudioScene() {
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          vec3 c = mix(vec3(0.012, 0.014, 0.02), vec3(0.05, 0.065, 0.075), smoothstep(-0.5, 0.9, d.y));
          // soft glow behind the tank
          float g = exp(-pow(acos(clamp(dot(d, normalize(vec3(0.0, 0.12, -1.0))), -1.0, 1.0)) * 1.5, 2.0));
          c += vec3(0.05, 0.12, 0.13) * g;
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
  scene.add(dome);
  const panel = (w, h, color, pos, lookAt) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.copy(pos); m.lookAt(lookAt); scene.add(m); return m;
  };
  panel(7.5, 3.6, new THREE.Color(11.0, 10.2, 9.2), new THREE.Vector3(0, 12, 0), new THREE.Vector3(0, 0, 0));   // key softbox
  panel(5, 7, new THREE.Color(0.35, 0.5, 0.7), new THREE.Vector3(-18, 6, 4), new THREE.Vector3(0, 2, 0));          // cool card left
  panel(5, 7, new THREE.Color(0.25, 0.4, 0.55), new THREE.Vector3(18, 6, 2), new THREE.Vector3(0, 2, 0));          // cooler card right
  panel(12, 5, new THREE.Color(0.12, 0.16, 0.2), new THREE.Vector3(0, 4, 22), new THREE.Vector3(0, 2, 0));         // dim front card
  return scene;
}

function createStudioEnvironment(renderer, scene) {
  const studio = buildStudioScene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(studio, 0.03, 0.1, 100);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.8;
  const cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(0.1, 100, cubeRT);
  cubeCam.update(renderer, studio);
  pmrem.dispose();
  // Studio meshes are only needed for the bake.
  studio.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return { cube: cubeRT.texture, pmrem: envRT.texture };
}

// Background dome shared by the scene and the model inspector.
function createDome(radius = 70) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */`
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          vec3 c = mix(vec3(0.004, 0.007, 0.014), vec3(0.014, 0.038, 0.052), smoothstep(-0.4, 0.25, d.y));
          c = mix(c, vec3(0.016, 0.05, 0.06), smoothstep(0.25, 1.0, d.y));
          float g = exp(-pow(acos(clamp(dot(d, normalize(vec3(0.0, 0.1, -1.0))), -1.0, 1.0)) * 1.35, 2.0));
          c += vec3(0.012, 0.038, 0.046) * g;
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
  );
}

// Background dome, floor, pedestal and the pendant light that hangs over the tank.
function createBackdrop(scene) {
  const group = new THREE.Group();
  group.name = 'backdrop';
  const dome = createDome();
  dome.renderOrder = -10;
  group.add(dome);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(45, 64), new THREE.MeshStandardMaterial({ color: 0x0c1018, roughness: 0.78, metalness: 0.05, envMapIntensity: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.9;
  floor.receiveShadow = true;
  group.add(floor);

  // pedestal: a plain dark cabinet with a slightly lighter top plate
  const body = new THREE.Mesh(new THREE.BoxGeometry(7.3, 1.5, 3.45), new THREE.MeshStandardMaterial({ color: 0x171b22, roughness: 0.5, metalness: 0.2, envMapIntensity: 0.6 }));
  body.position.set(0, -0.36 - 0.75, 0);
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(7.42, 0.05, 3.57), new THREE.MeshStandardMaterial({ color: 0x2a3039, roughness: 0.35, metalness: 0.35, envMapIntensity: 0.9 }));
  plate.position.set(0, -0.36 + 0.025, 0);
  plate.receiveShadow = true;
  group.add(plate);

  // soft contact shadow under the cabinet
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 6.2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.85, depthWrite: false, map: softDiscTexture(128) }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.set(0, -1.895, 0);
  group.add(blob);

  // pendant light: slim black bar with a warm diffuser, hung on two thin cables
  const housing = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.11, 0.42), new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.4, metalness: 0.5 }));
  housing.position.set(0, 8.4, 0);
  housing.castShadow = false;
  group.add(housing);
  const diffuser = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.34), new THREE.MeshBasicMaterial({ color: new THREE.Color(5.5, 5.1, 4.6) }));
  diffuser.rotation.x = Math.PI / 2;
  diffuser.position.set(0, 8.34, 0);
  group.add(diffuser);
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.5, metalness: 0.6 });
  for (const sx of [-2.6, 2.6]) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 12, 6), cableMat);
    cable.position.set(sx, 8.4 + 6, 0);
    group.add(cable);
  }
  scene.add(group);
  return group;
}
