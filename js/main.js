import { FoilRenderer, TEX_W, TEX_H } from './foil.js';
import { Impressions } from './impressions.js';
import { Crunch } from './crunch.js';
import { encodeKeepsake, decodeKeepsake } from './share.js';
import { STAMP_IDS, STAMPS, stampIcon } from './stamps.js';

const STAMP_SIZE = Math.round(TEX_W * 0.26); // texels across

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

// ----------------------------------------------------------------- tilt ----
// The light stays put; you tilt the foil to catch it, like holding a real
// wrapper. With a mouse the sheet tips toward wherever you hover (and lies flat
// while you press into it). On phones, tilting the phone does the same.
const light = { x: 0.3, y: -0.05, z: 0.9 };
const sheet = $('.sheet');
const TILT_MAX = 3.5 * (Math.PI / 180); // radians, how far the sheet visibly tips
const TILT_SHADE = 2.8; // the reflections swing a little more than the sheet
const PERSPECTIVE = 1100; // px
const tilt = { x: 0, y: 0, tx: 0, ty: 0 }; // x: rotateX, y: rotateY (CSS sense)
let hovering = false;
let deviceTilt = null;

window.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const r = sheet.getBoundingClientRect();
  const u = ((e.clientX - r.left) / r.width) * 2 - 1;
  const v = ((e.clientY - r.top) / r.height) * 2 - 1;
  hovering = Math.abs(u) <= 1.15 && Math.abs(v) <= 1.15;
  const c = (k) => Math.max(-1, Math.min(1, k));
  // the spot under the cursor dips away, like pressing a fingertip there
  tilt.ty = hovering ? c(u) * TILT_MAX : 0;
  tilt.tx = hovering ? -c(v) * TILT_MAX : 0;
});
document.documentElement.addEventListener('mouseleave', () => { hovering = false; tilt.tx = tilt.ty = 0; });

let tiltRequested = false;
function requestTilt() {
  if (tiltRequested || !matchMedia('(hover: none)').matches) return;
  tiltRequested = true;
  let rest = null;
  // Work from which way is up in the phone's own frame, not the raw angles:
  // those flip about wildly when the phone is held upright (gimbal lock),
  // which threw the light off. Tilt is measured from however it's being
  // held, and that rest pose slowly follows the hand.
  const up = (e) => {
    const k = Math.PI / 180, b = e.beta * k, g = e.gamma * k;
    return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
  };
  const listen = () => window.addEventListener('deviceorientation', (e) => {
    if (e.beta == null || e.gamma == null) return;
    const u = up(e);
    if (!rest) rest = u.slice();
    for (let i = 0; i < 3; i++) rest[i] += (u[i] - rest[i]) * 0.004;
    const m = Math.hypot(...rest);
    for (let i = 0; i < 3; i++) rest[i] /= m;
    // rotation from the rest pose to now, about the phone's own x and y axes
    const cx = rest[1] * u[2] - rest[2] * u[1];
    const cy = rest[2] * u[0] - rest[0] * u[2];
    const lim = 25 * (Math.PI / 180);
    const clamp = (v) => Math.max(-lim, Math.min(lim, Math.asin(Math.max(-1, Math.min(1, v)))));
    deviceTilt = { x: clamp(cx), y: clamp(-cy) };
  });
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    DOE.requestPermission().then((s) => s === 'granted' && listen()).catch(() => {});
  } else if (DOE) {
    listen();
  }
}

// Map a screen point onto the tilted sheet: cast a ray from the eye through
// the point and intersect it with the sheet's plane, then undo the rotation.
function rotate(a, b, [x, y, z]) {
  // CSS rotateX(a) rotateY(b) applied to a point
  const x1 = x * Math.cos(b) + z * Math.sin(b);
  const z1 = -x * Math.sin(b) + z * Math.cos(b);
  return [x1, y * Math.cos(a) - z1 * Math.sin(a), y * Math.sin(a) + z1 * Math.cos(a)];
}
function unrotate(a, b, [x, y, z]) {
  const y1 = y * Math.cos(a) + z * Math.sin(a);
  const z1 = -y * Math.sin(a) + z * Math.cos(a);
  return [x * Math.cos(b) - z1 * Math.sin(b), y1, x * Math.sin(b) + z1 * Math.cos(b)];
}
function toSheet(e) {
  const r = sheet.getBoundingClientRect();
  const X = e.clientX - (r.left + r.width / 2), Y = e.clientY - (r.top + r.height / 2);
  const n = rotate(tilt.x, tilt.y, [0, 0, 1]);
  const p = PERSPECTIVE;
  const t = -(n[2] * p) / (n[0] * X + n[1] * Y - n[2] * p);
  const q = unrotate(tilt.x, tilt.y, [t * X, t * Y, p - t * p]);
  return [q[0] / r.width + 0.5, q[1] / r.height + 0.5];
}

function updateTilt() {
  // flat while pressing, while it replays, and while still folded up
  const flat = current || replay || !revealed;
  const tx = flat ? 0 : tilt.tx, ty = flat ? 0 : tilt.ty;
  const ease = flat ? 0.25 : 0.1;
  tilt.x += (tx - tilt.x) * ease;
  tilt.y += (ty - tilt.y) * ease;
  if (Math.abs(tilt.x) < 1e-4 && Math.abs(tilt.y) < 1e-4 && !tx && !ty) {
    tilt.x = tilt.y = 0;
    canvas.style.transform = '';
  } else {
    canvas.style.transform = `perspective(${PERSPECTIVE}px) rotateX(${tilt.x}rad) rotateY(${tilt.y}rad)`;
  }
  const d = deviceTilt || { x: 0, y: 0 };
  return { x: tilt.x * TILT_SHADE + d.x, y: tilt.y * TILT_SHADE + d.y };
}

// --------------------------------------------------------------- drawing ---
let current = null;
let lastMoveT = 0;
let speedSm = 0;

function toTex(e) {
  const [u, v] = toSheet(e);
  const x = u * TEX_W;
  const y = v * TEX_H;
  return [
    Math.round(Math.min(Math.max(x, 0), TEX_W) * 2),
    Math.round(Math.min(Math.max(y, 0), TEX_H) * 2),
  ];
}

const isStamp = (tool) => tool.startsWith('stamp:');

// a stamp lands with a firm press: a thump and a short crunch
function stampSound() {
  crunch.tap(1);
  crunch.setSpeed(1.6);
  setTimeout(() => crunch.tap(0.6), 45);
  setTimeout(() => crunch.setSpeed(0), 130);
}

function placeStamp(e) {
  const [x, y] = toTex(e);
  const item = { stamp: state.tool.slice(6), x, y, s: STAMP_SIZE };
  state.strokes.push(item);
  ink.stamp(item);
  stampSound();
  syncUI();
}

// a faint outline of the chosen stamp follows the pointer
const ghost = $('#ghost');
function moveGhost(e) {
  if (!isStamp(state.tool) || state.mode !== 'edit') { ghost.hidden = true; return; }
  const r = sheet.getBoundingClientRect();
  const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
  ghost.hidden = u < 0 || u > 1 || v < 0 || v > 1;
  ghost.style.left = `${u * 100}%`;
  ghost.style.top = `${v * 100}%`;
}
canvas.addEventListener('pointermove', moveGhost);
canvas.addEventListener('pointerleave', () => { ghost.hidden = true; });

canvas.addEventListener('pointerdown', (e) => {
  if (state.mode !== 'edit' || e.button > 0) return;
  e.preventDefault();
  crunch.unlock();
  requestTilt();
  if (isStamp(state.tool)) {
    crunch.unlock().then(() => {});
    placeStamp(e);
    return;
  }
  canvas.setPointerCapture(e.pointerId);
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

function startReplay(delay = 500) {
  ink.clear();
  let total = 0;
  for (const s of state.strokes) {
    if (s.stamp) continue;
    for (let i = 1; i < s.pts.length; i++) {
      total += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]);
    }
  }
  // unhurried, like someone writing it out for you; long notes speed up a
  // little so they still finish in under twenty seconds
  const base = 0.5 * TEX_W * 2; // half-texels per second
  const now = performance.now();
  replay = { si: 0, pi: 0, run: 0, stampT0: 0, rate: Math.max(base, total / 16), last: now, pauseUntil: now + delay };
  setBusy(true);
}

// how fast the hand moves into point i of a stroke: it starts slowly, and
// eases off into sharp turns
function handPace(s, i, run) {
  let f = Math.min(1, 0.35 + run / (TEX_W * 0.12));
  if (i >= 2) {
    const [a, b, c] = [s.pts[i - 2], s.pts[i - 1], s.pts[i]];
    const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let turn = Math.abs(t2 - t1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    f *= 1 - 0.55 * Math.min(turn / 1.2, 1);
  }
  return Math.max(f, 0.25);
}

const STAMP_MS = 850;

function stepReplay(now) {
  const r = replay;
  const dt = Math.min((now - r.last) / 1000, 0.05);
  r.last = now;
  if (now < r.pauseUntil) { crunch.setSpeed(0); return; }

  let budget = r.rate * dt;
  let moved = 0;
  while (budget > 0 && r.si < state.strokes.length) {
    const s = state.strokes[r.si];
    if (s.stamp) {
      // lowered, pressed in (rocking down from one side), then held a moment
      if (!r.stampT0) r.stampT0 = now;
      const k = Math.min((now - r.stampT0) / STAMP_MS, 1);
      const press = k < 0.2 ? 0 : 1 - Math.pow(1 - (k - 0.2) / 0.8, 2.2);
      if (press > 0 && !r.stampSounded) { stampSound(); r.stampSounded = true; }
      ink.stamp(s, press);
      if (k >= 1) {
        r.si++;
        r.stampT0 = 0;
        r.stampSounded = false;
        r.pauseUntil = now + 380 + Math.random() * 220;
      }
      break;
    }
    if (r.pi === 0) {
      ink.segment(s, 0);
      r.pi = 1;
      r.run = 0;
      crunch.tap(0.3);
    }
    if (r.pi >= s.pts.length) {
      ink.finish(s);
      r.si++;
      r.pi = 0;
      // lifting the pen and finding the next spot
      r.pauseUntil = now + 200 + Math.random() * 250;
      break;
    }
    const a = s.pts[r.pi - 1], b = s.pts[r.pi];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    budget -= d / handPace(s, r.pi, r.run);
    moved += d;
    r.run += d;
    ink.segment(s, r.pi);
    r.pi++;
  }
  crunch.setSpeed(moved > 0 ? moved / dt / (2 * TEX_W) : 0);

  if (r.si >= state.strokes.length) {
    replay = null;
    crunch.setSpeed(0);
    setBusy(false);
  }
}

// ------------------------------------------------------------------ loop ---
function frame(now) {
  const shadeTilt = updateTilt();

  if (current && now - lastMoveT > 60) {
    speedSm = 0;
    crunch.setSpeed(0);
  }
  if (replay) stepReplay(now);

  const dirty = ink.takeDirty();
  if (dirty) renderer.uploadStroke(ink.ctx, dirty);
  renderer.render({ light, tilt: shadeTilt, look: LOOKS[state.foil] });
  requestAnimationFrame(frame);
}

// -------------------------------------------------------------------- UI ---
function syncUI() {
  for (const b of $$('[data-foil]')) b.setAttribute('aria-pressed', String(b.dataset.foil === state.foil));
  for (const b of $$('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool));
  for (const b of $$('[data-stamp]')) b.setAttribute('aria-pressed', String(state.tool === `stamp:${b.dataset.stamp}`));
  $('#stamps').setAttribute('aria-pressed', String(isStamp(state.tool)));
  $('#stamps').innerHTML = isStamp(state.tool) ? stampIcon(state.tool.slice(6)) : STAMP_GLYPH;
  if (isStamp(state.tool)) ghost.innerHTML = stampIcon(state.tool.slice(6));
  canvas.style.cursor = isStamp(state.tool) ? 'copy' : '';
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
// ---------------------------------------------------------------- stamps ---
const STAMP_GLYPH = $('#stamps').innerHTML;
const tray = $('#tray');
tray.innerHTML = STAMP_IDS.map((id) => `<button class="stamp-opt" data-stamp="${id}" aria-label="${STAMPS[id].name} stamp" title="${STAMPS[id].name}">${stampIcon(id)}</button>`).join('');
function setTray(open) {
  tray.hidden = !open;
  $('#stamps').setAttribute('aria-expanded', String(open));
}
$('#stamps').addEventListener('click', (e) => { e.stopPropagation(); setTray(tray.hidden); });
for (const b of $$('[data-stamp]')) {
  b.addEventListener('click', () => { state.tool = `stamp:${b.dataset.stamp}`; setTray(false); syncUI(); });
}
document.addEventListener('pointerdown', (e) => {
  if (!tray.hidden && !tray.contains(e.target) && !$('#stamps').contains(e.target)) setTray(false);
});

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

// Shared links are kept short: the packed note is saved under a short id
// (api/notes.js) and the link carries just that. If saving isn't possible
// (no server, offline), the whole note goes in the link as before.
const shortLinks = new Map(); // packed note -> link, so a second tap is instant
async function linkFor(data) {
  if (shortLinks.has(data)) return shortLinks.get(data);
  let url = `${location.origin}${location.pathname}#k=${data}`;
  try {
    const r = await fetch('api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: data }),
    });
    if (r.ok) {
      const { id } = await r.json();
      if (id) url = `${location.origin}${location.pathname}#n=${id}`;
    }
  } catch {}
  shortLinks.set(data, url);
  return url;
}

$('#share').addEventListener('click', async () => {
  if (!state.strokes.length) return;
  const data = await encodeKeepsake(state);
  const fresh = !shortLinks.has(data);
  const url = await linkFor(data);
  const text = 'I pressed something into a chocolate wrapper for you.';
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: 'Foil Keepsake', text, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      // some phones only open the share sheet straight from the tap; the
      // link's ready now, so the next tap opens it at once
      if (err.name === 'NotAllowedError' && fresh) {
        toast('Your link is ready. Tap Share again to send it.');
        return;
      }
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
  requestTilt();
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

// ---------------------------------------------------------------- reveal ---
// A shared keepsake arrives folded up into a little packet with a card beside
// it. Tapping opens it out, then the pressing replays.
// The folded flaps are pictures of the actual (blank) foil, so the hand-off to
// the live sheet once it's open is seamless.
let revealed = true;
const reveal = $('#reveal');
const fold = $('#fold');

// Folded simply, in half and in half again: the bottom half up over the top,
// then the right half over the left. The little packet sits centred and is
// slid back into place as it opens. Each column holds its own two tiles so
// the folds nest correctly.
function buildFold(src) {
  const COLS = [['l', 0], ['r', 0.5]];
  const ROWS = [['t', 0], ['b', 0.5]];
  fold.innerHTML = COLS.map(([c, cx]) => `<div class="col ${c}">${ROWS.map(([r, ry]) => {
    const bg = `background-image:url(${src});background-size:200% 200%;background-position:${cx * 200}% ${ry * 200}%`;
    // the back of the foil is the same patch seen from behind, trimmed in a
    // little so the sheet's lit outer rim doesn't show along the packet's edge
    const edge = (f) => (f ? 97.1 : 2.9);
    const back = `background-image:url(${src});background-size:206% 206%;background-position:${edge(cx)}% ${edge(ry)}%`;
    return `<div class="tile ${r}">`
      + `<div class="face front" style="${bg}"><i class="shade"></i></div>`
      + `<div class="face back" style="${back}"><i class="shade"></i></div>`
      + '</div>';
  }).join('')}</div>`).join('');
}

function showFolded() {
  revealed = false;
  $('#replay').disabled = $('#save-view').disabled = true;
  canvas.classList.add('hidden-sheet');
  // wait for the foil to be baked and drawn once, then photograph it
  const snap = () => {
    if (!renderer.ready) return requestAnimationFrame(snap);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      buildFold(canvas.toDataURL('image/png'));
      reveal.hidden = false;
    }));
  };
  snap();
}

// How a flap catches the light as it turns about its fold: the face toward
// you, lit from the upper left, with the foil's sharp glint. Returns an
// overlay colour relative to lying flat.
const LIGHT = (() => { const l = [-0.35, -0.55, 0.76], m = Math.hypot(...l); return l.map((v) => v / m); })();
const HALF = (() => { const h = [LIGHT[0], LIGHT[1], LIGHT[2] + 1], m = Math.hypot(...h); return h.map((v) => v / m); })();
function flapLight(axis, deg) {
  const a = (deg * Math.PI) / 180;
  let n = axis === 'y' ? [Math.sin(a), 0, Math.cos(a)] : [0, -Math.sin(a), Math.cos(a)];
  if (n[2] < 0) n = n.map((v) => -v); // the back face is the one showing
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const spec = (q) => Math.pow(Math.max(q, 0), 30);
  const v = 0.9 * (dot(n, LIGHT) - LIGHT[2]) + 1.1 * (spec(dot(n, HALF)) - spec(HALF[2]));
  const c = Math.max(-0.55, Math.min(0.26, v));
  return c >= 0 ? `rgba(255, 236, 178, ${c.toFixed(3)})` : `rgba(28, 20, 6, ${(-c).toFixed(3)})`;
}

// Open one flap by hand: it's lifted gently off the packet, swung over, and
// laid down, settling with the faintest lift as the foil relaxes.
function openFlap(els, axis, from, ms) {
  const N = 28;
  const ease = (k) => k * k * k * (k * (k * 6 - 15) + 10);
  const frames = [], shades = [];
  for (let j = 0; j <= N; j++) {
    const k = j / N;
    let deg = k < 0.86 ? from * (1 - ease(k / 0.86)) : Math.sign(from) * 2.2 * Math.sin((Math.PI * (k - 0.86)) / 0.14);
    if (j === N) deg = 0;
    frames.push({ transform: `rotate${axis.toUpperCase()}(${deg.toFixed(2)}deg)` });
    shades.push({ backgroundColor: flapLight(axis, deg) });
  }
  for (const el of els) {
    el.animate(frames, { duration: ms, fill: 'forwards' });
    for (const sh of el.querySelectorAll(':scope > .face > .shade')) sh.animate(shades, { duration: ms, fill: 'forwards' });
  }
}

function unfold() {
  const at = (ms, f) => setTimeout(f, ms);
  const q = (sel) => [...fold.querySelectorAll(sel)];
  const rest = (el) => parseFloat(getComputedStyle(el).getPropertyValue('--rest'));
  reveal.classList.add('opening');
  // the right half comes open first, then the bottom
  const slide = (from, to, ms) => fold.animate([{ transform: `translate(${from})` }, { transform: `translate(${to})` }],
    { duration: ms, easing: 'cubic-bezier(0.45, 0, 0.25, 1)', fill: 'forwards' });
  const [r] = q('.col.r');
  at(300, () => {
    openFlap([r], 'y', rest(r), 1150);
    r.animate([{ translate: '0 0 10px' }, { translate: '0 0 0' }], { duration: 1150, fill: 'forwards' });
    slide('25%, 25%', '0%, 25%', 1150);
  });
  at(450, () => crunch.tap(0.35));
  at(1550, () => { const b = q('.tile.b'); openFlap(b, 'x', rest(b[0]), 1150); slide('0%, 25%', '0%, 0%', 1150); });
  at(1700, () => crunch.tap(0.3));
  at(2850, () => {
    canvas.classList.remove('hidden-sheet');
    reveal.hidden = true;
    reveal.classList.remove('opening');
    revealed = true;
    $('#save-view').disabled = false;
    // a breath before the pressing starts to come through
    startReplay(800);
  });
}

// tap the card (or the packet itself) to open it
function openNote() {
  if (reveal.classList.contains('opening')) return;
  crunch.unlock();
  requestTilt();
  unfold();
}
$('#open-note').addEventListener('click', openNote);
fold.addEventListener('click', openNote);

// ------------------------------------------------------------------ boot ---
// the packed note from the link: in it directly (#k=), or saved under a
// short id (#n=)
async function packedFromLink() {
  const k = location.hash.match(/[#&]k=([\w-]+)/);
  if (k) return k[1];
  const n = location.hash.match(/[#&]n=([A-Za-z0-9]+)/);
  if (!n) return null;
  const r = await fetch(`api/notes?id=${n[1]}`);
  if (!r.ok) throw new Error(`note ${r.status}`);
  return (await r.json()).k;
}

async function boot() {
  // a shared one: show the receiving view (and no bare foil) while it loads
  const shared = /[#&][kn]=/.test(location.hash);
  if (shared) {
    document.body.dataset.mode = 'view';
    canvas.classList.add('hidden-sheet');
  }
  let packed = null;
  try {
    packed = await packedFromLink();
  } catch (err) {
    console.warn('Could not fetch keepsake:', err);
    toast('That link looks crumpled beyond repair. Here is a fresh wrapper.');
  }
  if (packed) {
    try {
      const k = await decodeKeepsake(packed, { w: TEX_W * 2, h: TEX_H * 2 });
      Object.assign(state, k, { mode: 'view' });
      showFolded();
    } catch (err) {
      console.warn('Could not read keepsake from link:', err);
      toast('That link looks crumpled beyond repair. Here is a fresh wrapper.');
    }
  }
  if (state.mode !== 'view') canvas.classList.remove('hidden-sheet');
  renderer.bake(state.seed, { letterFold: state.mode === 'view' });
  syncUI();
  requestAnimationFrame(frame);
}

boot();
