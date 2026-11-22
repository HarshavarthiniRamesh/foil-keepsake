// The groove map. White = pressed deepest. A rounded stylus pushed into foil
// on something soft leaves a broad, rounded channel with soft shoulders,
// h(r) = (1 - (r/R)^2)^2, not a crisp V. (The wider bending of the sheet around it
// is derived from this map on the GPU.) Built from stacked concentric passes
// combined with "lighten", so overlapping lines merge instead of digging deeper.

import { stampLines } from './stamps.js';

// groove radii (texels) for a stamp's outlines, details and dots
const STAMP_R = { o: 4.8, d: 3.4, dot: 4.2 };

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TOOLS = {
  fine: { radius: 4.5 },
  medium: { radius: 9 },
  bold: { radius: 14 },
};

// Level f is reached where (1 - u^2)^2 = f, i.e. u = sqrt(1 - sqrt(f)).
const LEVELS = 32;
const PROFILE = Array.from({ length: LEVELS }, (_, k) => {
  const f = (k + 1) / LEVELS;
  return [f, Math.max(Math.sqrt(1 - Math.sqrt(f)), 0.06)];
});

export class Impressions {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.dirty = null;
    this.clear();
  }

  clear() {
    const c = this.ctx;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.w, this.h);
    this.dirty = { x0: 0, y0: 0, x1: this.w, y1: this.h };
  }

  takeDirty() {
    const d = this.dirty;
    if (!d) return null;
    this.dirty = null;
    const x = Math.max(0, Math.floor(d.x0)), y = Math.max(0, Math.floor(d.y0));
    const x1 = Math.min(this.w, Math.ceil(d.x1)), y1 = Math.min(this.h, Math.ceil(d.y1));
    if (x1 <= x || y1 <= y) return null;
    return { x, y, w: x1 - x, h: y1 - y };
  }

  #mark(points, radius) {
    const pad = radius + 3;
    const d = this.dirty || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const [x, y] of points) {
      d.x0 = Math.min(d.x0, x - pad); d.y0 = Math.min(d.y0, y - pad);
      d.x1 = Math.max(d.x1, x + pad); d.y1 = Math.max(d.y1, y + pad);
    }
    this.dirty = d;
  }

  #press(radius, build, depth = 1) {
    if (depth <= 0) return;
    const c = this.ctx;
    c.globalCompositeOperation = 'lighten';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const [f, r] of PROFILE) {
      const g = Math.round(255 * f * depth);
      c.lineWidth = 2 * r * radius;
      c.strokeStyle = `rgb(${g},${g},${g})`;
      c.beginPath();
      build(c);
      c.stroke();
    }
  }

  // Press the piece of a stroke that point i adds. Points are half-texel ints.
  segment(stroke, i) {
    const pts = stroke.pts;
    const radius = TOOLS[stroke.tool].radius;
    const P = (j) => [pts[j][0] / 2, pts[j][1] / 2];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (i === 0) {
      const p = P(0);
      this.#press(radius, (c) => { c.moveTo(p[0], p[1]); c.lineTo(p[0] + 0.01, p[1]); });
      this.#mark([p], radius);
    } else if (i === 1) {
      const a = P(0), m = mid(a, P(1));
      this.#press(radius, (c) => { c.moveTo(a[0], a[1]); c.lineTo(m[0], m[1]); });
      this.#mark([a, m], radius);
    } else {
      const a = P(i - 2), b = P(i - 1), z = P(i);
      const m0 = mid(a, b), m1 = mid(b, z);
      this.#press(radius, (c) => { c.moveTo(m0[0], m0[1]); c.quadraticCurveTo(b[0], b[1], m1[0], m1[1]); });
      this.#mark([m0, b, m1], radius);
    }
  }

  finish(stroke) {
    const pts = stroke.pts;
    const n = pts.length;
    if (n < 2) return;
    const radius = TOOLS[stroke.tool].radius;
    const a = [pts[n - 2][0] / 2, pts[n - 2][1] / 2];
    const b = [pts[n - 1][0] / 2, pts[n - 1][1] / 2];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    this.#press(radius, (c) => { c.moveTo(m[0], m[1]); c.lineTo(b[0], b[1]); });
    this.#mark([m, b], radius);
  }

  // Press a preset stamp. item: { stamp, x, y, s }: centre in half-texels,
  // size of its 100×100 box in texels. It's pressed by hand, not machine: the
  // lines waver, the pressure comes and goes, and it sits a little askew. The
  // wobble is seeded from the stamp itself so a shared link replays it exactly.
  // `press` (0..1) is how far it has been pushed in: it lands on one side first
  // and rocks down onto the rest, so a replay can press it in gradually.
  stamp(item, press = 1) {
    const rnd = seeded((item.x * 73856093) ^ (item.y * 19349663) ^ item.stamp.length * 83492791);
    // never quite the same twice: a touch bigger or smaller, a few degrees off
    const k = (item.s / 100) * (0.88 + rnd() * 0.24);
    const rot = (rnd() - 0.5) * 0.26;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const cx = item.x / 2, cy = item.y / 2;
    // two slow waves of wobble, different for x and y
    const wave = () => {
      const f1 = 0.05 + rnd() * 0.05, f2 = 0.17 + rnd() * 0.12, p1 = rnd() * 6.3, p2 = rnd() * 6.3;
      return (t) => Math.sin(t * f1 + p1) * 0.9 + Math.sin(t * f2 + p2) * 0.35;
    };
    const wx = wave(), wy = wave(), wp = wave();
    const amp = 0.7; // box units: a steady hand, not a shaky one
    const place = ([x, y], t) => {
      const u = x - 50 + wx(t + x * 0.3) * amp, v = y - 50 + wy(t + y * 0.3) * amp;
      return [cx + (u * cr - v * sr) * k, cy + (u * sr + v * cr) * k];
    };
    // its own seed, so the stamp's shape stays as it was
    const rock = seeded(item.x * 2654435761 + item.y)() * Math.PI * 2, rc = Math.cos(rock), rs = Math.sin(rock);
    const depthAt = ([x, y]) => {
      const w = 0.5 + (((x - cx) * rc + (y - cy) * rs) / (k * 100)); // 0..1 across the stamp
      const d = press * 1.6 - w * 0.6;
      return Math.min(Math.max(d, 0), 1);
    };
    let t = rnd() * 100;
    for (const line of stampLines(item.stamp)) {
      if (line.dot) {
        const [x, y] = place([line.dot[0] + (rnd() - 0.5) * 1.6, line.dot[1] + (rnd() - 0.5) * 1.6], t);
        const r = STAMP_R.dot * (0.8 + rnd() * 0.4);
        this.#press(r, (c) => { c.moveTo(x, y); c.lineTo(x + 0.01, y); }, depthAt([x, y]));
        this.#mark([[x, y]], r);
        t += 7;
        continue;
      }
      const pts = line.pts.map((p, i) => place(p, t + i * 1.6));
      // press in short runs so the groove width can change along the line
      const R = STAMP_R[line.w];
      const run = 6;
      for (let i = 0; i < pts.length - 1; i += run) {
        const seg = pts.slice(i, Math.min(i + run + 1, pts.length));
        const r = R * (0.82 + 0.3 * (0.5 + 0.5 * wp(t + i * 1.6)));
        this.#press(r, (c) => {
          c.moveTo(seg[0][0], seg[0][1]);
          for (let j = 1; j < seg.length; j++) c.lineTo(seg[j][0], seg[j][1]);
        }, depthAt(seg[seg.length >> 1]));
        this.#mark(seg, r);
      }
      t += pts.length * 1.6 + 11;
    }
  }

  drawStroke(stroke) {
    if (stroke.stamp) return this.stamp(stroke);
    for (let i = 0; i < stroke.pts.length; i++) this.segment(stroke, i);
    this.finish(stroke);
  }
}
