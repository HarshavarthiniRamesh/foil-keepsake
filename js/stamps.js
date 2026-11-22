// Preset stamps, in the style of folk tin and foil embossing: a bold outline,
// a second contour just inside it, and small lines and dots for detail. Each
// is drawn in a 100×100 box. Parts:
//   { d }                  a pressed line (SVG path data)
//   { d, scale }           the same path shrunk toward the centre (inner contour)
//   { dots: d, n, scale }  n small dots spaced evenly along a path
//   { dot: [x, y] }        a single dot
// 'w' picks the groove width: 'o' outline, 'd' detail.

const C = 50;

function poly(points) {
  return 'M' + points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z';
}

function starPoints(n, R, r, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n;
    const k = i % 2 ? r : R;
    pts.push([C + Math.cos(a) * k, C + Math.sin(a) * k]);
  }
  return pts;
}

function circle(cx, cy, r) {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

const HEART = 'M50 86C24 68 8 52 10 33C12 17 30 11 42 20C46 23 48 26 50 30C52 26 54 23 58 20C70 11 88 17 90 33C92 52 76 68 50 86Z';

const STAR5 = poly(starPoints(5, 46, 20));

function snowflake() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 2;
    const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    const P = (t, s) => `${(C + ux * t + vx * s).toFixed(1)} ${(C + uy * t + vy * s).toFixed(1)}`;
    parts.push({ d: `M${P(10, 0)}L${P(44, 0)}`, w: 'o' });
    parts.push({ d: `M${P(22, -9)}L${P(28, 0)}L${P(22, 9)}`, w: 'd' });
    parts.push({ d: `M${P(32, -8)}L${P(37, 0)}L${P(32, 8)}`, w: 'd' });
    parts.push({ dot: [C + ux * 47, C + uy * 47] });
  }
  const hex = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 2 + Math.PI / 6;
    hex.push([C + Math.cos(a) * 11, C + Math.sin(a) * 11]);
  }
  parts.push({ d: poly(hex), w: 'o' });
  parts.push({ dot: [C, C] });
  return parts;
}

const TREE = 'M50 8L66 34L60 34L74 56L66 56L82 80L18 80L34 56L26 56L40 34L34 34Z';

const BELL = 'M50 14C38 14 31 23 30 36C29 50 26 62 16 72L84 72C74 62 71 50 70 36C69 23 62 14 50 14Z';

const MOON = 'M62 10C40 12 24 30 24 52C24 74 42 90 64 90C72 90 80 87 86 82C82 83 78 84 74 84C52 84 36 68 36 47C36 31 46 17 62 10Z';

function flower() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 - Math.PI / 2;
    const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
    const P = (t, s) => `${(C + ux * t + vx * s).toFixed(1)} ${(C + uy * t + vy * s).toFixed(1)}`;
    parts.push({ d: `M${P(12, 0)}C${P(20, -16)} ${P(40, -14)} ${P(45, 0)}C${P(40, 14)} ${P(20, 16)} ${P(12, 0)}Z`, w: 'o' });
    parts.push({ d: `M${P(17, 0)}L${P(37, 0)}`, w: 'd' });
  }
  parts.push({ d: circle(C, C, 9), w: 'o' });
  parts.push({ dots: circle(C, C, 4.5), n: 5 });
  return parts;
}

// a holly leaf from (bx,by) to (tx,ty): spiky points with scooped edges between
function hollyLeaf(bx, by, tx, ty, w) {
  const ux = tx - bx, uy = ty - by, L = Math.hypot(ux, uy);
  const vx = -uy / L, vy = ux / L;
  const P = (t, k) => `${(bx + ux * t + vx * k * w).toFixed(1)} ${(by + uy * t + vy * k * w).toFixed(1)}`;
  const side = (sgn) => {
    const spikes = [[0.22, 0.8], [0.48, 1], [0.74, 0.8]];
    let d = '';
    let prev = 0;
    for (const [t, k] of spikes) {
      d += `Q${P((prev + t) / 2, sgn * k * 0.45)} ${P(t, sgn * k)}`;
      prev = t;
    }
    return d + `Q${P((prev + 1) / 2, sgn * 0.35)} ${P(1, 0)}`;
  };
  // up one side to the tip, back down the other
  const back = (() => {
    const spikes = [[0.74, 0.8], [0.48, 1], [0.22, 0.8]];
    let d = '';
    let prev = 1;
    for (const [t, k] of spikes) {
      d += `Q${P((prev + t) / 2, -k * 0.45)} ${P(t, -k)}`;
      prev = t;
    }
    return d + `Q${P(prev / 2, -0.35)} ${P(0, 0)}`;
  })();
  return { outline: `M${P(0, 0)}` + side(1) + back + 'Z', vein: `M${P(0.04, 0)}L${P(0.92, 0)}` };
}
const HOLLY_L = hollyLeaf(48, 56, 12, 26, 13);
const HOLLY_R = hollyLeaf(52, 56, 88, 26, 13);

export const STAMPS = {
  heart: {
    name: 'Heart',
    parts: [
      { d: HEART, w: 'o' },
      { d: HEART, scale: 0.78, w: 'd' },
      { dots: HEART, scale: 0.89, n: 26 },
      { d: 'M50 44C46 40 40 42 41 48C42 53 46 56 50 60C54 56 58 53 59 48C60 42 54 40 50 44Z', w: 'd' },
    ],
  },
  star: {
    name: 'Star',
    parts: [
      { d: STAR5, w: 'o' },
      { d: STAR5, scale: 0.7, w: 'd' },
      ...starPoints(5, 46, 20).filter((_, i) => i % 2 === 0).map(([x, y]) => ({
        d: `M${C} ${C}L${(C + (x - C) * 0.55).toFixed(1)} ${(C + (y - C) * 0.55).toFixed(1)}`, w: 'd',
      })),
      { dots: circle(C, C, 6), n: 6 },
    ],
  },
  snowflake: { name: 'Snowflake', parts: snowflake() },
  tree: {
    name: 'Tree',
    parts: [
      { d: TREE, w: 'o' },
      { d: 'M38 44L58 40M32 64L66 58M28 76L72 70', w: 'd' },
      { dot: [46, 30] }, { dot: [56, 50] }, { dot: [42, 52] }, { dot: [60, 66] }, { dot: [38, 68] }, { dot: [50, 74] },
      { d: 'M44 80L44 92L56 92L56 80', w: 'o' },
    ],
  },
  bell: {
    name: 'Bell',
    parts: [
      { d: BELL, w: 'o' },
      { d: 'M36 38C37 28 42 22 50 22', w: 'd' },
      { d: 'M28 62L72 62', w: 'd' },
      { dots: 'M33 54L67 54', n: 7 },
      { d: circle(50, 80, 6), w: 'o' },
      { d: 'M50 14C46 8 38 6 36 10C34 14 42 15 50 14C58 15 66 14 64 10C62 6 54 8 50 14Z', w: 'd' },
    ],
  },
  moon: {
    name: 'Moon',
    parts: [
      { d: MOON, w: 'o' },
      { dots: 'M54 18C40 24 30 36 30 52C30 68 42 81 58 84', n: 11 },
      { d: poly(starPoints(4, 9, 3).map(([x, y]) => [x + 22, y - 18])), w: 'd' },
      { d: poly(starPoints(4, 6, 2).map(([x, y]) => [x + 30, y + 2])), w: 'd' },
    ],
  },
  flower: { name: 'Flower', parts: flower() },
  holly: {
    name: 'Holly',
    parts: [
      { d: HOLLY_L.outline, w: 'o' },
      { d: HOLLY_L.vein, w: 'd' },
      { d: HOLLY_R.outline, w: 'o' },
      { d: HOLLY_R.vein, w: 'd' },
      { d: circle(50, 64, 8), w: 'o' },
      { d: circle(38, 74, 7), w: 'o' },
      { d: circle(62, 74, 7), w: 'o' },
      { dot: [50, 64] }, { dot: [38, 74] }, { dot: [62, 74] },
    ],
  },
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
    const m = [s * mx, 0, 0, s, C - C * s * mx, C - C * s];
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
    ? `<circle cx="${g.dot[0].toFixed(1)}" cy="${g.dot[1].toFixed(1)}" r="2.6"/>`
    : `<path d="${g.d}" transform="matrix(${g.m.join(' ')})" style="stroke-width:${((g.w === 'o' ? 4.5 : 3) / Math.abs(g.m[0])).toFixed(2)}"/>`));
  return `<svg class="stamp-svg" viewBox="-4 -4 108 108" aria-hidden="true">${parts.join('')}</svg>`;
}
