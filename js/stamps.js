// Preset stamps, after Mexican tin (hojalata) and foil repoussé: flowing
// C-scrolls and spirals, tapered leaves with veins, pointed petals, rows of
// beads and doubled outlines. Lines are kept fine so the shapes read as
// crafted rather than cartoon. Each is drawn in a 100×100 box. Parts:
//   { d }                  a pressed line (SVG path data)
//   { d, scale, o }        the same path shrunk toward o (default the centre)
//   { dots: d, n, scale }  n small dots spaced evenly along a path
//   { dot: [x, y] }        a single dot
// 'w' picks the groove width: 'o' outline, 'd' detail.

const C = 50;
const f = (n) => n.toFixed(1);

function line(points) {
  return 'M' + points.map(([x, y]) => `${f(x)} ${f(y)}`).join('L');
}

function circle(cx, cy, r) {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

// a curl: starts at angle a0 (radians, screen coords) at radius R from
// (cx, cy) and winds `turns` times inward to radius r; dir 1 or -1
function spiral(cx, cy, R, r, a0, turns, dir = 1) {
  const n = Math.ceil(turns * 40), pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = a0 + dir * t * turns * Math.PI * 2;
    const k = R * Math.pow(r / R, t);
    pts.push([cx + Math.cos(a) * k, cy + Math.sin(a) * k]);
  }
  return line(pts);
}

// a frame from (bx,by) toward (tx,ty): P(t, k) is t along, k across (in w)
function frame(bx, by, tx, ty, w) {
  const ux = tx - bx, uy = ty - by, L = Math.hypot(ux, uy);
  const vx = -uy / L, vy = ux / L;
  return (t, k) => `${f(bx + ux * t + vx * k * w)} ${f(by + uy * t + vy * k * w)}`;
}

// a tapered almond leaf with a midrib and, optionally, veins angled to the tip
function leaf(bx, by, tx, ty, w, veins = 0) {
  const P = frame(bx, by, tx, ty, w);
  const parts = [
    { d: `M${P(0, 0)}C${P(0.25, 1.3)} ${P(0.7, 0.9)} ${P(1, 0)}C${P(0.7, -0.9)} ${P(0.25, -1.3)} ${P(0, 0)}Z`, w: 'o' },
    { d: `M${P(0.06, 0)}L${P(0.84, 0)}`, w: 'd' },
  ];
  for (let i = 0; i < veins; i++) {
    const t = 0.22 + (i * 0.5) / Math.max(veins - 1, 1);
    for (const sg of [1, -1]) parts.push({ d: `M${P(t, 0)}L${P(t + 0.14, sg * 0.62)}`, w: 'd' });
  }
  return parts;
}

// a pointed petal around the centre, from radius r0 to r1 at angle a
function petal(a, r0, r1, w) {
  const ux = Math.cos(a), uy = Math.sin(a);
  return frame(C + ux * r0, C + uy * r0, C + ux * r1, C + uy * r1, w);
}

const HEART = 'M50 92C27 76 13 62 15 45C17 31 32 26 42 34C46 37 48 40 50 43C52 40 54 37 58 34C68 26 83 31 85 45C87 62 73 76 50 92Z';
const HEART_O = [50, 58];

function sun() {
  const parts = [
    { d: circle(C, C, 14), w: 'o' },
    { dots: circle(C, C, 9), n: 10 },
    { dot: [C, C] },
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const P = petal(a, 19, 44, 1);
    // a flame-like wavy ray, then a short straight one with a bead
    parts.push({ d: `M${P(0, 0)}C${P(0.35, 5)} ${P(0.6, -5)} ${P(1, 0)}`, w: 'o' });
    const Q = petal(a + Math.PI / 8, 19, 31, 1);
    parts.push({ d: `M${Q(0, 0)}L${Q(1, 0)}`, w: 'd' });
    parts.push({ dot: [C + Math.cos(a + Math.PI / 8) * 36, C + Math.sin(a + Math.PI / 8) * 36] });
  }
  return parts;
}

function scroll() {
  // two C-scrolls curling out of a stem, a leaf rising between them
  return [
    { d: 'M50 80L50 62', w: 'o' },
    { d: spiral(31, 44, 25, 3, Math.PI * 0.26, 1.25, 1), w: 'o' },
    { d: spiral(69, 44, 25, 3, Math.PI * 0.74, 1.25, -1), w: 'o' },
    ...leaf(50, 56, 50, 8, 9, 0),
    { dot: [31, 44] }, { dot: [69, 44] },
    { dot: [50, 88] },
  ];
}

function tulip() {
  return [
    { d: 'M30 34C28 54 38 66 50 66C62 66 72 54 70 34C64 40 60 44 58 46C56 38 53 30 50 24C47 30 44 38 42 46C40 44 36 40 30 34Z', w: 'o' },
    { d: 'M42 46C43 56 46 61 50 64C54 61 57 56 58 46', w: 'd' },
    { d: 'M50 66C50 76 47 86 50 96', w: 'o' },
    ...leaf(49, 90, 24, 64, 7, 0),
    ...leaf(50, 84, 76, 62, 7, 0),
  ];
}

function rosette() {
  const parts = [{ d: circle(C, C, 10), w: 'o' }, { dots: circle(C, C, 5), n: 6 }];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const P = petal(a, 13, 43, 9);
    parts.push({ d: `M${P(0, 0)}C${P(0.2, 1.2)} ${P(0.7, 0.9)} ${P(1, 0)}C${P(0.7, -0.9)} ${P(0.2, -1.2)} ${P(0, 0)}Z`, w: 'o' });
    parts.push({ d: `M${P(0.2, 0)}L${P(0.68, 0)}`, w: 'd' });
    const b = a + Math.PI / 8;
    parts.push({ dot: [C + Math.cos(b) * 38, C + Math.sin(b) * 38] });
  }
  return parts;
}

function vine() {
  // an S-curve with a curl at each end and leaves along it
  return [
    { d: 'M24 78C38 80 44 62 50 50C56 38 62 20 76 22', w: 'o' },
    { d: spiral(18, 70, 9.5, 2, Math.PI * 0.35, 1.1, 1), w: 'o' },
    { d: spiral(82, 30, 9.5, 2, Math.PI * 1.35, 1.1, 1), w: 'o' },
    ...leaf(40, 70, 58, 86, 6, 0),
    ...leaf(46, 58, 26, 46, 6, 0),
    ...leaf(54, 42, 74, 54, 6, 0),
    ...leaf(60, 30, 42, 14, 6, 0),
  ];
}

const MOON = 'M62 10C40 12 24 30 24 52C24 74 42 90 64 90C72 90 80 87 86 82C82 83 78 84 74 84C52 84 36 68 36 47C36 31 46 17 62 10Z';

// a slim four-pointed sparkle
function sparkle(cx, cy, R) {
  const r = R * 0.22, pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2, k = i % 2 ? r : R;
    pts.push([cx + Math.cos(a) * k, cy + Math.sin(a) * k]);
  }
  return line(pts) + 'Z';
}

// The order matters: shared links store a stamp by its place in this list.
export const STAMPS = {
  heart: {
    name: 'Heart',
    parts: [
      { d: HEART, w: 'o' },
      { d: HEART, scale: 0.8, o: HEART_O, w: 'd' },
      { dots: HEART, scale: 0.9, o: HEART_O, n: 26 },
      // a flame of three tongues rising from the cleft
      { d: 'M43 37C38 31 40 25 42 18C44 24 46 27 47.5 25C47 18 48 13 50 6C52 13 53 18 52.5 25C54 27 56 24 58 18C60 25 62 31 57 37', w: 'o' },
      // a sprig inside: two leaves from the point
      ...leaf(50, 74, 37, 50, 6.5, 0),
      ...leaf(50, 74, 63, 50, 6.5, 0),
      { dot: [50, 56] },
    ],
  },
  sun: { name: 'Sun', parts: sun() },
  scroll: { name: 'Scroll', parts: scroll() },
  leaf: { name: 'Leaf', parts: [...leaf(26, 86, 78, 12, 15, 4), { d: spiral(20, 86, 6, 1.5, 0, 0.9, 1), w: 'd' }] },
  tulip: { name: 'Tulip', parts: tulip() },
  moon: {
    name: 'Moon',
    parts: [
      { d: MOON, w: 'o' },
      { dots: 'M54 18C40 24 30 36 30 52C30 68 42 81 58 84', n: 11 },
      { d: sparkle(72, 34, 13), w: 'd' },
      { dot: [80, 60] }, { dot: [64, 18] },
    ],
  },
  rosette: { name: 'Rosette', parts: rosette() },
  vine: { name: 'Vine', parts: vine() },
};

export const STAMP_IDS = Object.keys(STAMPS);

// Sampling dots needs path geometry, which an off-screen SVG path provides.
let probe = null;
function dotsAlong(d, n) {
  if (!probe) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(probe);
  }
  probe.setAttribute('d', d);
  const len = probe.getTotalLength();
  const closed = /z\s*$/i.test(d);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = closed ? (i / n) * len : (i / Math.max(n - 1, 1)) * len;
    const p = probe.getPointAtLength(t);
    out.push([p.x, p.y]);
  }
  return out;
}

// Each part, resolved to: { path: Path2D-ready d, matrix: [a,b,c,d,e,f], w }
// or { dot: [x, y] }, all in the 100×100 box.
const cache = new Map();
export function stampGeometry(id) {
  if (cache.has(id)) return cache.get(id);
  const out = [];
  for (const p of STAMPS[id].parts) {
    const s = p.scale || 1;
    const mx = p.mirror ? -1 : 1;
    const [ox, oy] = p.o || [C, C];
    const m = [s * mx, 0, 0, s, ox - ox * s * mx, oy - oy * s];
    const apply = ([x, y]) => [m[0] * x + m[4], m[3] * y + m[5]];
    if (p.dot) out.push({ dot: apply(p.dot) });
    else if (p.dots) for (const q of dotsAlong(p.dots, p.n)) out.push({ dot: apply(q) });
    else out.push({ d: p.d, m, w: p.w || 'o' });
  }
  cache.set(id, out);
  return out;
}

// Each line part as a polyline of points (in the 100×100 box), for pressing
// with a hand wobble. Closed paths repeat their first point at the end.
const lineCache = new Map();
export function stampLines(id) {
  if (lineCache.has(id)) return lineCache.get(id);
  const lines = [];
  for (const g of stampGeometry(id)) {
    if (g.dot) { lines.push({ dot: g.dot }); continue; }
    dotsAlong(g.d, 1); // make sure the probe exists
    // split at subpaths so separate strokes don't get joined up
    for (const d of g.d.split(/(?=M)/).filter(Boolean)) {
      probe.setAttribute('d', d);
      const L = probe.getTotalLength();
      const n = Math.max(2, Math.ceil(L / 1.6));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const p = probe.getPointAtLength((i / n) * L);
        pts.push([g.m[0] * p.x + g.m[4], g.m[3] * p.y + g.m[5]]);
      }
      lines.push({ pts, w: g.w });
    }
  }
  lineCache.set(id, lines);
  return lines;
}

// A little SVG of the stamp for the picker.
export function stampIcon(id) {
  const parts = stampGeometry(id).map((g) => (g.dot
    ? `<circle cx="${g.dot[0].toFixed(1)}" cy="${g.dot[1].toFixed(1)}" r="2.3"/>`
    : `<path d="${g.d}" transform="matrix(${g.m.join(' ')})" style="stroke-width:${((g.w === 'o' ? 3.6 : 2.4) / Math.abs(g.m[0])).toFixed(2)}"/>`));
  return `<svg class="stamp-svg" viewBox="-4 -4 108 108" aria-hidden="true">${parts.join('')}</svg>`;
}
