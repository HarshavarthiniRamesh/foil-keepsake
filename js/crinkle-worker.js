// Crumple generator (runs in a worker; takes a few hundred ms at full size).
//
// Crumpled-then-flattened foil is a network of folds. When foil is balled up it
// buckles at points, and creases radiate from each one, bending and fading as
// they run out. Flattened again, each fold leaves a sharp, narrow crease (a thin
// bright crest beside a thin dark valley), while the patches between folds are
// left nearly flat, each tipped at a slightly different angle. On top of that
// there's a gentle unevenness and a fine micro-crinkle everywhere.
//
// Output is RGBA8: RG = surface tilt (encoded n*0.4+0.5), B = crease shading.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate(seed, W, H) {
  const rnd = mulberry32(seed);
  const nx = new Float32Array(W * H);
  const ny = new Float32Array(W * H);
  const cav = new Float32Array(W * H);

  // One straight piece of a crease from (x0,y0), L px along (dx,dy).
  // The tilt either side has strength amp (sign: ridge or valley), falls off
  // over `falloff` px, and runs from strength g0 at the start to g1 at the end.
  function piece(x0, y0, dx, dy, L, amp, falloff, g0, g1, shade) {
    const px = -dy, py = dx;
    const back = Math.min(falloff, 2);
    const corners = [
      [x0 - dx * back + px * falloff, y0 - dy * back + py * falloff],
      [x0 - dx * back - px * falloff, y0 - dy * back - py * falloff],
      [x0 + dx * (L + back) - px * falloff, y0 + dy * (L + back) - py * falloff],
      [x0 + dx * (L + back) + px * falloff, y0 + dy * (L + back) + py * falloff],
    ];
    let minY = Infinity, maxY = -Infinity;
    for (const c of corners) { minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]); }
    const yStart = Math.max(0, Math.floor(minY)), yEnd = Math.min(H - 1, Math.ceil(maxY));
    const valley = amp < 0;
    const absAmp = Math.abs(amp);

    for (let y = yStart; y <= yEnd; y++) {
      const yc = y + 0.5;
      let xMin = Infinity, xMax = -Infinity;
      for (let k = 0; k < 4; k++) {
        const a = corners[k], b = corners[(k + 1) & 3];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
          const x = a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
          if (x < xMin) xMin = x;
          if (x > xMax) xMax = x;
        }
      }
      if (xMin > xMax) continue;
      const xs = Math.max(0, Math.floor(xMin)), xe = Math.min(W - 1, Math.ceil(xMax));
      const ry = yc - y0;
      let i = y * W + xs;
      for (let x = xs; x <= xe; x++, i++) {
        const rx = x + 0.5 - x0;
        const along = rx * dx + ry * dy;
        const sd = rx * px + ry * py;
        const ad = sd < 0 ? -sd : sd;
        if (ad >= falloff) continue;
        // ends overlap the neighbouring piece by `back` px, cross-faded
        let t = along / L;
        let g;
        if (along < 0) g = g0 * (1 + along / back) * 0.5;
        else if (along > L) g = g1 * (1 - (along - L) / back) * 0.5;
        else g = g0 + (g1 - g0) * t;
        if (along < back && along >= 0) g *= 0.5 + 0.5 * (along / back);
        if (along > L - back && along <= L) g *= 0.5 + 0.5 * ((L - along) / back);
        if (g <= 0) continue;
        const q = 1 - ad / falloff;
        const s = (sd >= 0 ? amp : -amp) * q * q * g;
        nx[i] += s * px;
        ny[i] += s * py;
        if (shade && ad < 1.3) cav[i] += (valley ? 0.08 : 0.015) * absAmp * g * (1.3 - ad);
      }
    }
  }

  // A crease that wanders: a few straight pieces with small turns, strongest at
  // the crumple point and fading out. Each fold gets a sharp narrow component
  // (the visible crease) and a weak broad one (the facets tipping either side).
  function crease(x, y, ang, L, amp, sharpW, broadW) {
    const parts = L < 25 ? 1 : 2 + Math.floor(rnd() * 3);
    const segL = L / parts;
    for (let p = 0; p < parts; p++) {
      const g0 = Math.pow(1 - p / parts, 1.3), g1 = Math.pow(1 - (p + 1) / parts, 1.3);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      piece(x, y, dx, dy, segL, amp * 0.4, sharpW, g0, g1, true);
      if (broadW > sharpW) piece(x, y, dx, dy, segL, amp * 0.35, broadW, g0, g1, false);
      x += dx * segL;
      y += dy * segL;
      ang += (rnd() - 0.5) * 0.5;
    }
  }

  const S = W; // px per sheet width

  // crumple points: a few large, many small, slightly clustered
  const clusters = Array.from({ length: 8 }, () => [rnd() * W, rnd() * H, 0.12 + rnd() * 0.25]);
  const spot = () => {
    if (rnd() < 0.35) {
      const c = clusters[Math.floor(rnd() * clusters.length)];
      const r = Math.sqrt(rnd()) * c[2] * S, a = rnd() * Math.PI * 2;
      return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
    }
    return [rnd() * W, rnd() * H];
  };

  for (let v = 0; v < 1100; v++) {
    const [x, y] = spot();
    const size = Math.pow(rnd(), 2.4);
    const Lbase = (0.012 + 0.16 * size) * S;
    const arms = 3 + Math.floor(rnd() * 4);
    const spin = rnd() * Math.PI * 2;
    for (let j = 0; j < arms; j++) {
      const ang = spin + (j * Math.PI * 2) / arms + (rnd() - 0.5) * 1.1;
      const L = Lbase * (0.4 + rnd() * 1.2);
      const amp = (0.16 + 0.3 * rnd()) * (0.6 + 0.4 * Math.sqrt(size)) * (rnd() < 0.5 ? -1 : 1);
      const sharpW = 1.6 + rnd() * (2 + 5 * size);
      const broadW = L * (0.12 + 0.2 * rnd());
      crease(x, y, ang, L, amp, sharpW, broadW);
    }
  }

  // micro-crinkle: lots of tiny creases everywhere
  for (let v = 0; v < 9000; v++) {
    const x = rnd() * W, y = rnd() * H;
    const arms = 2 + Math.floor(rnd() * 3);
    const spin = rnd() * Math.PI * 2;
    for (let j = 0; j < arms; j++) {
      const ang = spin + (j * Math.PI * 2) / arms + (rnd() - 0.5) * 1.2;
      const L = 3 + rnd() * 12;
      const amp = (0.025 + 0.05 * rnd()) * (rnd() < 0.5 ? -1 : 1);
      piece(x, y, Math.cos(ang), Math.sin(ang), L, amp, 1.2 + rnd() * 1.3, 1, 0.1, true);
    }
  }

  // one or two folds left from being wrapped around the bar
  const folds = 1 + Math.floor(rnd() * 2);
  for (let f = 0; f < folds; f++) {
    const horizontal = rnd() < 0.65;
    const ang = (horizontal ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.06;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const cx = horizontal ? W / 2 : W * (0.25 + rnd() * 0.5);
    const cy = horizontal ? H * (0.2 + rnd() * 0.6) : H / 2;
    const L = Math.hypot(W, H);
    const amp = (0.12 + rnd() * 0.08) * (rnd() < 0.5 ? -1 : 1);
    piece(cx - dx * L / 2, cy - dy * L / 2, dx, dy, L, amp * 0.5, 2.5 + rnd() * 2, 1, 1, true);
    piece(cx - dx * L / 2, cy - dy * L / 2, dx, dy, L, amp * 0.25, 30 + rnd() * 40, 1, 1, false);
  }

  // gentle unevenness: smooth value-noise height at a few scales
  const bumps = new Float32Array(W * H);
  const octaves = [[90, 1.0], [40, 0.45], [18, 0.2]];
  for (const [cell, weight] of octaves) {
    const gw = Math.ceil(W / cell) + 2, gh = Math.ceil(H / cell) + 2;
    const grid = new Float32Array(gw * gh);
    for (let k = 0; k < grid.length; k++) grid[k] = rnd() - 0.5;
    for (let y = 0, i = 0; y < H; y++) {
      const fy = y / cell, iy = Math.floor(fy);
      let ty = fy - iy; ty = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < W; x++, i++) {
        const fx = x / cell, ix = Math.floor(fx);
        let tx = fx - ix; tx = tx * tx * (3 - 2 * tx);
        const r0 = iy * gw + ix, r1 = r0 + gw;
        const top = grid[r0] + (grid[r0 + 1] - grid[r0]) * tx;
        const bot = grid[r1] + (grid[r1 + 1] - grid[r1]) * tx;
        bumps[i] += (top + (bot - top) * ty) * weight * cell;
      }
    }
  }

  // mill roller lines
  const rows = new Float32Array(H);
  let acc = 0;
  for (let y = 0; y < H; y++) { acc = acc * 0.6 + (rnd() - 0.5); rows[y] = acc; }

  const out = new Uint8ClampedArray(W * H * 4);
  const bumpK = 0.05;
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const xl = x > 0 ? i - 1 : i, xr = x < W - 1 ? i + 1 : i;
      const yu = y > 0 ? i - W : i, yd = y < H - 1 ? i + W : i;
      let a = nx[i] - (bumps[xr] - bumps[xl]) * bumpK;
      let b = ny[i] - (bumps[yd] - bumps[yu]) * bumpK + rows[y] * 0.01;
      // soft limit where many creases pile up
      const m = Math.hypot(a, b);
      const k = 1 / (1 + m * 0.5);
      const o = i * 4;
      out[o] = (a * k * 0.4 + 0.5) * 255;
      out[o + 1] = (b * k * 0.4 + 0.5) * 255;
      out[o + 2] = (1 - Math.min(cav[i], 0.25)) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

self.onmessage = (e) => {
  const { id, seed, w, h } = e.data;
  const data = generate(seed, w, h);
  self.postMessage({ id, data }, [data.buffer]);
};
