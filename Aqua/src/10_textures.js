// Procedural textures — everything is drawn at runtime on canvases (no image assets).

function makePeriodicNoise(seed, period) {
  const rng = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = new Float32Array(256);
  for (let i = 0; i < 256; i++) grad[i] = rng() * 2 - 1;
  const fade = (t) => t * t * (3 - 2 * t);
  const wrap = (v) => ((v % period) + period) % period;
  return function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const X = wrap(xi), Y = wrap(yi), X1 = wrap(xi + 1), Y1 = wrap(yi + 1);
    const v00 = grad[perm[perm[X] + Y] & 255], v10 = grad[perm[perm[X1] + Y] & 255];
    const v01 = grad[perm[perm[X] + Y1] & 255], v11 = grad[perm[perm[X1] + Y1] & 255];
    const u = fade(x - xi), v = fade(y - yi);
    return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v) * 1.6;
  };
}

function makeCanvasTexture(w, h, draw, { srgb = true, repeat = [1, 1], anisotropy = 8 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = anisotropy;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Seamless fBm mottling, used as a multiply map for stone, shells and pebbles.
function mottleTexture(size = 256, seed = 7, { octaves = 5, scale = 3, lo = 0.62, hi = 1.0, tint = [1, 1, 1] } = {}) {
  const noises = [];
  for (let i = 0; i < octaves; i++) noises.push(makePeriodicNoise(seed * 31 + i, scale << i));
  const img = new ImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0, amp = 1, norm = 0;
      for (let o = 0; o < octaves; o++) { sum += noises[o]((x / size) * (scale << o), (y / size) * (scale << o)) * amp; norm += amp; amp *= 0.55; }
      const n = clamp(0.5 + 0.5 * (sum / norm) * 1.9, 0, 1);
      const v = lerp(lo, hi, n);
      const i = (y * size + x) * 4;
      d[i] = Math.min(255, v * tint[0] * 255); d[i + 1] = Math.min(255, v * tint[1] * 255); d[i + 2] = Math.min(255, v * tint[2] * 255); d[i + 3] = 255;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Fine gravel seen between the pebbles.
function gravelTexture(size = 512, seed = 3) {
  const rng = new Rng(seed);
  // low-contrast palette: the lighting (shadows, caustics) should carry the detail, not the albedo
  const palette = [[150, 138, 116], [132, 128, 122], [104, 104, 106], [92, 86, 80], [128, 110, 92], [166, 160, 146], [84, 80, 76]];
  return makeCanvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = '#5a5044';
    ctx.fillRect(0, 0, w, h);
    const count = Math.floor((size * size) / 70);
    for (let i = 0; i < count; i++) {
      const c = rng.pick(palette);
      const jitter = rng.range(-10, 10);
      const fill = `rgb(${c[0] + jitter},${c[1] + jitter},${c[2] + jitter})`;
      const x = rng.range(0, w), y = rng.range(0, h);
      const rx = rng.range(2.6, 7.0), ry = rx * rng.range(0.65, 1.0), rot = rng.range(0, Math.PI);
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        const px = x + ox, py = y + oy;
        if (px < -8 || py < -8 || px > w + 8 || py > h + 8) continue;
        ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
        const g = ctx.createRadialGradient(-rx * 0.3, -ry * 0.35, rx * 0.1, 0, 0, rx * 1.1);
        g.addColorStop(0, 'rgba(255,250,240,0.22)');
        g.addColorStop(0.4, fill);
        g.addColorStop(1, 'rgba(40,32,26,0.75)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, TWO_PI); ctx.fill();
        ctx.restore();
      }
    }
  }, { repeat: [5, 3] });
}

// Coursed, weathered stone blocks for the castle.
function stoneTexture(w = 1024, h = 512, seed = 11, { courses = 7, hue = 36, sat = 9, light = 52 } = {}) {
  const rng = new Rng(seed);
  const grain = makePeriodicNoise(seed + 5, 64);
  return makeCanvasTexture(w, h, (ctx) => {
    ctx.fillStyle = `hsl(${hue}, 8%, 24%)`;
    ctx.fillRect(0, 0, w, h);
    const rowH = h / courses;
    for (let r = 0; r < courses; r++) {
      const y0 = r * rowH;
      let x = -rng.range(0, 180);
      while (x < w) {
        const bw = rng.range(95, 190);
        const l = light + rng.range(-9, 8), s = sat + rng.range(-3, 5);
        ctx.fillStyle = `hsl(${hue + rng.range(-6, 6)}, ${s}%, ${l}%)`;
        ctx.fillRect(x + 2, y0 + 2, bw - 4, rowH - 4);
        // bevel: light top/left edge, dark bottom/right edge
        ctx.fillStyle = 'rgba(255,246,228,0.22)';
        ctx.fillRect(x + 2, y0 + 2, bw - 4, 3); ctx.fillRect(x + 2, y0 + 2, 3, rowH - 4);
        ctx.fillStyle = 'rgba(20,16,12,0.30)';
        ctx.fillRect(x + 2, y0 + rowH - 6, bw - 4, 4); ctx.fillRect(x + bw - 6, y0 + 2, 4, rowH - 4);
        // pitting
        const pits = rng.int(2, 7);
        for (let k = 0; k < pits; k++) {
          const px = x + rng.range(8, bw - 8), py = y0 + rng.range(8, rowH - 8), pr = rng.range(1.5, 5);
          const g = ctx.createRadialGradient(px, py, 0, px, py, pr);
          g.addColorStop(0, 'rgba(30,24,18,0.45)'); g.addColorStop(1, 'rgba(30,24,18,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, pr, 0, TWO_PI); ctx.fill();
        }
        x += bw;
      }
    }
    // grain
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = grain((x / w) * 64, (y / h) * 32) * 0.10 + grain((x / w) * 256, (y / h) * 128) * 0.05;
      d[i] = clamp(d[i] * (1 + n), 0, 255); d[i + 1] = clamp(d[i + 1] * (1 + n), 0, 255); d[i + 2] = clamp(d[i + 2] * (1 + n), 0, 255);
    }
    ctx.putImageData(img, 0, 0);
    // cracks
    ctx.strokeStyle = 'rgba(24,18,14,0.55)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    for (let c = 0; c < 9; c++) {
      let px = rng.range(0, w), py = rng.range(0, h);
      ctx.beginPath(); ctx.moveTo(px, py);
      const segs = rng.int(3, 7);
      for (let s = 0; s < segs; s++) { px += rng.range(-30, 30); py += rng.range(8, 34); ctx.lineTo(px, py); }
      ctx.stroke();
    }
    // weathering stains (cool / greenish)
    for (let c = 0; c < 14; c++) {
      const px = rng.range(0, w), py = rng.range(0, h), pr = rng.range(40, 150);
      const g = ctx.createRadialGradient(px, py, 0, px, py, pr);
      const greenish = rng.float() < 0.5;
      g.addColorStop(0, greenish ? 'rgba(70,96,60,0.22)' : 'rgba(40,52,62,0.20)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
  });
}

// Black filter sponge: dark rubber with lighter ridges and dark pores.
function spongeTexture(size = 256, seed = 5) {
  const rng = new Rng(seed);
  return makeCanvasTexture(size, size, (ctx, w, h) => {
    ctx.fillStyle = '#1b1b1d'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      const x = rng.range(0, w), y = rng.range(0, h), r = rng.range(1.2, 5.5);
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        const px = x + ox, py = y + oy;
        if (px < -8 || py < -8 || px > w + 8 || py > h + 8) continue;
        ctx.fillStyle = 'rgba(70,70,74,0.9)'; ctx.beginPath(); ctx.arc(px, py + 0.8, r, 0, TWO_PI); ctx.fill();
        ctx.fillStyle = 'rgba(3,3,4,1)'; ctx.beginPath(); ctx.arc(px, py, r * 0.78, 0, TWO_PI); ctx.fill();
      }
    }
  }, { repeat: [2, 2] });
}

// Small soft disc used by suspended particles (rendered as points).
function softDiscTexture(size = 64) {
  return makeCanvasTexture(size, size, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { srgb: false });
}
