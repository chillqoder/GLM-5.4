// Web Audio: original synthesized music and effects. One audio owner, bounded scheduling,
// gain ramps, cleanup of finished nodes. Audio failure never prevents play.
import { makeRng } from '../sim/math.js';

const REGION_MUSIC = {
  workshop: { bpm: 70, root: 146.83, scale: [0, 3, 5, 7, 10, 12, 15], drone: [1, 1.5], seed: 1, shimmer: 0, thump: 0.25 },
  reservoir: { bpm: 58, root: 220.0, scale: [0, 2, 4, 7, 9, 12, 14], drone: [1, 1.5, 2], seed: 2, shimmer: 0.6, thump: 0 },
  foundry: { bpm: 84, root: 130.81, scale: [0, 1, 5, 7, 8, 12, 13], drone: [1, 1.335], seed: 3, shimmer: 0, thump: 0.5 },
  ascent: { bpm: 64, root: 164.81, scale: [0, 4, 7, 11, 14, 16], drone: [1, 1.5, 2], seed: 4, shimmer: 0.35, thump: 0.15 },
};

export class AudioEngine {
  constructor(settings = {}) {
    this.ctx = null;
    this.unlocked = false;
    this.failed = false;
    this.muted = !!settings.muted;
    this.paused = false;
    this.hidden = false;
    this.region = 'workshop';
    this.nextStep = 0;
    this.stepIndex = 0;
    this.voices = 0;
    this.maxVoices = 36;
    this.drones = null;
    this.slideNode = null;
    this.liftNode = null;
    this.pattern = null;
    this.rng = makeRng(9);
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (this.unlocked || this.failed) return this.unlocked;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('no AudioContext');
      this.ctx = new AC();
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -18;
      this.comp.ratio.value = 4;
      this.master.connect(this.comp).connect(ctx.destination);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.55;
      this.musicBus.connect(this.master);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
      // shared noise buffer
      const len = ctx.sampleRate;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      const rng = makeRng(77);
      for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
      this.nextStep = ctx.currentTime + 0.2;
      this.unlocked = true;
      this.setRegion(this.region, true);
    } catch {
      this.failed = true;
      this.unlocked = false;
    }
    return this.unlocked;
  }

  get ready() {
    return this.unlocked && !this.failed && this.ctx && this.ctx.state === 'running';
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.03);
  }

  /** Pause / hidden tab: suspend the context so nothing accumulates; reset scheduling on resume. */
  setSuspended(suspend) {
    if (!this.unlocked || this.failed) return;
    const ctx = this.ctx;
    if (suspend) {
      if (ctx.state === 'running') ctx.suspend().catch(() => {});
      this.stopLoops();
    } else if (ctx.state === 'suspended') {
      ctx.resume()
        .then(() => {
          this.nextStep = Math.max(this.nextStep, ctx.currentTime + 0.15);
        })
        .catch(() => {});
    }
  }

  setRegion(id, force = false) {
    if (!force && id === this.region) return;
    this.region = id;
    this.stepIndex = 0;
    this.pattern = null;
    if (this.unlocked) this.rebuildDrones();
  }

  // ------------------------------------------------------------ music
  rebuildDrones() {
    if (!this.ready && !(this.unlocked && this.ctx.state === 'suspended')) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const cfg = REGION_MUSIC[this.region] || REGION_MUSIC.workshop;
    if (this.drones) {
      const old = this.drones;
      old.gain.gain.setTargetAtTime(0, now, 0.6);
      setTimeout(() => old.nodes.forEach((n) => {
        try {
          n.stop();
        } catch {}
      }), 2500);
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.musicBus);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 0.7;
    filter.connect(gain);
    const nodes = [];
    for (const ratio of cfg.drone) {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = ratio === 1 ? 'triangle' : 'sawtooth';
        o.frequency.value = cfg.root * ratio;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = ratio === 1 ? 0.11 : 0.035;
        o.connect(g).connect(filter);
        o.start(now);
        nodes.push(o);
      }
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 110;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start(now);
    nodes.push(lfo);
    gain.gain.setTargetAtTime(1, now, 0.8);
    this.drones = { gain, filter, nodes, cfg };
  }

  buildPattern(cfg) {
    const rng = makeRng(cfg.seed * 101 + 7);
    const steps = [];
    for (let i = 0; i < 16; i++) {
      const r = rng();
      if (r < 0.45) steps.push(null);
      else steps.push(cfg.scale[Math.floor(rng() * cfg.scale.length)]);
    }
    return steps;
  }

  /** Called every frame: schedules music a little ahead of time with bounded lookahead. */
  update() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const cfg = REGION_MUSIC[this.region] || REGION_MUSIC.workshop;
    if (!this.pattern) this.pattern = this.buildPattern(cfg);
    const stepDur = 60 / cfg.bpm / 2; // eighth notes
    if (this.nextStep < now - 0.5) this.nextStep = now + 0.05; // never dump a backlog
    while (this.nextStep < now + 0.3) {
      this.scheduleStep(this.stepIndex, this.nextStep, cfg, stepDur);
      this.nextStep += stepDur;
      this.stepIndex = (this.stepIndex + 1) % 64;
    }
  }

  scheduleStep(i, t, cfg, stepDur) {
    const bar = i % 16;
    const semis = this.pattern[bar];
    const f = (s) => cfg.root * Math.pow(2, s / 12);
    // Bass pulses on beats 1 and 3
    if (bar % 8 === 0) this.tone({ type: 'sine', freq: cfg.root / 2, dur: stepDur * 5, gain: 0.22, attack: 0.02, bus: this.musicBus });
    if (bar % 8 === 4 && cfg.thump > 0.3) this.noise({ dur: 0.25, gain: 0.12 * cfg.thump, type: 'lowpass', freq: 160, q: 1, bus: this.musicBus });
    // Plucks from the region's scale
    if (semis !== null) {
      const octave = bar % 4 === 2 ? 2 : 1;
      this.tone({ type: 'triangle', freq: f(semis) * octave, dur: 1.4, gain: 0.085, attack: 0.005, decay: 1.4, filter: { type: 'bandpass', freq: f(semis) * 2, q: 2 }, bus: this.musicBus });
      this.tone({ type: 'sine', freq: f(semis) * octave * 2, dur: 0.6, gain: 0.025, attack: 0.005, decay: 0.6, bus: this.musicBus });
    }
    // Crystal shimmer
    if (cfg.shimmer > 0 && bar % 4 === 3 && this.rng() < cfg.shimmer) {
      const s = cfg.scale[Math.floor(this.rng() * cfg.scale.length)] + 24;
      this.tone({ type: 'sine', freq: f(s), dur: 2.2, gain: 0.03, attack: 0.01, decay: 2.2, bus: this.musicBus });
    }
    // Foundry: slow mechanical thump every bar
    if (cfg.thump >= 0.5 && bar === 0) {
      this.noise({ dur: 0.5, gain: 0.1, type: 'lowpass', freq: 120, q: 0.8, bus: this.musicBus });
      this.tone({ type: 'sine', freq: 55, freqEnd: 38, dur: 0.5, gain: 0.2, attack: 0.005, bus: this.musicBus });
    }
  }

  // ------------------------------------------------------------ primitives
  voice() {
    if (this.voices >= this.maxVoices) return null;
    this.voices += 1;
    return true;
  }

  release(node, when) {
    const ctx = this.ctx;
    const track = this.voice();
    if (!track) return false;
    const done = () => {
      this.voices = Math.max(0, this.voices - 1);
      try {
        node.disconnect();
      } catch {}
    };
    node.addEventListener('ended', done);
    return true;
  }

  tone({ type = 'sine', freq = 440, freqEnd = null, dur = 0.2, gain = 0.2, attack = 0.005, decay = null, filter = null, bus = null, detune = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    let last = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type;
      f.frequency.value = filter.freq;
      f.Q.value = filter.q || 1;
      o.connect(f);
      last = f;
    }
    last.connect(g).connect(bus || this.sfxBus);
    if (!this.release(o)) return;
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noise({ dur = 0.2, gain = 0.2, type = 'bandpass', freq = 1000, freqEnd = null, q = 1, attack = 0.004, bus = null, rate = 1 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(bus || this.sfxBus);
    if (!this.release(src)) return;
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  stopLoops() {
    for (const key of ['slideNode', 'liftNode']) {
      const n = this[key];
      if (!n) continue;
      try {
        n.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        n.src.stop(this.ctx.currentTime + 0.3);
      } catch {}
      this[key] = null;
    }
  }

  loop(kind) {
    if (!this.ready || this[kind === 'slide' ? 'slideNode' : 'liftNode']) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    if (kind === 'slide') {
      f.type = 'bandpass';
      f.frequency.value = 1800;
      f.Q.value = 0.8;
      g.gain.linearRampToValueAtTime(0.05, t + 0.05);
    } else {
      f.type = 'lowpass';
      f.frequency.value = 140;
      f.Q.value = 1.2;
      g.gain.linearRampToValueAtTime(0.22, t + 0.6);
    }
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t);
    const node = { src, gain: g, filter: f };
    this[kind === 'slide' ? 'slideNode' : 'liftNode'] = node;
  }

  // ------------------------------------------------------------ effects
  sfx(name, o = {}) {
    if (!this.ready) return;
    switch (name) {
      case 'step':
        if (o.surface === 'metal') {
          this.noise({ dur: 0.05, gain: 0.05, freq: 2600, q: 3 });
          this.tone({ type: 'square', freq: 1900, dur: 0.03, gain: 0.015 });
        } else this.noise({ dur: 0.07, gain: 0.06, freq: 420, q: 0.8, type: 'lowpass' });
        break;
      case 'jump':
        this.tone({ type: 'sine', freq: 300, freqEnd: 620, dur: 0.13, gain: 0.09 });
        this.noise({ dur: 0.08, gain: 0.04, freq: 1200, q: 1 });
        break;
      case 'wallJump':
        this.tone({ type: 'sine', freq: 340, freqEnd: 720, dur: 0.14, gain: 0.09 });
        this.noise({ dur: 0.06, gain: 0.07, freq: 2200, q: 2 });
        break;
      case 'land': {
        const k = Math.min(1, (o.impact || 6) / 18);
        this.tone({ type: 'sine', freq: 110, freqEnd: 60, dur: 0.14, gain: 0.1 + 0.14 * k });
        this.noise({ dur: 0.09, gain: 0.04 + 0.08 * k, freq: o.surface === 'metal' ? 1800 : 500, q: 1 });
        break;
      }
      case 'slideStart':
        this.loop('slide');
        break;
      case 'slideEnd':
        if (this.slideNode) {
          this.slideNode.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
          this.slideNode.src.stop(this.ctx.currentTime + 0.2);
          this.slideNode = null;
        }
        break;
      case 'dash':
        this.noise({ dur: 0.22, gain: 0.18, freq: 2400, freqEnd: 500, q: 0.9 });
        this.tone({ type: 'sine', freq: 140, freqEnd: 70, dur: 0.18, gain: 0.12 });
        break;
      case 'dashStop':
        this.tone({ type: 'square', freq: 180, freqEnd: 90, dur: 0.1, gain: 0.08 });
        break;
      case 'seamBreak':
        this.noise({ dur: 0.4, gain: 0.25, freq: 3000, freqEnd: 900, q: 0.7 });
        for (const f of [1567, 1975, 2637]) this.tone({ type: 'sine', freq: f, dur: 0.5, gain: 0.05, decay: 0.5 });
        break;
      case 'seamThud':
        this.tone({ type: 'square', freq: 120, freqEnd: 80, dur: 0.08, gain: 0.08 });
        break;
      case 'pulse':
        this.tone({ type: 'sine', freq: 130, freqEnd: 60, dur: 0.3, gain: 0.16 });
        this.tone({ type: 'sine', freq: 523, dur: 0.7, gain: 0.1, attack: 0.01 });
        this.tone({ type: 'sine', freq: 784, dur: 0.6, gain: 0.06, attack: 0.02 });
        this.tone({ type: 'sine', freq: 1046, dur: 0.5, gain: 0.03, attack: 0.03 });
        this.noise({ dur: 0.35, gain: 0.05, freq: 4000, q: 0.5 });
        break;
      case 'pulseDenied':
        this.tone({ type: 'sine', freq: 170, freqEnd: 120, dur: 0.1, gain: 0.05 });
        break;
      case 'shield':
        for (const f of [880, 1320, 1760]) this.tone({ type: 'sine', freq: f, dur: 0.45, gain: 0.07 });
        this.noise({ dur: 0.2, gain: 0.08, freq: 5000, q: 1 });
        break;
      case 'damage':
        this.tone({ type: 'square', freq: 140, freqEnd: 50, dur: 0.3, gain: 0.16, filter: { type: 'lowpass', freq: 900 } });
        this.noise({ dur: 0.25, gain: 0.2, freq: 800, q: 0.6 });
        break;
      case 'pickup':
        this.noise({ dur: 0.05, gain: 0.08, freq: 1500, q: 2 });
        this.tone({ type: 'square', freq: 520, freqEnd: 700, dur: 0.08, gain: 0.05 });
        break;
      case 'place':
        this.tone({ type: 'square', freq: 600, freqEnd: 380, dur: 0.1, gain: 0.05 });
        this.noise({ dur: 0.06, gain: 0.07, freq: 900, q: 1 });
        break;
      case 'insert':
        this.tone({ type: 'square', freq: 300, freqEnd: 620, dur: 0.16, gain: 0.07 });
        this.noise({ dur: 0.12, gain: 0.1, freq: 1200, q: 1.5 });
        this.tone({ type: 'sine', freq: 880, dur: 0.4, gain: 0.04, attack: 0.05 });
        break;
      case 'remove':
        this.noise({ dur: 0.1, gain: 0.08, freq: 1800, q: 2 });
        this.tone({ type: 'square', freq: 500, freqEnd: 280, dur: 0.12, gain: 0.05 });
        break;
      case 'placeDenied':
        this.tone({ type: 'square', freq: 150, freqEnd: 110, dur: 0.1, gain: 0.06 });
        break;
      case 'switchOn':
        this.noise({ dur: 0.08, gain: 0.14, freq: 700, q: 1.5 });
        this.tone({ type: 'square', freq: 220, freqEnd: 440, dur: 0.3, gain: 0.05, filter: { type: 'lowpass', freq: 1200 } });
        break;
      case 'relayActivate':
        for (const [i, f] of [220, 330, 440, 660].entries()) this.tone({ type: 'sawtooth', freq: f, dur: 2.4, gain: 0.06, attack: 0.3 + i * 0.12, filter: { type: 'lowpass', freq: 1800, q: 0.8 } });
        this.tone({ type: 'sine', freq: 110, dur: 2.2, gain: 0.12, attack: 0.2 });
        break;
      case 'relayUnpowered':
        this.tone({ type: 'square', freq: 110, dur: 0.18, gain: 0.05, filter: { type: 'lowpass', freq: 600 } });
        break;
      case 'station':
        this.tone({ type: 'sine', freq: 523, dur: 0.5, gain: 0.08 });
        this.tone({ type: 'sine', freq: 784, dur: 0.7, gain: 0.07, attack: 0.12 });
        break;
      case 'checkpoint':
        this.tone({ type: 'sine', freq: 1046, dur: 0.15, gain: 0.04 });
        break;
      case 'archive':
        this.tone({ type: 'sine', freq: 880, dur: 0.6, gain: 0.07 });
        this.tone({ type: 'sine', freq: 1174, dur: 0.9, gain: 0.06, attack: 0.2 });
        break;
      case 'cache':
        this.noise({ dur: 0.05, gain: 0.1, freq: 3000, q: 2 });
        for (const [i, f] of [660, 880, 1320].entries()) this.tone({ type: 'triangle', freq: f, dur: 0.25, gain: 0.05, attack: 0.01 + i * 0.07 });
        break;
      case 'skitterAlert':
        this.tone({ type: 'square', freq: 420, dur: 0.07, gain: 0.05, filter: { type: 'lowpass', freq: 1500 } });
        this.tone({ type: 'square', freq: 420, dur: 0.07, gain: 0.05, attack: 0.11 });
        break;
      case 'skitterTelegraph':
        this.tone({ type: 'sawtooth', freq: 200, freqEnd: 600, dur: 0.45, gain: 0.05, filter: { type: 'lowpass', freq: 900 } });
        break;
      case 'skitterLunge':
        this.noise({ dur: 0.2, gain: 0.14, freq: 1800, freqEnd: 600, q: 0.8 });
        break;
      case 'droneAim':
        this.tone({ type: 'sine', freq: 1760, dur: 0.12, gain: 0.035 });
        this.tone({ type: 'sine', freq: 1760, dur: 0.12, gain: 0.035, attack: 0.25 });
        this.tone({ type: 'sine', freq: 2217, dur: 0.12, gain: 0.035, attack: 0.5 });
        break;
      case 'boltFire':
        this.tone({ type: 'sine', freq: 1200, freqEnd: 320, dur: 0.25, gain: 0.09 });
        break;
      case 'boltImpact':
        this.noise({ dur: 0.08, gain: 0.08, freq: 2500, q: 1 });
        break;
      case 'beamWarning':
        this.tone({ type: 'square', freq: 330, dur: 0.18, gain: 0.06, filter: { type: 'lowpass', freq: 1200 } });
        this.tone({ type: 'square', freq: 262, dur: 0.25, gain: 0.06, attack: 0.4 });
        break;
      case 'beamFire':
        this.noise({ dur: 0.4, gain: 0.22, freq: 2500, freqEnd: 400, q: 0.5 });
        this.tone({ type: 'sawtooth', freq: 220, freqEnd: 110, dur: 0.35, gain: 0.1, filter: { type: 'lowpass', freq: 1500 } });
        break;
      case 'beamVent':
        this.noise({ dur: 0.9, gain: 0.1, type: 'highpass', freq: 2500 });
        break;
      case 'vent_warning':
        this.noise({ dur: 0.6, gain: 0.08, freq: 900, freqEnd: 2400, q: 1.2 });
        break;
      case 'vent_active':
        this.noise({ dur: 1.1, gain: 0.2, type: 'lowpass', freq: 700, q: 0.7 });
        break;
      case 'enemyStun':
        this.tone({ type: 'square', freq: 1400, freqEnd: 200, dur: 0.25, gain: 0.07 });
        this.noise({ dur: 0.2, gain: 0.1, freq: 3000, q: 0.8 });
        break;
      case 'enemyDisable':
        this.tone({ type: 'square', freq: 600, freqEnd: 60, dur: 0.45, gain: 0.1, filter: { type: 'lowpass', freq: 1400 } });
        this.noise({ dur: 0.3, gain: 0.16, freq: 1200, q: 0.6 });
        break;
      case 'pulseDeflect':
        this.tone({ type: 'sine', freq: 1800, freqEnd: 1200, dur: 0.2, gain: 0.07 });
        break;
      case 'shutterOpen':
      case 'shutterClose':
        this.noise({ dur: 0.9, gain: 0.08, freq: 600, freqEnd: 400, q: 1 });
        this.tone({ type: 'square', freq: 90, freqEnd: 60, dur: 0.15, gain: 0.08, attack: 0.8 });
        break;
      case 'shutdown':
        this.tone({ type: 'sawtooth', freq: 420, freqEnd: 50, dur: 1.1, gain: 0.1, filter: { type: 'lowpass', freq: 1200 } });
        this.tone({ type: 'sine', freq: 70, freqEnd: 40, dur: 0.8, gain: 0.15, attack: 0.4 });
        break;
      case 'reboot':
        for (const [i, f] of [330, 440, 660].entries()) this.tone({ type: 'sine', freq: f, dur: 0.2, gain: 0.05, attack: i * 0.18 });
        this.tone({ type: 'sawtooth', freq: 110, dur: 1.0, gain: 0.04, attack: 0.4, filter: { type: 'lowpass', freq: 500 } });
        break;
      case 'liftStart':
        this.loop('lift');
        break;
      case 'liftArrive':
        if (this.liftNode) {
          this.liftNode.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
          this.liftNode.src.stop(this.ctx.currentTime + 1.2);
          this.liftNode = null;
        }
        this.tone({ type: 'sine', freq: 523, dur: 1.6, gain: 0.08 });
        this.tone({ type: 'sine', freq: 784, dur: 2.0, gain: 0.07, attack: 0.3 });
        break;
      case 'liftDenied':
        this.tone({ type: 'square', freq: 120, dur: 0.2, gain: 0.05, filter: { type: 'lowpass', freq: 500 } });
        break;
      case 'complete':
        for (const [i, f] of [261.6, 329.6, 392, 523.3, 659.3].entries()) this.tone({ type: 'triangle', freq: f, dur: 3.5, gain: 0.05, attack: 0.5 + i * 0.35 });
        break;
      case 'crush':
      case 'moverPush':
        this.tone({ type: 'square', freq: 80, freqEnd: 50, dur: 0.2, gain: 0.12 });
        break;
      default:
        break;
    }
  }

  dispose() {
    this.stopLoops();
    if (this.drones) this.drones.nodes.forEach((n) => {
      try {
        n.stop();
      } catch {}
    });
    if (this.ctx) this.ctx.close().catch(() => {});
    this.unlocked = false;
  }
}
