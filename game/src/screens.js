// The menus over the 3D view: mission select, the briefing with the controls tutorial, pause, and the
// debrief with score breakdown and stars. Plain HTML so text stays crisp and keyboard-reachable.

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CONTROLS = [
  ['W / S  or  ↑ / ↓', 'Pitch: nose down / nose up'],
  ['A / D  or  ← / →', 'Roll left / right (bank to turn)'],
  ['Q / E', 'Rudder: yaw left / right, steer on the ground'],
  ['R / F', 'Throttle up / down · 1–9 set 10–90 %, 0 full'],
  ['Space', 'Wheel brakes'],
  ['C', 'Chase / cockpit view'],
  ['Drag mouse · wheel', 'Look around the aircraft · zoom the chase view'],
  ['M', 'Mouse yoke: fly with the mouse'],
  ['Esc or P', 'Pause'],
];

const TIPS = [
  'Lift-off comes at about 60 knots: open the throttle, keep the nose straight, then ease back.',
  'A banked wing turns the aircraft but also sinks it — pull back gently through every turn.',
  'Below 52 knots the wing stalls: the horn sounds and the nose drops. Lower it, add power.',
  'Full throttle burns fuel four times faster than a cruise setting of 50–60 %.',
  'For a soft landing cross the threshold near 60 knots, under 500 ft/min, and level off just before the wheels touch.',
];

export function setScreen(name) {
  document.body.dataset.screen = name;
  for (const el of document.querySelectorAll('[data-panel]')) el.hidden = el.dataset.panel !== name;
}

export const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

export function bestOf(id) {
  try { return JSON.parse(localStorage.getItem('kestrel.best') || '{}')[id] || null; } catch { return null; }
}

export function saveBest(id, score, starCount) {
  try {
    const all = JSON.parse(localStorage.getItem('kestrel.best') || '{}');
    if (!all[id] || score > all[id].score) all[id] = { score, stars: starCount };
    localStorage.setItem('kestrel.best', JSON.stringify(all));
  } catch { /* scores just are not kept */ }
}

/** Mission select. onPick(def) is called with the chosen mission. */
export function showTitle(missions, free, onPick) {
  const card = (m, i) => {
    const best = bestOf(m.id);
    return `<button class="mission" data-id="${m.id}">
      <span class="m-num">${m.free ? '∞' : String(i + 1).padStart(2, '0')}</span>
      <span class="m-body"><b>${esc(m.name)}</b><small>${esc(m.tag)}</small></span>
      <span class="m-best">${m.free ? 'explore' : best ? `${stars(best.stars)}<em>${best.score}</em>` : 'new'}</span></button>`;
  };
  $('#missions').innerHTML = missions.map(card).join('') + card(free, 0);
  $('#tips').textContent = TIPS[Math.floor(Date.now() / 60000) % TIPS.length];
  for (const b of document.querySelectorAll('.mission')) {
    b.onclick = () => onPick([...missions, free].find((m) => m.id === b.dataset.id));
  }
  setScreen('title');
  document.querySelector('.mission')?.focus({ preventScroll: true });
}

/** Briefing: the mission's goal and the controls, with a start button. */
export function showBrief(def, onStart, onBack) {
  $('#brief-name').textContent = def.name;
  $('#brief-tag').textContent = def.tag;
  $('#brief-text').textContent = def.brief;
  $('#brief-goals').innerHTML = def.free ? '<li>Refuel by stopping on a runway</li><li>Land at both fields</li>'
    : `<li>Par time ${Math.floor(def.par / 60)}:${String(def.par % 60).padStart(2, '0')}</li><li>${stars(2)} at ${def.stars[0]} points</li><li>${stars(3)} at ${def.stars[1]} points</li>`;
  $('#controls').innerHTML = CONTROLS.map(([k, v]) => `<tr><th scope="row"><kbd>${esc(k)}</kbd></th><td>${esc(v)}</td></tr>`).join('');
  $('#start').onclick = onStart;
  $('#back').onclick = onBack;
  setScreen('brief');
  $('#start').focus({ preventScroll: true });
}

export function showPause(onResume, onRestart, onMenu) {
  $('#resume').onclick = onResume;
  $('#restart').onclick = onRestart;
  $('#to-menu').onclick = onMenu;
  setScreen('pause');
  $('#resume').focus({ preventScroll: true });
}

/** Debrief after a sortie ends. result: {title, reason, total, lines, stars, best}. */
export function showDebrief(def, result, onRetry, onNext, onMenu) {
  $('#debrief-title').textContent = result.title;
  $('#debrief-reason').textContent = result.reason;
  $('#debrief-stars').textContent = stars(result.stars);
  $('#debrief-lines').innerHTML = result.lines.map((l) => `<tr><th scope="row">${esc(l.label)}</th><td class="${l.value < 0 ? 'neg' : ''}">${l.value > 0 ? '+' : ''}${l.value}</td></tr>`).join('')
    + `<tr class="total"><th scope="row">Score</th><td>${result.total}</td></tr>`;
  $('#debrief-best').textContent = result.best ? `Best: ${result.best.score}` : '';
  document.body.dataset.result = result.failed ? 'failed' : 'done';
  $('#retry').onclick = onRetry;
  $('#next').onclick = onNext;
  $('#next').hidden = !onNext;
  $('#debrief-menu').onclick = onMenu;
  setScreen('debrief');
  (onNext ? $('#next') : $('#retry')).focus({ preventScroll: true });
}
