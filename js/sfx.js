// Sons da interface, sintetizados na hora com Web Audio (zero arquivos, zero download).
let ctx = null;
let master = null;
let enabled = true;
try { enabled = localStorage.getItem('guri:sfx') !== '0'; } catch {}

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// toca uma nota com envelope curto
function tone({ freq = 440, to = null, type = 'sine', dur = 0.15, vol = 1, delay = 0, attack = 0.005 }) {
  const c = ac();
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.5, delay = 0, from = 3000, to = 300, q = 1 }) {
  const c = ac();
  const t = c.currentTime + delay;
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

const SOUNDS = {
  click: () => tone({ freq: 1800, to: 1200, type: 'triangle', dur: 0.04, vol: 0.35 }),
  toggleOn: () => { tone({ freq: 520, type: 'sine', dur: 0.08, vol: 0.6 }); tone({ freq: 780, type: 'sine', dur: 0.1, vol: 0.6, delay: 0.06 }); },
  toggleOff: () => { tone({ freq: 620, type: 'sine', dur: 0.08, vol: 0.55 }); tone({ freq: 410, type: 'sine', dur: 0.12, vol: 0.55, delay: 0.06 }); },
  join: () => [523.25, 659.25, 783.99].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.32, vol: 0.5, delay: i * 0.08 })),
  leave: () => [659.25, 523.25, 392].forEach((f, i) => tone({ freq: f, type: 'sine', dur: 0.28, vol: 0.4, delay: i * 0.08 })),
  message: () => { tone({ freq: 880, type: 'sine', dur: 0.09, vol: 0.5 }); tone({ freq: 1320, type: 'sine', dur: 0.14, vol: 0.45, delay: 0.07 }); },
  whoosh: () => noise({ dur: 0.28, vol: 0.35, from: 600, to: 3200, q: 0.8 }),
  pick: () => tone({ freq: 300, to: 520, type: 'triangle', dur: 0.08, vol: 0.4 }),
  drop: () => { tone({ freq: 220, to: 110, type: 'sine', dur: 0.14, vol: 0.9 }); noise({ dur: 0.06, vol: 0.18, from: 2000, to: 800 }); },
  pop: () => tone({ freq: 600, to: 1100, type: 'sine', dur: 0.07, vol: 0.5 }),
  vote: () => { tone({ freq: 740, type: 'square', dur: 0.05, vol: 0.18 }); tone({ freq: 988, type: 'triangle', dur: 0.12, vol: 0.4, delay: 0.04 }); },
  vs: () => { noise({ dur: 0.5, vol: 0.4, from: 200, to: 4000, q: 0.6 }); tone({ freq: 110, to: 55, type: 'sawtooth', dur: 0.5, vol: 0.25 }); },
  advance: () => [392, 523.25, 659.25, 783.99].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.2, vol: 0.4, delay: i * 0.06 })),
  win: () => {
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    const times = [0, 0.12, 0.24, 0.36, 0.56, 0.68];
    notes.forEach((f, i) => { tone({ freq: f, type: 'triangle', dur: i === 5 ? 0.9 : 0.18, vol: 0.5, delay: times[i] }); tone({ freq: f / 2, type: 'sine', dur: i === 5 ? 0.9 : 0.18, vol: 0.3, delay: times[i] }); });
    noise({ dur: 1.2, vol: 0.12, from: 6000, to: 2000, q: 0.5, delay: 0.68 });
  },
  tick: () => tone({ freq: 2400, type: 'square', dur: 0.015, vol: 0.12 }),
  error: () => { tone({ freq: 200, type: 'sawtooth', dur: 0.12, vol: 0.25 }); tone({ freq: 150, type: 'sawtooth', dur: 0.18, vol: 0.25, delay: 0.1 }); },
};

let last = {};
export function sfx(name) {
  if (!enabled || !SOUNDS[name]) return;
  // evita "metralhadora" do mesmo som
  const now = performance.now();
  if (last[name] && now - last[name] < 45) return;
  last[name] = now;
  try { SOUNDS[name](); } catch {}
}
export function setSfx(on) {
  enabled = on;
  try { localStorage.setItem('guri:sfx', on ? '1' : '0'); } catch {}
}
export const sfxEnabled = () => enabled;
// destrava o áudio no primeiro clique (política de autoplay dos navegadores)
document.addEventListener('pointerdown', () => { if (enabled) ac(); }, { once: true });
