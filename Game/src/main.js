// DEEPWAKE entry: fixed-step loop, input routing with post-overlay locks, lifecycle, records.
import { Game } from './sim/game.js';
import { STATE, FIXED_STEP, MAX_FRAME_DT } from './sim/tuning.js';
import { regionAt } from './sim/level.js';
import { Renderer } from './render/renderer.js';
import { AudioEngine } from './audio/audio.js';
import { UI } from './ui/ui.js';
import { RecordStore, loadSettings, saveSettings, validateSettings } from './records.js';

const KEYMAP = {
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  KeyZ: 'jump',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyX: 'dash',
  KeyQ: 'pulse',
  KeyE: 'interact',
  KeyR: 'retry',
};
const ACTIONS = ['left', 'right', 'jump', 'dash', 'pulse', 'interact', 'retry'];

const SOUND = {
  jump: 'jump',
  wallJump: 'wallJump',
  land: 'land',
  step: 'step',
  slideStart: 'slideStart',
  slideEnd: 'slideEnd',
  dash: 'dash',
  dashStop: 'dashStop',
  seamBreak: 'seamBreak',
  seamThud: 'seamThud',
  pulse: 'pulse',
  pulseDenied: 'pulseDenied',
  shield: 'shield',
  damage: 'damage',
  pickup: 'pickup',
  place: 'place',
  insert: 'insert',
  remove: 'remove',
  placeDenied: 'placeDenied',
  switchOn: 'switchOn',
  relayActivate: 'relayActivate',
  relayUnpowered: 'relayUnpowered',
  station: 'station',
  checkpoint: 'checkpoint',
  archive: 'archive',
  cache: 'cache',
  skitterAlert: 'skitterAlert',
  skitterTelegraph: 'skitterTelegraph',
  skitterLunge: 'skitterLunge',
  droneAim: 'droneAim',
  boltFire: 'boltFire',
  boltImpact: 'boltImpact',
  beamWarning: 'beamWarning',
  beamFire: 'beamFire',
  beamVent: 'beamVent',
  vent_warning: 'vent_warning',
  vent_active: 'vent_active',
  enemyStun: 'enemyStun',
  enemyDisable: 'enemyDisable',
  pulseDeflect: 'pulseDeflect',
  shutterOpen: 'shutterOpen',
  shutterClose: 'shutterClose',
  moverPush: 'moverPush',
  crush: 'crush',
  shutdown: 'shutdown',
  reboot: 'reboot',
  liftAscend: 'liftStart',
  liftArrive: 'liftArrive',
  liftDenied: 'liftDenied',
  complete: 'complete',
};

class App {
  constructor() {
    this.game = new Game();
    this.settings = loadSettings();
    this.records = new RecordStore();
    this.keysDown = new Set();
    this.touchDown = new Map();
    this.latched = new Set(); // presses that must survive at least one simulation step
    this.locked = false;
    this.accumulator = 0;
    this.last = performance.now();
    this.time = 0;
    this.lastState = this.game.state;
    this.lastRegion = this.game.region;
    this.frameStats = { frames: 0, lastFps: 0, fpsTime: 0, fpsCount: 0 };

    const canvas = document.getElementById('game');
    this.renderer = null;
    if (Renderer.isSupported()) {
      try {
        this.renderer = new Renderer(canvas, this.game.level, this.settings);
      } catch (err) {
        console.error('Renderer init failed', err);
        this.renderer = null;
      }
    }
    if (!this.renderer) {
      document.getElementById('fatal').classList.remove('hidden');
      return;
    }
    this.audio = new AudioEngine(this.settings);
    this.ui = new UI({
      pause: () => this.togglePause(),
      toggleMute: () => this.toggleMute(),
      isMuted: () => this.audio.muted,
      action: (act, kind) => this.onAction(act, kind),
    });
    this.ui.setTouchVisible(this.touchWanted());
    document.body.classList.toggle('reduced', !!this.settings.reducedMotion);
    this.bindInput();
    this.bindTouch();
    this.bindLifecycle();
    this.ui.show('title', this.game, { records: this.records.records });
    this.exposeApi();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------- settings
  touchWanted() {
    const t = this.settings.touch;
    if (t === 'on') return true;
    if (t === 'off') return false;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const noHover = window.matchMedia && window.matchMedia('(hover: none)').matches;
    return coarse || (noHover && (navigator.maxTouchPoints || 0) > 0);
  }

  saveSettings() {
    this.settings = validateSettings(this.settings);
    saveSettings(this.settings);
  }

  toggleMute() {
    this.audio.unlock();
    this.audio.setMuted(!this.audio.muted);
    this.settings.muted = this.audio.muted;
    this.saveSettings();
    if (this.ui.overlayKind === 'pause') this.ui.show('pause', this.game, this.pauseExtras());
  }

  toggleMotion() {
    this.settings.reducedMotion = !this.settings.reducedMotion;
    this.saveSettings();
    document.body.classList.toggle('reduced', !!this.settings.reducedMotion);
    if (this.renderer) this.renderer.setReducedMotion(!!this.settings.reducedMotion);
    if (this.ui.overlayKind === 'pause') this.ui.show('pause', this.game, this.pauseExtras());
  }

  cycleTouch() {
    const order = ['auto', 'on', 'off'];
    this.settings.touch = order[(order.indexOf(this.settings.touch) + 1) % 3];
    this.saveSettings();
    this.ui.setTouchVisible(this.touchWanted());
    if (this.ui.overlayKind === 'pause') this.ui.show('pause', this.game, this.pauseExtras());
  }

  pauseExtras() {
    return { settings: this.settings, records: this.records.records };
  }

  // ------------------------------------------------------------- input
  bindInput() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
  }

  onKeyDown(e) {
    const act = KEYMAP[e.code];
    if (act) {
      e.preventDefault();
      if (e.repeat) return;
      this.keysDown.add(e.code);
      this.latched.add(act);
      this.audio.unlock();
      this.applyInput();
      return;
    }
    if (e.code === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      this.audio.unlock();
      this.confirm();
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault();
      if (e.repeat) return;
      this.audio.unlock();
      this.togglePause();
      return;
    }
    if (e.code === 'KeyM') {
      if (e.repeat) return;
      this.toggleMute();
    }
  }

  onKeyUp(e) {
    if (KEYMAP[e.code]) {
      e.preventDefault();
      this.keysDown.delete(e.code);
      this.applyInput();
    }
  }

  anyGameplayKeyDown() {
    for (const k of this.keysDown) if (KEYMAP[k]) return true;
    return this.touchDown.size > 0;
  }

  /** Route physical input into the sim. While locked, nothing reaches the game until all keys are released. */
  applyInput() {
    const held = (a) => {
      for (const k of this.keysDown) if (KEYMAP[k] === a) return true;
      for (const v of this.touchDown.values()) if (v === a) return true;
      return false;
    };
    if (this.locked && !this.anyGameplayKeyDown()) this.locked = false;
    for (const a of ACTIONS) this.game.setKey(a, !this.locked && (held(a) || this.latched.has(a)));
  }

  /** Called after a simulation step: a latched press that was already released lasts exactly one step. */
  consumeLatches() {
    for (const a of Array.from(this.latched)) {
      const stillHeld = Array.from(this.keysDown).some((k) => KEYMAP[k] === a) || Array.from(this.touchDown.values()).includes(a);
      if (!stillHeld) {
        this.latched.delete(a);
        this.game.setKey(a, false);
      }
    }
  }

  releaseEverything(lock = true) {
    this.keysDown.clear();
    this.touchDown.clear();
    this.latched.clear();
    for (const b of this.ui.dom.touch.querySelectorAll('.tbtn')) b.classList.remove('active');
    this.game.releaseAll();
    if (lock) this.locked = true;
  }

  bindTouch() {
    const buttons = Array.from(this.ui.dom.touch.querySelectorAll('.tbtn'));
    for (const b of buttons) {
      const act = b.dataset.act;
      const down = (e) => {
        e.preventDefault();
        this.audio.unlock();
        try {
          b.setPointerCapture(e.pointerId);
        } catch {}
        this.touchDown.set(e.pointerId, act);
        this.latched.add(act);
        b.classList.add('active');
        this.applyInput();
      };
      const up = (e) => {
        e.preventDefault();
        this.touchDown.delete(e.pointerId);
        b.classList.remove('active');
        this.applyInput();
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    // Prevent gestures from scrolling the page.
    document.getElementById('touch').addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  }

  bindLifecycle() {
    window.addEventListener('blur', () => this.loseFocus());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.loseFocus();
      else this.last = performance.now();
    });
    window.addEventListener('resize', () => this.renderer && this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer && this.renderer.resize(), 120));
  }

  loseFocus() {
    this.releaseEverything(true);
    if (this.game.state === STATE.PLAY) this.togglePause();
    this.audio.setSuspended(true);
  }

  // ------------------------------------------------------------- flow
  confirm() {
    const st = this.game.state;
    if (st === STATE.TITLE) this.onAction('begin', 'title');
    else if (st === STATE.PAUSED) this.onAction('resume', 'pause');
    else if (st === STATE.COMPLETE) this.onAction('restart', 'complete');
    else if (st === STATE.PLAY && this.game.archiveOpen) this.game.dismissArchive();
  }

  togglePause() {
    const g = this.game;
    if ([STATE.TITLE, STATE.COMPLETE, STATE.SHUTDOWN, STATE.REBOOT, STATE.LIFT, STATE.RELAY].includes(g.state)) return;
    const nowPaused = g.togglePause();
    if (nowPaused) {
      this.releaseEverything(true);
      this.audio.setSuspended(true);
      this.ui.show('pause', g, this.pauseExtras());
    } else {
      this.ui.hide();
      this.locked = true;
      this.applyInput();
      this.audio.setSuspended(false);
    }
  }

  onAction(act, kind) {
    const g = this.game;
    switch (act) {
      case 'begin':
        if (g.begin()) {
          this.ui.hide();
          this.locked = true;
          this.applyInput();
          this.audio.setSuspended(false);
        }
        break;
      case 'resume':
        if (g.resume()) {
          this.ui.hide();
          this.locked = true;
          this.applyInput();
          this.audio.setSuspended(false);
        }
        break;
      case 'retry':
        g.resume();
        this.ui.hide();
        this.locked = true;
        this.applyInput();
        this.audio.setSuspended(false);
        g.setKey('retry', true);
        g.step();
        g.setKey('retry', false);
        this.accumulator = 0;
        break;
      case 'restart':
        g.restartExpedition();
        this.ui.hide();
        this.ui.recovery(false);
        if (this.renderer) this.renderer.clearEffects();
        this.locked = true;
        this.applyInput();
        this.audio.setSuspended(false);
        this.audio.setRegion(g.region, true);
        this.accumulator = 0;
        break;
      case 'mute':
        this.toggleMute();
        break;
      case 'motion':
        this.toggleMotion();
        break;
      case 'touch':
        this.cycleTouch();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------- events
  handleEvents(events) {
    const g = this.game;
    for (const e of events) {
      const s = SOUND[e.type];
      if (s) this.audio.sfx(s, e);
      switch (e.type) {
        case 'shield':
          this.ui.flash('shield');
          break;
        case 'damage':
          this.ui.flash('damage');
          break;
        case 'pulseDenied':
          this.ui.flash('deny');
          break;
        case 'relayActivate':
          this.ui.toast(`Relay ${e.id} online · route opened`, 'cyan', 3);
          break;
        case 'station':
          this.ui.toast('Station online · checkpoint committed', 'teal', 2.6);
          break;
        case 'cache':
          this.ui.toast(e.atFull ? 'Salvage cache recorded (resonance already full)' : `Salvage cache · +${e.gained} resonance`, 'amber', 2.4);
          break;
        case 'shutdown':
          this.ui.recovery(true, e.reason);
          if (this.renderer) this.renderer.clearEffects();
          this.audio.setSuspended(false);
          break;
        case 'rebooted':
          this.ui.recovery(false);
          break;
        case 'liftSequence':
          this.ui.toast('All relays online · ascent lift engaged', 'cyan', 3);
          break;
        case 'complete': {
          const newBests = this.records.applyResult(e.result);
          this.ui.show('complete', g, { result: e.result, newBests, records: this.records.records });
          break;
        }
        case 'restart':
          this.ui.showRegion(g.region);
          break;
        default:
          break;
      }
    }
    if (g.region !== this.lastRegion && g.state === STATE.PLAY) {
      this.lastRegion = g.region;
      this.audio.setRegion(g.region);
      this.ui.showRegion(g.region);
    }
    if (g.state !== this.lastState) {
      const prev = this.lastState;
      this.lastState = g.state;
      if (g.state === STATE.PLAY && (prev === STATE.RELAY || prev === STATE.REBOOT)) this.applyInput(); // held keys resume after automatic transitions
    }
    if (this.renderer) this.renderer.handleEvents(events, g.world);
  }

  // ------------------------------------------------------------- loop
  loop(now) {
    const dt = Math.min(MAX_FRAME_DT, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.accumulator += dt;
    let n = 0;
    while (this.accumulator >= FIXED_STEP && n < 24) {
      this.game.step();
      this.consumeLatches();
      this.accumulator -= FIXED_STEP;
      n++;
    }
    const events = this.game.drainEvents();
    this.handleEvents(events);
    if (this.renderer) this.renderer.render(this.game, dt, this.time, events);
    this.audio.update();
    this.ui.update(this.game, dt);
    const fs = this.frameStats;
    fs.frames += 1;
    fs.fpsTime += dt;
    fs.fpsCount += 1;
    if (fs.fpsTime >= 1) {
      fs.lastFps = fs.fpsCount / fs.fpsTime;
      fs.fpsTime = 0;
      fs.fpsCount = 0;
    }
    requestAnimationFrame(this.loop);
  }

  /** Small deterministic inspection API for checks. No debugging details appear in the UI. */
  exposeApi() {
    const app = this;
    window.DEEPWAKE = Object.freeze({
      version: '1.0.0',
      getState: () => app.game.getState(),
      press: (action, down) => {
        if (!ACTIONS.includes(action)) return false;
        app.game.setKey(action, !!down);
        return true;
      },
      /** Advance the simulation by `seconds` with the currently pressed inputs (headless checks). */
      step: (seconds) => {
        const n = Math.round(seconds / FIXED_STEP);
        for (let i = 0; i < n; i++) app.game.step();
        app.game.drainEvents();
        return app.game.getState();
      },
      start: () => app.onAction('begin', 'title'),
      pause: () => app.togglePause(),
      stats: () => ({ fps: app.frameStats.lastFps, frames: app.frameStats.frames, audio: app.audio.unlocked ? app.audio.ctx.state : 'locked', recordsAvailable: app.records.available }),
      records: () => ({ ...app.records.records }),
      settings: () => ({ ...app.settings }),
    });
  }
}

// Module scripts execute after the document is parsed, so the DOM is ready here.
try {
  new App();
} catch (err) {
  console.error(err);
  document.getElementById('fatal').classList.remove('hidden');
}
