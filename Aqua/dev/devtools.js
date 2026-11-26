// Development hooks (dev builds only, never part of aquarium.html).
(function installDevTools() {
  const A = () => window.__dev.APP;
  const sph = new THREE.Spherical();
  function render() { A().optics.render(SIM.time); }
  window.__dev = {
    APP,
    glsl: { WATER_GLSL, OPTIC_COMMON_GLSL, CURRENT_GLSL },
    // az: radians around Y (0 = +Z front), polar: radians from +Y
    view({ az = VIEW_HOME.azimuth, polar = VIEW_HOME.polar, dist = VIEW_HOME.distance, target = VIEW_HOME.target.toArray() } = {}) {
      const { camera, controls } = A();
      sph.set(dist, polar, az);
      camera.position.setFromSpherical(sph).add(new THREE.Vector3(...target));
      controls.target.set(...target);
      controls.update();
      render();
    },
    home() { applyHomeView(A().camera, A().controls, A().camera.aspect); render(); },
    setPaused(p) { SIM.paused = !!p; },
    // advance the simulation without waiting for real time
    step(seconds) {
      const n = Math.max(0, Math.round(seconds * 60));
      for (let i = 0; i < n; i++) { SIM.step(1 / 60); updateRipples(SIM.time); }
      SIM_UNIFORMS.uTime.value = SIM.time;
      render();
      return SIM.time;
    },
    render,
    // scale every material's caustic contribution (1 = designed strength)
    caustics(v) { for (const u of CAUSTIC_STRENGTH_UNIFORMS) u.value = v * u.base; return CAUSTIC_STRENGTH_UNIFORMS.length; },
    stats() {
      const a = A(), r = a.renderer.info.render;
      const size = a.renderer.getDrawingBufferSize(new THREE.Vector2());
      return {
        time: +SIM.time.toFixed(2), paused: SIM.paused,
        calls: r.calls, triangles: r.triangles, lines: r.lines, points: r.points,
        programs: a.renderer.info.programs.length,
        geometries: a.renderer.info.memory.geometries, textures: a.renderer.info.memory.textures,
        pixelRatio: +a.renderer.getPixelRatio().toFixed(3), buffer: size.toArray(),
        camera: a.camera.position.toArray().map((v) => +v.toFixed(2)),
        fps: A().fps ? +A().fps.toFixed(1) : null,
      };
    },
    // Runs the simulation headlessly for `seconds` and reports constraint violations.
    check(seconds = 120) {
      const app = A();
      const w = app.world, dt = 1 / 60, n = Math.round(seconds / dt);
      const report = { seconds, fish: {}, crab: {}, snails: {} };
      for (const ag of w.fish) {
        report.fish[ag.model.kind] = { minWall: 99, obstacleHits: 0, minFishDist: 99, maxSpeed: 0, stuck: 0, samples: 0 };
      }
      let crabMin = { x: 99, z: 99 }, crabMax = { x: -99, z: -99 }, crabBoxHits = 0, footBuried = 0, crabSamples = 0;
      const v = new THREE.Vector3(), b = new THREE.Box3();
      const snailA = { min: [99, 99], max: [-99, -99] }, snailB = { min: [99, 99, 99], max: [-99, -99, -99] };
      for (let i = 0; i < n; i++) {
        SIM.step(dt); updateRipples(SIM.time);
        for (const ag of w.fish) {
          const r = report.fish[ag.model.kind], p = ag.root.position, bb = ag.bounds();
          r.samples++;
          const wall = Math.min(p.x - bb.min.x, bb.max.x - p.x, p.y - bb.min.y, bb.max.y - p.y, p.z - bb.min.z, bb.max.z - p.z);
          r.minWall = Math.min(r.minWall, wall);
          r.maxSpeed = Math.max(r.maxSpeed, ag.speed);
          if (ag.stuck > 0) r.stuck++;
          for (const o of w.obstacles) {
            if (o.isBox3) { if (b.copy(o).expandByScalar(ag.cfg.radius * 0.8).containsPoint(p)) r.obstacleHits++; }
            else if (p.distanceTo(o.center) < o.radius + ag.cfg.radius * 0.8) r.obstacleHits++;
          }
          for (const o of w.fish) if (o !== ag) r.minFishDist = Math.min(r.minFishDist, p.distanceTo(o.root.position));
        }
        const cp = w.crab.group.position;
        crabSamples++;
        crabMin.x = Math.min(crabMin.x, cp.x); crabMin.z = Math.min(crabMin.z, cp.z); crabMax.x = Math.max(crabMax.x, cp.x); crabMax.z = Math.max(crabMax.z, cp.z);
        for (const leg of w.crab.legs) {
          leg.knee.getWorldPosition(v);
          const g = groundHeightAt(v.x, v.z);
          if (v.y < g - 0.01) footBuried++;
          if (v.x < TANK.ixMin || v.x > TANK.ixMax || v.z < TANK.izMin || v.z > TANK.izMax) crabBoxHits++;
        }
        const sa = w.snailA.group.position, sb = w.snailB.group.position;
        snailA.min = [Math.min(snailA.min[0], sa.x), Math.min(snailA.min[1], sa.z)]; snailA.max = [Math.max(snailA.max[0], sa.x), Math.max(snailA.max[1], sa.z)];
        snailB.min = [Math.min(snailB.min[0], sb.x), Math.min(snailB.min[1], sb.y), Math.min(snailB.min[2], sb.z)]; snailB.max = [Math.max(snailB.max[0], sb.x), Math.max(snailB.max[1], sb.y), Math.max(snailB.max[2], sb.z)];
      }
      for (const k of Object.keys(report.fish)) { const r = report.fish[k]; r.minWall = +r.minWall.toFixed(3); r.minFishDist = +r.minFishDist.toFixed(3); r.maxSpeed = +r.maxSpeed.toFixed(2); }
      report.crab = { range: [crabMin, crabMax], footOutOfBounds: crabBoxHits, footBuriedSamples: footBuried, samples: crabSamples, wp: w.crab.state.wp };
      report.snails = { A: snailA, B: snailB };
      report.bubblesAlive = w.bubbles.alive;
      report.time = +SIM.time.toFixed(1);
      SIM_UNIFORMS.uTime.value = SIM.time;
      render();
      return report;
    },
  };
})();
