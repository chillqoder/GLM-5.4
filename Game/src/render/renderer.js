// Three.js renderer: scene, lights, shadows, viewport and per-frame presentation.
import * as THREE from '../../vendor/three.module.js';
import { createTextures, makeHaloTexture, PALETTE } from './textures.js';
import { LevelView } from './levelview.js';
import { Effects } from './effects.js';
import { CameraRig } from './camera.js';
import { STATE } from '../sim/tuning.js';
import { computePower } from '../sim/world.js';

export class Renderer {
  static isSupported() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch {
      return false;
    }
  }

  constructor(canvas, level, settings = {}) {
    this.canvas = canvas;
    this.level = level;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.bgColor = new THREE.Color(PALETTE.bg);
    this.scene.background = this.bgColor;
    this.scene.fog = new THREE.Fog(PALETTE.bg, 26, 70);
    this.camera = new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 120);
    this.rig = new CameraRig(this.camera, level.cameraBounds);
    this.rig.setReducedMotion(!!settings.reducedMotion);
    // Lights: hemisphere + one shadow-casting directional + a small pool of point lights.
    this.hemi = new THREE.HemisphereLight(0x5f7a94, 0x0b1016, 0.95);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xd8e6f2, 1.15);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -20;
    this.sun.shadow.camera.right = 20;
    this.sun.shadow.camera.top = 16;
    this.sun.shadow.camera.bottom = -16;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 80;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.points = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 9, 1.6);
      this.scene.add(l);
      this.points.push(l);
    }
    this.textures = createTextures();
    this.halo = makeHaloTexture();
    this.view = new LevelView(this.scene, level, this.textures, this.halo);
    this.effects = new Effects(this.scene, this.halo, !!settings.reducedMotion);
    this.dawn = 0;
    this.resize();
  }

  setReducedMotion(v) {
    this.rig.setReducedMotion(v);
    this.effects.setReducedMotion(v);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const aspect = w / Math.max(1, h);
    this.renderer.setSize(w, h, false);
    // Narrow screens keep a minimum horizontal view so dash destinations stay visible.
    let viewW = Math.max(17, Math.min(32, 15 * aspect));
    let viewH = viewW / aspect;
    if (viewH > 34) {
      viewH = 34;
      viewW = viewH * aspect;
    }
    this.viewW = viewW;
    this.viewH = viewH;
    this.camera.left = -viewW / 2;
    this.camera.right = viewW / 2;
    this.camera.top = viewH / 2;
    this.camera.bottom = -viewH / 2;
    this.camera.updateProjectionMatrix();
    this.rig.setViewport(viewW, viewH);
  }

  /** One presentation frame. `events` are this frame's simulation events (for cosmetic reactions). */
  render(game, dt, time, events = []) {
    const world = game.world;
    const player = game.player;
    const power = computePower(this.level, world);
    this.rig.compute(game, dt);
    this.rig.apply(this.effects.shake, time);
    // Shadow light follows the framing center.
    const cx = this.rig.x;
    const cy = this.rig.y;
    this.sun.position.set(cx - 7, cy + 16, 22);
    this.sun.target.position.set(cx, cy, 0);
    // Pool of point lights assigned to the nearest purposeful sources.
    const sources = this.view.lightSources(world, player.x);
    for (let i = 0; i < this.points.length; i++) {
      const l = this.points[i];
      const s = sources[i];
      if (!s) {
        l.intensity = 0;
        continue;
      }
      l.color.setHex(s.color);
      l.intensity = s.intensity;
      l.position.set(s.x, s.y, 1.5);
    }
    // Ending: underground light recedes, warm dawn reveals.
    const dawn = this.view.dawn || 0;
    const fade = this.view.undergroundFade || 0;
    this.hemi.intensity = 0.95 * (1 - fade * 0.5) + dawn * 0.6;
    this.sun.color.setHex(dawn > 0.5 ? 0xffe4c4 : 0xd8e6f2);
    this.sun.intensity = 1.15 + dawn * 0.5;
    this.bgColor.setHex(PALETTE.bg).lerp(new THREE.Color(0xf3d9b4), dawn);
    this.scene.fog.color.copy(this.bgColor);
    this.view.update(world, player, dt, time, { state: game.state, power, events, cameraTarget: { x: this.rig.x, y: this.rig.y } });
    this.effects.update(dt, world, player, this.level);
    this.renderer.render(this.scene, this.camera);
  }

  handleEvents(events, world) {
    this.effects.handleEvents(events, this.level, world);
  }

  clearEffects() {
    this.effects.clear();
  }

  dispose() {
    this.view.dispose();
    this.renderer.dispose();
  }
}
