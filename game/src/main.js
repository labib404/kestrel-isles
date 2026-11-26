// Kestrel Isles: boots the renderer and world, runs the screens (title → briefing → flight → debrief)
// and the fixed-step game loop that ties flight, missions, camera, sound, effects and the HUD together.

import { AIRCRAFT, STEP, WORLD } from './config.js';
import { DEG, add, basis, compose, normalize, quatAxisAngle, quatFromEuler, quatMul, scale } from './math.js';
import { Renderer } from './renderer.js';
import { buildForestMesh, buildTerrainMesh, groundHeight, heightmap } from './terrain.js';
import { buildAircraft, buildAirfields, buildCloudSprites, buildPropeller, buildPuff, buildRing, buildRunwayLights, buildSea, buildShadow } from './models.js';
import { drawWeather, updateWeather } from './weather.js';
import { makePlane, readInstruments, stepPlane } from './flight.js';
import { cameraMatrices, debriefCamera, makeCamera, orbitBy, orbitCamera, updateCamera, zoomBy } from './camera.js';
import { bindInput, clearTaps, readControls, resetStick, takeMouse, tapped, toggleYoke, yokeOn } from './input.js';
import { FREE_FLIGHT, MISSIONS, currentObjective, hintFor, objectiveTarget, objectiveText, scoreRun, startMission, updateMission } from './missions.js';
import { drawHud } from './hud.js';
import { playCue, startAudio, toggleMute, updateAudio } from './audio.js';
import { clearEffects, eachPuff, emit, explode, updateEffects } from './effects.js';
import { bestOf, saveBest, setScreen, showBrief, showDebrief, showPause, showTitle } from './screens.js';
import { stageShot } from './shots.js';

const view = document.getElementById('view');
const hud = document.getElementById('hud');
let renderer;
try {
  renderer = new Renderer(view);
} catch (err) {
  document.getElementById('nogl').hidden = false;
  document.getElementById('nogl-msg').textContent = err.message;
  throw err;
}

const meshes = {
  terrain: renderer.mesh(buildTerrainMesh()),
  forest: renderer.mesh(buildForestMesh()),
  airfields: renderer.mesh(buildAirfields()),
  lights: renderer.mesh(buildRunwayLights()),
  aircraft: renderer.mesh(buildAircraft()),
  prop: renderer.mesh(buildPropeller()),
  ring: renderer.mesh(buildRing()),
  sea: renderer.mesh(buildSea()),
  shadow: renderer.mesh(buildShadow()),
  puff: renderer.mesh(buildPuff()),
};
const IDENTITY = compose([0, 0, 0]);
const CLOUDS = buildCloudSprites();
{
  const { heights, side } = heightmap();
  renderer.setHeightmap(heights, side, WORLD.size);
}

const game = {
  screen: 'title',
  def: null,
  run: null,
  plane: makePlane(FREE_FLIGHT.start),
  cam: makeCamera(),
  messages: [],
  endTimer: 0,
  shot: null,
  clock: 0,
};

// ---- flow between screens ----

function toTitle() {
  game.screen = 'title';
  game.def = null;
  showTitle(MISSIONS, FREE_FLIGHT, toBrief);
}

function toBrief(def) {
  game.def = def;
  game.screen = 'brief';
  showBrief(def, () => launch(def), toTitle);
}

function launch(def) {
  startAudio();
  clearEffects();
  clearTaps();
  resetStick();
  game.def = def;
  game.run = startMission(def);
  game.plane = makePlane(def.start);
  game.cam = makeCamera();
  game.cam.mode = game.prefMode || 'chase';
  game.messages = [];
  game.endTimer = 0;
  game.screen = 'fly';
  setScreen('fly');
  view.focus({ preventScroll: true });
}

function pause() {
  game.screen = 'pause';
  showPause(resume, () => launch(game.def), toTitle);
}

function resume() {
  game.screen = 'fly';
  setScreen('fly');
  clearTaps();
  view.focus({ preventScroll: true });
}

function finish() {
  const { run, plane, def } = game;
  const score = scoreRun(run, plane);
  if (!run.failed && !def.free) saveBest(def.id, score.total, score.stars);
  const i = MISSIONS.indexOf(def);
  const next = !run.failed && i >= 0 && i < MISSIONS.length - 1 ? () => toBrief(MISSIONS[i + 1]) : null;
  game.screen = 'debrief';
  playCue(run.failed ? 'crash' : 'complete');
  showDebrief(def, {
    title: run.failed ? 'Sortie lost' : `${def.name} complete`,
    reason: run.failed ? `You ${run.failed}.` : run.landing ? `Landed — ${run.landing} touchdown, ${Math.round(plane.damage)} % damage.` : `${run.ringsHit} rings flown, ${run.ringsMissed} missed.`,
    failed: Boolean(run.failed), ...score, best: bestOf(def.id),
  }, () => launch(def), next, toTitle);
}

// ---- one frame of flight ----

function flyStep(dt) {
  const { plane, run } = game;
  const controls = readControls(dt, plane);
  const events = stepPlane(plane, controls, dt);
  updateMission(run, plane, events, dt);
  for (const e of events) {
    if (e.type === 'crash') { explode(plane.pos, e.reason.includes('sea')); playCue('crash'); }
    if (e.type === 'touchdown' || e.type === 'rough') {
      playCue('touchdown');
      for (let i = 0; i < 6; i++) emit(add(plane.pos, [0, -1.6, 0]), { vel: [0, 1.2, 0], size: 0.9, grow: 3, life: 1.4, colour: [0.75, 0.72, 0.66], spread: 2 });
    }
  }
  for (const m of run.messages.splice(0)) {
    game.messages.push({ text: m.points ? `${m.text}  +${m.points}` : m.text, age: 0 });
    if (m.text === 'Ring') playCue('ring');
    if (m.text === 'Missed ring') playCue('missed');
  }
  emitWingtipTrails(plane, controls);
  if (plane.damage > 35 && !plane.crashed && Math.random() < plane.damage / 400) {
    const b = basis(plane.q);
    emit(add(plane.pos, scale(b.fwd, 3)), { vel: scale(b.fwd, -6), size: 0.6, grow: 2.5, life: 1.6, colour: [0.3, 0.3, 0.3], spread: 0.6 });
  }
  if (run.def.free && plane.onGround && plane.stoppedOn && plane.stoppedOn !== 'field') plane.fuel = Math.min(AIRCRAFT.fuelCapacity, plane.fuel + 6 * dt);
  const far = Math.hypot(plane.pos[0], plane.pos[2]);
  if (far > 6400 && !run.failed && !run.done) run.failed = 'strayed too far out to sea';
}

/** Vapour streams off the wingtips when the aircraft is fast or pulling hard through damp storm air. */
let trailTick = 0;
export function emitWingtipTrails(plane, controls) {
  if (plane.onGround || plane.crashed || game.shot) return;
  trailTick += 1;
  const load = Math.abs(controls.pitch) + Math.abs(controls.roll) * 0.4;
  if (plane.speed < 38 && load < 0.4) return;
  const b = basis(plane.q);
  for (const side of [1, -1]) {
    const tip = add(add(plane.pos, scale(b.right, side * 5.6)), add(scale(b.up, 0.95), scale(b.fwd, -0.9)));
    emit(tip, { vel: [0, 0.2, 0], size: 0.08, grow: 0.12, life: 0.35 + load * 0.4, colour: [0.78, 0.84, 0.94], spread: 0.02 });
  }
}

function warningFor(plane, ins) {
  if (plane.crashed) return null;
  if (Math.hypot(plane.pos[0], plane.pos[2]) > 5300) return 'Leaving the islands — turn back';
  if (ins.fuel < 0.08 && plane.fuel > 0) return 'Fuel low';
  if (plane.fuel <= 0) return 'Out of fuel — glide to a runway';
  if (!plane.onGround && ins.agl < 120 && ins.vsi < -900) return 'Sink rate — pull up';
  if (plane.speed > AIRCRAFT.neverExceed) return 'Overspeed — reduce power';
  return null;
}

// ---- drawing ----

function drawWorld(cam) {
  renderer.begin(cam);
  renderer.draw(meshes.terrain, IDENTITY, { terrain: true });
  renderer.draw(meshes.airfields, IDENTITY);
  renderer.draw(meshes.lights, IDENTITY, { emissive: 1, tint: [3, 3, 3] });
  renderer.draw(meshes.forest, IDENTITY);
  renderer.drawSea(meshes.sea, IDENTITY);
  drawWeather(renderer, IDENTITY);

  if (game.run && !game.run.def.free) {
    const objs = game.run.def.objectives;
    objs.forEach((o, i) => {
      if (o.type !== 'ring' || i < game.run.index) return;
      const current = i === game.run.index;
      const yaw = Math.atan2(o.normal[0], -o.normal[2]);
      const q = quatFromEuler(yaw, Math.asin(o.normal[1]), 0);
      const pulse = current ? 1 + Math.sin(renderer.time * 4) * 0.03 : 1;
      renderer.draw(meshes.ring, compose(o.pos, q, o.radius * pulse), { emissive: 1, tint: current ? [0.7, 3.2, 3.6] : [0.35, 0.9, 1.1], alpha: current ? 1 : 0.5 });
    });
  }

  const p = game.plane;
  const showPlane = !((game.screen === 'fly' || game.screen === 'pause') && game.cam.mode === 'cockpit');
  if (!p.crashed && showPlane) {
    renderer.draw(meshes.aircraft, compose(p.pos, p.q));
    const b = basis(p.q);
    const spin = quatMul(p.q, quatAxisAngle([0, 0, 1], p.prop));
    renderer.draw(meshes.prop, compose(add(p.pos, scale(b.fwd, 3.98)), spin), { alpha: p.throttle > 0.05 ? 0.75 : 1 });
  }
  if (!p.crashed) {
    const g = Math.max(groundHeight(p.pos[0], p.pos[2]), 0);
    const h = p.pos[1] - g;
    if (h < 300) renderer.draw(meshes.shadow, compose([p.pos[0] + h * 0.35, g + 0.4, p.pos[2] + h * 0.3], [0, 0, 0, 1], [6, 1, 4.6]), { alpha: 0.32 * (1 - h / 300), emissive: 1 });
  }
  renderer.drawClouds(CLOUDS);
  eachPuff((pos, size, colour, life) => renderer.draw(meshes.puff, compose(pos, [0, 0, 0, 1], size), { tint: colour, alpha: 0.7 * life, emissive: colour[2] > 0.95 ? 0.85 : 0.2 }));
  const fast = game.screen === 'fly' ? Math.max(0, (p.speed - 62) / 25) : 0;
  renderer.end({ speed: Math.min(fast, 1) * 0.6, bloom: 1.25 });
}

function hudState(cam) {
  const { plane, run, def } = game;
  const ins = readInstruments(plane);
  const target = run ? objectiveTarget(run) : null;
  const o = run ? currentObjective(run) : null;
  const score = run && !def.free ? scoreRun(run, plane).total : 0;
  const msg = game.messages[0];
  return {
    plane, ins, vp: cam.vp, mode: game.cam.mode, target,
    targetLabel: o?.type === 'ring' ? 'RING' : 'RUNWAY',
    rings: run ? run.def.objectives.map((x, i) => ({ ...x, current: i === run.index })).filter((x, i) => x.type === 'ring' && i >= run.index) : [],
    missionName: def ? def.name : '',
    objective: run ? objectiveText(run) : '',
    hint: run ? hintFor(run) : null,
    time: run ? run.time : 0,
    score,
    message: msg ? msg.text : null,
    warning: warningFor(plane, ins),
    yoke: yokeOn(),
    clock: game.clock,
  };
}

// ---- background flight for the menus: the KS-2 circling Gullhaven ----

function menuFlight(t) {
  const centre = [-4400, 210, 300];
  const a = t * 0.08;
  const pos = [centre[0] + Math.cos(a) * 520, centre[1] + Math.sin(a * 2) * 12, centre[2] + Math.sin(a) * 520];
  const dir = normalize([-Math.sin(a), 0, Math.cos(a)]);
  const heading = Math.atan2(dir[0], -dir[2]);
  game.plane.pos = pos;
  game.plane.q = quatFromEuler(heading, 2 * DEG, 22 * DEG);
  game.plane.prop += 0.9;
  game.plane.throttle = 0.6;
  game.plane.crashed = null;
  const b = basis(game.plane.q);
  game.cam.eye = add(add(pos, scale(b.fwd, 22)), add(scale(b.right, -16), [0, 3, 0]));
  game.cam.look = add(pos, scale(b.fwd, -6));
  game.cam.up = [0, 1, 0];
  game.cam.fov = 50;
  game.cam.mode = 'chase';
}

// ---- main loop ----

let last = performance.now();
let acc = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.clock += dt;
  renderer.time += dt;
  const aspect = renderer.resize();

  if (game.screen === 'fly') {
    if (tapped('Escape') || tapped('KeyP')) pause();
    if (tapped('KeyC')) { game.cam.mode = game.cam.mode === 'chase' ? 'cockpit' : 'chase'; game.prefMode = game.cam.mode; }
    if (tapped('KeyM')) game.messages.push({ text: toggleYoke() ? 'Mouse yoke on' : 'Mouse yoke off', age: 0 });
    if (tapped('KeyH')) game.messages.push({ text: 'W/S pitch · A/D roll · Q/E rudder · R/F throttle', age: 0 });
    acc += dt;
    while (acc >= STEP && game.screen === 'fly') {
      if (!game.plane.crashed) flyStep(STEP);
      acc -= STEP;
    }
    const mouse = takeMouse();
    if (mouse.dragging) orbitBy(game.cam, mouse.dx * 0.006, mouse.dy * 0.004);
    if (mouse.wheel) zoomBy(game.cam, mouse.wheel * 0.1);
    updateCamera(game.cam, game.plane, dt, mouse.dragging || Boolean(game.shot));
    if ((game.run.done || game.run.failed) && (game.endTimer += dt) > (game.run.failed ? 2.2 : 1.6)) finish();
  } else if (game.screen === 'title' || game.screen === 'brief') {
    menuFlight(game.clock);
    clearTaps();
  } else if (game.screen === 'debrief') {
    if (game.plane.crashed) orbitCamera(game.cam, game.plane.pos, game.clock * 0.15, 60, 25);
    else debriefCamera(game.cam, game.plane.pos, game.clock);
    clearTaps();
  } else if (game.screen === 'pause') {
    if (tapped('Escape') || tapped('KeyP')) resume();
  }
  if (tapped('KeyN')) toggleMute();
  updateEffects(game.screen === 'pause' ? 0 : dt);
  updateWeather(renderer, game.screen === 'pause' ? 0 : dt, game.cam.eye);
  for (const m of game.messages) m.age += dt;
  while (game.messages.length && game.messages[0].age > 2.2) game.messages.shift();

  const cam = cameraMatrices(game.cam, aspect);
  drawWorld(cam);
  const flying = game.screen === 'fly' || game.screen === 'pause';
  hud.hidden = !flying;
  if (flying) drawHud(hud, hudState(cam));
  updateAudio(game.plane, game.screen === 'fly');
  if (!game.shot) requestAnimationFrame(frame);
}

// ---- start ----

bindInput(view);
addEventListener('pointerdown', startAudio);
addEventListener('keydown', startAudio);

const shotName = new URLSearchParams(location.search).get('shot');
if (shotName) {
  game.shot = shotName;
  stageShot(shotName, { game, launch, toTitle, finish, MISSIONS, FREE_FLIGHT, setScreen, flyStep, renderer });
  last = performance.now();
  requestAnimationFrame((t) => { frame(t); requestAnimationFrame(frame); });
} else {
  toTitle();
  requestAnimationFrame(frame);
}
