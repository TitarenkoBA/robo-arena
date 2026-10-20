import { Injectable, effect, inject } from '@angular/core';
import { SoundName } from '../game/effects';
import { AudioService } from './audio.service';

type Wave = OscillatorType;

interface ToneDef { k: 't'; f0: number; f1: number; d: number; w: Wave; v: number; at?: number }
interface NoiseDef { k: 'n'; d: number; f: number; ft: BiquadFilterType; v: number; at?: number }
type Part = ToneDef | NoiseDef;

const t = (f0: number, f1: number, d: number, w: Wave = 'sine', v = 0.4, at = 0): ToneDef => ({ k: 't', f0, f1, d, w, v, at });
const n = (d: number, f: number, ft: BiquadFilterType = 'lowpass', v = 0.5, at = 0): NoiseDef => ({ k: 'n', d, f, ft, v, at });

const RECIPES: Record<SoundName, Part[]> = {
  blaster: [t(900, 300, 0.12, 'square', 0.18), n(0.05, 3000, 'highpass', 0.1)],
  hammer: [n(0.15, 500, 'lowpass', 0.6), t(140, 50, 0.15, 'triangle', 0.5)],
  mg: [n(0.06, 1800, 'bandpass', 0.6), t(260, 90, 0.05, 'square', 0.12)],
  shotgun: [n(0.32, 1300, 'lowpass', 0.9), t(160, 50, 0.2, 'triangle', 0.5)],
  sshotgun: [n(0.45, 1000, 'lowpass', 1), t(120, 40, 0.3, 'triangle', 0.6)],
  rocket: [n(0.5, 700, 'lowpass', 0.6), t(220, 80, 0.4, 'sawtooth', 0.2)],
  grenade: [t(320, 140, 0.12, 'triangle', 0.4), n(0.08, 1200, 'lowpass', 0.3)],
  plasma: [t(1300, 600, 0.08, 'sine', 0.25), t(1900, 900, 0.06, 'sine', 0.1)],
  rail: [t(2200, 200, 0.6, 'sawtooth', 0.2), n(0.4, 3500, 'highpass', 0.35)],
  lightning: [n(0.1, 3200, 'bandpass', 0.4), t(110, 90, 0.1, 'sawtooth', 0.1)],
  bfg: [t(80, 420, 0.8, 'sine', 0.5), t(160, 640, 0.8, 'sawtooth', 0.15)],
  nail: [t(1500, 1000, 0.04, 'square', 0.12)],
  minigun: [n(0.04, 2300, 'bandpass', 0.5), t(220, 120, 0.03, 'square', 0.1)],
  sniper: [n(0.5, 2200, 'lowpass', 1), t(900, 90, 0.4, 'triangle', 0.4)],
  freeze: [n(0.12, 5000, 'highpass', 0.18)],
  laser: [t(2500, 700, 0.16, 'sine', 0.3), t(1250, 350, 0.16, 'square', 0.06)],
  mine: [t(600, 600, 0.05, 'square', 0.15), t(800, 800, 0.05, 'square', 0.15, 0.08)],
  cluster: [t(520, 240, 0.16, 'triangle', 0.4), n(0.1, 900, 'lowpass', 0.3)],
  homing: [t(380, 950, 0.3, 'sawtooth', 0.15), n(0.3, 700, 'lowpass', 0.3)],
  vortex: [t(70, 30, 1.6, 'sine', 0.6), t(320, 70, 1.2, 'triangle', 0.2)],
  disc: [t(1600, 1300, 0.16, 'triangle', 0.25), n(0.05, 4000, 'highpass', 0.15)],
  crossbow: [n(0.08, 2500, 'highpass', 0.3), t(320, 180, 0.06, 'triangle', 0.3)],
  tesla: [n(0.16, 4200, 'bandpass', 0.5), t(90, 90, 0.16, 'square', 0.18)],
  bubble: [t(280, 950, 0.13, 'sine', 0.4)],
  wave: [n(0.4, 600, 'lowpass', 0.8), t(130, 40, 0.35, 'sine', 0.6)],
  flak: [n(0.22, 1500, 'lowpass', 0.6), t(220, 90, 0.12, 'square', 0.15)],
  boomerang: [t(600, 950, 0.2, 'triangle', 0.25)],
  boom: [n(0.7, 900, 'lowpass', 1), t(95, 30, 0.5, 'sine', 0.8)],
  bigboom: [n(1.3, 600, 'lowpass', 1), t(60, 20, 1.0, 'sine', 1)],
  hit: [t(1300, 900, 0.04, 'square', 0.12)],
  hurt: [t(320, 150, 0.12, 'triangle', 0.4)],
  pop: [t(420, 1300, 0.14, 'sine', 0.5), n(0.08, 2500, 'bandpass', 0.4), t(1300, 1700, 0.1, 'sine', 0.25, 0.12)],
  jump: [t(320, 620, 0.09, 'sine', 0.15)],
  djump: [t(520, 940, 0.1, 'sine', 0.18)],
  pad: [t(200, 1100, 0.32, 'sine', 0.4)],
  tele: [t(1300, 200, 0.4, 'sine', 0.3), t(400, 1700, 0.4, 'triangle', 0.15)],
  pick: [t(800, 1200, 0.08, 'sine', 0.3), t(1200, 1600, 0.1, 'sine', 0.3, 0.07)],
  pickW: [t(400, 800, 0.12, 'square', 0.18), t(800, 800, 0.1, 'square', 0.15, 0.12)],
  power: [t(523, 523, 0.1, 'square', 0.2), t(659, 659, 0.1, 'square', 0.2, 0.1), t(784, 784, 0.1, 'square', 0.2, 0.2), t(1046, 1046, 0.25, 'square', 0.2, 0.3)],
  break: [n(0.28, 900, 'bandpass', 0.7), t(200, 80, 0.15, 'triangle', 0.2)],
  glass: [n(0.3, 4000, 'highpass', 0.5), t(3100, 2800, 0.12, 'sine', 0.1), t(4100, 3900, 0.1, 'sine', 0.08, 0.05)],
  spawn: [t(300, 900, 0.3, 'sine', 0.25)],
  ric: [t(3200, 2000, 0.08, 'sine', 0.08)],
  end: [t(523, 523, 0.15, 'triangle', 0.4), t(659, 659, 0.15, 'triangle', 0.4, 0.15), t(784, 784, 0.15, 'triangle', 0.4, 0.3), t(1046, 1046, 0.5, 'triangle', 0.4, 0.45)],
  msg: [t(900, 900, 0.06, 'sine', 0.12)],
};

/** Процедурные звуки игры через WebAudio (не нужны файлы, мгновенная загрузка). */
@Injectable({ providedIn: 'root' })
export class SfxService {
  private readonly audio = inject(AudioService);
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>();
  private listener = { x: 0, y: 0 };
  private active = 0;

  constructor() {
    effect(() => {
      const v = this.audio.isMuted() ? 0 : this.audio.volume();
      if (this.master) this.master.gain.value = v;
    });
  }

  /** Вызывать из обработчика жеста пользователя (браузеры требуют для звука). */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.audio.isMuted() ? 0 : this.audio.volume();
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setListener(x: number, y: number) {
    this.listener.x = x;
    this.listener.y = y;
  }

  /** x=y=0 — непозиционный звук (интерфейс). */
  play(name: SoundName, x = 0, y = 0, vol = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const prev = this.last.get(name) ?? 0;
    if (now - prev < 0.035) return;
    if (this.active > 40) return;
    this.last.set(name, now);

    let gain = vol;
    let pan = 0;
    if (x !== 0 || y !== 0) {
      const dx = x - this.listener.x;
      const dy = y - this.listener.y;
      const d = Math.hypot(dx, dy);
      gain *= Math.max(0, 1 - d / 1800) ** 1.5;
      pan = Math.max(-1, Math.min(1, dx / 900));
    }
    if (gain < 0.02) return;

    const out = ctx.createGain();
    out.gain.value = gain;
    let node: AudioNode = out;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      node = p;
    }
    node.connect(this.master);

    let end = now;
    for (const part of RECIPES[name]) {
      const st = now + (part.at ?? 0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(part.v, st + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, st + part.d);
      g.connect(out);
      if (part.k === 't') {
        const o = ctx.createOscillator();
        o.type = part.w;
        o.frequency.setValueAtTime(part.f0, st);
        o.frequency.exponentialRampToValueAtTime(Math.max(1, part.f1), st + part.d);
        o.connect(g);
        o.start(st);
        o.stop(st + part.d + 0.02);
      } else {
        const s = ctx.createBufferSource();
        s.buffer = this.noise;
        s.playbackRate.value = 0.8 + Math.random() * 0.4;
        const f = ctx.createBiquadFilter();
        f.type = part.ft;
        f.frequency.value = part.f;
        s.connect(f);
        f.connect(g);
        s.start(st, Math.random() * 0.5);
        s.stop(st + part.d + 0.02);
      }
      end = Math.max(end, st + part.d);
    }
    this.active++;
    window.setTimeout(() => {
      this.active--;
      out.disconnect();
    }, (end - now) * 1000 + 100);
  }
}
