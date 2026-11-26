// The Kestrel Isles: a seeded heightmap of a mountainous main island and a smaller volcanic one, with
// both airfields levelled into it. Answers height and surface queries for the flight model and builds
// the terrain and forest meshes for the renderer.

import { AIRFIELDS, WORLD } from './config.js';
import { DEG, clamp, lerp, smooth } from './math.js';
import { fbm, ridge, rng } from './random.js';
import { MeshBuilder } from './geometry.js';

const N = WORLD.grid;
const SIZE = WORLD.size;
const CELL = SIZE / N;
const HALF = SIZE / 2;

const ISLANDS = [
  { x: -700, z: 300, r: 3900 },
  { x: 2700, z: -2200, r: 1700 },
  { x: 1700, z: 2900, r: 900 },
  { x: -3400, z: -2700, r: 700 },
];

/** Where a point lies relative to an airfield's runway: along it (u) and across it (v), in metres. */
export function runwayLocal(field, x, z) {
  const h = field.heading * DEG;
  const dx = x - field.x;
  const dz = z - field.z;
  const ax = Math.sin(h);
  const az = -Math.cos(h);
  return { u: dx * ax + dz * az, v: dx * -az + dz * ax };
}

function rawHeight(x, z) {
  let mask = 0;
  for (const i of ISLANDS) {
    const d = Math.hypot(x - i.x, z - i.z) / i.r;
    mask = Math.max(mask, 1 - d * d);
  }
  const n = fbm(x / 1500 + 10, z / 1500 + 10, WORLD.seed);
  const r = ridge(x / 1250, z / 1250, WORLD.seed + 5);
  let h = (mask * 1.2 - 0.3 + (n - 0.5) * 0.7) * 240;
  h += Math.max(0, mask - 0.3) * r * 1050;
  return Math.max(h, -90);
}

function fieldBlend(field, x, z, h) {
  const { u, v } = runwayLocal(field, x, z);
  const du = Math.max(0, Math.abs(u) - field.length / 2 - 80);
  const dv = Math.max(0, Math.abs(v) - field.width / 2 - 70);
  const d = Math.hypot(du, dv);
  const w = 1 - smooth(clamp(d / 380, 0, 1));
  return lerp(h, field.elevation, w);
}

const heights = new Float32Array((N + 1) * (N + 1));
for (let j = 0; j <= N; j++) {
  for (let i = 0; i <= N; i++) {
    const x = -HALF + i * CELL;
    const z = -HALF + j * CELL;
    let h = rawHeight(x, z);
    for (const f of AIRFIELDS) h = fieldBlend(f, x, z, h);
    heights[j * (N + 1) + i] = h;
  }
}

/** Ground height in metres at a world position (bilinear between grid points; deep sea beyond the map). */
export function groundHeight(x, z) {
  const gx = (x + HALF) / CELL;
  const gz = (z + HALF) / CELL;
  if (gx < 0 || gz < 0 || gx >= N || gz >= N) return -90;
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const at = (a, b) => heights[b * (N + 1) + a];
  return lerp(lerp(at(i, j), at(i + 1, j), fx), lerp(at(i, j + 1), at(i + 1, j + 1), fx), fz);
}

/** The airfield whose runway contains this point, or null. */
export function runwayAt(x, z, margin = 0) {
  for (const f of AIRFIELDS) {
    const { u, v } = runwayLocal(f, x, z);
    if (Math.abs(u) <= f.length / 2 + margin && Math.abs(v) <= f.width / 2 + margin) return f;
  }
  return null;
}

/** Surface under a point: 'runway', 'water' or 'ground'. */
export function surfaceAt(x, z) {
  if (runwayAt(x, z)) return 'runway';
  return groundHeight(x, z) < WORLD.sea + 0.5 ? 'water' : 'ground';
}

const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Storm-dusk palette: dark wet sand at the shore, moss and pine on the lowlands, heath higher up, slate
// rock on steep faces and high ground, blue-white snow on the peaks. Blended, not banded.
const SAND = [0.42, 0.36, 0.3];
const MOSS = [0.13, 0.27, 0.13];
const PINE = [0.04, 0.13, 0.09];
const HEATH = [0.2, 0.21, 0.17];
const ROCK = [0.15, 0.15, 0.19];
const SNOW = [0.8, 0.84, 0.95];
const SEABED = [0.1, 0.14, 0.17];

function colourAt(h, slope, x, z) {
  const macro = fbm(x / 900, z / 900, 41, 3);
  const detail = (fbm(x / 120, z / 120, 77, 3) - 0.5) * 0.25;
  if (h < -1) return mixc(SEABED, SAND, clamp((h + 12) / 12, 0, 1));
  let c = mixc(MOSS, PINE, clamp((fbm(x / 520, z / 520, 31, 3) - 0.4) * 3.2, 0, 1));
  c = mixc(c, HEATH, smooth(clamp((h - 260 + macro * 140) / 220, 0, 1)));
  c = mixc(c, ROCK, smooth(clamp((h - 480) / 160, 0, 1)));
  c = mixc(c, ROCK, smooth(clamp((slope - 0.35) / 0.25, 0, 1)));
  c = mixc(c, SNOW, smooth(clamp((h - 700 - detail * 200) / 70, 0, 1)) * (1 - clamp((slope - 0.55) / 0.2, 0, 1)));
  c = mixc(SAND, c, smooth(clamp((h - 2) / 7, 0, 1)));
  return c.map((v) => v * (1 + detail));
}

/** The raw heights and grid side, for the sea's shore-foam texture. */
export const heightmap = () => ({ heights, side: N + 1 });

/** Indexed, smooth-shaded terrain mesh. */
export function buildTerrainMesh() {
  const count = (N + 1) * (N + 1);
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const at = (i, j) => heights[clamp(j, 0, N) * (N + 1) + clamp(i, 0, N)];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      const x = -HALF + i * CELL;
      const z = -HALF + j * CELL;
      const h = heights[k];
      const nx = at(i - 1, j) - at(i + 1, j);
      const nz = at(i, j - 1) - at(i, j + 1);
      const ny = 2 * CELL;
      const l = Math.hypot(nx, ny, nz);
      pos.set([x, h, z], k * 3);
      nrm.set([nx / l, ny / l, nz / l], k * 3);
      col.set(colourAt(h, 1 - ny / l, x, z), k * 3);
    }
  }
  const idx = new Uint32Array(N * N * 6);
  let p = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b = a + 1;
      const c = a + N + 1;
      const d = c + 1;
      idx.set([a, c, b, b, c, d], p);
      p += 6;
    }
  }
  return { pos, nrm, col, idx };
}

function treeSpot(x, z) {
  const h = groundHeight(x, z);
  if (h < 6 || h > 560) return null;
  const slope = Math.abs(groundHeight(x + 15, z) - h) + Math.abs(groundHeight(x, z + 15) - h);
  if (slope > 13 || runwayAt(x, z, 120)) return null;
  return h;
}

/** One tree: a dark lower crown and a lighter upper one, so stands read in two tones from the air. */
function addTree(m, r, x, h, z) {
  const s = 1.1 + r() * 1.1;
  const pine = r() < 0.78;
  const dark = pine ? [0.05 + r() * 0.03, 0.13 + r() * 0.05, 0.09] : [0.13, 0.19 + r() * 0.05, 0.08];
  const light = pine ? [dark[0] + 0.06, dark[1] + 0.1, dark[2] + 0.04] : [0.3, 0.32 + r() * 0.06, 0.12];
  m.box([x, h + 1.2 * s, z], [0.7 * s, 2.4 * s, 0.7 * s], [0.22, 0.15, 0.1]);
  if (pine) {
    m.cone([x, h + 1.8 * s, z], 3.4 * s, 7.5 * s, dark, 5);
    m.cone([x, h + 5.2 * s, z], 2.4 * s, 6.2 * s, light, 5);
  } else {
    m.cone([x, h + 2 * s, z], 4.2 * s, 4.2 * s, dark, 6);
    m.cone([x, h + 4.3 * s, z], 3.2 * s, 3.4 * s, light, 6);
  }
}

/** Forests in clustered stands: dense woods on the lowland slopes, thinning to single trees at their edges. */
export function buildForestMesh() {
  const m = new MeshBuilder();
  const r = rng(WORLD.seed + 101);
  let placed = 0;
  for (let c = 0; c < 900 && placed < 7000; c++) {
    const cx = (r() - 0.5) * SIZE * 0.92;
    const cz = (r() - 0.5) * SIZE * 0.92;
    if (treeSpot(cx, cz) === null || fbm(cx / 520, cz / 520, 31, 3) < 0.36) continue;
    const count = 10 + Math.floor(r() * 26);
    const spread = 50 + r() * 110;
    for (let t = 0; t < count; t++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * spread;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const h = treeSpot(x, z);
      if (h === null) continue;
      addTree(m, r, x, h, z);
      placed++;
    }
  }
  return m;
}

export const WORLD_HALF = HALF;
