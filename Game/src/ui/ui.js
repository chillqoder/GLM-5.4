// DOM UI: HUD, contextual prompts, toasts, overlays (title, pause, recovery, archive, complete).
import { formatTime, ARCHIVE_COUNT } from '../records.js';
import { STATE } from '../sim/tuning.js';
import { REGIONS } from '../sim/level.js';

const $ = (sel) => document.querySelector(sel);
const el = (id) => document.getElementById(id);

export class UI {
  constructor(callbacks) {
    this.cb = callbacks;
    this.dom = {
      integrity: el('integrity').children,
      resFill: el('resonance').querySelector('.fill'),
      resNum: el('resonance-num'),
      relays: el('relays').children,
      archives: el('archives-pill'),
      prompt: el('prompt'),
      carry: el('carry'),
      toast: el('toast'),
      vignette: el('vignette'),
      region: el('region-name'),
      overlay: el('overlay'),
      panel: el('panel'),
      recovery: el('recovery-banner'),
      fragment: el('archive-fragment'),
      mute: el('btn-mute'),
      pause: el('btn-pause'),
      touch: el('touch'),
    };
    this.toastTimer = 0;
    this.vignetteTimer = 0;
    this.regionTimer = 0;
    this.lastRegion = null;
    this.overlayKind = null;
    this.archiveShown = null;
    this.lastHud = {};
    el('btn-pause').addEventListener('click', () => callbacks.pause());
    el('btn-mute').addEventListener('click', () => callbacks.toggleMute());
  }

  // ---------------------------------------------------------------- HUD
  update(game, dt) {
    const d = this.dom;
    const p = game.player;
    const w = game.world;
    // integrity
    for (let i = 0; i < 3; i++) {
      const on = i < p.integrity;
      if (this.lastHud[`int${i}`] !== on) {
        d.integrity[i].classList.toggle('on', on);
        this.lastHud[`int${i}`] = on;
      }
    }
    const shieldReady = p.energy >= 50;
    // resonance
    const e = Math.round(p.energy);
    if (this.lastHud.energy !== e) {
      d.resFill.style.width = `${e}%`;
      d.resFill.classList.toggle('low', e < 35);
      d.resNum.textContent = String(e);
      this.lastHud.energy = e;
    }
    if (this.lastHud.shield !== shieldReady) {
      d.integrity[0].classList.toggle('shield', shieldReady);
      this.lastHud.shield = shieldReady;
    }
    // relays
    game.level.relays.forEach((r, i) => {
      const on = w.relays[r.id].active;
      if (this.lastHud[`relay${r.id}`] !== on) {
        d.relays[i].classList.toggle('active', on);
        d.relays[i].title = `Relay ${r.id}: ${on ? 'online' : 'offline'}`;
        this.lastHud[`relay${r.id}`] = on;
      }
    });
    const arch = Object.values(w.archives).filter((a) => a.collected).length;
    if (this.lastHud.arch !== arch) {
      d.archives.textContent = `${arch} / ${ARCHIVE_COUNT}`;
      d.archives.classList.toggle('full', arch === ARCHIVE_COUNT);
      this.lastHud.arch = arch;
    }
    // carry state
    const carrying = !!p.carrying;
    if (this.lastHud.carrying !== carrying) {
      d.carry.classList.toggle('hidden', !carrying);
      this.lastHud.carrying = carrying;
    }
    // prompt (contextual, only near meaningful interactions)
    const showPrompt = game.state === STATE.PLAY && game.interaction && !game.archiveOpen;
    const key = showPrompt ? `${game.interaction.kind}:${game.interaction.id}:${game.interaction.label}` : '';
    if (this.lastHud.prompt !== key) {
      if (showPrompt) {
        const it = game.interaction;
        const keyName = it.kind === 'pulse' ? 'Q' : 'E';
        d.prompt.innerHTML = `<span class="key">${keyName}</span> — ${escapeHtml(it.label)}`;
        d.prompt.classList.toggle('warn', it.kind === 'liftLocked');
        d.prompt.classList.remove('hidden');
      } else {
        d.prompt.classList.add('hidden');
      }
      this.lastHud.prompt = key;
    }
    // touch ability buttons dim while carrying
    if (document.body.classList.contains('touch')) {
      for (const b of d.touch.querySelectorAll('.ability')) b.classList.toggle('dim', carrying);
    }
    // transient timers
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) d.toast.classList.remove('show');
    }
    if (this.vignetteTimer > 0) {
      this.vignetteTimer -= dt;
      if (this.vignetteTimer <= 0) d.vignette.className = '';
    }
    if (this.regionTimer > 0) {
      this.regionTimer -= dt;
      if (this.regionTimer <= 0) d.region.classList.remove('show');
    }
    // archive fragment auto-hide follows the sim
    if (game.archiveOpen !== this.archiveShown) {
      this.archiveShown = game.archiveOpen;
      if (this.archiveShown) this.showFragment(this.archiveShown, game);
      else d.fragment.classList.add('hidden');
    }
    // mute icon
    const muted = this.cb.isMuted();
    if (this.lastHud.muted !== muted) {
      d.mute.textContent = muted ? '♪̸' : '♪';
      d.mute.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
      d.mute.style.opacity = muted ? '0.5' : '1';
      this.lastHud.muted = muted;
    }
  }

  toast(text, kind = '', seconds = 2.6) {
    const t = this.dom.toast;
    t.textContent = text;
    t.className = `show ${kind}`;
    this.toastTimer = seconds;
  }

  flash(kind) {
    const v = this.dom.vignette;
    v.className = kind;
    this.vignetteTimer = kind === 'deny' ? 0.25 : 0.45;
  }

  showRegion(id) {
    const r = REGIONS.find((x) => x.id === id);
    if (!r) return;
    this.dom.region.textContent = r.name;
    this.dom.region.classList.add('show');
    this.regionTimer = 3.5;
  }

  showFragment(id, game) {
    const a = game.level.archives.find((x) => x.id === id);
    if (!a) return;
    const f = this.dom.fragment;
    f.querySelector('.t').textContent = `Memory Archive · ${a.title}`;
    f.querySelector('.x').textContent = a.text;
    f.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- overlays
  show(kind, game, extra = {}) {
    this.overlayKind = kind;
    const o = this.dom.overlay;
    const panel = this.dom.panel;
    o.classList.remove('hidden');
    const rec = extra.records;
    const recordsLine = rec
      ? `<div class="records">Personal records — Best completion: <b>${rec.bestTime !== null ? formatTime(rec.bestTime) : '—'}</b> · Best full-archive: <b>${rec.bestFullArchiveTime !== null ? formatTime(rec.bestFullArchiveTime) : '—'}</b> · Fewest recoveries: <b>${rec.fewestRecoveries !== null ? rec.fewestRecoveries : '—'}</b></div>`
      : '';
    const controls = `<div class="controls">
      <b><span class="k">A / D</span> or <span class="k">← →</span></b><span>Move</span>
      <b><span class="k">Space</span> / <span class="k">Z</span></b><span>Jump — hold for height; jump away from walls</span>
      <b><span class="k">Shift</span> / <span class="k">X</span></b><span>Dash — breaks cracked seams, disables stunned machines</span>
      <b><span class="k">Q</span></b><span>Echo pulse — reveals, stuns, reaches relay nodes</span>
      <b><span class="k">E</span></b><span>Interact — cells, switches, archives, lift</span>
      <b><span class="k">R</span></b><span>Retry from the last station (keeps committed progress)</span>
      <b><span class="k">P</span> / <span class="k">Esc</span></b><span>Pause</span>
    </div>`;
    if (kind === 'title') {
      o.classList.add('clear');
      panel.style.background = 'var(--backing)';
      panel.innerHTML = `<h1>DEEPWAKE</h1>
        <p class="ink">Restore three resonance relays. Reach the ascent lift.</p>
        <p>A small maintenance robot wakes beneath a collapsed research station.</p>
        ${controls}
        <div class="btn-row"><button class="btn" data-act="begin">Begin Expedition <span style="opacity:.6">↵</span></button></div>
        ${recordsLine}`;
    } else if (kind === 'pause') {
      o.classList.remove('clear');
      const w = game.world;
      const list = game.level.archives
        .map((a) => `<li class="${w.archives[a.id].collected ? 'got' : ''}">${w.archives[a.id].collected ? `<span class="t">${a.title}</span>${a.text}` : 'Uncollected fragment'}</li>`)
        .join('');
      const settings = extra.settings || {};
      panel.innerHTML = `<h2>Expedition Paused</h2>
        <div class="stats"><span class="k">Expedition time</span><span class="v">${formatTime(w.time)}</span><span class="k">Relays</span><span class="v">${game.level.relays.map((r) => `${r.id}:${w.relays[r.id].active ? '✓' : '—'}`).join('  ')}</span><span class="k">Archives</span><span class="v">${Object.values(w.archives).filter((a) => a.collected).length} / ${ARCHIVE_COUNT}</span><span class="k">Recoveries</span><span class="v">${w.stats.recoveries}</span></div>
        <div class="btn-row"><button class="btn" data-act="resume">Resume <span style="opacity:.6">Esc</span></button><button class="btn secondary" data-act="retry">Retry from Checkpoint <span style="opacity:.6">R</span></button></div>
        <p class="hint">Retry returns to the last station and keeps committed progress. Restart begins a new expedition and clears this run.</p>
        <div class="btn-row"><button class="btn danger" data-act="restart" data-confirm="0">Restart Expedition</button></div>
        <h2 style="margin-top:18px;font-size:14px">Memory Archives</h2>
        <ul class="archives-list">${list}</ul>
        <h2 style="margin-top:14px;font-size:14px">Settings</h2>
        <div class="btn-row">
          <button class="btn secondary toggle ${settings.muted ? 'off' : ''}" data-act="mute">Sound: ${settings.muted ? 'Off' : 'On'}</button>
          <button class="btn secondary toggle ${settings.reducedMotion ? 'off' : ''}" data-act="motion">Reduced motion: ${settings.reducedMotion ? 'On' : 'Off'}</button>
          <button class="btn secondary toggle ${settings.touch === 'off' ? 'off' : ''}" data-act="touch">Touch controls: ${settings.touch === 'auto' ? 'Auto' : settings.touch === 'on' ? 'On' : 'Off'}</button>
        </div>
        ${recordsLine}`;
    } else if (kind === 'complete') {
      o.classList.remove('clear');
      const r = extra.result;
      const nb = extra.newBests || [];
      const full = r.archives.length >= ARCHIVE_COUNT;
      panel.innerHTML = `<h2>Signal Restored ${full ? '<span class="tag">Full Archive Run</span>' : ''}</h2>
        <p class="ink">ILO steps onto the ruined observation terrace as dawn light spills across the station.</p>
        <div class="relay-states">${['A', 'B', 'C'].map((k) => `<span class="${r.relays[k] ? 'on' : ''}">Relay ${k} ${r.relays[k] ? 'online' : 'offline'}</span>`).join('')}</div>
        <div class="stats">
          <span class="k">Expedition time</span><span class="v ${nb.includes('bestTime') || nb.includes('bestFullArchiveTime') ? 'new' : ''}">${formatTime(r.time)}</span>
          <span class="k">Recoveries</span><span class="v ${nb.includes('fewestRecoveries') ? 'new' : ''}">${r.recoveries}</span>
          <span class="k">Archives recovered</span><span class="v ${full ? 'good' : ''}">${r.archives.length} / ${ARCHIVE_COUNT}</span>
          <span class="k">Salvage caches found</span><span class="v">${r.caches} / 3</span>
          <span class="k">Machines disabled</span><span class="v">${r.machinesDisabled} / 5</span>
          <span class="k">Shield absorptions</span><span class="v">${r.shieldAbsorbs}</span>
        </div>
        ${nb.length ? `<p class="ink" style="color:var(--amber)">New personal record${nb.length > 1 ? 's' : ''}: ${nb.map(labelBest).join(', ')}</p>` : ''}
        <div class="btn-row"><button class="btn" data-act="restart">New Expedition <span style="opacity:.6">↵</span></button></div>
        ${recordsLine}`;
    }
    panel.querySelectorAll('button[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'restart' && kind === 'pause' && b.dataset.confirm === '0') {
          b.dataset.confirm = '1';
          b.textContent = 'Confirm: clear this run and restart';
          return;
        }
        this.cb.action(act, kind);
      });
    });
    const primary = panel.querySelector('button.btn:not(.secondary):not(.danger)');
    if (primary) primary.focus({ preventScroll: true });
  }

  hide() {
    this.overlayKind = null;
    this.dom.overlay.classList.add('hidden');
  }

  get visible() {
    return !!this.overlayKind;
  }

  recovery(show, reason) {
    const r = this.dom.recovery;
    r.classList.toggle('hidden', !show);
    if (show) r.textContent = reason === 'retry' ? 'Returning to Station' : 'Rebooting at Station';
  }

  setTouchVisible(v) {
    document.body.classList.toggle('touch', v);
  }
}

function labelBest(k) {
  return { bestTime: 'Best Completion Time', bestFullArchiveTime: 'Best Full-Archive Time', fewestRecoveries: 'Fewest Recoveries' }[k] || k;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
