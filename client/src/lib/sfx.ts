/**
 * Sonidos sintetizados con Web Audio: cero assets, cero descargas.
 * El contexto se crea con el primer gesto del usuario, como exigen los navegadores.
 */

type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = localStorage.getItem('partidazo:muted') === '1';

function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  localStorage.setItem('partidazo:muted', muted ? '1' : '0');
  return muted;
}

interface ToneOpts {
  freq: number;
  to?: number;
  dur?: number;
  type?: Wave;
  gain?: number;
  delay?: number;
  /** barrido exponencial en vez de lineal */
  glide?: boolean;
}

function tone({ freq, to, dur = 0.12, type = 'sine', gain = 0.22, delay = 0, glide = true }: ToneOpts): void {
  const ac = ensure();
  if (!ac || !master || muted) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to && to !== freq) {
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    else osc.frequency.linearRampToValueAtTime(to, t0 + dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function noise(dur = 0.14, gain = 0.14, hp = 900): void {
  const ac = ensure();
  if (!ac || !master || muted) return;
  const frames = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = hp;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(master);
  src.start();
}

export const sfx = {
  wake: () => ensure(),

  tap: () => tone({ freq: 520, to: 700, dur: 0.055, type: 'triangle', gain: 0.1 }),
  pick: () => tone({ freq: 760, to: 1080, dur: 0.07, type: 'triangle', gain: 0.13 }),
  back: () => tone({ freq: 460, to: 300, dur: 0.09, type: 'triangle', gain: 0.1 }),

  good: () => {
    tone({ freq: 660, dur: 0.1, type: 'triangle', gain: 0.16 });
    tone({ freq: 880, dur: 0.14, type: 'triangle', gain: 0.15, delay: 0.08 });
  },
  bad: () => tone({ freq: 220, to: 110, dur: 0.22, type: 'sawtooth', gain: 0.13 }),

  tick: () => tone({ freq: 1180, dur: 0.04, type: 'square', gain: 0.07 }),
  urgent: () => tone({ freq: 880, to: 660, dur: 0.1, type: 'square', gain: 0.1 }),

  /** Smash: raquetazo */
  smash: () => {
    noise(0.09, 0.2, 1600);
    tone({ freq: 340, to: 900, dur: 0.09, type: 'square', gain: 0.17 });
  },
  dodge: () => tone({ freq: 900, to: 1500, dur: 0.07, type: 'sine', gain: 0.08 }),
  out: () => {
    tone({ freq: 300, to: 70, dur: 0.42, type: 'sawtooth', gain: 0.16 });
    noise(0.25, 0.1, 400);
  },

  /** Tanque / cañonazo */
  shoot: () => {
    noise(0.06, 0.12, 2200);
    tone({ freq: 620, to: 260, dur: 0.08, type: 'square', gain: 0.08 });
  },
  boom: () => {
    noise(0.45, 0.22, 120);
    tone({ freq: 160, to: 40, dur: 0.5, type: 'sawtooth', gain: 0.18 });
  },
  bounce: () => tone({ freq: 1500, to: 1100, dur: 0.035, type: 'sine', gain: 0.04 }),
  spawn: () => tone({ freq: 300, to: 900, dur: 0.22, type: 'triangle', gain: 0.1 }),
  stomp: () => {
    noise(0.12, 0.18, 500);
    tone({ freq: 420, to: 90, dur: 0.22, type: 'square', gain: 0.14 });
  },
  blast: () => {
    noise(0.3, 0.2, 300);
    tone({ freq: 90, to: 260, dur: 0.18, type: 'sawtooth', gain: 0.16 });
  },

  /** Hipódromo */
  gallop: () => noise(0.035, 0.05, 700),
  bell: () => {
    [880, 880, 880].forEach((f, i) => tone({ freq: f, dur: 0.12, type: 'square', gain: 0.08, delay: i * 0.16 }));
  },

  /** Casino */
  card: () => noise(0.07, 0.1, 2400),
  coin: () => {
    tone({ freq: 1200, dur: 0.06, type: 'square', gain: 0.1 });
    tone({ freq: 1800, dur: 0.1, type: 'square', gain: 0.08, delay: 0.05 });
  },
  reel: () => tone({ freq: 240, to: 180, dur: 0.06, type: 'square', gain: 0.07 }),
  cascade: (step: number) => tone({ freq: 500 + step * 85, dur: 0.1, type: 'triangle', gain: 0.12 }),
  jackpot: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone({ freq: f, dur: 0.3, type: 'triangle', gain: 0.17, delay: i * 0.09 }),
    );
  },

  /** Pizarra / resultados */
  star: (n: number) => tone({ freq: 620 + n * 120, dur: 0.11, type: 'triangle', gain: 0.14 }),
  reveal: () => {
    tone({ freq: 400, to: 900, dur: 0.3, type: 'sine', gain: 0.13 });
  },
  fanfare: () => {
    [523, 659, 784, 1047].forEach((f, i) =>
      tone({ freq: f, dur: 0.45, type: 'triangle', gain: 0.2, delay: i * 0.13 }),
    );
  },
};
