// The things in the world besides the terrain: the Kestrel KS-2 aircraft and its propeller, the two
// airfields (runway, markings, edge lights, hangar, tower, windsock, fuel shed), target rings, clouds,
// the sea, the aircraft's ground shadow and a puff for smoke and spray.

import { AIRFIELDS, WORLD } from './config.js';
import { DEG, add, quatAxisAngle, quatRotate } from './math.js';
import { MeshBuilder } from './geometry.js';
import { groundHeight } from './terrain.js';
import { rng } from './random.js';

const CREAM = [0.93, 0.9, 0.82];
const TEAL = [0.08, 0.46, 0.5];
const ORANGE = [0.95, 0.47, 0.13];
const DARK = [0.13, 0.14, 0.16];
const GLASS = [0.2, 0.32, 0.42];
const METAL = [0.62, 0.64, 0.66];

/** The KS-2 in body space: nose toward -z, wing on top, about 11 m span and 8 m long. */
export function buildAircraft() {
  const m = new MeshBuilder();
  // fuselage: cowl → cabin → tapering tail boom
  m.taper([0, 0, 0], -3.6, -2.4, 0.55, 0.55, 0.72, 0.72, CREAM);
  m.taper([0, 0, 0], -2.4, 0.6, 0.72, 0.72, 0.68, 0.78, CREAM, 0.08);
  m.taper([0, 0, 0], 0.6, 4.6, 0.68, 0.78, 0.18, 0.28, CREAM, 0.42);
  // livery stripe and belly
  m.taper([0, -0.12, 0], -2.38, 3.2, 0.735, 0.12, 0.36, 0.1, TEAL, 0.28);
  m.box([0, -0.66, -0.9], [1.3, 0.12, 4.6], TEAL);
  // cabin glazing
  m.taper([0, 0.5, 0], -2.25, -1.3, 0.62, 0.05, 0.66, 0.32, GLASS, 0.18);
  m.box([0.7, 0.42, -0.55], [0.06, 0.5, 1.4], GLASS);
  m.box([-0.7, 0.42, -0.55], [0.06, 0.5, 1.4], GLASS);
  // high wing with orange tips, and struts
  m.box([0, 0.95, -0.95], [11.2, 0.18, 1.55], CREAM);
  m.box([5.35, 0.96, -0.95], [0.5, 0.2, 1.57], ORANGE);
  m.box([-5.35, 0.96, -0.95], [0.5, 0.2, 1.57], ORANGE);
  m.box([0, 1.07, -0.95], [3.2, 0.06, 1.1], TEAL);
  const strut = (side) => m.box([side * 1.9, 0.15, -0.8], [0.08, 1.75, 0.12], METAL, quatAxisAngle([0, 0, 1], side * -58 * DEG));
  strut(1);
  strut(-1);
  // tail: stabiliser and fin with a teal flash
  m.box([0, 0.38, 4.15], [3.8, 0.1, 0.95], CREAM);
  m.box([1.75, 0.39, 4.15], [0.3, 0.12, 0.96], ORANGE);
  m.box([-1.75, 0.39, 4.15], [0.3, 0.12, 0.96], ORANGE);
  m.taper([0, 0.95, 0], 3.4, 4.75, 0.06, 0.6, 0.06, 0.9, TEAL, 0.35);
  // engine nose and exhaust
  m.taper([0, 0, 0], -3.95, -3.6, 0.3, 0.3, 0.55, 0.55, DARK);
  m.box([0.45, -0.42, -2.9], [0.12, 0.12, 0.5], METAL);
  // tundra tyres on sprung legs, and a tail wheel
  for (const side of [1, -1]) {
    m.box([side * 0.95, -1.05, -1.75], [0.1, 1.0, 0.12], METAL, quatAxisAngle([0, 0, 1], side * 28 * DEG));
    m.box([side * 1.3, -1.45, -1.75], [0.34, 0.62, 0.62], DARK);
  }
  m.box([0, -0.55, 4.25], [0.12, 0.3, 0.3], DARK);
  return m;
}

/** Two-blade propeller with a spinner, spun around z by the game. */
export function buildPropeller() {
  const m = new MeshBuilder();
  m.box([0, 0, 0], [0.18, 2.1, 0.06], DARK, quatAxisAngle([0, 0, 1], 0));
  m.box([0, 0.98, 0.01], [0.19, 0.16, 0.07], ORANGE);
  m.box([0, -0.98, 0.01], [0.19, 0.16, 0.07], ORANGE);
  m.taper([0, 0, 0], -0.35, 0.05, 0.03, 0.03, 0.22, 0.22, CREAM);
  return m;
}

/** A unit ring (radius 1) facing -z, scaled and turned by the game. */
export function buildRing() {
  const m = new MeshBuilder();
  m.torus([0, 0, 0], 1, 0.075, [1, 1, 1], [0, 0, 0, 1], 36, 6);
  return m;
}

/** Runways with markings and lights, and each field's buildings, in world space. */
export function buildAirfields() {
  const m = new MeshBuilder();
  for (const f of AIRFIELDS) {
    const q = quatAxisAngle([0, 1, 0], -f.heading * DEG);
    const at = (u, v, y = 0) => add([f.x, f.elevation + y, f.z], quatRotate(q, [v, 0, -u]));
    const y = 0.12;
    const L = f.length / 2;
    const W = f.width / 2;
    m.box(at(0, 0, y - 0.3), [f.width, 0.6, f.length], [0.25, 0.26, 0.27], q);
    m.box(at(0, 0, y - 0.32), [f.width + 16, 0.6, f.length + 40], [0.56, 0.6, 0.44], q);
    for (let u = -L + 60; u < L - 60; u += 36) m.box(at(u, 0, y + 0.02), [0.9, 0.05, 18], [0.95, 0.95, 0.92], q);
    for (const end of [-1, 1]) {
      for (let k = -3; k <= 3; k++) if (k) m.box(at(end * (L - 14), k * (W / 4.2), y + 0.02), [1.6, 0.05, 20], [0.95, 0.95, 0.92], q);
      m.box(at(end * (L - 52), 0, y + 0.02), [W * 1.2, 0.05, 6], [0.95, 0.95, 0.92], q);
      m.box(at(end * (L - 160), -W * 0.45, y + 0.02), [3, 0.05, 30], [0.95, 0.95, 0.92], q);
      m.box(at(end * (L - 160), W * 0.45, y + 0.02), [3, 0.05, 30], [0.95, 0.95, 0.92], q);
    }
    // apron, hangar, tower, fuel shed and windsock beside the runway
    m.box(at(-L * 0.35, W + 62, -0.2), [70, 0.5, 80], [0.42, 0.43, 0.43], q);
    m.box(at(-L * 0.35 + 10, W + 82, 7), [34, 14, 26], [0.74, 0.32, 0.22], q);
    m.box(at(-L * 0.35 + 10, W + 82, 14.5), [36, 1.2, 28], [0.35, 0.37, 0.4], q);
    m.box(at(-L * 0.35 + 10, W + 68.8, 5), [26, 10, 0.4], [0.86, 0.82, 0.72], q);
    m.box(at(-L * 0.35 - 30, W + 70, 9), [7, 18, 7], [0.9, 0.88, 0.8], q);
    m.box(at(-L * 0.35 - 30, W + 70, 19.5), [9, 3.2, 9], [0.25, 0.42, 0.52], q);
    m.box(at(-L * 0.35 - 30, W + 70, 21.4), [10, 0.6, 10], [0.3, 0.3, 0.32], q);
    m.box(at(-L * 0.35 + 45, W + 50, 2), [8, 4, 6], [0.95, 0.75, 0.2], q);
    m.box(at(L * 0.55, W + 28, 4), [0.3, 8, 0.3], METAL, q);
    m.taper(at(L * 0.55, W + 28, 7.6), 0, 5, 0.7, 0.7, 0.35, 0.35, ORANGE, -0.3, quatAxisAngle([0, 1, 0], 120 * DEG));
  }
  return m;
}

/**
 * Glowing lights, drawn emissive so they bloom: runway edge lights (amber), threshold bars (green),
 * an approach light line leading in to each end, and the warm windows of hangar and tower.
 */
export function buildRunwayLights() {
  const m = new MeshBuilder();
  for (const f of AIRFIELDS) {
    const q = quatAxisAngle([0, 1, 0], -f.heading * DEG);
    const at = (u, v, y) => add([f.x, f.elevation + y, f.z], quatRotate(q, [v, 0, -u]));
    const L = f.length / 2;
    const W = f.width / 2;
    for (let u = -L; u <= L; u += 45) for (const s of [-1, 1]) m.box(at(u, s * (W + 2), 0.7), [0.9, 0.9, 0.9], [1, 0.72, 0.3], q);
    for (const end of [-1, 1]) {
      for (let v = -W; v <= W; v += 4) m.box(at(end * (L + 2), v, 0.6), [1, 0.7, 1], [0.35, 1, 0.55], q);
      for (let k = 1; k <= 8; k++) {
        const p = at(end * (L + k * 32), 0, 0);
        const ground = Math.max(groundHeight(p[0], p[2]), f.elevation - 30, 0);
        m.box([p[0], ground + 3, p[2]], [1.4, 1.4, 1.4], [1, 0.95, 0.85]);
      }
    }
    m.box(at(-L * 0.35 + 10, W + 68.5, 3.5), [20, 2.2, 0.5], [1, 0.62, 0.3], q);
    m.box(at(-L * 0.35 - 30, W + 70, 19.5), [9.4, 1.6, 9.4], [0.5, 0.9, 1], q);
  }
  return m;
}

/**
 * Storm clouds as soft billboards: towering cells built from stacked puffs (big dark bases, smaller lit
 * tops), a broken scud layer at mid height, and low wisps over the sea. Drawn sorted, far to near.
 */
export function buildCloudSprites() {
  const r = rng(WORLD.seed + 9);
  const sprites = [];
  const puff = (pos, size, shade, alpha) => sprites.push({ pos, size, shade, seed: r(), alpha });
  for (let c = 0; c < 26; c++) {
    const a = r() * Math.PI * 2;
    const d = 2500 + r() * 6500;
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d;
    const base = 900 + r() * 300;
    const tall = 3 + Math.floor(r() * 4);
    for (let level = 0; level < tall; level++) {
      const n = 5 - Math.min(level, 3);
      for (let p = 0; p < n; p++) {
        const s = (420 - level * 55) * (0.7 + r() * 0.5);
        puff([cx + (r() - 0.5) * 700, base + level * 260 + r() * 80, cz + (r() - 0.5) * 700], s, 0.7 + level * 0.12 + r() * 0.2, 0.85);
      }
    }
  }
  for (let i = 0; i < 90; i++) {
    puff([(r() - 0.5) * WORLD.size * 1.6, 650 + r() * 350, (r() - 0.5) * WORLD.size * 1.6], 160 + r() * 220, 0.55 + r() * 0.4, 0.5 + r() * 0.3);
  }
  for (let i = 0; i < 40; i++) {
    puff([(r() - 0.5) * WORLD.size * 1.7, 90 + r() * 140, (r() - 0.5) * WORLD.size * 1.7], 120 + r() * 160, 0.5 + r() * 0.3, 0.28);
  }
  return sprites;
}

export function buildSea() {
  const m = new MeshBuilder();
  const s = 40000;
  m.quad([-s, WORLD.sea, s], [s, WORLD.sea, s], [s, WORLD.sea, -s], [-s, WORLD.sea, -s], [0.1, 0.35, 0.45]);
  return m;
}

export function buildShadow() {
  const m = new MeshBuilder();
  const pts = 20;
  for (let i = 0; i < pts; i++) {
    const a0 = (i / pts) * Math.PI * 2;
    const a1 = ((i + 1) / pts) * Math.PI * 2;
    m.tri([0, 0, 0], [Math.cos(a1), 0, Math.sin(a1)], [Math.cos(a0), 0, Math.sin(a0)], [0, 0, 0]);
  }
  return m;
}

export function buildPuff() {
  const m = new MeshBuilder();
  m.blob([0, 0, 0], 1, [1, 1, 1], 0.9);
  return m;
}
