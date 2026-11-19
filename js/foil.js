// WebGL2 foil renderer.
// The crumple (a surface-tilt map) is generated once per wrapper in a worker.
// Every frame, the lighting pass combines it with the pressed-in height map
// drawn by the user.

export const TEX_W = 1200;
export const TEX_H = 1600;
export const ASPECT = TEX_H / TEX_W;

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Bend field: the foil around a pressed line is dragged down with it, so the
// sheet bends over a much wider area than the groove itself. Two Gaussian
// blurs of the groove map at 1/4 resolution: R = near shoulder, G = the whole
// sheet bowing. Run as a horizontal then a vertical pass.
const BEND_SIGMA = [3.0, 11.0]; // in 1/4-res texels (~12px and ~44px full-res)
const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform vec2 uDir;
uniform int uFromStroke;
void main() {
  const float s1 = ${BEND_SIGMA[0].toFixed(1)}, s2 = ${BEND_SIGMA[1].toFixed(1)};
  vec2 acc = vec2(0.0), wsum = vec2(0.0);
  for (int i = -33; i <= 33; i++) {
    float x = float(i);
    vec2 w = vec2(exp(-x * x / (2.0 * s1 * s1)), exp(-x * x / (2.0 * s2 * s2)));
    vec2 uv = vUv + uDir * x;
    vec2 v = uFromStroke == 1 ? vec2(textureLod(uSrc, uv, 2.0).r) : texture(uSrc, uv).rg;
    acc += v * w;
    wsum += w;
  }
  outColor = vec4(acc / wsum, 0.0, 1.0);
}`;

const MAIN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uCrinkle;
uniform sampler2D uStroke;
uniform sampler2D uBend;
uniform vec2 uTexel;
uniform vec2 uBendTexel;
uniform vec3 uLight;
uniform vec3 uAlbedo;
uniform float uRough;
uniform float uExposure;
uniform float uAspect;
uniform float uPx;
uniform vec3 uDepth;   // groove, near shoulder, sheet bend
uniform float uFlat;

float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
float inset(float t, float k) { return 0.0035 + 0.0045 * n1(t * 19.0 + k * 31.7) + 0.0016 * n1(t * 150.0 + k * 7.3); }
float press(vec2 st) { return texture(uStroke, st).r; }
vec2 bend(vec2 st) { return texture(uBend, st).rg; }

void main() {
  vec2 st = vec2(vUv.x, 1.0 - vUv.y);   // top-left origin, matches the textures
  float A = uAspect;

  // slightly ragged edge, as if torn off the bar
  float dl = st.x - inset(st.y * A, 0.0);
  float dr = 1.0 - st.x - inset(st.y * A, 1.0);
  float dt = st.y * A - inset(st.x, 2.0);
  float db = (1.0 - st.y) * A - inset(st.x, 3.0);
  float d = min(min(dl, dr), min(dt, db));
  float mask = clamp(d / uPx + 0.5, 0.0, 1.0);
  if (mask <= 0.0) { outColor = vec4(0); return; }

  // The stylus leaves a rounded channel... The slope is taken over a small
  // 3x3 footprint so the stacked levels of the groove map read as one smooth
  // curve instead of tiny terraces.
  vec2 e1 = uTexel * 1.5;
  float h0 = press(st);
  float pl = press(st - vec2(e1.x, 0.0)), pr = press(st + vec2(e1.x, 0.0));
  float pu = press(st - vec2(0.0, e1.y)), pd = press(st + vec2(0.0, e1.y));
  float pul = press(st - e1), pdr = press(st + e1);
  float pur = press(st + vec2(e1.x, -e1.y)), pdl = press(st + vec2(-e1.x, e1.y));
  vec2 g = vec2((pr - pl) * 2.0 + (pur - pul) + (pdr - pdl),
                (pd - pu) * 2.0 + (pdl - pul) + (pdr - pur)) / (8.0 * 1.5);

  // ...and drags the foil around it down too, bending the sheet. Gradients
  // span two bend texels (8 full-res texels) so they stay smooth.
  vec2 bt = uBendTexel;
  vec2 b0 = bend(st);
  vec2 bx1 = bend(st + vec2(bt.x, 0.0)), bx0 = bend(st - vec2(bt.x, 0.0));
  vec2 by1 = bend(st + vec2(0.0, bt.y)), by0 = bend(st - vec2(0.0, bt.y));
  vec2 gNear = vec2(bx1.r - bx0.r, by1.r - by0.r) / 8.0;
  vec2 gFar = vec2(bx1.g - bx0.g, by1.g - by0.g) / 8.0;

  // the crinkle is dragged a little toward the line, and pressed slightly
  // flatter right beside it, but it survives
  vec2 stC = st - gNear * 90.0 * uTexel;
  vec4 cr = texture(uCrinkle, stC);
  vec2 n = (cr.rg - 0.5) * 2.5 * uFlat;
  float ao = cr.b;

  float worked = smoothstep(0.01, 0.12, b0.r * 1.5 + b0.g);
  float burnish = smoothstep(0.25, 0.9, h0);
  n *= 1.0 - 0.75 * worked - 0.25 * burnish;
  ao = mix(ao, 1.0, burnish);

  // pressed in: height = -(groove + shoulder + bend), so slopes face the line
  n += g * uDepth.x + gNear * uDepth.y + gFar * uDepth.z;

  vec2 curl = vec2(exp(-dr / 0.02) - exp(-dl / 0.02), exp(-db / 0.02) - exp(-dt / 0.02));
  n -= curl * 0.1;

  vec3 N = normalize(vec3(n, 1.0));
  vec3 P = vec3(st.x, st.y * A, 0.0);
  vec3 C = vec3(0.5, 0.5 * A, 2.4);
  vec3 V = normalize(C - P);
  vec3 Lp = vec3(uLight.x, uLight.y * A, uLight.z);
  vec3 L = normalize(Lp - P);
  vec3 H = normalize(L + V);
  float NdL = max(dot(N, L), 0.0), NdV = max(dot(N, V), 1e-3), NdH = max(dot(N, H), 0.0);

  float rough = uRough * (1.0 - 0.35 * burnish);
  float a = rough * rough, a2 = a * a;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * dd * dd);
  float k = a * 0.5;
  float G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
  float spec = D * G / (4.0 * NdV + 1e-3);

  // a simple room for the foil to reflect: bright above, a soft window at the light
  vec3 R = reflect(-V, N);
  vec3 Ld = normalize(Lp - vec3(0.5, 0.5 * A, 0.0));
  float up = -R.y + 0.25 * R.x;
  vec3 room = mix(vec3(0.07, 0.065, 0.06), vec3(0.6, 0.58, 0.54), smoothstep(-0.6, 0.75, up));
  float lobe = max(dot(R, Ld), 0.0);
  room += vec3(1.0, 0.97, 0.9) * (pow(lobe, 18.0) * 1.3 + pow(lobe, 4.0) * 0.35);
  room += vec3(0.75, 0.82, 0.95) * pow(max(dot(R, normalize(vec3(-0.65, -0.35, 0.65))), 0.0), 6.0) * 0.3;

  vec3 col = uAlbedo * (room + spec * vec3(1.0, 0.98, 0.92) * 1.1) * ao;
  // tone map on luminance so the gold keeps its colour, with a little
  // per-channel roll-off so the brightest glints go pale like real foil
  float lum = max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  vec3 keep = col * (1.0 - exp(-lum * uExposure)) / lum;
  col = mix(keep, 1.0 - exp(-col * uExposure), 0.35);
  col = pow(col, vec3(0.4545));

  outColor = vec4(col * mask, mask);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
  }
  return sh;
}

function link(gl, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) || 'program link failed');
  }
  const uniforms = {};
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(prog, i).name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(prog, name);
  }
  return { prog, u: uniforms };
}

function mipTexture(gl, internal, w, h) {
  const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, levels, internal, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export class FoilRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.canvas = canvas;
    this.ready = false;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.mainProg = link(gl, MAIN_FS);
    this.blurProg = link(gl, BLUR_FS);

    // Bend field targets at 1/4 res. Half-float keeps the gentle slopes free of
    // banding; fall back to 8-bit where float rendering isn't available.
    const float = !!gl.getExtension('EXT_color_buffer_float');
    this.bendW = TEX_W / 4;
    this.bendH = TEX_H / 4;
    this.bend = [0, 1].map(() => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, float ? gl.RG16F : gl.RG8, this.bendW, this.bendH);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return { tex, fbo };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.crinkle = mipTexture(gl, gl.RGBA8, TEX_W, TEX_H);
    this.stroke = mipTexture(gl, gl.R8, TEX_W, TEX_H);
    this.strokeDirty = true;

    this.worker = new Worker(new URL('./crinkle-worker.js', import.meta.url));
    this.bakeId = 0;
    this.pending = new Map();
    this.worker.onmessage = (e) => {
      const { id, data } = e.data;
      const resolve = this.pending.get(id);
      this.pending.delete(id);
      if (id === this.bakeId) {
        gl.bindTexture(gl.TEXTURE_2D, this.crinkle);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, TEX_H, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.buffer));
        gl.generateMipmap(gl.TEXTURE_2D);
        this.ready = true;
      }
      resolve?.();
    };
  }

  // Crumple a new wrapper from a seed. Resolves once it's on the GPU.
  bake(seed) {
    const id = ++this.bakeId;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({ id, seed: seed >>> 0, w: TEX_W, h: TEX_H });
    });
  }

  // Copy the red channel of a dirty region of the press canvas to the GPU.
  uploadStroke(ctx, r) {
    const gl = this.gl;
    const img = ctx.getImageData(r.x, r.y, r.w, r.h).data;
    const red = new Uint8Array(r.w * r.h);
    for (let i = 0, j = 0; i < red.length; i++, j += 4) red[i] = img[j];
    gl.bindTexture(gl.TEXTURE_2D, this.stroke);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RED, gl.UNSIGNED_BYTE, red);
    this.strokeDirty = true;
  }

  resize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  updateBend() {
    const gl = this.gl;
    const { prog, u } = this.blurProg;
    gl.useProgram(prog);
    gl.viewport(0, 0, this.bendW, this.bendH);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(u.uSrc, 0);
    // horizontal: groove map -> bend[0]
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bend[0].fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.stroke);
    gl.uniform1i(u.uFromStroke, 1);
    gl.uniform2f(u.uDir, 1 / this.bendW, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // vertical: bend[0] -> bend[1]
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bend[1].fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.bend[0].tex);
    gl.uniform1i(u.uFromStroke, 0);
    gl.uniform2f(u.uDir, 0, 1 / this.bendH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render({ light, look }) {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.ready) return;

    if (this.strokeDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.stroke);
      gl.generateMipmap(gl.TEXTURE_2D);
      this.updateBend();
      this.strokeDirty = false;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }

    const { prog, u } = this.mainProg;
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.crinkle);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.stroke);
    gl.uniform1i(u.uCrinkle, 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.bend[1].tex);
    gl.uniform1i(u.uStroke, 1);
    gl.uniform1i(u.uBend, 2);
    gl.uniform2f(u.uTexel, 1 / TEX_W, 1 / TEX_H);
    gl.uniform2f(u.uBendTexel, 1 / this.bendW, 1 / this.bendH);
    gl.uniform3f(u.uLight, light.x, light.y, light.z);
    gl.uniform3fv(u.uAlbedo, look.albedo);
    gl.uniform1f(u.uRough, look.rough);
    gl.uniform1f(u.uExposure, look.exposure);
    gl.uniform1f(u.uAspect, ASPECT);
    gl.uniform1f(u.uPx, 1.2 / this.canvas.width);
    gl.uniform3fv(u.uDepth, look.depth);
    gl.uniform1f(u.uFlat, look.flat);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
