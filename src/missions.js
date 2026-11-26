// Missions: what each sortie asks (take off, fly the rings, land somewhere), where it starts and with how
// much fuel, the tutorial hints for the first one, and how a finished sortie is scored and starred.

import { AIRCRAFT, AIRFIELDS, SCORE } from './config.js';
import { DEG, dot, normalize, sub } from './math.js';
import { groundHeight } from './terrain.js';

const field = (id) => AIRFIELDS.find((f) => f.id === id);

/** A point beside a runway: `along` metres down its heading, `across` metres to its right. */
function offset(f, along, across) {
  const h = f.heading * DEG;
  return [f.x + Math.sin(h) * along + Math.cos(h) * across, f.z - Math.cos(h) * along + Math.sin(h) * across];
}

/** Highest ground within `r` metres, so a ring always clears the hills around it. */
function clearance(x, z, r = 260) {
  let top = -100;
  for (let a = 0; a < 8; a++) top = Math.max(top, groundHeight(x + Math.cos(a) * r, z + Math.sin(a) * r));
  return Math.max(top, groundHeight(x, z), 0);
}

/** Rings along a path of [x, z, height above the local hills], each facing the next. */
function ringCourse(points, radius) {
  const pos = points.map(([x, z, agl]) => [x, clearance(x, z) + agl, z]);
  return pos.map((p, i) => {
    const next = pos[i + 1] || [p[0] + (p[0] - pos[i - 1][0]), p[1], p[2] + (p[2] - pos[i - 1][2])];
    const prev = pos[i - 1] || [p[0] - (next[0] - p[0]), p[1], p[2] - (next[2] - p[2])];
    const n = normalize(sub(next, prev));
    return { type: 'ring', pos: p, normal: normalize([n[0], n[1] * 0.3, n[2]]), radius };
  });
}

const gull = field('gull');
const cinder = field('cinder');
const gullStart = offset(gull, -gull.length / 2 + 25, 0);
const cinderStart = offset(cinder, -cinder.length / 2 + 25, 0);

export const MISSIONS = [
  {
    id: 'first-flight',
    name: 'First Flight',
    tag: 'Tutorial · 4 rings · landing',
    brief: 'Take the KS-2 up from Gullhaven, fly a right-hand circuit over the coast through four rings, and land back on the same runway. Hints on screen walk you through every step.',
    start: { pos: [gullStart[0], gull.elevation + AIRCRAFT.gearHeight, gullStart[1]], heading: gull.heading, speed: 0, throttle: 0, fuel: 80, onGround: true },
    objectives: [
      { type: 'takeoff' },
      ...ringCourse([[...offset(gull, 1700, 300), 150], [...offset(gull, 1500, 1300), 170], [...offset(gull, -900, 1300), 160], [...offset(gull, -1500, 200), 110]], 40),
      { type: 'land', field: 'gull', stop: true },
    ],
    par: 260,
    stars: [1800, 2600],
    tutorial: true,
  },
  {
    id: 'ridge-run',
    name: 'Ridge Run',
    tag: '10 rings · against the clock',
    brief: 'A timed course across the spine of the main island. Rings sit just above the ridges; every second under par time earns a bonus, every missed ring costs it. Watch your fuel at full throttle.',
    start: { pos: [-2700, 600, 1250], heading: 60, speed: 50, throttle: 0.75, fuel: 70, onGround: false },
    objectives: ringCourse([[-1900, 700, 80], [-1250, 150, 70], [-650, -350, 70], [50, -800, 75], [750, -500, 70],
      [1150, 200, 70], [750, 850, 70], [50, 1250, 70], [-650, 1000, 75], [-1400, 1500, 90]], 34),
    par: 150,
    stars: [3000, 3900],
  },
  {
    id: 'courier',
    name: 'Island Courier',
    tag: 'Gullhaven → Cinder Point · fuel limited',
    brief: 'The mail bag is aboard. Climb out of Gullhaven on the west coast, cross the Saddle Pass ring over the island’s spine, and land at Cinder Point Strip — a short runway on the eastern headland. 65 litres is enough only if you do not fly the whole way at full throttle.',
    start: { pos: [gullStart[0], gull.elevation + AIRCRAFT.gearHeight, gullStart[1]], heading: gull.heading, speed: 0, throttle: 0, fuel: 65, onGround: true },
    objectives: [
      { type: 'takeoff' },
      ...ringCourse([[150, -250, 110], [...offset(cinder, -1300, 0), 140], [...offset(cinder, -700, 0), 90]], 50),
      { type: 'land', field: 'cinder', stop: true },
    ],
    par: 230,
    stars: [1500, 2100],
  },
  {
    id: 'fuel-emergency',
    name: 'Fuel Emergency',
    tag: 'Engine failing · choose a runway',
    brief: 'A fuel line has split over the interior: you have a few litres and a high hill below. Pick the runway you can reach — Gullhaven is closer, Cinder Point longer — trade height for distance, and get it down in one piece.',
    start: { pos: [-1500, 1050, 700], heading: 280, speed: 45, throttle: 0.4, fuel: 5, onGround: false },
    objectives: [{ type: 'land', field: 'any', stop: true }],
    par: 120,
    stars: [900, 1300],
  },
];

export const FREE_FLIGHT = {
  id: 'free',
  name: 'Free Flight',
  tag: 'No goals · refuel on any runway',
  brief: 'The islands are yours. Fly anywhere, practise landings at both fields, and refuel by stopping on a runway.',
  start: { pos: [gullStart[0], gull.elevation + AIRCRAFT.gearHeight, gullStart[1]], heading: gull.heading, speed: 0, throttle: 0, fuel: AIRCRAFT.fuelCapacity, onGround: true },
  objectives: [],
  par: 0,
  stars: [0, 0],
  free: true,
};

export const fieldById = field;
export { cinderStart };

const HINTS = {
  takeoff: 'Press 0 for full throttle (or hold R). Keep straight with A / D. Past 60 knots, ease back with S to lift off.',
  ring: 'Fly through the gold ring. Bank with A / D and pull gently with S to hold the turn; the marker shows where it is.',
  land: 'Line up with the runway, throttle back to about 30 % (press 3) and descend under 500 ft/min. Level off just above the ground, then hold Space to brake to a stop.',
};

/** A running sortie. */
export function startMission(def) {
  return { def, index: 0, ringsHit: 0, ringsMissed: 0, time: 0, done: false, failed: null, landing: null, side: null, messages: [] };
}

export const currentObjective = (run) => run.def.objectives[run.index] || null;

export function hintFor(run) {
  if (!run.def.tutorial) return null;
  const o = currentObjective(run);
  return o ? HINTS[o.type] : null;
}

/** Plain words for the objective on screen. */
export function objectiveText(run) {
  const o = currentObjective(run);
  if (run.def.free) return 'Free flight — explore the islands';
  if (!o) return 'Complete';
  const rings = run.def.objectives.filter((x) => x.type === 'ring').length;
  if (o.type === 'takeoff') return 'Take off';
  if (o.type === 'ring') return `Ring ${run.ringsHit + run.ringsMissed + 1} of ${rings}`;
  if (o.field === 'any') return 'Land on either runway and stop';
  return `Land at ${field(o.field).name} and stop`;
}

/** Where the HUD marker should point for the current objective. */
export function objectiveTarget(run) {
  const o = currentObjective(run);
  if (!o) return null;
  if (o.type === 'ring') return o.pos;
  if (o.type === 'land') {
    const f = o.field === 'any' ? null : field(o.field);
    return f ? [f.x, f.elevation + 2, f.z] : null;
  }
  return null;
}

function advance(run, text, points) {
  run.index += 1;
  run.messages.push({ text, points });
  if (run.index >= run.def.objectives.length) run.done = true;
}

/** Check the current objective against the aircraft and this step's flight events. */
export function updateMission(run, plane, events, dt) {
  if (run.done || run.failed || run.def.free) {
    if (run.def.free) for (const e of events) if (e.type === 'crash') run.failed = e.reason;
    return;
  }
  run.time += dt;
  for (const e of events) {
    if (e.type === 'crash') run.failed = e.reason;
    if (e.type === 'touchdown') run.messages.push({ text: { perfect: 'Greaser! Perfect touchdown', good: 'Good landing', firm: 'Firm landing', hard: 'Hard landing — airframe damaged' }[e.quality] });
    if (e.type === 'rough') run.messages.push({ text: 'Off-field landing — damage taken' });
  }
  if (run.failed) return;
  const o = currentObjective(run);
  if (!o) return;
  if (o.type === 'takeoff' && !plane.onGround) advance(run, 'Airborne', 0);
  if (o.type === 'ring') {
    const rel = sub(plane.pos, o.pos);
    const side = dot(rel, o.normal);
    const lateral = Math.hypot(...sub(rel, o.normal.map((v) => v * side)));
    if (run.side !== null && run.side < 0 && side >= 0) {
      if (lateral <= o.radius) {
        run.ringsHit += 1;
        run.side = null;
        return advance(run, 'Ring', SCORE.ring);
      }
    }
    if (side > 180 && run.side !== null && run.side > 0 && lateral > o.radius) {
      run.ringsMissed += 1;
      run.side = null;
      return advance(run, 'Missed ring', 0);
    }
    run.side = side;
  }
  if (o.type === 'land' && plane.onGround && plane.stoppedOn && plane.lastTouchdown) {
    const ok = o.field === 'any' ? plane.stoppedOn !== 'field' : plane.stoppedOn === o.field;
    if (ok) {
      run.landing = plane.lastTouchdown.quality;
      advance(run, `Stopped at ${field(plane.stoppedOn).name}`, 0);
    }
  }
  if (plane.onGround && plane.fuel <= 0 && plane.speed < 0.5 && !run.done) run.failed = 'out of fuel short of the runway';
}

/** The sortie's score, its breakdown and its stars. */
export function scoreRun(run, plane) {
  const lines = [];
  const add = (label, value) => { if (value) lines.push({ label, value: Math.round(value) }); };
  add(`Rings flown (${run.ringsHit})`, run.ringsHit * SCORE.ring);
  if (run.landing) add(`Landing: ${run.landing}`, { perfect: SCORE.perfectLanding, good: SCORE.goodLanding, firm: SCORE.firmLanding, hard: 0 }[run.landing]);
  add(`Fuel remaining (${plane.fuel.toFixed(1)} L)`, plane.fuel * SCORE.fuelPerLitre);
  add('Under par time', Math.max(0, run.def.par - run.time) * SCORE.timeBonusPerSecond);
  add(`Damage (${Math.round(plane.damage)} %)`, -plane.damage * SCORE.damagePenalty);
  const total = run.failed ? 0 : Math.max(0, lines.reduce((a, l) => a + l.value, 0));
  const stars = run.failed ? 0 : 1 + (total >= run.def.stars[0] ? 1 : 0) + (total >= run.def.stars[1] ? 1 : 0);
  return { total, lines, stars };
}
