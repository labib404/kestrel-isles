// The head-up display and instrument panel, drawn on a 2D canvas over the 3D view: speed and altitude
// tapes, a heading strip, a pitch ladder, the objective marker, fuel / throttle / damage, a minimap, and
// in the cockpit view a lit panel of six round gauges.

import { AIRFIELDS, WORLD } from './config.js';
import { DEG, clamp, project } from './math.js';
import { groundHeight } from './terrain.js';

// Storm-dusk HUD: electric cyan symbology, ember for targets, rose for danger, on deep-indigo glass.
const GREEN = '#7ff6ff';
const AMBER = '#ff9a5c';
const RED = '#ff5a7a';
const INK = 'rgba(12, 10, 30, 0.58)';

/** Thin streaks rushing past the screen edges at high speed. */
function speedLines(g, W, H, speed, time) {
  const k = clamp((speed - 50) / 30, 0, 1);
  if (!k) return;
  g.strokeStyle = `rgba(200, 240, 255, ${0.22 * k})`;
  g.lineWidth = 1.2;
  for (let i = 0; i < 26; i++) {
    const a = i * 2.39996;
    const phase = (time * (1.6 + (i % 5) * 0.3) + i * 0.137) % 1;
    const r0 = 0.42 + phase * 0.5;
    const len = 0.05 + 0.08 * k;
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.hypot(W, H) / 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * R * r0, cy + Math.sin(a) * R * r0);
    g.lineTo(cx + Math.cos(a) * R * (r0 + len), cy + Math.sin(a) * R * (r0 + len));
    g.stroke();
  }
}

let minimap = null;
const MAP_PX = 180;

/** Paint the islands once into a small offscreen canvas for the minimap. */
function buildMinimap() {
  const c = document.createElement('canvas');
  c.width = MAP_PX;
  c.height = MAP_PX;
  const g = c.getContext('2d');
  const img = g.createImageData(MAP_PX, MAP_PX);
  for (let y = 0; y < MAP_PX; y++) {
    for (let x = 0; x < MAP_PX; x++) {
      const h = groundHeight((x / MAP_PX - 0.5) * WORLD.size, (y / MAP_PX - 0.5) * WORLD.size);
      const k = (y * MAP_PX + x) * 4;
      const rgb = h < 0 ? [24, 74, 92] : h < 6 ? [214, 198, 150] : h > 700 ? [235, 238, 240] : h > 420 ? [140, 130, 112] : [86 - h * 0.05, 140 - h * 0.08, 70];
      img.data.set([...rgb, 235], k);
    }
  }
  g.putImageData(img, 0, 0);
  for (const f of AIRFIELDS) {
    const px = ((f.x / WORLD.size) + 0.5) * MAP_PX;
    const pz = ((f.z / WORLD.size) + 0.5) * MAP_PX;
    g.save();
    g.translate(px, pz);
    g.rotate(f.heading * DEG);
    g.fillStyle = '#1b1d20';
    g.fillRect(-2, -f.length / WORLD.size * MAP_PX / 2, 4, f.length / WORLD.size * MAP_PX);
    g.restore();
  }
  return c;
}

function tape(g, x, y, h, value, step, label, unit, right) {
  const w = 74;
  g.save();
  g.fillStyle = INK;
  g.fillRect(x, y - h / 2, w, h);
  g.beginPath();
  g.rect(x, y - h / 2, w, h);
  g.clip();
  g.strokeStyle = GREEN;
  g.fillStyle = GREEN;
  g.font = '600 13px ui-monospace, Consolas, monospace';
  g.textAlign = right ? 'left' : 'right';
  const pxPer = h / (step * 8);
  const first = Math.floor((value - step * 5) / step) * step;
  for (let v = first; v <= value + step * 5; v += step) {
    const ty = y - (v - value) * pxPer;
    const major = Math.round(v / step) % 2 === 0;
    g.beginPath();
    g.moveTo(right ? x : x + w, ty);
    g.lineTo(right ? x + (major ? 14 : 8) : x + w - (major ? 14 : 8), ty);
    g.lineWidth = 1.5;
    g.stroke();
    if (major && v >= 0) g.fillText(String(v), right ? x + 18 : x + w - 18, ty + 4);
  }
  g.restore();
  g.fillStyle = '#08130d';
  g.strokeStyle = GREEN;
  g.lineWidth = 2;
  g.fillRect(x - 2, y - 15, w + 4, 30);
  g.strokeRect(x - 2, y - 15, w + 4, 30);
  g.fillStyle = GREEN;
  g.font = '700 18px ui-monospace, Consolas, monospace';
  g.textAlign = 'center';
  g.fillText(String(Math.round(value)), x + w / 2, y + 6);
  g.font = '600 11px system-ui, sans-serif';
  g.fillText(`${label} ${unit}`, x + w / 2, y - h / 2 - 8);
}

function headingStrip(g, cx, y, heading) {
  const w = 360;
  g.save();
  g.fillStyle = INK;
  g.fillRect(cx - w / 2, y, w, 30);
  g.beginPath();
  g.rect(cx - w / 2, y, w, 30);
  g.clip();
  g.strokeStyle = GREEN;
  g.fillStyle = GREEN;
  g.font = '600 12px ui-monospace, Consolas, monospace';
  g.textAlign = 'center';
  const px = 4;
  for (let d = Math.floor(heading / 5) * 5 - 50; d <= heading + 50; d += 5) {
    const x = cx + (d - heading) * px;
    const n = ((d % 360) + 360) % 360;
    g.beginPath();
    g.moveTo(x, y + 30);
    g.lineTo(x, y + (n % 10 === 0 ? 20 : 25));
    g.stroke();
    if (n % 30 === 0) g.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[n] ?? String(n / 10).padStart(2, '0'), x, y + 14);
  }
  g.restore();
  g.fillStyle = GREEN;
  g.beginPath();
  g.moveTo(cx, y + 30);
  g.lineTo(cx - 7, y + 40);
  g.lineTo(cx + 7, y + 40);
  g.fill();
  g.font = '700 14px ui-monospace, Consolas, monospace';
  g.textAlign = 'center';
  g.fillText(`HDG ${String(Math.round(heading) % 360).padStart(3, '0')}°`, cx, y + 56);
}

function pitchLadder(g, cx, cy, pitch, bank, scalePx) {
  g.save();
  g.translate(cx, cy);
  g.rotate(-bank * DEG);
  g.strokeStyle = 'rgba(159, 240, 180, 0.75)';
  g.fillStyle = 'rgba(159, 240, 180, 0.85)';
  g.lineWidth = 1.6;
  g.font = '600 11px ui-monospace, Consolas, monospace';
  for (let p = -30; p <= 30; p += 10) {
    const y = (pitch - p) * scalePx;
    if (Math.abs(y) > 170) continue;
    const w = p === 0 ? 150 : 60;
    g.setLineDash(p < 0 ? [6, 5] : []);
    g.beginPath();
    g.moveTo(-w, y);
    g.lineTo(-24, y);
    g.moveTo(24, y);
    g.lineTo(w, y);
    g.stroke();
    if (p) {
      g.textAlign = 'right';
      g.fillText(String(p), -w - 6, y + 4);
    }
  }
  g.restore();
  g.setLineDash([]);
  g.strokeStyle = AMBER;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cx - 40, cy);
  g.lineTo(cx - 14, cy);
  g.lineTo(cx - 7, cy + 8);
  g.moveTo(cx + 40, cy);
  g.lineTo(cx + 14, cy);
  g.lineTo(cx + 7, cy + 8);
  g.stroke();
}

function bar(g, x, y, w, label, frac, colour, text) {
  g.fillStyle = INK;
  g.fillRect(x, y, w, 26);
  g.fillStyle = colour;
  g.fillRect(x + 64, y + 8, (w - 112) * clamp(frac, 0, 1), 10);
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.strokeRect(x + 64, y + 8, w - 112, 10);
  g.fillStyle = '#e8f3ec';
  g.font = '600 12px system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillText(label, x + 10, y + 17);
  g.textAlign = 'right';
  g.fillText(text, x + w - 8, y + 17);
}

/** Marker over the current objective, or an arrow at the screen edge pointing to it. */
function objectiveMarker(g, vp, target, plane, W, H, label) {
  if (!target) return;
  const p = project(vp, target);
  const dist = Math.hypot(target[0] - plane.pos[0], target[1] - plane.pos[1], target[2] - plane.pos[2]);
  const km = dist > 950 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
  g.font = '700 13px system-ui, sans-serif';
  g.textAlign = 'center';
  if (p && p[0] > 0.04 && p[0] < 0.96 && p[1] > 0.08 && p[1] < 0.92) {
    const x = p[0] * W;
    const y = p[1] * H;
    g.strokeStyle = AMBER;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(x, y - 16);
    g.lineTo(x + 16, y);
    g.lineTo(x, y + 16);
    g.lineTo(x - 16, y);
    g.closePath();
    g.stroke();
    g.fillStyle = AMBER;
    g.fillText(`${label} · ${km}`, x, y + 34);
    return;
  }
  let dx = p ? p[0] - 0.5 : 0;
  let dy = p ? p[1] - 0.5 : 0.5;
  if (!p) {
    const fwd = [vp[2], vp[6], vp[10]];
    dx = (target[0] - plane.pos[0]) * fwd[2] - (target[2] - plane.pos[2]) * fwd[0] > 0 ? -0.5 : 0.5;
  }
  const a = Math.atan2(dy, dx);
  const x = W / 2 + Math.cos(a) * Math.min(W, H) * 0.36;
  const y = H / 2 + Math.sin(a) * Math.min(W, H) * 0.36;
  g.save();
  g.translate(x, y);
  g.rotate(a);
  g.fillStyle = AMBER;
  g.beginPath();
  g.moveTo(18, 0);
  g.lineTo(-8, -11);
  g.lineTo(-8, 11);
  g.fill();
  g.restore();
  g.fillStyle = AMBER;
  g.fillText(km, x, y + 28);
}

function drawMinimap(g, x, y, plane, target, rings) {
  if (!minimap) minimap = buildMinimap();
  const s = MAP_PX;
  g.save();
  g.beginPath();
  g.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
  g.clip();
  g.drawImage(minimap, x, y, s, s);
  const toMap = (wx, wz) => [x + (wx / WORLD.size + 0.5) * s, y + (wz / WORLD.size + 0.5) * s];
  for (const r of rings) {
    const [mx, my] = toMap(r.pos[0], r.pos[2]);
    g.fillStyle = r.current ? AMBER : 'rgba(255, 200, 97, 0.45)';
    g.beginPath();
    g.arc(mx, my, r.current ? 4 : 2.5, 0, Math.PI * 2);
    g.fill();
  }
  if (target) {
    const [tx, ty] = toMap(target[0], target[2]);
    g.strokeStyle = AMBER;
    g.lineWidth = 2;
    g.strokeRect(tx - 5, ty - 5, 10, 10);
  }
  const [px, py] = toMap(plane.pos[0], plane.pos[2]);
  g.translate(px, py);
  g.rotate(plane.headingRad);
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(0, -8);
  g.lineTo(6, 6);
  g.lineTo(0, 3);
  g.lineTo(-6, 6);
  g.fill();
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
  g.stroke();
}

// ---- cockpit panel: round gauges with a warm backlight ----

/** Brushed-metal bezel, a dark face with a faint backlight, and a curved glass highlight over it. */
function bezel(g, x, y, r) {
  const metal = g.createLinearGradient(x - r, y - r, x + r, y + r);
  metal.addColorStop(0, '#8d8a93');
  metal.addColorStop(0.45, '#3a3840');
  metal.addColorStop(0.55, '#5c5963');
  metal.addColorStop(1, '#1d1c22');
  g.fillStyle = metal;
  g.beginPath();
  g.arc(x, y, r + 5, 0, Math.PI * 2);
  g.fill();
  const face = g.createRadialGradient(x, y + r * 0.2, r * 0.1, x, y, r);
  face.addColorStop(0, '#1b1a2a');
  face.addColorStop(1, '#07070d');
  g.fillStyle = face;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function glass(g, x, y, r) {
  const shine = g.createLinearGradient(x, y - r, x, y + r * 0.2);
  shine.addColorStop(0, 'rgba(255,255,255,0.22)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = shine;
  g.beginPath();
  g.ellipse(x - r * 0.12, y - r * 0.38, r * 0.72, r * 0.42, -0.35, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(127, 246, 255, 0.18)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(x, y, r - 1, 0, Math.PI * 2);
  g.stroke();
}

function dial(g, x, y, r, label, value, min, max, unit, opts = {}) {
  bezel(g, x, y, r);
  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  if (opts.arcs) {
    for (const [lo, hi, col] of opts.arcs) {
      g.strokeStyle = col;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(x, y, r - 8, a0 + ((lo - min) / (max - min)) * (a1 - a0), a0 + ((hi - min) / (max - min)) * (a1 - a0));
      g.stroke();
    }
  }
  g.strokeStyle = '#f4e6c8';
  g.fillStyle = '#f4e6c8';
  g.font = `600 ${Math.round(r * 0.2)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  const ticks = opts.ticks ?? 8;
  for (let i = 0; i <= ticks; i++) {
    const a = a0 + (i / ticks) * (a1 - a0);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * (r - 4), y + Math.sin(a) * (r - 4));
    g.lineTo(x + Math.cos(a) * (r - 13), y + Math.sin(a) * (r - 13));
    g.stroke();
    if (opts.numbers) g.fillText(String(Math.round(min + (i / ticks) * (max - min))), x + Math.cos(a) * (r - 24), y + Math.sin(a) * (r - 24) + 4);
  }
  const a = a0 + clamp((value - min) / (max - min), 0, 1) * (a1 - a0);
  g.strokeStyle = '#ffb347';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + Math.cos(a) * (r - 10), y + Math.sin(a) * (r - 10));
  g.stroke();
  g.fillStyle = '#ffb347';
  g.beginPath();
  g.arc(x, y, 4, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#9fa3c4';
  g.font = `600 ${Math.round(r * 0.17)}px system-ui, sans-serif`;
  g.fillText(label, x, y + r * 0.42);
  g.fillStyle = '#ffe2bf';
  g.font = `700 ${Math.round(r * 0.22)}px ui-monospace, Consolas, monospace`;
  g.fillText(unit, x, y + r * 0.68);
  glass(g, x, y, r);
}

function attitudeDial(g, x, y, r, pitch, bank) {
  bezel(g, x, y, r);
  g.save();
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.clip();
  g.translate(x, y);
  g.rotate(-bank * DEG);
  const off = pitch * r * 0.035;
  g.fillStyle = '#2b5f9a';
  g.fillRect(-r * 2, -r * 2 + off, r * 4, r * 2);
  g.fillStyle = '#6b4424';
  g.fillRect(-r * 2, off, r * 4, r * 2);
  g.strokeStyle = '#fff';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-r, off);
  g.lineTo(r, off);
  for (const p of [-20, -10, 10, 20]) {
    g.moveTo(-r * 0.25, off - p * r * 0.035);
    g.lineTo(r * 0.25, off - p * r * 0.035);
  }
  g.stroke();
  g.restore();
  g.strokeStyle = '#ffb347';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x - r * 0.55, y);
  g.lineTo(x - r * 0.18, y);
  g.lineTo(x, y + r * 0.12);
  g.lineTo(x + r * 0.18, y);
  g.lineTo(x + r * 0.55, y);
  g.stroke();
  glass(g, x, y, r);
}

/** The cockpit: thin windscreen posts and a slim glare-shielded panel of six backlit gauges. */
function cockpitPanel(g, W, H, ins) {
  const ph = Math.min(170, H * 0.19);
  const top = H - ph;
  // glare shield: a dark curved coaming with a faint cyan instrument glow under its lip
  const shield = g.createLinearGradient(0, top - 46, 0, top + 10);
  shield.addColorStop(0, '#16141f');
  shield.addColorStop(1, '#0b0a12');
  g.fillStyle = shield;
  g.beginPath();
  g.moveTo(0, top - 18);
  g.quadraticCurveTo(W / 2, top - 52, W, top - 18);
  g.lineTo(W, H);
  g.lineTo(0, H);
  g.fill();
  const panel = g.createLinearGradient(0, top, 0, H);
  panel.addColorStop(0, '#24222c');
  panel.addColorStop(1, '#101017');
  g.fillStyle = panel;
  g.fillRect(0, top, W, ph);
  const glow = g.createLinearGradient(0, top, 0, top + 24);
  glow.addColorStop(0, 'rgba(127, 246, 255, 0.16)');
  glow.addColorStop(1, 'rgba(127, 246, 255, 0)');
  g.fillStyle = glow;
  g.fillRect(0, top, W, 24);
  // windscreen posts
  g.fillStyle = '#121019';
  g.beginPath();
  g.moveTo(W * 0.06, 0); g.lineTo(W * 0.075, 0); g.lineTo(W * 0.11, top - 30); g.lineTo(W * 0.09, top - 28); g.fill();
  g.beginPath();
  g.moveTo(W * 0.94, 0); g.lineTo(W * 0.925, 0); g.lineTo(W * 0.89, top - 30); g.lineTo(W * 0.91, top - 28); g.fill();
  const r = Math.min(ph * 0.4, W / 17);
  const y = top + ph * 0.52;
  const xs = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((k) => W / 2 + k * r * 2.5);
  dial(g, xs[0], y, r, 'AIRSPEED', ins.knots, 0, 180, `${Math.round(ins.knots)} kt`, { numbers: true, ticks: 6, arcs: [[50, 120, '#3fa65b'], [120, 160, '#e1b333'], [160, 180, '#d44']] });
  attitudeDial(g, xs[1], y, r, ins.pitch, ins.bank);
  dial(g, xs[2], y, r, 'ALTITUDE', ins.feet % 1000, 0, 1000, `${Math.round(ins.feet)} ft`, { ticks: 10 });
  dial(g, xs[3], y, r, 'HEADING', ins.heading, 0, 360, `${String(Math.round(ins.heading) % 360).padStart(3, '0')}°`, { ticks: 12 });
  dial(g, xs[4], y, r, 'VERT SPEED', clamp(ins.vsi, -2000, 2000), -2000, 2000, `${Math.round(ins.vsi / 10) * 10}`, { ticks: 8, arcs: [[-2000, -500, '#d44']] });
  dial(g, xs[5], y, r, 'FUEL', ins.fuel * 100, 0, 100, `${Math.round(ins.fuel * 100)} %`, { ticks: 4, arcs: [[0, 15, '#d44']] });
  g.fillStyle = ins.stall ? RED : '#2a1f2c';
  g.fillRect(W / 2 - 36, top - 30, 72, 16);
  g.fillStyle = ins.stall ? '#fff' : '#6d5866';
  g.font = '700 11px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('STALL', W / 2, top - 18);
}

/**
 * Draw the HUD for one frame. state: {plane, ins, vp, mode, objective, target, rings, hint, time, score,
 * message, yoke, warnings}.
 */
export function drawHud(canvas, s) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const { ins } = s;
  const cockpit = s.mode === 'cockpit';
  if (!cockpit) speedLines(g, W, H, s.plane.speed, s.clock);

  objectiveMarker(g, s.vp, s.target, s.plane, W, H, s.targetLabel);
  if (cockpit) {
    cockpitPanel(g, W, H, ins);
  } else {
    pitchLadder(g, W / 2, H * 0.46, ins.pitch, ins.bank, 5);
    tape(g, W / 2 - 300, H * 0.46, 260, ins.knots, 10, 'SPD', 'kt', false);
    tape(g, W / 2 + 226, H * 0.46, 260, ins.feet, 100, 'ALT', 'ft', true);
    g.fillStyle = GREEN;
    g.font = '600 12px ui-monospace, Consolas, monospace';
    g.textAlign = 'left';
    g.fillText(`VS ${ins.vsi >= 0 ? '+' : ''}${Math.round(ins.vsi / 10) * 10} fpm`, W / 2 + 226, H * 0.46 + 150);
    g.fillText(`AGL ${Math.max(0, Math.round(ins.agl))} ft`, W / 2 + 226, H * 0.46 + 166);
  }
  headingStrip(g, W / 2, 14, ins.heading);

  // status bars, bottom-left
  const bx = cockpit ? W - 276 : 16;
  const by = cockpit ? 70 : H - 112;
  bar(g, bx, by, 260, 'THROTTLE', ins.throttle, GREEN, `${Math.round(ins.throttle * 100)} %`);
  bar(g, bx, by + 30, 260, 'FUEL', ins.fuel, ins.fuel < 0.15 ? RED : AMBER, `${(ins.fuel * 120).toFixed(0)} L`);
  bar(g, bx, by + 60, 260, 'DAMAGE', ins.damage / 100, RED, `${Math.round(ins.damage)} %`);

  // mission panel, top-left
  g.fillStyle = INK;
  g.fillRect(16, 14, 300, s.hint ? 132 : 76);
  g.fillStyle = AMBER;
  g.font = '700 11px system-ui, sans-serif';
  g.textAlign = 'left';
  g.fillText(s.missionName.toUpperCase(), 28, 33);
  g.fillStyle = '#fff';
  g.font = '700 17px system-ui, sans-serif';
  g.fillText(s.objective, 28, 56);
  g.fillStyle = '#cfe3d6';
  g.font = '600 12px ui-monospace, Consolas, monospace';
  g.fillText(`TIME ${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}   SCORE ${s.score}`, 28, 77);
  if (s.hint) {
    g.fillStyle = '#e8f3ec';
    g.font = '13px system-ui, sans-serif';
    wrap(g, s.hint, 28, 98, 276, 16);
  }

  if (!cockpit) drawMinimap(g, W - MAP_PX - 18, H - MAP_PX - 18, { pos: s.plane.pos, headingRad: ins.heading * DEG }, s.target, s.rings);

  // warnings and messages, centre
  g.textAlign = 'center';
  if (ins.stall) flash(g, W / 2, H * 0.24, 'STALL — lower the nose, add power', RED);
  else if (s.warning) flash(g, W / 2, H * 0.24, s.warning, AMBER);
  if (s.message) {
    g.font = '800 28px system-ui, sans-serif';
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillText(s.message, W / 2 + 2, H * 0.32 + 2);
    g.fillStyle = '#fff';
    g.fillText(s.message, W / 2, H * 0.32);
  }
  g.font = '600 12px system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.textAlign = 'right';
  g.fillText(`${s.yoke ? 'Mouse yoke ON (M)' : 'Keys W A S D · R/F throttle'} · C camera · Space brakes · Esc pause`, W - 18, cockpit ? H - (Math.min(170, H * 0.19)) - 40 : H - MAP_PX - 30);
}

function flash(g, x, y, text, colour) {
  g.font = '800 18px system-ui, sans-serif';
  const w = g.measureText(text).width + 30;
  g.fillStyle = colour;
  g.fillRect(x - w / 2, y - 22, w, 32);
  g.fillStyle = '#111';
  g.fillText(text, x, y);
}

function wrap(g, text, x, y, width, lh) {
  let line = '';
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word;
    if (g.measureText(t).width > width) {
      g.fillText(line, x, y);
      y += lh;
      line = word;
    } else line = t;
  }
  if (line) g.fillText(line, x, y);
}
