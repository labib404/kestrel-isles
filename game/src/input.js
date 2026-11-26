// Keyboard and mouse. Keys give smoothed stick, rudder and throttle; the mouse can fly the aircraft
// (yoke mode, M) or swing the chase camera by dragging, and the wheel zooms the camera.

import { clamp } from './math.js';

const held = new Set();
const pressed = new Set();
const mouse = { x: 0, y: 0, dragging: false, dx: 0, dy: 0, wheel: 0, yoke: false };
const stick = { pitch: 0, roll: 0, yaw: 0 };

const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyC', 'KeyM', 'KeyP', 'KeyH',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Escape', 'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9']);

export function bindInput(canvas) {
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
    if (!held.has(e.code)) pressed.add(e.code);
    held.add(e.code);
    if (GAME_KEYS.has(e.code) && document.body.dataset.screen === 'fly') e.preventDefault();
  });
  addEventListener('keyup', (e) => held.delete(e.code));
  addEventListener('blur', () => held.clear());
  canvas.addEventListener('pointerdown', (e) => {
    mouse.dragging = true;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', () => { mouse.dragging = false; });
  canvas.addEventListener('pointermove', (e) => {
    if (mouse.dragging && !mouse.yoke) {
      mouse.dx += e.movementX;
      mouse.dy += e.movementY;
    }
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = (e.clientY / innerHeight) * 2 - 1;
  });
  canvas.addEventListener('wheel', (e) => { mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** True once for each key press (consumed by reading). */
export function tapped(code) {
  const had = pressed.has(code);
  pressed.delete(code);
  return had;
}

export function clearTaps() {
  pressed.clear();
}

const axis = (neg, pos) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);

/**
 * The pilot's controls for this frame. Keys ramp the stick in rather than snapping it, which keeps small
 * corrections possible; in yoke mode the mouse's distance from the centre of the screen is the stick.
 */
export function readControls(dt, plane) {
  const wantPitch = axis('KeyW', 'KeyS') || axis('ArrowUp', 'ArrowDown');
  const wantRoll = axis('KeyA', 'KeyD') || axis('ArrowLeft', 'ArrowRight');
  const wantYaw = axis('KeyQ', 'KeyE');
  const k = 1 - Math.exp(-dt * 6);
  stick.pitch += (wantPitch - stick.pitch) * k;
  stick.roll += (wantRoll - stick.roll) * k;
  stick.yaw += (wantYaw - stick.yaw) * k;
  let pitch = stick.pitch;
  let roll = stick.roll;
  if (mouse.yoke) {
    const dead = (v) => (Math.abs(v) < 0.04 ? 0 : v);
    pitch = clamp(dead(mouse.y) * 1.6 + pitch, -1, 1);
    roll = clamp(dead(mouse.x) * 1.6 + roll, -1, 1);
  }
  const throttleStep = axis('KeyF', 'KeyR') * 0.45 * dt;
  plane.throttle = clamp(plane.throttle + throttleStep, 0, 1);
  for (let n = 0; n <= 9; n++) if (tapped(`Digit${n}`)) plane.throttle = n === 0 ? 1 : n / 10;
  return { pitch, roll, yaw: stick.yaw, brakes: held.has('Space') };
}

/** Camera drag and wheel since the last call. */
export function takeMouse() {
  const out = { dx: mouse.dx, dy: mouse.dy, wheel: mouse.wheel, dragging: mouse.dragging };
  mouse.dx = 0;
  mouse.dy = 0;
  mouse.wheel = 0;
  return out;
}

export function toggleYoke() {
  mouse.yoke = !mouse.yoke;
  return mouse.yoke;
}

export const yokeOn = () => mouse.yoke;

export function resetStick() {
  stick.pitch = 0;
  stick.roll = 0;
  stick.yaw = 0;
}
