// Synthesised sound for COLD YARD: every effect is built from oscillators and filtered
// noise at play time, so the game ships no audio files and makes no network requests.
// One shared AudioContext, created lazily on the first user gesture (browser policy).

let ctx = null;
let master = null;
let noiseBuffer = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  // Two seconds of white noise, reused by every noise-based effect.
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function noise({ dur = 0.2, freq = 1000, q = 1, gain = 0.4, type = 'bandpass', sweepTo = null, delay = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, t0);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

function tone({ freq = 440, dur = 0.1, gain = 0.2, type = 'square', sweepTo = null, delay = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// distance scales volume and dulls the crack: a shot across the yard is a pop, not a bang.
function distanceGain(distance) {
  return 1 / (1 + distance * 0.12);
}

export const sfx = {
  shoot(kind, distance = 0) {
    const g = distanceGain(distance);
    if (kind === 'sniper') {
      noise({ dur: 0.35, freq: 900, gain: 0.8 * g, type: 'lowpass' });
      tone({ freq: 160, dur: 0.25, gain: 0.5 * g, type: 'sawtooth', sweepTo: 40 });
    } else if (kind === 'shotgun') {
      noise({ dur: 0.28, freq: 700, gain: 0.8 * g, type: 'lowpass' });
      tone({ freq: 120, dur: 0.2, gain: 0.5 * g, sweepTo: 50 });
    } else if (kind === 'smg') {
      noise({ dur: 0.09, freq: 2400, gain: 0.4 * g });
      tone({ freq: 300, dur: 0.06, gain: 0.25 * g, sweepTo: 120 });
    } else {
      noise({ dur: 0.14, freq: 1800, gain: 0.55 * g });
      tone({ freq: 220, dur: 0.09, gain: 0.3 * g, sweepTo: 80 });
    }
  },
  dryFire() { tone({ freq: 1200, dur: 0.03, gain: 0.12 }); },
  reloadStart() { noise({ dur: 0.06, freq: 3000, gain: 0.2 }); tone({ freq: 500, dur: 0.05, gain: 0.1, delay: 0.05 }); },
  reloadEnd() { noise({ dur: 0.05, freq: 2600, gain: 0.25, delay: 0 }); tone({ freq: 700, dur: 0.05, gain: 0.15 }); },
  hitmarker(headshot) {
    tone({ freq: headshot ? 1900 : 1400, dur: 0.05, gain: 0.25, type: 'sine' });
    if (headshot) tone({ freq: 2400, dur: 0.07, gain: 0.2, type: 'sine', delay: 0.04 });
  },
  hurt() { noise({ dur: 0.12, freq: 400, gain: 0.3, type: 'lowpass' }); },
  kill() { tone({ freq: 880, dur: 0.09, gain: 0.2, type: 'sine' }); tone({ freq: 1320, dur: 0.12, gain: 0.2, type: 'sine', delay: 0.07 }); },
  throwWhoosh() { noise({ dur: 0.18, freq: 900, gain: 0.15, sweepTo: 2400 }); },
  fragBoom(distance = 0) {
    const g = distanceGain(distance);
    noise({ dur: 0.7, freq: 300, gain: 1.0 * g, type: 'lowpass', sweepTo: 60 });
    tone({ freq: 70, dur: 0.6, gain: 0.7 * g, type: 'sine', sweepTo: 30 });
  },
  flashPop(distance = 0) {
    const g = distanceGain(distance);
    noise({ dur: 0.1, freq: 5000, gain: 0.5 * g, type: 'highpass' });
    tone({ freq: 3200, dur: 0.4, gain: 0.1 * g, type: 'sine', sweepTo: 2800 });
  },
  smokeHiss(distance = 0) {
    noise({ dur: 1.2, freq: 4000, gain: 0.12 * distanceGain(distance), type: 'highpass' });
  },
  plantBeep(final = false) { tone({ freq: final ? 1560 : 1040, dur: final ? 0.3 : 0.08, gain: 0.25, type: 'sine' }); },
  defuseTick() { tone({ freq: 780, dur: 0.04, gain: 0.12, type: 'sine' }); },
  buy() { tone({ freq: 990, dur: 0.06, gain: 0.18, type: 'sine' }); tone({ freq: 1480, dur: 0.09, gain: 0.18, type: 'sine', delay: 0.05 }); },
  denied() { tone({ freq: 220, dur: 0.12, gain: 0.2, type: 'square' }); },
  roundWin() { tone({ freq: 660, dur: 0.12, gain: 0.2, type: 'sine' }); tone({ freq: 880, dur: 0.12, gain: 0.2, type: 'sine', delay: 0.1 }); tone({ freq: 1100, dur: 0.2, gain: 0.22, type: 'sine', delay: 0.2 }); },
  roundLose() { tone({ freq: 440, dur: 0.15, gain: 0.2, type: 'sine' }); tone({ freq: 330, dur: 0.25, gain: 0.2, type: 'sine', delay: 0.12 }); },
  explosion() {
    noise({ dur: 1.6, freq: 240, gain: 1.0, type: 'lowpass', sweepTo: 40 });
    tone({ freq: 55, dur: 1.4, gain: 0.9, type: 'sine', sweepTo: 24 });
  },
};
