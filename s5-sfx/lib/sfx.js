'use strict';
// Motion sound for the S5 episode pages: no music, only the sound of things moving. Every cue is
// synthesised in an OfflineAudioContext from seeded noise and oscillators, and the moving cues take
// their level, pitch and pan straight from the motion they belong to (the easing curve of a move,
// the camera path, an odometer digit, a scrolling list), so the soundtrack is a function of the
// timeline like the picture: retime the picture and the sound follows. Noise is seeded, so renders
// match; the browser's DSP may round differently from run to run, but only far below −75 dBFS.
//
// An episode passes sfx(s) to S5.run() (or calls S5SFX.track() itself). s holds the instruments
// below; times are seconds on the episode clock, levels are rough peak dBFS, pan is -1 … 1.
(() => {
  const SR = 48000;
  const W = 1920;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const dB = (v) => (v === -Infinity ? 0 : 10 ** (v / 20));

  // Screen x (0 … 1920) to pan, kept inside ±0.8 so nothing sits hard in one ear.
  const pan = (x) => clamp(((x - W / 2) / (W / 2)) * 0.8, -0.8, 0.8);

  function prng(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }

  // Times in [t0, t1] at which g(t) passes k·step + at for a whole k: the moments an odometer digit
  // flips (at 0.5: half way through its roll), a list passes a detent, a playhead passes a year.
  function crossings(g, t0, t1, { at = 0.5, step = 1, dt = 1 / 2000 } = {}) {
    const out = [];
    const band = (v) => Math.floor((v - at) / step);
    let ta = t0, a = g(t0);
    for (let i = 1, n = Math.ceil((t1 - t0) / dt); i <= n; i++) {
      const tb = Math.min(t1, t0 + i * dt), b = g(tb);
      const ka = band(a), kb = band(b);
      for (let k = ka; k !== kb; k += Math.sign(kb - ka)) {
        const dir = Math.sign(kb - ka), th = (dir > 0 ? k + 1 : k) * step + at;
        out.push({ t: ta + ((th - a) / (b - a)) * (tb - ta), dir, value: th });
      }
      ta = tb; a = b;
    }
    return out;
  }

  // ---- sources ---------------------------------------------------------------------------------
  // Seeded noise, two decorrelated channels each, scaled to an RMS of 0.25: pink (Paul Kellet's
  // filter) for air, white for transients.
  function noiseBuffers(ctx, seconds = 8) {
    const n = Math.round(seconds * ctx.sampleRate);
    const pink = ctx.createBuffer(2, n, ctx.sampleRate), white = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const rnd = prng(0x51ab + ch * 7919), p = pink.getChannelData(ch), w = white.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, ep = 0, ew = 0;
      for (let i = 0; i < n; i++) {
        const x = rnd() * 2 - 1;
        b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759;
        b2 = 0.969 * b2 + x * 0.153852; b3 = 0.8665 * b3 + x * 0.3104856;
        b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
        p[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362;
        b6 = x * 0.115926;
        w[i] = x;
        ep += p[i] * p[i]; ew += x * x;
      }
      const gp = 0.25 / Math.sqrt(ep / n), gw = 0.25 / Math.sqrt(ew / n);
      for (let i = 0; i < n; i++) { p[i] *= gp; w[i] *= gw; }
    }
    return { pink, white };
  }

  // The room: a dark hall about 1.9 s long. A few early reflections, then a noise tail whose highs
  // die first (a low-pass that closes along the tail, its loss of level made up so only the colour
  // changes). Energy is normalised to 1; the send and return gains set how much room there is.
  function impulse(ctx, { t60 = 1.9, pre = 0.014, seconds = 2.6 } = {}) {
    const sr = ctx.sampleRate, n = Math.round(seconds * sr);
    const ir = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const rnd = prng(0x7e5 + ch * 104729), d = ir.getChannelData(ch);
      let y = 0, e = 0;
      for (let i = Math.round(pre * sr); i < n; i++) {
        const u = i / sr - pre;
        const fc = 8000 * Math.exp(-u / 0.5) + 1200;
        const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
        y += a * (rnd() * 2 - 1 - y);
        d[i] = (y / Math.sqrt(a / (2 - a))) * 10 ** ((-3 * u) / t60) * Math.min(1, u / 0.006) * 0.55;
      }
      for (let k = 0; k < 9; k++) {
        const at = Math.round((0.009 + rnd() * 0.07) * sr), amp = 0.9 * Math.exp(-k * 0.28) * (rnd() < 0.5 ? -1 : 1);
        d[at] += amp;
      }
      for (let i = 0; i < n; i++) e += d[i] * d[i];
      const g = 1 / Math.sqrt(e);
      for (let i = 0; i < n; i++) d[i] *= g;
    }
    return ir;
  }

  // Smooth bell from 0 up to 1 at peakAt and back to 0; rise > 1 starts slower, fall > 1 ends sooner.
  function bell(n, peakAt, rise = 2, fall = 2) {
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      v[i] = u < peakAt
        ? Math.sin(((u / peakAt) * Math.PI) / 2) ** rise
        : Math.cos((((u - peakAt) / (1 - peakAt)) * Math.PI) / 2) ** fall;
    }
    v[0] = 0; v[n - 1] = 0;
    return v;
  }

  // ---- a session: one render of one soundtrack ---------------------------------------------------
  class Session {
    constructor(ctx, seed) {
      this.ctx = ctx;
      this.rnd = prng(seed);
      Object.assign(this, noiseBuffers(ctx));
      this.cues = [];
      const hp = this.biquad('highpass', 24, 0.7);   // nothing below the sub: no rumble, no DC
      this.master = this.gain(1);
      this.master.connect(hp); hp.connect(ctx.destination);
      this.dry = this.gain(1); this.dry.connect(this.master);
      this.send = this.gain(1);
      const lo = this.biquad('highpass', 200, 0.7);  // keep the lows out of the room, so hits stay tight
      const verb = ctx.createConvolver();
      verb.normalize = false; verb.buffer = impulse(ctx);
      const ret = this.gain(dB(-6));
      this.send.connect(lo); lo.connect(verb); verb.connect(ret); ret.connect(this.master);
    }

    biquad(type, f, q = 0.707) {
      const b = this.ctx.createBiquadFilter();
      b.type = type; b.frequency.value = f; b.Q.value = q;
      return b;
    }
    gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
    shaper(k) {
      // tanh saturation: adds the harmonics that let a 50 Hz sub be heard on a laptop
      const s = this.ctx.createWaveShaper(), n = 2048, c = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
      s.curve = c; s.oversample = '4x';
      return s;
    }
    mono() {
      const g = this.ctx.createGain();
      g.channelCount = 1; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers';
      g.gain.value = 2;                              // the downmix and the centre pan each cost 3 dB
      return g;
    }
    noise(kind, t0, t1, wide = false) {
      const s = this.ctx.createBufferSource();
      s.buffer = kind === 'white' ? this.white : this.pink;
      s.loop = true;
      s.start(t0, this.rnd() * (s.buffer.duration - 1));
      s.stop(t1);
      if (wide) return s;
      const m = this.mono();
      s.connect(m);
      return m;
    }
    osc(type, t0, t1) {
      const o = this.ctx.createOscillator();
      o.type = type; o.start(t0); o.stop(t1);
      return o;
    }
    curve(param, values, t0, dur) {
      param.value = values[0];
      param.setValueCurveAtTime(values, t0, dur);
    }
    // Every cue ends here: panner, dry bus, room send.
    out(node, { pan: p = 0, rv = 0.2, panCurve = null, t0 = 0, dur = 0 } = {}) {
      const pn = this.ctx.createStereoPanner();
      if (panCurve) this.curve(pn.pan, panCurve, t0, dur); else pn.pan.value = clamp(p, -1, 1);
      node.connect(pn); pn.connect(this.dry);
      if (rv > 0) { const s = this.gain(rv); pn.connect(s); s.connect(this.send); }
    }
    log(t, kind, o) { this.cues.push({ t: +t.toFixed(3), kind, label: o.label || '' }); }

    // ---- instruments ---------------------------------------------------------------------------

    // Air moved by something travelling. sample(t) gives its level v (0 … 1), the band centre f (Hz)
    // and pan; the level is smoothed (attack, then a tail after t1) like air that keeps moving.
    air(t0, t1, sample, o = {}) {
      const { db = -18, q = 0.85, rv = 0.25, air = 0.12, body = 0, tail = 0.16, attack = 0.03, wide = false } = o;
      t0 = Math.max(0, t0);
      if (t1 <= t0) return;
      const T = t1 - t0 + tail, n = Math.max(3, Math.ceil(T * 300) + 1), dt = T / (n - 1);
      const lv = new Float32Array(n), fq = new Float32Array(n), pn = new Float32Array(n);
      let y = 0;
      for (let i = 0; i < n; i++) {
        const t = t0 + i * dt, s = sample(Math.min(t, t1));
        const target = t <= t1 ? clamp(s.v) : 0;
        y += (target - y) * (1 - Math.exp(-dt / (target > y ? attack : tail / 3)));
        lv[i] = y; fq[i] = clamp(s.f, 40, 15000); pn[i] = clamp(s.pan ?? 0, -1, 1);
      }
      lv[n - 1] = 0;
      const g = dB(db) * 3.2;                         // a Q≈0.85 band of the noise peaks about 10 dB under it
      const src = this.noise('pink', t0, t0 + T + 0.05, wide), mix = this.gain(1);
      const bp = this.biquad('bandpass', fq[0], q), bg = this.gain();
      this.curve(bp.frequency, fq, t0, T);
      this.curve(bg.gain, lv.map((v) => v * g), t0, T);
      src.connect(bp); bp.connect(bg); bg.connect(mix);
      if (air > 0) {                                 // the silky top, only near the peak
        const hp = this.biquad('highpass', 6000, 0.7), ag = this.gain();
        this.curve(ag.gain, lv.map((v) => v * v * g * air), t0, T);
        src.connect(hp); hp.connect(ag); ag.connect(mix);
      }
      if (body > 0) {                                // weight for big moves
        const lp = this.biquad('lowpass', 240, 0.7), lg = this.gain();
        this.curve(lg.gain, lv.map((v) => v * g * body * 1.8), t0, T);
        src.connect(lp); lp.connect(lg); lg.connect(mix);
      }
      this.out(mix, { rv, panCurve: pn, t0, dur: T });
      this.log(t0, 'air', o);
    }

    // A move along an easing curve, given the same easing the picture uses: loudest where it is
    // fastest, brighter as it speeds up, panned along its path. shift > 1 rises in pitch over the
    // move (something shrinking away), < 1 falls (something growing towards us).
    move(t0, t1, ease, o = {}) {
      const { f = [320, 2200], pan: pp = [0, 0], gamma = 1.5, shift = 1 } = o;
      const h = 1e-3, vel = (u) => Math.abs(ease(clamp(u + h)) - ease(clamp(u - h))) / (clamp(u + h) - clamp(u - h));
      let vmax = 1e-9;
      for (let i = 0; i <= 400; i++) vmax = Math.max(vmax, vel(i / 400));
      this.air(t0, t1, (t) => {
        const u = clamp((t - t0) / (t1 - t0)), v = (vel(u) / vmax) ** gamma, p = ease(u);
        return { v, f: f[0] * (f[1] / f[0]) ** v * shift ** p, pan: lerp(pp[0], pp[1], p) };
      }, o);
    }

    // The camera's own travel: level from how fast the frame slides and zooms (a slow drift is
    // silent), brighter while pushing in, darker while pulling out, leaning where things go.
    camera(t0, t1, cam, o = {}) {
      const { f = [200, 1500], ref = 1500, floor = 80, gamma = 1.4, zoomK = 1100, tilt = 0.6 } = o;
      const h = 1 / 240;
      this.air(t0, t1, (t) => {
        const a = cam(t - h), b = cam(t + h), z = (a.z + b.z) / 2;
        const vx = ((b.x - a.x) / (2 * h)) * z, vy = ((b.y - a.y) / (2 * h)) * z;
        const vz = Math.log(b.z / a.z) / (2 * h);
        const v = clamp((Math.hypot(vx, vy) + Math.abs(vz) * zoomK - floor) / (ref - floor)) ** gamma;
        return { v, f: f[0] * (f[1] / f[0]) ** v * 2 ** (tilt * clamp(vz)), pan: clamp(-vx / 2600, -0.6, 0.6) };
      }, { wide: true, ...o });
    }

    // Impact: a sub that drops in pitch, a punch an octave and a half up, a soft knock in the low mids
    // (what is left of the hit on a phone speaker), a click on top and a dark breath into the room.
    // punch / knock / click / air are dB against the sub.
    hit(t, o = {}) {
      const { db = -6, f = 48, tail = 1.5, punch = -3, knock = -1, click = -7, air = -10, rv = 0.35, pan: p = 0, dark = 0 } = o;
      const bus = this.gain(dB(db) * 0.5);
      const sub = this.osc('sine', t, t + tail + 0.1), sg = this.gain();
      sub.frequency.setValueAtTime(f * 2.4, t);
      sub.frequency.exponentialRampToValueAtTime(f, t + 0.07);
      sub.frequency.exponentialRampToValueAtTime(f * 0.8, t + tail);
      sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(1, t + 0.004); sg.gain.setTargetAtTime(0, t + 0.004, tail / 5);
      const sh = this.shaper(2.2), lp = this.biquad('lowpass', 900, 0.7);
      sub.connect(sg); sg.connect(sh); sh.connect(lp); lp.connect(bus);
      if (punch > -60) {
        const k = this.osc('sine', t, t + 0.4), kg = this.gain();
        k.frequency.setValueAtTime(f * 3.4, t); k.frequency.exponentialRampToValueAtTime(f * 1.7, t + 0.05);
        kg.gain.setValueAtTime(0, t); kg.gain.linearRampToValueAtTime(dB(punch), t + 0.002); kg.gain.setTargetAtTime(0, t + 0.002, 0.045);
        k.connect(kg); kg.connect(bus);
      }
      if (knock > -60) {
        const k = this.osc('sine', t, t + 0.4), kg = this.gain();
        k.frequency.setValueAtTime(f * 4.6, t); k.frequency.exponentialRampToValueAtTime(f * 3, t + 0.06);
        kg.gain.setValueAtTime(0, t); kg.gain.linearRampToValueAtTime(dB(knock - 6), t + 0.002); kg.gain.setTargetAtTime(0, t + 0.002, 0.05);
        const n = this.noise('white', t, t + 0.3), bp = this.biquad('bandpass', dark ? 560 : 820, 0.9), ng = this.gain();
        ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(dB(knock) * 5, t + 0.001); ng.gain.setTargetAtTime(0, t + 0.001, 0.036);
        k.connect(kg); kg.connect(bus);
        n.connect(bp); bp.connect(ng); ng.connect(bus);
      }
      if (click > -60) {
        const c = this.noise('white', t, t + 0.08), hp = this.biquad('highpass', dark ? 700 : 2200, 0.7), cg = this.gain();
        const lpc = this.biquad('lowpass', dark ? 3000 : 12000, 0.7);
        cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(dB(click) * 2.4, t + 0.0005); cg.gain.setTargetAtTime(0, t + 0.0005, 0.005);
        c.connect(hp); hp.connect(lpc); lpc.connect(cg); cg.connect(bus);
      }
      if (air > -60) {
        const a = this.noise('pink', t, t + tail, true), lpa = this.biquad('lowpass', dark ? 900 : 1800, 0.7), ag = this.gain();
        lpa.frequency.setValueAtTime(dark ? 900 : 1800, t); lpa.frequency.exponentialRampToValueAtTime(260, t + 0.5);
        ag.gain.setValueAtTime(0, t); ag.gain.linearRampToValueAtTime(dB(air) * 3, t + 0.008); ag.gain.setTargetAtTime(0, t + 0.008, 0.11);
        a.connect(lpa); lpa.connect(ag); ag.connect(bus);
      }
      this.out(bus, { pan: p, rv });
      this.log(t, 'hit', o);
    }

    // A small landing: the same impact, higher, shorter, quieter.
    thud(t, o = {}) {
      this.hit(t, { db: -14, f: 72, tail: 0.42, punch: -4, knock: -2, click: -12, air: -16, rv: 0.25, ...o });
    }

    // A small mechanical tick: a click ringing through two resonances, like a dial detent.
    // double adds a second, lighter click that many seconds later (a detent going in and out).
    tick(t, o = {}) {
      const { db = -26, f = 3000, q = 5, body = -4, pan: p = 0, rv = 0.12, decay = 0.012, double = 0 } = o;
      const bus = this.gain(dB(db) * 12);
      const one = (tt, amp, ff) => {
        const src = this.noise('white', tt, tt + 0.08), ex = this.gain();
        ex.gain.setValueAtTime(0, tt); ex.gain.linearRampToValueAtTime(amp, tt + 0.0004); ex.gain.setTargetAtTime(0, tt + 0.0004, decay / 4);
        const r1 = this.biquad('bandpass', ff, q), r2 = this.biquad('bandpass', ff * 0.42, q * 0.6), r2g = this.gain(dB(body));
        const top = this.biquad('highpass', 7000, 0.7), tg = this.gain(dB(-24));
        src.connect(ex);
        ex.connect(r1); r1.connect(bus);
        ex.connect(r2); r2.connect(r2g); r2g.connect(bus);
        ex.connect(top); top.connect(tg); tg.connect(bus);
      };
      one(t, 1, f);
      if (double) one(t + double, 0.5, f * 1.19);
      this.out(bus, { pan: p, rv });
      this.log(t, 'tick', o);
    }
    ticks(list, o = {}) {
      list.forEach((x, i) => {
        const t = typeof x === 'number' ? x : x.t;
        this.tick(t, typeof o === 'function' ? o(i, x) : o);
      });
    }

    // A struck glass: a glint for something being singled out. Higher partials die sooner.
    ping(t, o = {}) {
      const { db = -24, f = 1760, decay = 0.9, pan: p = 0, rv = 0.45 } = o;
      const partials = o.partials || [[1, 0, 1], [2.005, -11, 0.55], [3.01, -21, 0.35], [4.2, -28, 0.22]];
      const bus = this.gain(dB(db) * 1.05), hp = this.biquad('highpass', 300, 0.7);
      for (const [m, rel, dk] of partials) {
        const s = this.osc('sine', t, t + decay * 2), g = this.gain();
        s.frequency.value = f * m;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(dB(rel), t + 0.003); g.gain.setTargetAtTime(0, t + 0.003, (decay * dk) / 4);
        s.connect(g); g.connect(hp);
      }
      hp.connect(bus);
      this.out(bus, { pan: p, rv });
      this.log(t, 'ping', o);
    }

    // Reverse swell: noise that grows into t1 and stops dead there, so whatever lands at t1 lands harder.
    swell(t0, t1, o = {}) {
      const { db = -24, f = [600, 3600], q = 0.7, pan: p = 0, rv = 0.12, power = 3 } = o;
      t0 = Math.max(0, t0);
      if (t1 <= t0) return;
      const dur = t1 - t0, n = Math.ceil(dur / 0.003) + 1, env = new Float32Array(n), g = dB(db) * 3.2;
      for (let i = 0; i < n - 1; i++) env[i] = (i / (n - 2)) ** power * g;
      const src = this.noise('pink', t0, t1 + 0.05, true), bp = this.biquad('bandpass', f[0], q), eg = this.gain();
      bp.frequency.setValueAtTime(f[0], t0); bp.frequency.exponentialRampToValueAtTime(f[1], t1);
      this.curve(eg.gain, env, t0, dur);
      src.connect(bp); bp.connect(eg);
      this.out(eg, { pan: p, rv });
      this.log(t0, 'swell', o);
    }

    // A pitch dive: a driven sine sliding down along the motion's own easing, felt more than heard.
    drop(t0, t1, o = {}) {
      const { db = -14, f = [150, 42], ease = (u) => u, tail = 0.35, pan: p = 0, rv = 0.08 } = o;
      const T = t1 - t0 + tail, n = Math.ceil(T * 300) + 1, fq = new Float32Array(n), env = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = t0 + (i / (n - 1)) * T, u = clamp((t - t0) / (t1 - t0));
        fq[i] = f[0] * (f[1] / f[0]) ** ease(u);
        env[i] = t <= t1 ? clamp((t - t0) / 0.05) : Math.exp((-(t - t1) / tail) * 5);
      }
      env[n - 1] = 0;
      const s = this.osc('sine', t0, t0 + T + 0.05), g = this.gain(), sh = this.shaper(1.5), lp = this.biquad('lowpass', 420, 0.7);
      this.curve(s.frequency, fq, t0, T);
      this.curve(g.gain, env.map((v) => v * dB(db) * 0.92), t0, T);
      s.connect(sh); sh.connect(lp); lp.connect(g);
      this.out(g, { pan: p, rv });
      this.log(t0, 'drop', o);
    }

    // A fine line being drawn: thin high noise for as long as the stroke runs, panned along it.
    scribe(t0, t1, o = {}) {
      const { db = -32, f = 6500, q = 1.4, pan: pp = [0, 0], rv = 0.1, ease = (u) => u } = o;
      t0 = Math.max(0, t0);
      const dur = t1 - t0, n = Math.max(8, Math.ceil(dur * 300) + 1), env = new Float32Array(n), pn = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        env[i] = Math.min(1, u / 0.12, (1 - u) / 0.2) * (0.8 + 0.2 * this.rnd()) * dB(db) * 4.7;
        pn[i] = lerp(pp[0], pp[1], ease(u));
      }
      env[n - 1] = 0;
      const src = this.noise('white', t0, t1 + 0.05), bp = this.biquad('bandpass', f, q), hp = this.biquad('highpass', 2500, 0.7), g = this.gain();
      this.curve(g.gain, env, t0, dur);
      src.connect(bp); bp.connect(hp); hp.connect(g);
      this.out(g, { rv, panCurve: pn, t0, dur });
      this.log(t0, 'scribe', o);
    }

    // A soft breath of low noise: something dissolving.
    puff(t, o = {}) {
      const { db = -22, dur = 0.4, f = [1600, 280], pan: p = 0, rv = 0.35 } = o;
      const src = this.noise('pink', t, t + dur * 2, true), lp = this.biquad('lowpass', f[0], 0.7), g = this.gain();
      lp.frequency.setValueAtTime(f[0], t); lp.frequency.exponentialRampToValueAtTime(f[1], t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(dB(db) * 2.2, t + 0.025); g.gain.setTargetAtTime(0, t + 0.025, dur / 4);
      src.connect(lp); lp.connect(g);
      this.out(g, { pan: p, rv });
      this.log(t, 'puff', o);
    }

    // A low swell for something coming up out of the dark: no attack, mostly dark air over a pure
    // sub (no harmonics, so it never turns into a note).
    bloom(t0, t1, o = {}) {
      const { db = -22, f = 46, peak = 0.6, air = -6, pan: p = 0, rv = 0.3 } = o;
      t0 = Math.max(0, t0);
      const dur = t1 - t0, env = bell(Math.ceil(dur * 200) + 1, peak, 2, 1.6), g = dB(db) * 0.5;
      const s = this.osc('sine', t0, t1 + 0.05), eg = this.gain(), mix = this.gain(1);
      s.frequency.value = f;
      s.connect(eg);
      this.curve(eg.gain, env.map((v) => v * g), t0, dur);
      eg.connect(mix);
      const n = this.noise('pink', t0, t1 + 0.05, true), nl = this.biquad('lowpass', 900, 0.7), ng = this.gain();
      this.curve(ng.gain, env.map((v) => v * v * g * dB(air) * 3.2), t0, dur);
      n.connect(nl); nl.connect(ng); ng.connect(mix);
      this.out(mix, { pan: p, rv });
      this.log(t0, 'bloom', o);
    }
  }

  // What a score function sees: the instruments plus a few helpers.
  function api(s) {
    const a = { pan, crossings, clamp, lerp };
    for (const k of ['air', 'move', 'camera', 'hit', 'thud', 'tick', 'ticks', 'ping', 'swell', 'drop', 'scribe', 'puff', 'bloom']) {
      a[k] = (...args) => s[k](...args);
    }
    return a;
  }

  // Soft ceiling above −2 dBFS (only the biggest hit should ever reach it), a 3 ms fade in and a
  // 40 ms fade out so the track starts and stops clean on the cut.
  function finish(buf) {
    const n = buf.length, sr = buf.sampleRate, fin = Math.round(0.003 * sr), fout = Math.round(0.04 * sr);
    const knee = dB(-2), top = dB(-0.3);
    let peak = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        let x = d[i];
        const a = Math.abs(x);
        if (a > knee) x = Math.sign(x) * (knee + (top - knee) * Math.tanh((a - knee) / (top - knee)));
        if (i < fin) x *= i / fin;
        if (i >= n - fout) x *= (n - 1 - i) / fout;
        d[i] = x;
        peak = Math.max(peak, Math.abs(x));
      }
    }
    return peak;
  }

  // Render a score to a stereo AudioBuffer of exactly duration seconds.
  async function render(score, duration, { sampleRate = SR, seed = 0x5f5 } = {}) {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(duration * sampleRate), sampleRate });
    const s = new Session(ctx, seed);
    score(api(s));
    const buffer = await ctx.startRendering();
    const peak = finish(buffer);
    return { buffer, cues: s.cues.sort((x, y) => x.t - y.t), peak };
  }

  // ---- files ---------------------------------------------------------------------------------
  // PCM WAV, 24-bit by default (16-bit gets TPDF dither).
  function wav(buffer, bits = 24) {
    const ch = buffer.numberOfChannels, n = buffer.length, bps = bits / 8;
    const v = new DataView(new ArrayBuffer(44 + n * ch * bps));
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n * ch * bps, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * ch * bps, true);
    v.setUint16(32, ch * bps, true); v.setUint16(34, bits, true);
    str(36, 'data'); v.setUint32(40, n * ch * bps, true);
    const data = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
    const rnd = prng(0xd17);
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        const x = clamp(data[c][i], -1, 1);
        if (bits === 24) {
          const q = Math.round(x * 8388607);
          v.setUint8(o, q & 0xff); v.setUint8(o + 1, (q >> 8) & 0xff); v.setUint8(o + 2, (q >> 16) & 0xff);
        } else {
          v.setInt16(o, clamp(Math.round(x * 32767 + rnd() - rnd()), -32768, 32767), true);
        }
        o += bps;
      }
    }
    return new Uint8Array(v.buffer);
  }

  // Encode for the in-page video export. MP4 takes AAC where the browser can encode it, else Opus;
  // WebM takes Opus. Returns null when the browser has no audio encoder for the format.
  async function encode(buffer, format) {
    if (!('AudioEncoder' in window)) return null;
    const tries = format === 'mp4'
      ? [['aac', 'mp4a.40.2', 256000], ['opus', 'opus', 192000]]
      : [['A_OPUS', 'opus', 192000]];
    const { sampleRate, numberOfChannels, length } = buffer;
    for (const [mux, codec, bitrate] of tries) {
      const cfg = { codec, sampleRate, numberOfChannels, bitrate };
      try {
        if (!(await AudioEncoder.isConfigSupported(cfg)).supported) continue;
      } catch { continue; }
      const chunks = [];
      let failed = null;
      const enc = new AudioEncoder({ output: (chunk, meta) => chunks.push([chunk, meta]), error: (e) => { failed = e; } });
      enc.configure(cfg);
      const step = 4800, chans = [...Array(numberOfChannels)].map((_, c) => buffer.getChannelData(c));
      for (let i = 0; i < length && !failed; i += step) {
        const m = Math.min(step, length - i), data = new Float32Array(m * numberOfChannels);
        chans.forEach((d, c) => data.set(d.subarray(i, i + m), c * m));
        const ad = new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: m, numberOfChannels, timestamp: Math.round((i * 1e6) / sampleRate), data });
        enc.encode(ad);
        ad.close();
      }
      try { await enc.flush(); } catch (e) { failed = failed || e; }
      enc.close();
      if (!failed && chunks.length) return { mux, codec, sampleRate, numberOfChannels, chunks };
    }
    return null;
  }

  function base64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ---- live preview --------------------------------------------------------------------------
  // Plays the rendered track from any point. time() is where the listener is (output latency taken
  // off), so the preview can run its picture off the sound and never drift. Asked to play before the
  // track is rendered or the output is running, it starts as soon as both are, at the time it is by then.
  class Player {
    constructor() { this.buffer = null; this.ctx = null; this.src = null; this.want = null; this.token = 0; }
    play(t) {
      this.stop();
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) this.ctx = new AC({ latencyHint: 'interactive' });   // made inside the click, for autoplay rules
      this.want = { t, asked: performance.now(), token: this.token };
      this.start(true);
    }
    start(retry) {
      const w = this.want;
      if (!w || w.token !== this.token || !this.buffer || !this.ctx) return;
      if (this.ctx.state !== 'running') {
        if (retry) this.ctx.resume().then(() => this.start(false), () => {});
        return;
      }
      this.want = null;
      const offset = w.t + (performance.now() - w.asked) / 1000;
      if (offset >= this.buffer.duration) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.connect(this.ctx.destination);
      this.t0 = this.ctx.currentTime; this.offset = offset;
      src.start(this.t0, offset);
      this.src = src;
    }
    load(buffer) { this.buffer = buffer; this.start(true); }
    stop() {
      this.token++;
      this.want = null;
      if (this.src) {
        try { this.src.stop(); } catch { /* already stopped */ }
        this.src.disconnect();
        this.src = null;
      }
    }
    time() {
      if (!this.src || this.ctx.state !== 'running') return null;
      const c = this.ctx, lat = (c.outputLatency || 0) + (c.baseLatency || 0);
      return this.offset + Math.max(0, c.currentTime - this.t0 - lat);
    }
  }

  // One episode's soundtrack: rendered on first use (reading .ready starts it), then played, saved
  // as WAV or encoded for export.
  function track(score, duration) {
    const player = new Player();
    let rendered = null;
    const ready = () => (rendered ||= render(score, duration).then((r) => { player.load(r.buffer); return r; }));
    return {
      duration, player,
      get ready() { return ready(); },
      async wav(bits = 24) { return wav((await ready()).buffer, bits); },
      async encoded(format) { return encode((await ready()).buffer, format); },
      async base64(bits = 24) { return base64(wav((await ready()).buffer, bits)); },
    };
  }

  window.S5SFX = { SR, pan, crossings, render, wav, encode, base64, track, Player };
})();
