// Keepsakes travel entirely in the URL hash: foil colour, crinkle seed and
// every stroke, varint/delta packed and deflated. Nothing is stored on a server.

const VERSION = 1;
const FOILS = ['gold', 'silver'];
const TOOL_IDS = ['fine', 'medium', 'bold'];
const MAX_STROKES = 4000;
const MAX_POINTS = 400000;

const zig = (n) => (n << 1) ^ (n >> 31);
const unzig = (n) => (n >>> 1) ^ -(n & 1);

function pushVar(out, n) {
  n >>>= 0;
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
}

function reader(bytes) {
  let i = 0;
  return {
    byte() {
      if (i >= bytes.length) throw new Error('truncated');
      return bytes[i++];
    },
    varint() {
      let n = 0, shift = 0, b;
      do {
        if (i >= bytes.length || shift > 28) throw new Error('bad varint');
        b = bytes[i++];
        n |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80);
      return n >>> 0;
    },
  };
}

async function through(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

function toB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encodeKeepsake({ foil, seed, strokes }) {
  const b = [VERSION, Math.max(0, FOILS.indexOf(foil))];
  pushVar(b, seed);
  pushVar(b, strokes.length);
  for (const s of strokes) {
    b.push(Math.max(0, TOOL_IDS.indexOf(s.tool)));
    pushVar(b, s.pts.length);
    let px = 0, py = 0;
    for (const [x, y] of s.pts) {
      pushVar(b, zig(x - px));
      pushVar(b, zig(y - py));
      px = x;
      py = y;
    }
  }
  let bytes = new Uint8Array(b);
  let tag = 'r';
  if (typeof CompressionStream !== 'undefined') {
    try {
      bytes = await through(bytes, new CompressionStream('deflate-raw'));
      tag = 'z';
    } catch { /* fall back to raw */ }
  }
  return tag + toB64url(bytes);
}

export async function decodeKeepsake(str, bounds) {
  const tag = str[0];
  let bytes = fromB64url(str.slice(1));
  if (tag === 'z') bytes = await through(bytes, new DecompressionStream('deflate-raw'));
  else if (tag !== 'r') throw new Error('unknown format');

  const r = reader(bytes);
  if (r.byte() !== VERSION) throw new Error('unsupported version');
  const foil = FOILS[r.byte()] || 'gold';
  const seed = r.varint();
  const count = r.varint();
  if (count > MAX_STROKES) throw new Error('too many strokes');
  const strokes = [];
  let total = 0;
  for (let s = 0; s < count; s++) {
    const tool = TOOL_IDS[r.byte()] || 'medium';
    const n = r.varint();
    total += n;
    if (n === 0 || total > MAX_POINTS) throw new Error('bad stroke');
    const pts = [];
    let x = 0, y = 0;
    for (let i = 0; i < n; i++) {
      x += unzig(r.varint());
      y += unzig(r.varint());
      pts.push([
        Math.min(Math.max(x, 0), bounds.w),
        Math.min(Math.max(y, 0), bounds.h),
      ]);
    }
    strokes.push({ tool, pts });
  }
  return { foil, seed, strokes };
}
