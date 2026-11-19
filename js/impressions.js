// The groove map. White = pressed deepest. A rounded stylus pushed into foil
// on something soft leaves a broad, rounded channel with soft shoulders,
// h(r) = (1 - (r/R)^2)^2, not a crisp V. (The wider bending of the sheet around it
// is derived from this map on the GPU.) Built from stacked concentric passes
// combined with "lighten", so overlapping lines merge instead of digging deeper.

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

  #press(radius, build) {
    const c = this.ctx;
    c.globalCompositeOperation = 'lighten';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const [f, r] of PROFILE) {
      const g = Math.round(255 * f);
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

  drawStroke(stroke) {
    for (let i = 0; i < stroke.pts.length; i++) this.segment(stroke, i);
    this.finish(stroke);
  }
}
