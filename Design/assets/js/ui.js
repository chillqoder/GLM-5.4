/* Rough Idea — UI. Navigation, reveals, service rows, concept dialog, estimator,
   accordion and a contact form that opens the visitor's own mail app (no fake submits). */
(function () {
  'use strict';
  const RI = window.RI;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const MAIL = 'hello@roughidea.studio';

  const NAMES = ['Intro', 'What we build', 'How it works', 'Concepts', 'The rough number', 'Ways to work', 'Fair questions', 'Start something'];
  const DOTS = ['#FFC400', '#1848DC', '#FFC400', '#FF3B24', '#FFC400', '#1848DC', '#FF3B24', '#FFC400'];

  const CONCEPTS = [
    {
      title: 'Crumb', meta: 'Concept · Web app · 2025', tag: 'Pre-order and pickup for a two-person bakery.',
      img: 'assets/img/concept-crumb.jpg',
      alt: 'Paper sculpture of a croissant on a chrome-yellow background, wrapped in a blue paper ribbon',
      problem: 'A neighborhood bakery sold out by 10am and had no idea what to bake tomorrow.',
      built: 'A three-tap pre-order flow, a “bake list” view for the oven, and a morning text that tells regulars what is coming out at seven.',
      learned: 'The bake list mattered more than the storefront. Staff tools are products too.',
      stack: 'Next.js · PostgreSQL · Twilio — built as a three-week prototype',
    },
    {
      title: 'Tally', meta: 'Concept · Automation · 2024', tag: 'An invoice chaser for freelancers who hate asking.',
      img: 'assets/img/concept-tally.jpg',
      alt: 'Paper calculator on a cobalt-blue background, threaded with a yellow paper ribbon',
      problem: 'Late invoices, awkward emails, and a spreadsheet of shame.',
      built: 'Connects to the bank and the invoicing tool, nudges clients on day 7, 14 and 30 with increasingly firm wording, and hands over a phone script on day 45.',
      learned: 'Polite beats firm until day 30. Then firm wins.',
      stack: 'Node · Plaid · Resend — running for six freelancers we know',
    },
    {
      title: 'Plot', meta: 'Concept · Website + booking · 2024', tag: 'Bed booking for a community garden.',
      img: 'assets/img/concept-plot.jpg',
      alt: 'Paper watering can and seedling pots on a leaf-green background, wound with a red paper ribbon',
      problem: 'A whiteboard in a shed and a waiting list in a notebook.',
      built: 'A map of beds with live availability, season-long bookings, and watering-rotation reminders.',
      learned: 'The waiting list was the feature. Scarcity is honest when it is visible.',
      stack: 'Astro · SQLite · a Telegram bot',
    },
    {
      title: 'Fleet', meta: 'Concept · SaaS · 2025', tag: 'Job scheduling for a twelve-person cleaning crew.',
      img: 'assets/img/concept-fleet.jpg',
      alt: 'Paper delivery van on a hot-pink background, trailing a green paper ribbon',
      problem: 'Jobs assigned by group chat. Two people turned up to the same flat twice in one week.',
      built: 'A drag-and-drop week view, route-aware assignment, and a “who’s where” map for the office manager.',
      learned: 'Route-aware beats clever. The best algorithm is the one the dispatcher can override.',
      stack: 'SvelteKit · Supabase · Mapbox',
    },
  ];

  // ------------------------------------------------------------------ chrome: nav, rail, chip
  function chrome(scene) {
    const nav = $('#nav'), sections = $$('.s'), rail = $$('.rail a'), railEl = $('.rail');
    const chip = $('.chip'), chipNum = $('.chip__num'), chipName = $('.chip__name');
    const isDark = (el) => el.classList.contains('s--dark');
    let raf = 0;
    const under = () => {
      raf = 0;
      const y = (window.pageYOffset || 0) + 44;
      let idx = 0;
      for (let i = 0; i < scene.secTop.length; i++) if (scene.secTop[i] <= y) idx = i;
      nav.dataset.on = isDark(sections[idx]) ? 'dark' : 'light';
      nav.classList.toggle('is-scrolled', (window.pageYOffset || 0) > 24);
    };
    addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(under); }, { passive: true });
    scene.onSection = (i) => {
      if (railEl) {
        railEl.dataset.on = isDark(sections[i]) ? 'dark' : 'light';
        railEl.style.setProperty('--rail-c', DOTS[i]);
      }
      rail.forEach((a, k) => {
        const on = k === i;
        a.classList.toggle('is-on', on);
        if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
      $$('.nav__links a').forEach((a) => a.classList.toggle('is-on', a.getAttribute('href') === '#' + sections[i].id));
      if (chip) {
        chipNum.textContent = String(i + 1).padStart(2, '0') + ' / 08';
        chipName.textContent = NAMES[i];
        chip.style.setProperty('--dot', DOTS[i]);
        chip.classList.remove('is-flip');
        void chip.offsetWidth;
        chip.classList.add('is-flip');
      }
    };
    under();
  }

  function menu() {
    const btn = $('.nav__toggle'), m = $('#menu');
    if (!btn || !m) return;
    const set = (open) => {
      m.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.querySelector('span').textContent = open ? 'Close' : 'Menu';
      document.documentElement.classList.toggle('menu-open', open);
      if (open) m.querySelector('a').focus(); else btn.focus();
    };
    btn.addEventListener('click', () => set(!m.classList.contains('is-open')));
    m.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && m.classList.contains('is-open')) set(false); });
  }

  // ------------------------------------------------------------------ reveals
  function reveals() {
    const els = $$('.reveal');
    if (reduced.matches || !('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    els.forEach((el) => io.observe(el));
    const ready = () => document.documentElement.classList.add('is-in');
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(ready);
    setTimeout(ready, 700);
  }

  // ------------------------------------------------------------------ services
  function services(scene) {
    $$('.svc__row').forEach((row, i) => {
      const btn = $('.svc__head', row);
      const open = () => { row.classList.remove('is-closed'); btn.setAttribute('aria-expanded', 'true'); };
      const close = () => { row.classList.add('is-closed'); btn.setAttribute('aria-expanded', 'false'); };
      if (!fine.matches) close();
      btn.addEventListener('click', () => { (row.classList.contains('is-closed') ? open : close)(); scene.flashGlyph(i); });
      row.addEventListener('pointerenter', () => { if (fine.matches) { scene.setHoverGlyph(i); row.classList.add('is-hot'); } });
      row.addEventListener('pointerleave', () => { if (fine.matches) { scene.setHoverGlyph(-1); row.classList.remove('is-hot'); } });
      btn.addEventListener('focus', () => { row.classList.add('is-hot'); if (!fine.matches) scene.flashGlyph(i); });
      btn.addEventListener('blur', () => row.classList.remove('is-hot'));
    });
  }

  // ------------------------------------------------------------------ concepts
  function concepts() {
    const dlg = $('#concept-dialog');
    if (!dlg) return;
    let last = null;
    const open = (i, trigger) => {
      const c = CONCEPTS[i];
      if (!c) return;
      last = trigger;
      const img = $('#cd-img');
      img.src = c.img; img.alt = c.alt;
      $('#cd-meta').textContent = c.meta;
      $('#cd-title').textContent = c.title;
      $('#cd-tag').textContent = c.tag;
      $('#cd-problem').textContent = c.problem;
      $('#cd-built').textContent = c.built;
      $('#cd-learned').textContent = c.learned;
      $('#cd-stack').textContent = c.stack;
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      $('#cd-close').focus();
    };
    $$('.print').forEach((b) => b.addEventListener('click', () => open(+b.dataset.concept, b)));
    $('#cd-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', () => { if (last) last.focus(); });
  }

  // ------------------------------------------------------------------ estimator
  const TYPES = [
    { id: 'website', label: 'website', base: 3200, size: 2400, integ: 800, design: 2200, wk: 1.2, wkSize: 0.6 },
    { id: 'webapp', label: 'web app', base: 8000, size: 5200, integ: 1600, design: 4200, wk: 2.2, wkSize: 1.1 },
    { id: 'automation', label: 'automation', base: 3800, size: 2900, integ: 1100, design: 600, wk: 1.0, wkSize: 0.7 },
    { id: 'integration', label: 'integration', base: 4500, size: 2600, integ: 1400, design: 400, wk: 1.2, wkSize: 0.6 },
    { id: 'mvp', label: 'MVP', base: 13000, size: 7000, integ: 1700, design: 3800, wk: 3.0, wkSize: 1.2 },
    { id: 'saas', label: 'SaaS product', base: 24000, size: 10500, integ: 2000, design: 5200, wk: 5.0, wkSize: 1.6 },
  ];
  const SIZES = ['tiny', 'small', 'standard size', 'serious', 'ambitious'];

  function money(v) {
    const k = v / 1000;
    return '$' + (Math.round(k * 10) / 10).toLocaleString('en-US') + 'k';
  }

  function estimator(scene) {
    const form = $('#est');
    if (!form) return;
    const out = { low: $('#est-low'), high: $('#est-high'), weeks: $('#est-weeks'), sum: $('#est-sum'), mail: $('#est-mail'), size: $('#est-size'), int: $('#est-int') };
    const compute = () => {
      const val = (n) => (form.elements[n] ? form.elements[n].value : '');
      const T = TYPES.find((t) => t.id === val('type')) || TYPES[0];
      const size = +val('size') || 3;
      const integ = +out.int.textContent || 0;
      const design = val('design'), pace = val('pace');
      const rush = pace === 'rush';
      let total = T.base + T.size * (size - 1) + T.integ * integ + (design === 'studio' ? T.design + T.size * 0.2 * (size - 1) : 0);
      if (rush) total *= 1.35;
      const low = Math.round((total * 0.82) / 500) * 500, high = Math.round((total * 1.28) / 500) * 500;
      const wk = (T.wk + T.wkSize * (size - 1) + integ * 0.2 + (design === 'studio' ? 0.4 : 0)) * (rush ? 0.7 : 1);
      const wl = Math.max(1, Math.round(wk * 0.85)), wh = Math.max(wl, Math.round(wk * 1.2));
      out.low.textContent = money(low);
      out.high.textContent = money(high);
      out.weeks.textContent = wl === wh ? wl + (wl === 1 ? ' week' : ' weeks') : wl + '–' + wh + ' weeks';
      const sum = 'A ' + T.label + ', ' + SIZES[size - 1] + ', with ' + (integ === 0 ? 'no integrations' : integ + (integ === 1 ? ' integration' : ' integrations')) + ', ' + (design === 'studio' ? 'designed from scratch' : 'using your designs') + ', at ' + (rush ? 'a rush pace' : 'a standard pace') + '.';
      out.sum.textContent = sum;
      scene.setFill(Math.sqrt(Math.min(1, total / 70000)));
      out.mail.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent('Rough estimate — ' + T.label) +
        '&body=' + encodeURIComponent('Hi Rough Idea,\n\nI played with your estimator:\n\n' + sum + '\n\nBallpark: ' + money(low) + ' – ' + money(high) + ' · ' + out.weeks.textContent + '\n\nCan we talk?\n');
    };
    form.addEventListener('input', compute);
    form.addEventListener('change', compute);
    const step = (d) => { out.int.textContent = String(Math.max(0, Math.min(6, (+out.int.textContent || 0) + d))); compute(); };
    $$('[data-step]', form).forEach((b) => b.addEventListener('click', () => step(+b.dataset.step)));
    $$('input[type=range]', form).forEach((r) => r.addEventListener('input', () => scene.pluck(0.5)));
    compute();
  }

  // ------------------------------------------------------------------ ways to work
  function ways(scene) {
    let last = 0;
    $$('.tier').forEach((t) => {
      const go = () => { const n = performance.now(); if (n - last > 260) { last = n; scene.pluck(0.9); } };
      t.addEventListener('pointerenter', () => { if (fine.matches) go(); });
      t.addEventListener('focusin', go);
    });
  }

  // ------------------------------------------------------------------ FAQ
  function faq(scene) {
    const items = $$('.acc__item');
    if (!items.length) return;
    const set = (item, open) => { item.classList.toggle('is-open', open); $('.acc__btn', item).setAttribute('aria-expanded', String(open)); };
    items.forEach((item) => {
      $('.acc__btn', item).addEventListener('click', () => {
        const willOpen = !item.classList.contains('is-open');
        items.forEach((o) => set(o, false));
        if (willOpen) set(item, true);
        scene.setCurl(willOpen ? 0.08 : 1);
        scene.pluck(0.8);
      });
    });
  }

  // ------------------------------------------------------------------ contact
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext !== false) {
      return navigator.clipboard.writeText(text).then(() => true, () => copyFallback(text));
    }
    return Promise.resolve(copyFallback(text));
  }
  function copyFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
  function contact(scene) {
    const form = $('#start-form');
    if (!form) return;
    const ok = $('#start-ok'), okMsg = $('#ok-msg');
    const flash = (btn, done) => {
      const label = $('span', btn), was = label.textContent;
      label.textContent = done ? 'Copied' : 'Press ⌘C';
      btn.classList.add('is-done');
      setTimeout(() => { label.textContent = was; btn.classList.remove('is-done'); }, 1600);
    };
    $$('[data-copy]').forEach((btn) => btn.addEventListener('click', () => {
      const txt = btn.dataset.copy === '@msg' ? okMsg.textContent : btn.dataset.copy;
      copyText(txt).then((done) => flash(btn, done));
    }));
    const invalid = (el, bad) => { el.setAttribute('aria-invalid', bad ? 'true' : 'false'); el.closest('.field').classList.toggle('is-bad', bad); };
    form.addEventListener('input', (e) => { if (e.target.closest('.field')) invalid(e.target, false); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const el = form.elements;
      const name = el.name.value.trim(), email = el.email.value.trim(), text = el.message.value.trim();
      let first = null;
      const check = (input, bad) => { invalid(input, bad); if (bad && !first) first = input; };
      check(el.name, !name);
      check(el.email, !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
      check(el.message, text.length < 8);
      if (first) { first.focus(); return; }
      const body = 'Hi Rough Idea,\n\n' + text + '\n\nRough budget: ' + el.budget.value + '\nTimeline: ' + el.when.value + '\n\n— ' + name + '\n' + email;
      okMsg.textContent = body;
      form.hidden = true; ok.hidden = false;
      ok.querySelector('h3').setAttribute('tabindex', '-1');
      ok.querySelector('h3').focus();
      window.location.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent('New project — ' + name) + '&body=' + encodeURIComponent(body);
      scene.celebrate();
    });
    const again = $('#ok-again');
    if (again) again.addEventListener('click', () => { ok.hidden = true; form.hidden = false; el0(form); });
    function el0(f) { f.elements.message.focus(); }
  }

  RI.UI = {
    init(scene) {
      chrome(scene); menu(); reveals(); services(scene); concepts(); estimator(scene); ways(scene); faq(scene); contact(scene);
      const y = $('#year'); if (y) y.textContent = String(new Date().getFullYear());
    },
  };
})();
