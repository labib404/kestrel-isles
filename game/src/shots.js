// Screenshot scenes behind ?shot=cover|cockpit|menu|debrief. Each sets the real game up at a moment of a
// real mission — the aircraft placed on the course, the mission's own rings and runways, the live HUD —
// so the maker's screenshots are renders of the game's code and the same URL always gives the same frame.

import { STEP } from './config.js';
import { DEG, quatFromEuler, sub } from './math.js';
import { updateCamera } from './camera.js';
import { fieldById } from './missions.js';
import { freezeStrike, strikeAt } from './weather.js';

function placeBefore(plane, point, normal, back, up, side = 0) {
  const flat = Math.hypot(normal[0], normal[2]) || 1;
  const n = [normal[0] / flat, 0, normal[2] / flat];
  plane.pos = [point[0] - n[0] * back + n[2] * side, point[1] + up, point[2] - n[2] * back - n[0] * side];
  const to = sub(point, plane.pos);
  plane.q = quatFromEuler(Math.atan2(to[0], -to[2]), Math.atan2(to[1], Math.hypot(to[0], to[2])) * 0.6, -8 * DEG);
}

export function stageShot(name, app) {
  const { game, launch, toTitle, finish, MISSIONS } = app;
  const byId = (id) => MISSIONS.find((m) => m.id === id);

  if (name === 'menu') {
    toTitle();
    freezeStrike(app.renderer, [-4400, 0, 300], 0);
    return;
  }

  if (name === 'cockpit') {
    launch(byId('courier'));
    const run = game.run;
    run.index = run.def.objectives.length - 1;
    run.time = 162;
    run.ringsHit = 3;
    const f = fieldById('cinder');
    const h = f.heading * DEG;
    const back = 380;
    const p = game.plane;
    p.pos = [f.x - Math.sin(h) * (back + f.length / 2), f.elevation + back * Math.tan(7 * DEG) + 22, f.z + Math.cos(h) * (back + f.length / 2)];
    p.q = quatFromEuler(h, -7 * DEG, 3 * DEG);
    p.speed = 33;
    p.throttle = 0.3;
    p.fuel = 21;
    p.onGround = false;
    p.vs = -2.4;
    game.cam.mode = 'cockpit';
    updateCamera(game.cam, p, 1);
    strikeAt(app.renderer, [f.x + Math.sin(h) * 2800 + 900, 1500, f.z - Math.cos(h) * 2800], 0.3);
    return;
  }

  if (name === 'debrief') {
    launch(byId('first-flight'));
    const run = game.run;
    const f = fieldById('gull');
    const p = game.plane;
    const h = f.heading * DEG;
    p.pos = [f.x + Math.sin(h) * 120, f.elevation + 1.7, f.z - Math.cos(h) * 120];
    p.q = quatFromEuler(h, 0, 0);
    p.speed = 0;
    p.fuel = 61.5;
    p.damage = 0;
    run.index = run.def.objectives.length;
    run.ringsHit = 4;
    run.time = 214;
    run.landing = 'perfect';
    run.done = true;
    finish();
    freezeStrike(app.renderer, p.pos, 0);
    return;
  }

  // cover: the Island Courier running low along the eastern coast toward the storm, lining up on a ring
  // with Cinder Point's headland ahead, the low sun behind lighting the hills, lightning over the sea.
  const pick = new URLSearchParams(location.search);
  const coverMission = pick.get('m') || 'courier';
  const coverRing = Number(pick.get('r') || 2);
  launch(byId(coverMission));
  const run = game.run;
  run.index = coverRing;
  run.ringsHit = Math.max(0, coverRing - 1);
  run.time = 131;
  const ring = run.def.objectives[coverRing];
  app.orbit = pick.has('o') ? Number(pick.get('o')) : -0.4;
  const p = game.plane;
  placeBefore(p, ring.pos, ring.normal, 230, -5, 9);
  p.onGround = false;
  p.speed = 52;
  p.throttle = 0.72;
  p.fuel = 63;
  void STEP;
  game.cam.mode = 'chase';
  game.cam.distance = 15;
  game.cam.smooth = null;
  game.cam.orbitYaw = app.orbit ?? -0.62;
  game.cam.orbitPitch = 0.06;
  updateCamera(game.cam, p, 1, true);
  const flat = Math.hypot(ring.normal[0], ring.normal[2]);
  strikeAt(app.renderer, [ring.pos[0] + (ring.normal[0] / flat) * 2600 + 500, 1500, ring.pos[2] + (ring.normal[2] / flat) * 2600 - 300], 0.22);
}
