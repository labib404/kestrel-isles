// Cameras: a chase view that trails the aircraft smoothly (and can be swung round with the mouse, easing
// back when released), a cockpit view from the pilot's seat, and a slow orbit for menus and debriefs.

import { WORLD } from './config.js';
import { DEG, add, basis, clamp, invert, lerp, lookAt, mix3, multiply, normalize, perspective, scale } from './math.js';
import { groundHeight } from './terrain.js';

export function makeCamera() {
  return { mode: 'chase', eye: [0, 50, 0], look: [0, 0, -1], up: [0, 1, 0], distance: 17, orbitYaw: 0, orbitPitch: 0, fov: 62, smooth: null };
}

/** Swing the chase camera around the aircraft (from mouse drag), in radians. */
export function orbitBy(cam, dx, dy) {
  cam.orbitYaw += dx;
  cam.orbitPitch = clamp(cam.orbitPitch + dy, -0.6, 1.1);
}

export function zoomBy(cam, amount) {
  cam.distance = clamp(cam.distance * (1 + amount), 9, 45);
}

/** Point the camera for this frame; `held` is true while the pilot is dragging the view. */
export function updateCamera(cam, plane, dt, held = false) {
  const b = basis(plane.q);
  if (!held) {
    cam.orbitYaw *= Math.exp(-dt * 2.5);
    cam.orbitPitch *= Math.exp(-dt * 2.5);
  }
  if (cam.mode === 'cockpit') {
    cam.eye = add(add(plane.pos, scale(b.up, 0.62)), scale(b.fwd, -1.25));
    cam.look = add(cam.eye, b.fwd);
    cam.up = b.up;
    cam.fov = 70;
    cam.smooth = null;
    return;
  }
  // Chase: behind and a little above the flight path, ignoring roll so the horizon stays readable.
  const flat = normalize([b.fwd[0], b.fwd[1] * 0.55, b.fwd[2]]);
  const cy = Math.cos(cam.orbitYaw);
  const sy = Math.sin(cam.orbitYaw);
  const back = [-(flat[0] * cy - flat[2] * sy), -flat[1], -(flat[0] * sy + flat[2] * cy)];
  const lift = 0.22 + cam.orbitPitch;
  const offset = scale(normalize([back[0], back[1] + lift, back[2]]), cam.distance);
  const want = add(plane.pos, offset);
  cam.smooth = cam.smooth ? mix3(cam.smooth, want, 1 - Math.exp(-dt * 7)) : want;
  const floor = Math.max(groundHeight(cam.smooth[0], cam.smooth[2]), WORLD.sea) + 2;
  cam.eye = [cam.smooth[0], Math.max(cam.smooth[1], floor), cam.smooth[2]];
  cam.look = add(plane.pos, scale(b.fwd, 6));
  cam.up = [0, 1, 0];
  cam.fov = lerp(cam.fov, 60 + clamp(plane.speed - 40, 0, 40) * 0.25, 1 - Math.exp(-dt * 2));
}

/** A slow circle around a point, for the title screen and debrief. */
export function orbitCamera(cam, centre, t, radius = 70, height = 22) {
  cam.eye = [centre[0] + Math.cos(t) * radius, centre[1] + height, centre[2] + Math.sin(t) * radius];
  cam.look = centre;
  cam.up = [0, 1, 0];
  cam.fov = 55;
}

/** Debrief framing: a slow low circle that keeps the aircraft in the left third, clear of the score card. */
export function debriefCamera(cam, centre, t) {
  const a = t * 0.12 + 2.2;
  cam.eye = [centre[0] + Math.cos(a) * 24, centre[1] + 4.5, centre[2] + Math.sin(a) * 24];
  const dir = normalize([centre[0] - cam.eye[0], 0, centre[2] - cam.eye[2]]);
  const right = [-dir[2], 0, dir[0]];
  cam.look = add(centre, add(scale(right, 10), [0, 1.5, 0]));
  cam.up = [0, 1, 0];
  cam.fov = 48;
}

/** The matrices the renderer and HUD need for this frame. */
export function cameraMatrices(cam, aspect) {
  const proj = perspective(cam.fov * DEG, aspect, cam.mode === 'cockpit' ? 0.3 : 1.2, 30000);
  const view = lookAt(cam.eye, cam.look, cam.up);
  const vp = multiply(proj, view);
  return { vp, view, invVP: invert(vp), eye: cam.eye, fogDensity: WORLD.fogDensity };
}
