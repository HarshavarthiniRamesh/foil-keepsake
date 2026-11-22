// Main-thread side of the crunch sound. Audio can only start after a user
// gesture, so unlock() is called from the first pointerdown / tap.

// A chocolate wrapper is a tiny piece of foil: keep it close and quiet.
const VOLUME = 0.35;

export class Crunch {
  constructor() {
    this.enabled = true;
    this.ready = null;
    this.ctx = null;
    this.node = null;
    this.speed = null;
    this.out = null;
  }

  unlock() {
    if (this.ready) {
      if (this.ctx?.state === 'suspended') this.ctx.resume();
      return this.ready;
    }
    // No AudioWorklet (e.g. a page opened over plain http on a phone): stay
    // silent rather than get in the way of pressing.
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = null;
    try { ctx = AC && window.AudioWorkletNode ? new AC({ latencyHint: 'interactive' }) : null; } catch { ctx = null; }
    if (!ctx?.audioWorklet) {
      ctx?.close?.();
      this.ready = Promise.resolve();
      return this.ready;
    }
    this.ctx = ctx;
    this.ready = this.ctx.audioWorklet
      .addModule(new URL('./crunch-worklet.js', import.meta.url))
      .then(() => {
        this.node = new AudioWorkletNode(this.ctx, 'foil-crunch', {
          numberOfInputs: 0,
          outputChannelCount: [2],
        });
        this.speed = this.node.parameters.get('speed');
        this.out = this.ctx.createGain();
        this.out.gain.value = this.enabled ? VOLUME : 0;
        this.node.connect(this.out).connect(this.ctx.destination);
      })
      .catch((err) => console.warn('Crunch sound unavailable:', err));
    return this.ready;
  }

  // speed is roughly "sheet widths per second" of tip movement
  setSpeed(v) {
    if (!this.speed) return;
    this.speed.setTargetAtTime(Math.min(Math.max(v, 0), 2), this.ctx.currentTime, 0.012);
  }

  tap(strength = 1) {
    if (this.node && this.enabled) this.node.port.postMessage({ type: 'tap', strength });
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.out) this.out.gain.setTargetAtTime(on ? VOLUME : 0, this.ctx.currentTime, 0.02);
  }
}
