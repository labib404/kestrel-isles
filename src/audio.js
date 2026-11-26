// Sound, synthesised with Web Audio (no sound files): an engine whose pitch and growl follow the
// throttle and RPM, wind that rises with airspeed, a stall horn, and short cues for rings, touchdowns
// and crashes. Audio starts on the first click or key, as browsers require.

let ctx = null;
let engine = null;
let wind = null;
let horn = null;
let master = null;
let muted = false;

function noiseBuffer(ac) {
  const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Create the audio graph; safe to call on every user gesture. */
export function startAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.55;
  master.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const sub = ctx.createOscillator();
  sub.type = 'square';
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 4;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.35;
  osc.connect(filter);
  sub.connect(subGain).connect(filter);
  filter.connect(gain).connect(master);
  osc.start();
  sub.start();
  engine = { osc, sub, filter, gain };

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 700;
  const wg = ctx.createGain();
  wg.gain.value = 0;
  src.connect(band).connect(wg).connect(master);
  src.start();
  wind = { band, gain: wg };

  const h = ctx.createOscillator();
  h.type = 'square';
  h.frequency.value = 820;
  const hg = ctx.createGain();
  hg.gain.value = 0;
  h.connect(hg).connect(master);
  h.start();
  horn = hg;
}

/** Follow the aircraft each frame. */
export function updateAudio(plane, active) {
  if (!ctx || !engine) return;
  const t = ctx.currentTime;
  const running = active && !plane.crashed && plane.fuel > 0;
  const rpm = running ? 0.25 + plane.throttle * 0.75 : 0;
  engine.osc.frequency.setTargetAtTime(38 + rpm * 70 + plane.speed * 0.15, t, 0.08);
  engine.sub.frequency.setTargetAtTime(19 + rpm * 35, t, 0.08);
  engine.filter.frequency.setTargetAtTime(240 + rpm * 900, t, 0.1);
  engine.gain.gain.setTargetAtTime(running ? 0.08 + rpm * 0.14 : 0, t, 0.15);
  wind.gain.gain.setTargetAtTime(active ? Math.min(0.22, (plane.speed / 80) ** 2 * 0.22) : 0, t, 0.2);
  wind.band.frequency.setTargetAtTime(400 + plane.speed * 14, t, 0.2);
  horn.gain.setTargetAtTime(active && plane.stalled && Math.sin(t * 18) > 0 ? 0.05 : 0, t, 0.01);
}

function blip(freq, dur, type = 'sine', vol = 0.2, slide = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur);
}

export function playCue(kind) {
  if (!ctx) return;
  if (kind === 'ring') { blip(660, 0.18, 'triangle', 0.25); setTimeout(() => blip(990, 0.25, 'triangle', 0.22), 90); }
  if (kind === 'touchdown') blip(140, 0.25, 'triangle', 0.3, 0.6);
  if (kind === 'missed') blip(300, 0.3, 'sawtooth', 0.12, 0.6);
  if (kind === 'complete') [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f, 0.35, 'triangle', 0.2), i * 120));
  if (kind === 'crash') {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.7, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.6);
    src.connect(f).connect(g).connect(master);
    src.start();
    src.stop(ctx.currentTime + 1.7);
  }
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.55;
  return muted;
}
