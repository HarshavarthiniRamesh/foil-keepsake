import { FoilRenderer, TEX_W, TEX_H } from './foil.js';
import { Impressions } from './impressions.js';
import { Crunch } from './crunch.js';
import { encodeKeepsake, decodeKeepsake } from './share.js';

const LOOKS = {
  gold: { albedo: [1.0, 0.64, 0.2], rough: 0.3, exposure: 1.05, depth: [3.6, 16, 85], flat: 0.36 },
  silver: { albedo: [0.84, 0.86, 0.88], rough: 0.28, exposure: 1.0, depth: [3.6, 16, 85], flat: 0.36 },
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const canvas = $('#foil');
let renderer;
try {
  renderer = new FoilRenderer(canvas);
} catch (err) {
  console.error(err);
  $('#unsupported').hidden = false;
  throw err;
}

const ink = new Impressions(TEX_W, TEX_H);
const crunch = new Crunch();

const state = {
  foil: 'gold',
  seed: newSeed(),
  tool: 'medium',
  strokes: [],
  mode: 'edit', // 'edit' | 'view'
};

function newSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

// ---------------------------------------------------------------- light ----
// The light is a lamp you place yourself: drag the little sun anywhere on or
// around the sheet. Its position is in sheet fractions (0..1 across, 0..1 down).
// The lamp can sit anywhere on the sheet or just past its edges.
const LAMP_RANGE = [-0.12, 1.12];

function clampLamp(x, y) {
  const lim = (v) => Math.min(Math.max(v, LAMP_RANGE[0]), LAMP_RANGE[1]);
  return [lim(x), lim(y)];
}

const light = { x: 0.18, y: 0.06, z: 0.9, tx: 0.18, ty: 0.06 };
const lamp = $('#lamp');
let lampDrag = null;

function placeLamp() {
  lamp.style.left = `${light.tx * 100}%`;
  lamp.style.top = `${light.ty * 100}%`;
}

function moveLamp(e) {
  const r = canvas.getBoundingClientRect();
  [light.tx, light.ty] = clampLamp((e.clientX - lampDrag.dx - r.left) / r.width, (e.clientY - lampDrag.dy - r.top) / r.height);
  placeLamp();
}

lamp.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  lamp.setPointerCapture(e.pointerId);
  const r = canvas.getBoundingClientRect();
  // keep the grab offset so the sun doesn't jump under the finger
  lampDrag = { dx: e.clientX - (r.left + light.tx * r.width), dy: e.clientY - (r.top + light.ty * r.height) };
  lamp.classList.add('dragging');
});
lamp.addEventListener('pointermove', (e) => { if (lampDrag) moveLamp(e); });
const dropLamp = () => { lampDrag = null; lamp.classList.remove('dragging'); };
lamp.addEventListener('pointerup', dropLamp);
lamp.addEventListener('pointercancel', dropLamp);
lamp.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 0.1 : 0.03;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!d) return;
  e.preventDefault();
  [light.tx, light.ty] = clampLamp(light.tx + d[0], light.ty + d[1]);
  placeLamp();
});
placeLamp();

// --------------------------------------------------------------- drawing ---
let current = null;
let lastMoveT = 0;
let speedSm = 0;

function toTex(e) {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * TEX_W;
  const y = ((e.clientY - r.top) / r.height) * TEX_H;
  return [
    Math.round(Math.min(Math.max(x, 0), TEX_W) * 2),
    Math.round(Math.min(Math.max(y, 0), TEX_H) * 2),
  ];
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'edit' || e.button > 0) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  crunch.unlock();
  current = { tool: state.tool, pts: [toTex(e)] };
  state.strokes.push(current);
  ink.segment(current, 0);
  lastMoveT = performance.now();
  speedSm = 0;
  crunch.tap(0.35);
  syncUI();
});

canvas.addEventListener('pointermove', (e) => {
  if (!current) return;
  const list = e.getCoalescedEvents?.();
  const events = list && list.length ? list : [e];
  let dist = 0;
  for (const ev of events) {
    const p = toTex(ev);
    const last = current.pts[current.pts.length - 1];
    const dx = p[0] - last[0], dy = p[1] - last[1];
    const d2 = dx * dx + dy * dy;
    if (d2 < 9) continue; // closer than 1.5 texels
    current.pts.push(p);
    ink.segment(current, current.pts.length - 1);
    dist += Math.sqrt(d2);
  }
  if (dist === 0) return;
  const now = performance.now();
  const dt = Math.max(now - lastMoveT, 4) / 1000;
  lastMoveT = now;
  const v = dist / 2 / TEX_W / dt; // sheet widths per second
  speedSm = speedSm * 0.5 + v * 0.5;
  crunch.setSpeed(speedSm);
});

function endStroke() {
  if (!current) return;
  ink.finish(current);
  current = null;
  crunch.setSpeed(0);
  crunch.tap(0.1);
}
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

function redrawAll() {
  ink.clear();
  for (const s of state.strokes) ink.drawStroke(s);
}

// ---------------------------------------------------------------- replay ---
let replay = null;

function startReplay() {
  ink.clear();
  let total = 0;
  for (const s of state.strokes) {
    for (let i = 1; i < s.pts.length; i++) {
      total += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]);
    }
  }
  const base = 0.75 * TEX_W * 2; // half-texels per second
  const now = performance.now();
  replay = { si: 0, pi: 0, rate: Math.max(base, total / 10), last: now, pauseUntil: now + 500 };
  setBusy(true);
}

function stepReplay(now) {
  const r = replay;
  const dt = Math.min((now - r.last) / 1000, 0.05);
  r.last = now;
  if (now < r.pauseUntil) { crunch.setSpeed(0); return; }

  let budget = r.rate * dt;
  let moved = 0;
  while (budget > 0 && r.si < state.strokes.length) {
    const s = state.strokes[r.si];
    if (r.pi === 0) {
      ink.segment(s, 0);
      r.pi = 1;
      crunch.tap(0.3);
    }
    if (r.pi >= s.pts.length) {
      ink.finish(s);
      r.si++;
      r.pi = 0;
      r.pauseUntil = now + 160 + Math.random() * 180;
      break;
    }
    const a = s.pts[r.pi - 1], b = s.pts[r.pi];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    budget -= d;
    moved += d;
    ink.segment(s, r.pi);
    r.pi++;
  }
  crunch.setSpeed(moved > 0 ? r.rate / (2 * TEX_W) : 0);

  if (r.si >= state.strokes.length) {
    replay = null;
    crunch.setSpeed(0);
    setBusy(false);
  }
}

// ------------------------------------------------------------------ loop ---
function frame(now) {
  const ease = lampDrag ? 0.35 : 0.15;
  light.x += (light.tx - light.x) * ease;
  light.y += (light.ty - light.y) * ease;

  if (current && now - lastMoveT > 60) {
    speedSm = 0;
    crunch.setSpeed(0);
  }
  if (replay) stepReplay(now);

  const dirty = ink.takeDirty();
  if (dirty) renderer.uploadStroke(ink.ctx, dirty);
  renderer.render({ light, look: LOOKS[state.foil] });
  requestAnimationFrame(frame);
}

// -------------------------------------------------------------------- UI ---
function syncUI() {
  for (const b of $$('[data-foil]')) b.setAttribute('aria-pressed', String(b.dataset.foil === state.foil));
  for (const b of $$('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool));
  $('#undo').disabled = state.strokes.length === 0 && cleared.length === 0;
  $('#clear').disabled = state.strokes.length === 0;
  $('#share').disabled = state.strokes.length === 0;
  $('#sound').setAttribute('aria-pressed', String(crunch.enabled));
  $('#sound').setAttribute('aria-label', crunch.enabled ? 'Mute sound' : 'Unmute sound');
  document.body.dataset.mode = state.mode;
}

function setBusy(on) {
  $('#replay').disabled = on;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

for (const b of $$('[data-foil]')) {
  b.addEventListener('click', () => { state.foil = b.dataset.foil; syncUI(); });
}
for (const b of $$('[data-tool]')) {
  b.addEventListener('click', () => { state.tool = b.dataset.tool; syncUI(); });
}

$('#undo').addEventListener('click', () => {
  if (state.strokes.length) state.strokes.pop();
  else if (cleared.length) state.strokes = cleared.pop();
  else return;
  redrawAll();
  syncUI();
});

// Clearing keeps the same wrapper (its crinkle) and can be undone.
const cleared = [];
$('#clear').addEventListener('click', () => {
  if (!state.strokes.length) return;
  cleared.push(state.strokes);
  state.strokes = [];
  ink.clear();
  crunch.unlock().then(() => crunch.tap(0.5));
  toast('Smoothed out. Undo brings it back.');
  syncUI();
});

$('#sound').addEventListener('click', () => {
  crunch.setEnabled(!crunch.enabled);
  syncUI();
});

for (const id of ['#save', '#save-view']) {
  $(id).addEventListener('click', () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'foil-keepsake.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  });
}

$('#share').addEventListener('click', async () => {
  if (!state.strokes.length) return;
  const data = await encodeKeepsake(state);
  const url = `${location.origin}${location.pathname}#k=${data}`;
  const text = 'I pressed something into a chocolate wrapper for you.';
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: 'Foil Keepsake', text, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied. Send it to someone.');
  } catch {
    window.prompt('Copy this link:', url);
  }
});

$('#replay').addEventListener('click', () => {
  crunch.unlock();
  startReplay();
});

$('#own').addEventListener('click', () => {
  history.replaceState(null, '', location.pathname);
  state.mode = 'edit';
  state.seed = newSeed();
  state.strokes = [];
  cleared.length = 0;
  renderer.bake(state.seed);
  ink.clear();
  syncUI();
});

$('#reveal').addEventListener('click', () => {
  $('#reveal').hidden = true;
  crunch.unlock();
  startReplay();
});

// ------------------------------------------------------------------ boot ---
async function boot() {
  const match = location.hash.match(/[#&]k=([\w-]+)/);
  if (match) {
    try {
      const k = await decodeKeepsake(match[1], { w: TEX_W * 2, h: TEX_H * 2 });
      Object.assign(state, k, { mode: 'view' });
      $('#reveal').hidden = false;
    } catch (err) {
      console.warn('Could not read keepsake from link:', err);
      toast('That link looks crumpled beyond repair. Here is a fresh wrapper.');
    }
  }
  renderer.bake(state.seed);
  syncUI();
  requestAnimationFrame(frame);
}

boot();
