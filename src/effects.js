// Particles: engine smoke when the airframe is damaged, spray and dust on landing, and fire and smoke
// after a crash. Each puff rises, grows and fades; they are few enough to draw one at a time.

import { add, scale } from './math.js';

const MAX = 420;
const puffs = [];

export function emit(pos, { vel = [0, 2, 0], size = 1.5, grow = 2, life = 2, colour = [0.5, 0.5, 0.5], spread = 1 } = {}) {
  if (puffs.length >= MAX) puffs.shift();
  const jitter = () => (Math.random() - 0.5) * spread;
  puffs.push({ pos: [pos[0] + jitter(), pos[1] + jitter(), pos[2] + jitter()], vel: add(vel, [jitter(), jitter() * 0.5, jitter()]), size, grow, life, age: 0, colour });
}

/** A burst of fire and dark smoke where the aircraft came down. */
export function explode(pos, water) {
  for (let i = 0; i < 26; i++) {
    if (water) emit(pos, { vel: [0, 6 + Math.random() * 8, 0], size: 2, grow: 3, life: 2.2, colour: [0.9, 0.95, 1], spread: 8 });
    else emit(pos, { vel: [0, 3 + Math.random() * 5, 0], size: 2.5, grow: 4, life: 3 + Math.random() * 2, colour: i % 3 ? [0.18, 0.17, 0.16] : [1, 0.55, 0.15], spread: 6 });
  }
}

export function updateEffects(dt) {
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.age += dt;
    if (p.age >= p.life) { puffs.splice(i, 1); continue; }
    p.pos = add(p.pos, scale(p.vel, dt));
    p.vel = scale(p.vel, 1 - dt * 0.6);
  }
}

export function eachPuff(fn) {
  for (const p of puffs) {
    const t = p.age / p.life;
    fn(p.pos, p.size + p.grow * t, p.colour, 1 - t);
  }
}

export function clearEffects() {
  puffs.length = 0;
}
