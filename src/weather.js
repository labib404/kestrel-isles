// The storm: lightning strikes out over the sea every few seconds. A strike is a jagged glowing bolt from
// the cloud base to the water and a flash that lights the sky, clouds, terrain and fog for a moment.

import { MeshBuilder } from './geometry.js';
import { add, quatAxisAngle } from './math.js';
import { rng } from './random.js';

const random = rng(4242);
const weather = { flash: 0, next: 3, bolt: null, boltAge: 0 };

/** A forked bolt as glowing boxes: a main channel zig-zagging down and two short branches. */
function buildBolt(base) {
  const m = new MeshBuilder();
  const segment = (from, to, width) => {
    const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const dz = to[2] - from[2];
    const len = Math.hypot(dx, dy, dz);
    const tilt = Math.atan2(Math.hypot(dx, dz), dy);
    const q = quatAxisAngle([dz / (Math.hypot(dx, dz) || 1), 0, -dx / (Math.hypot(dx, dz) || 1)], tilt);
    m.box(mid, [width, len, width], [1, 1, 1], q);
  };
  let p = base;
  const path = [p];
  while (p[1] > 0) {
    const next = add(p, [(random() - 0.5) * 90, -60 - random() * 70, (random() - 0.5) * 90]);
    next[1] = Math.max(0, next[1]);
    path.push(next);
    p = next;
  }
  for (let i = 1; i < path.length; i++) segment(path[i - 1], path[i], 5);
  for (const at of [Math.floor(path.length * 0.3), Math.floor(path.length * 0.55)]) {
    let b = path[at];
    for (let k = 0; k < 4; k++) {
      const nb = add(b, [(random() - 0.4) * 110, -45 - random() * 40, (random() - 0.4) * 110]);
      segment(b, nb, 2.5);
      b = nb;
    }
  }
  return m;
}

/** Pick a spot out to sea, a few kilometres from the camera, and strike. */
export function strike(renderer, near) {
  const a = random() * Math.PI * 2;
  const d = 2500 + random() * 2500;
  const base = [near[0] + Math.cos(a) * d, 1500, near[2] + Math.sin(a) * d];
  weather.bolt = renderer.mesh(buildBolt(base));
  weather.boltAge = 0;
  weather.flash = 1;
}

/** Advance the storm; returns the flash brightness for this frame. */
export function updateWeather(renderer, dt, near) {
  if (weather.frozen) {
    renderer.flash = weather.flash;
    return weather.flash;
  }
  weather.next -= dt;
  if (weather.next <= 0) {
    strike(renderer, near);
    weather.next = 4 + random() * 7;
  }
  weather.boltAge += dt;
  // a flash flickers twice before it fades
  const flicker = weather.boltAge < 0.35 ? (Math.sin(weather.boltAge * 60) > -0.3 ? 1 : 0.35) : 1;
  weather.flash = Math.max(0, weather.flash - dt * 2.4) * flicker;
  renderer.flash = weather.flash;
  return weather.flash;
}

export function drawWeather(renderer, identity) {
  if (weather.bolt && weather.boltAge < 0.5) {
    const glow = 1 - weather.boltAge / 0.5;
    renderer.draw(weather.bolt, identity, { emissive: 1, tint: [3.5 * glow + 0.6, 3.8 * glow + 0.7, 5 * glow + 1] });
  }
}

/** For screenshots: hold a strike (or a calm sky, at 0) still for as long as the frame is shown. */
export function freezeStrike(renderer, near, flash = 0.6) {
  if (flash > 0) strike(renderer, near);
  weather.frozen = true;
  weather.boltAge = flash > 0 ? 0.08 : 1;
  weather.flash = flash;
  renderer.flash = flash;
}

/** Strike where the caller wants it (a screenshot framing the bolt behind the aircraft). */
export function strikeAt(renderer, base, flash = 0.6) {
  weather.bolt = renderer.mesh(buildBolt(base));
  weather.frozen = true;
  weather.boltAge = 0.08;
  weather.flash = flash;
  renderer.flash = flash;
}
