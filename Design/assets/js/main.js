/* Rough Idea — boot. Wires the tape, the renderer and the UI together and keeps the page
   working no matter what: no WebGL → 2D canvas; no canvas at all → the page without the tape. */
(function () {
  'use strict';
  const RI = window.RI;
  const html = document.documentElement;
  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = window.matchMedia('(pointer: coarse)');

  const dpr = () => Math.min(window.devicePixelRatio || 1, window.innerWidth < 900 ? 1.75 : 2);

  let canvas = document.getElementById('tape');
  let renderer = null, scene = null, ribbon = null;
  let grabbing = false, failed = false;

  try {
    ribbon = new RI.Ribbon(RI.N);
    ribbon.lively = !mqReduce.matches;
    if (canvas) renderer = RI.createRenderer(canvas);
    scene = new RI.Scene(ribbon, renderer, { reduced: mqReduce.matches });
  } catch (e) {
    console.error('[tape] init failed', e);
  }
  if (!scene) {
    // the UI expects a scene; give it a silent one so every control still works
    scene = { secTop: [], onSection: null, setHoverGlyph() {}, flashGlyph() {}, pluck() {}, celebrate() {}, setCurl() {}, setFill() {}, near() { return false; }, pointerDown() { return false; }, pointerMove() {}, pointerLeave() {}, pointerUp() {}, update() {}, view() {}, resize() {}, layout() {} };
    failed = true;
  }

  // ---- UI first: it must never depend on the tape
  try { RI.UI.init(scene); } catch (e) { console.error('[ui] init failed', e); }

  // ---- resize / layout
  let rt = 0;
  const resizeNow = () => {
    rt = 0;
    if (!ribbon) return;
    try {
      scene.resize();
      if (renderer) renderer.resize(window.innerWidth, window.innerHeight, dpr());
    } catch (e) { console.error('[tape] resize', e); }
  };
  const resizeSoon = () => { clearTimeout(rt); rt = setTimeout(resizeNow, 90); };
  addEventListener('resize', resizeSoon);
  addEventListener('orientationchange', resizeSoon);
  if ('ResizeObserver' in window && document.body) {
    try { new ResizeObserver(resizeSoon).observe(document.body); } catch (e) { /* older browser */ }
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resizeSoon);
  addEventListener('load', resizeSoon);

  // ---- pointer: brush the tape aside, grab it (mouse), pluck it (tap)
  addEventListener('pointermove', (e) => {
    if (failed) return;
    try {
      scene.pointerMove(e.clientX, e.clientY);
      html.classList.toggle('tape-near', !coarse.matches && !grabbing && scene.near(e.clientX, e.clientY, 28));
    } catch (err) { fail(err); }
  }, { passive: true });
  addEventListener('pointerdown', (e) => {
    if (failed || e.button !== 0) return;
    if (e.target.closest('a,button,input,select,textarea,label,summary,dialog,.nav,.menu,.rail')) return;
    try {
      if (!coarse.matches && scene.pointerDown(e.clientX, e.clientY)) {
        grabbing = true;
        html.classList.add('is-grabbing');
        e.preventDefault();
      } else if (scene.near(e.clientX, e.clientY, 34)) {
        scene.pluck(1.6);
      }
    } catch (err) { fail(err); }
  });
  const release = () => {
    if (!grabbing) return;
    grabbing = false;
    html.classList.remove('is-grabbing');
    try { scene.pointerUp(); } catch (err) { fail(err); }
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  addEventListener('blur', release);
  addEventListener('touchmove', (e) => { if (grabbing) e.preventDefault(); }, { passive: false });
  addEventListener('touchend', () => { if (scene) { try { scene.pointerLeave(); } catch (err) { fail(err); } } }, { passive: true });
  document.addEventListener('mouseleave', () => { if (scene) { try { scene.pointerLeave(); } catch (err) { fail(err); } } });

  // ---- reduced motion can change while the page is open
  const onMq = () => {
    if (!ribbon) return;
    ribbon.lively = !mqReduce.matches;
    scene.reduced = mqReduce.matches;
    if (mqReduce.matches) scene.reveal = 1;
    resizeSoon();
  };
  if (mqReduce.addEventListener) mqReduce.addEventListener('change', onMq); else mqReduce.addListener(onMq);

  // ---- if the GPU goes away mid-session, carry on with the 2D fallback
  const to2D = () => {
    if (failed || !canvas) return;
    try {
      const c = canvas.cloneNode(false);
      canvas.parentNode.replaceChild(c, canvas);
      canvas = c;
      const ctx = canvas.getContext('2d');
      renderer = ctx ? new RI.Renderer2D(canvas, ctx) : null;
      if (renderer) renderer.resize(window.innerWidth, window.innerHeight, dpr());
      scene.renderer = renderer;
    } catch (e) { renderer = null; }
  };
  if (canvas) canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); to2D(); });

  function fail(e) {
    failed = true;
    console.error('[tape] stopped', e);
    html.classList.remove('is-tape', 'tape-near', 'is-grabbing');
  }

  // ---- loop
  let last = -1;
  function frame(now) {
    const t = now / 1000;
    if (last < 0 || t - last > 0.5) last = t;
    const dt = Math.min(0.05, t - last);
    last = t;
    try {
      if (scene.t0 === undefined) scene.t0 = t;
      scene.update(dt, t);
      if (renderer) renderer.draw(ribbon, scene.view());
      html.classList.add('is-tape');
    } catch (e) {
      fail(e);
      return;
    }
    requestAnimationFrame(frame);
  }

  if (!failed && ribbon) {
    if (window.__riDebug) window.__riDebug({ ribbon, get renderer() { return renderer; }, get scene() { return scene; } });
    if (renderer) renderer.resize(window.innerWidth, window.innerHeight, dpr());
    // start exactly in place (no fly-in from the origin), then let the unroll animation take over
    try { scene.update(1 / 60, 0); scene.snap(); } catch (e) { fail(e); }
    requestAnimationFrame(frame);
  } else if (canvas) {
    canvas.style.display = 'none';
  }
})();
