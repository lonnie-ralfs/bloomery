// Tiny synthesized sound kit (no audio files): looping noise beds + one-shot bursts.
export class Sfx {
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this.loops = {
      bellows: this._loop(this.white, 'bandpass', 450, 0.8),
      fire: this._loop(this.brown, 'lowpass', 350, 0.6),
      water: this._loop(this.white, 'bandpass', 1700, 0.5),
      slag: this._loop(this.white, 'highpass', 2800, 0.6),
      mud: this._loop(this.brown, 'bandpass', 320, 1.2),
      wind: this._loop(this.brown, 'lowpass', 220, 0.4),
    };
    this.loop('wind', 0.05);
  }
  _loop(buf, type, freq, Q) {
    const ctx = this.ctx, src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    return { f, g };
  }
  loop(name, vol, freq) {
    if (!this.ctx) return;
    const l = this.loops[name], t = this.ctx.currentTime;
    l.g.gain.setTargetAtTime(Math.max(0, vol), t, 0.06);
    if (freq) l.f.frequency.setTargetAtTime(freq, t, 0.08);
  }
  burst({ dur = 0.2, vol = 0.4, type = 'lowpass', freq = 800, Q = 0.7, attack = 0.005, tone = 0, toneEnd = 0, toneType = 'sine', toneVol }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.white;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    if (tone) {
      const o = ctx.createOscillator(); o.type = toneType; o.frequency.setValueAtTime(tone, t);
      if (toneEnd) o.frequency.exponentialRampToValueAtTime(toneEnd, t + dur);
      const og = ctx.createGain(); og.gain.setValueAtTime(toneVol ?? vol, t); og.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(og); og.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  play(name, k = 1) {
    const P = {
      dig: { dur: 0.25, vol: 0.45 * k, freq: 320, tone: 95, toneEnd: 50, toneVol: 0.35 * k },
      squelch: { dur: 0.2, vol: 0.32 * k, type: 'bandpass', freq: 650, Q: 2.2, attack: 0.02 },
      straw: { dur: 0.4, vol: 0.22 * k, type: 'highpass', freq: 2600, attack: 0.03 },
      splash: { dur: 0.55, vol: 0.35 * k, type: 'bandpass', freq: 1200, Q: 0.8, attack: 0.02 },
      pour: { dur: 0.6, vol: 0.28 * k, type: 'bandpass', freq: 900, Q: 0.6, attack: 0.06 },
      coal: { dur: 0.3, vol: 0.32 * k, type: 'bandpass', freq: 2100, Q: 1.4, tone: 700, toneEnd: 500, toneVol: 0.05 * k },
      thunk: { dur: 0.2, vol: 0.45 * k, freq: 420, tone: 150, toneEnd: 70, toneVol: 0.45 * k },
      crack: { dur: 0.28, vol: 0.45 * k, type: 'highpass', freq: 1400, tone: 320, toneEnd: 110, toneVol: 0.25 * k },
      clink: { dur: 0.45, vol: 0.08 * k, type: 'highpass', freq: 4000, tone: 1850, toneEnd: 1780, toneType: 'triangle', toneVol: 0.22 * k },
      hiss: { dur: 1.3, vol: 0.22 * k, type: 'highpass', freq: 3400, attack: 0.06 },
      tick: { dur: 0.06, vol: 0.12 * k, type: 'highpass', freq: 3000 },
      clang: { dur: 0.9, vol: 0.1 * k, type: 'highpass', freq: 3200, tone: 1320, toneEnd: 1300, toneType: 'triangle', toneVol: 0.28 * k },
      hit: { dur: 0.22, vol: 0.45 * k, freq: 700, tone: 230, toneEnd: 110, toneVol: 0.4 * k },
      whoosh: { dur: 0.25, vol: 0.18 * k, type: 'bandpass', freq: 700, Q: 0.6, attack: 0.05 },
    }[name];
    if (P) this.burst(P);
  }
}
