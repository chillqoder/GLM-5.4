// Assembles everything that lives inside (and around) the tank.
function buildWorld(scene, optics, env, lights) {
  const group = new THREE.Group();
  group.name = 'world';
  scene.add(group);
  const obstacles = [];           // Box3 volumes that fish must avoid

  const pebbles = createPebbleBed(group);
  const castle = createCastle(group);
  obstacles.push(...castle.obstacles);
  const filter = createFilter(group, env);
  obstacles.push(filter.obstacle);
  const bubbles = new BubbleSystem(group, env, lights);
  bubbles.setSource(filter.outletWorld, filter.outletDir, 15);
  const plants = createPlants(group);
  const plantSpheres = [];
  for (const key of Object.keys(plants)) {
    const pl = LAYOUT.plants[key];
    plantSpheres.push(new THREE.Sphere(new THREE.Vector3(pl.x, substrateHeight(pl.x, pl.z) + 0.3, pl.z), 0.42));
  }
  const stoneSpheres = ACCENT_STONES.map((st) => new THREE.Sphere(new THREE.Vector3(st.x, st.cy, st.z), st.r * 1.1));
  obstacles.push(...plantSpheres, ...stoneSpheres);

  const crab = createCrab(group, env);
  crab.setObstacles([...castle.obstacles, ...plantSpheres.map((s) => new THREE.Sphere(s.center.clone().setY(substrateHeight(s.center.x, s.center.z)), 0.3)), ...stoneSpheres]);
  const snailA = createBottomSnail(group, crab);
  const snailB = createGlassSnail(group);
  crab.setSnailProbe(() => snailA.group.position);

  const fish = createFishSchool(group, obstacles);
  const particles = createParticles(group);

  return { group, obstacles, pebbles, castle, filter, bubbles, plants, crab, snailA, snailB, fish, particles };
}
