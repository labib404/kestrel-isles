// The KS-2's flight model: thrust against drag and gravity along the flight path, lift that fades below
// the stall speed and in steep banks (so the aircraft sinks unless the pilot pulls), coordinated turns,
// fuel burn, the ground roll with brakes, and touchdowns graded against crashes.

import { AIRCRAFT as A, LANDING, WORLD } from './config.js';
import { DEG, add, basis, clamp, headingOf, quatAxisAngle, quatFromEuler, quatMul, quatNormalize, scale } from './math.js';
import { groundHeight, runwayAt, surfaceAt } from './terrain.js';

const G = 9.81;

/** A fresh aircraft. On the ground at a runway threshold, or airborne at a given speed. */
export function makePlane({ pos, heading, pitch = 0, speed = 0, throttle = 0, fuel = A.fuelCapacity, onGround = false }) {
  return {
    pos: [...pos], q: quatFromEuler(heading * DEG, pitch * DEG, 0), speed, sink: 0, throttle, fuel, damage: 0,
    onGround, brakes: false, stalled: false, crashed: null, stoppedOn: null, prop: 0, vs: 0, lastTouchdown: null, time: 0,
  };
}

function rotate(plane, axis, angle) {
  if (angle) plane.q = quatNormalize(quatMul(quatAxisAngle(axis, angle), plane.q));
}

/** Roll angle in degrees, positive with the right wing down. */
export function bankOf(b) {
  return Math.atan2(-b.right[1], b.up[1]) / DEG;
}

export function pitchOf(b) {
  return Math.asin(clamp(b.fwd[1], -1, 1)) / DEG;
}

function burnFuel(plane, dt) {
  plane.fuel = Math.max(0, plane.fuel - (A.burnIdle + (A.burnFull - A.burnIdle) * plane.throttle) * dt);
}

function thrust(plane) {
  if (plane.fuel <= 0) return 0;
  // A nearly empty tank makes the engine cough: thrust stutters below two litres.
  const cough = plane.fuel < 2 ? (Math.sin(plane.time * 9) > 0.2 ? 1 : 0.25) : 1;
  return A.thrust * plane.throttle * cough;
}

function crash(plane, reason, events) {
  plane.crashed = reason;
  plane.speed = 0;
  events.push({ type: 'crash', reason });
}

/** Contact with the surface while airborne: a graded touchdown, a rough field landing, or a crash. */
function touchGround(plane, b, floor, events) {
  const sink = -plane.vs;
  const bank = Math.abs(bankOf(b));
  const pitch = pitchOf(b);
  const surface = surfaceAt(plane.pos[0], plane.pos[2]);
  if (surface === 'water' || floor <= WORLD.sea + 0.3) return crash(plane, 'ditched in the sea', events);
  const field = runwayAt(plane.pos[0], plane.pos[2]);
  const gentle = sink <= LANDING.maxSink && bank <= LANDING.maxBank && pitch > -5 && pitch < 17 && plane.speed <= LANDING.maxSpeed;
  if (field && gentle) {
    let quality = 'firm';
    if (sink <= LANDING.softSink) quality = 'perfect';
    else if (sink <= 2.8) quality = 'good';
    else plane.damage += (sink - 2.8) * 14;
    settle(plane, b, floor);
    plane.lastTouchdown = { field: field.id, sink, quality };
    events.push({ type: 'touchdown', field, sink, quality });
    return null;
  }
  if (!field && sink <= 2.4 && plane.speed < 34 && bank < 10 && pitch > -3) {
    plane.damage += 28;
    settle(plane, b, floor);
    events.push({ type: 'rough', sink });
    return null;
  }
  if (field && sink <= LANDING.maxSink + 1.5 && bank < 25) {
    plane.damage += 45 + sink * 6;
    if (plane.damage < 100) {
      settle(plane, b, floor);
      plane.lastTouchdown = { field: field.id, sink, quality: 'hard' };
      events.push({ type: 'touchdown', field, sink, quality: 'hard' });
      return null;
    }
  }
  return crash(plane, field ? 'hard landing' : bank > 30 ? 'caught a wing on the ground' : 'flew into the ground', events);
}

/** Put the aircraft on its wheels: no roll, nose no lower than level. */
function settle(plane, b, floor) {
  plane.onGround = true;
  plane.sink = 0;
  plane.pos[1] = floor + A.gearHeight;
  plane.q = quatFromEuler(headingOf(b.fwd) * DEG, Math.max(0, pitchOf(b)) * DEG, 0);
}

function flyAir(plane, input, dt, events) {
  let b = basis(plane.q);
  const auth = clamp(plane.speed / 38, 0.12, 1);
  rotate(plane, b.right, input.pitch * A.pitchRate * auth * dt);
  rotate(plane, b.fwd, input.roll * A.rollRate * auth * dt);
  rotate(plane, b.up, -input.yaw * A.yawRate * auth * dt);
  b = basis(plane.q);

  // A banked wing turns the aircraft: rate g·tan(bank)/speed, around the world's vertical.
  const bank = clamp(bankOf(b), -80, 80) * DEG;
  const lift = (plane.speed / A.stallSpeed) ** 2;
  const turn = (G * Math.tan(bank) / Math.max(plane.speed, 18)) * clamp(lift, 0, 1);
  rotate(plane, [0, 1, 0], -turn * dt);

  // Below the stall the nose drops by itself and the controls go soft.
  plane.stalled = lift < 0.92 && !plane.onGround;
  if (lift < 1 && b.fwd[1] > -0.7) rotate(plane, basis(plane.q).right, -(1 - lift) * 0.9 * dt);

  b = basis(plane.q);
  const accel = thrust(plane) - A.drag * plane.speed * plane.speed - G * b.fwd[1];
  plane.speed = Math.max(0, plane.speed + accel * dt);
  if (plane.speed > A.neverExceed) plane.damage += (plane.speed - A.neverExceed) * 0.4 * dt;

  // Sink when the wing cannot carry the weight: too slow, or banked too far without pulling.
  const carried = Math.min(lift * Math.max(b.up[1], 0), 1.15);
  plane.sink = Math.max(0, plane.sink + (G * (1 - carried) - plane.sink * 0.9) * dt);

  const vel = add(scale(b.fwd, plane.speed), [0, -plane.sink, 0]);
  plane.vs = vel[1];
  plane.pos = add(plane.pos, scale(vel, dt));

  const floor = Math.max(groundHeight(plane.pos[0], plane.pos[2]), WORLD.sea);
  if (plane.pos[1] - A.gearHeight <= floor) touchGround(plane, b, floor, events);
}

function rollGround(plane, input, dt, events) {
  let b = basis(plane.q);
  const steer = (input.yaw + input.roll * 0.5) * 0.55 * clamp(plane.speed / 8, 0.15, 1);
  rotate(plane, [0, 1, 0], -steer * dt);
  b = basis(plane.q);
  let pitch = pitchOf(b);
  if (plane.speed > A.rotateSpeed * 0.82 && input.pitch > 0) pitch = Math.min(14, pitch + input.pitch * 9 * dt);
  else pitch = Math.max(0, pitch - 6 * dt);
  plane.q = quatFromEuler(headingOf(b.fwd) * DEG, pitch * DEG, 0);
  b = basis(plane.q);

  const onRunway = Boolean(runwayAt(plane.pos[0], plane.pos[2]));
  const friction = A.rolling * (onRunway ? 1 : 3.2) + (plane.brakes ? A.brake : 0);
  let accel = thrust(plane) - A.drag * plane.speed * plane.speed;
  accel -= plane.speed > 0 ? friction : 0;
  plane.speed = Math.max(0, plane.speed + accel * dt);
  if (!onRunway && plane.speed > 20) plane.damage += (plane.speed - 20) * 0.6 * dt;

  const flat = [b.fwd[0], 0, b.fwd[2]];
  const l = Math.hypot(flat[0], flat[2]) || 1;
  plane.pos = add(plane.pos, scale([flat[0] / l, 0, flat[2] / l], plane.speed * dt));
  const ground = groundHeight(plane.pos[0], plane.pos[2]);
  if (ground <= WORLD.sea + 0.3) return crash(plane, 'rolled into the sea', events);
  plane.pos[1] = ground + A.gearHeight;
  plane.vs = 0;
  plane.stalled = false;

  if (pitch > 4 && plane.speed > A.rotateSpeed) {
    plane.onGround = false;
    plane.sink = 0;
    events.push({ type: 'takeoff' });
  }
  const field = runwayAt(plane.pos[0], plane.pos[2]);
  plane.stoppedOn = plane.speed < 0.8 ? (field ? field.id : 'field') : null;
  return null;
}

/** Advance the aircraft one physics step. input: {pitch, roll, yaw in -1..1, brakes}. Returns events. */
export function stepPlane(plane, input, dt) {
  const events = [];
  if (plane.crashed) return events;
  plane.time += dt;
  plane.brakes = Boolean(input.brakes);
  burnFuel(plane, dt);
  if (plane.onGround) rollGround(plane, input, dt, events);
  else flyAir(plane, input, dt, events);
  plane.prop += (8 + plane.throttle * 50) * (plane.fuel > 0 ? 1 : 0.15) * dt;
  if (!plane.crashed && plane.damage >= 100) crash(plane, 'the airframe failed', events);
  return events;
}

/** What the instruments read: knots, feet, heading, feet per minute, degrees. */
export function readInstruments(plane) {
  const b = basis(plane.q);
  const ground = Math.max(groundHeight(plane.pos[0], plane.pos[2]), WORLD.sea);
  return {
    knots: plane.speed * 1.944,
    feet: plane.pos[1] * 3.281,
    agl: (plane.pos[1] - A.gearHeight - ground) * 3.281,
    heading: headingOf(b.fwd),
    vsi: plane.vs * 196.85,
    pitch: pitchOf(b),
    bank: bankOf(b),
    fuel: plane.fuel / A.fuelCapacity,
    throttle: plane.throttle,
    damage: plane.damage,
    stall: plane.stalled,
  };
}
