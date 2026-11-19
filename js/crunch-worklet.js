// Foil crunch synthesizer.
// Crinkling foil is a stream of tiny, irregular clicks: each one a short burst
// of noise ringing through a loose band-pass. They arrive in clusters (the foil
// gives way in little avalanches), a few are lower and fatter "crunches", and
// under it all the tip scratches faintly across the metal.

class FoilCrunch extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'speed', defaultValue: 0, minValue: 0, maxValue: 8, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this.voices = [];
    for (let i = 0; i < 20; i++) {
      this.voices.push({ env: 0, decay: 0, amp: 0, g: 0, q: 1, low: 0, band: 0, pl: 0.7, pr: 0.7 });
    }
    this.next = 0;
    this.burst = 0;
    this.frame = 0;
    this.pending = [];
    this.hp = 0;
    this.prevNoise = 0;
    this.flutter = 0;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'tap') this.tap(e.data.strength ?? 1);
    };
  }

  // A cluster of clicks, e.g. when the tip first presses down.
  tap(strength) {
    const n = Math.max(1, Math.round(strength * (2 + Math.random() * 6)));
    for (let i = 0; i < n; i++) {
      this.pending.push({
        at: this.frame + Math.floor(Math.random() * Math.random() * sampleRate * 0.06),
        big: Math.random() < 0.15 * strength,
      });
    }
    this.pending.sort((a, b) => a.at - b.at);
  }

  trigger(big) {
    const v = this.voices[this.next];
    this.next = (this.next + 1) % this.voices.length;
    let f, tau, amp, Q;
    if (big) {
      f = 900 + Math.random() * 1800;
      tau = 0.002 + Math.random() * 0.006;
      amp = 0.12 + Math.random() * 0.18;
      Q = 0.8 + Math.random() * 0.9;
    } else {
      f = 1500 * Math.pow(4.5, Math.random());
      tau = 0.0004 + Math.random() * Math.random() * 0.0025;
      amp = 0.02 + Math.pow(Math.random(), 4) * 0.35;
      Q = 0.8 + Math.random() * 2.2;
    }
    f = Math.min(f, sampleRate * 0.14);
    v.g = 2 * Math.sin(Math.PI * f / sampleRate);
    v.q = 1 / Q;
    v.decay = Math.exp(-1 / (tau * sampleRate));
    v.env = 1;
    v.amp = amp;
    v.low = 0;
    v.band = 0;
    const pan = 0.2 + Math.random() * 0.6;
    v.pl = Math.cos(pan * Math.PI / 2);
    v.pr = Math.sin(pan * Math.PI / 2);
  }

  process(_inputs, outputs, params) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    const n = L.length;
    const sr = sampleRate;
    const intensity = Math.min(params.speed[0], 4);

    for (let i = 0; i < n; i++) {
      const t = this.frame + i;
      while (this.pending.length && this.pending[0].at <= t) this.trigger(this.pending.shift().big);

      if (intensity > 0.01) {
        if (this.burst > 0) this.burst--;
        else if (Math.random() < intensity * 3 / sr) this.burst = Math.floor(sr * (0.004 + Math.random() * 0.015));
        const rate = intensity * (this.burst > 0 ? 500 : 70);
        if (Math.random() < rate / sr) this.trigger(Math.random() < 0.015);
      }

      let l = 0, r = 0;
      for (let k = 0; k < this.voices.length; k++) {
        const v = this.voices[k];
        if (v.env < 1e-4) continue;
        const x = (Math.random() * 2 - 1) * v.env * v.amp;
        v.env *= v.decay;
        v.low += v.g * v.band;
        const hi = x - v.low - v.q * v.band;
        v.band += v.g * hi;
        l += v.band * v.pl;
        r += v.band * v.pr;
      }

      // scratch of the tip: high-passed noise with a little flutter
      const w = Math.random() * 2 - 1;
      this.hp = 0.78 * (this.hp + w - this.prevNoise);
      this.prevNoise = w;
      this.flutter = this.flutter * 0.996 + (Math.random() * 2 - 1) * 0.02;
      const bed = this.hp * Math.min(intensity, 1.5) * 0.005 * (1 + this.flutter * 3);

      L[i] = Math.tanh(l + bed) * 0.8;
      R[i] = Math.tanh(r + bed) * 0.8;
    }
    this.frame += n;
    return true;
  }
}

registerProcessor('foil-crunch', FoilCrunch);
