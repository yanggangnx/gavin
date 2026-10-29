'use strict';
// Sound effects for the episode pages, made from noise and sine waves: no samples and no music.
// An episode lists cues, [kind, time, options]; render() mixes them offline into one stereo 48 kHz
// buffer through a shared dark reverb, identical on every run. The preview plays that buffer in
// sync with the picture, the in-page export muxes it under the video, and render.mjs saves it as a
// 24-bit WAV for the masters.
(() => {
  const SR = 48000;
  const PEAK = 0.708;                // the finished mix peaks at -3 dBFS

  // Seeded PRNG (mulberry32), so the noise, and therefore the mix, is the same every time.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Stereo noise with independent channels; pink is Paul Kellet's economy filter.
  function noise(ctx, seconds, seed, pink = false) {
    const n = Math.round(seconds * SR), buf = ctx.createBuffer(2, n, SR);
    for (let ch = 0; ch < 2; ch++) {
      const r = rng(seed * 2 + ch + 1), d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < n; i++) {
        const w = r() * 2 - 1;
        if (!pink) { d[i] = w; continue; }
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
    }
    return buf;
  }

  // A dark room: decaying noise that loses its highs as it fades, after a short pre-delay (RT60 ≈ 2.6 s).
  function room(ctx, seed) {
    const n = Math.round(2.8 * SR), pre = Math.round(0.025 * SR), buf = ctx.createBuffer(2, n, SR);
    for (let ch = 0; ch < 2; ch++) {
      const r = rng(seed + ch), d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const k = (i - pre) / SR;
        lp += (0.18 + 0.6 * Math.exp(-k / 0.3)) * ((r() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-k / 0.38);
      }
    }
    return buf;
  }

  // ---- building blocks -----------------------------------------------------------------------
  function source(io, buf, t, dur, r) {
    const s = io.ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.start(t, r() * (buf.duration - 0.5), dur + 0.05);
    return s;
  }
  function filter(io, type, freq, q = 0.707) {
    const f = io.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }
  // Attack to peak, then an exponential fall to silence.
  function pluck(io, t, peak, attack, decay) {
    const g = io.ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * 1e-4, 1e-6), t + attack + decay);
    g.gain.setValueAtTime(0, t + attack + decay + 0.01);
    return g;
  }
  // Any shape: f(u) for u in 0..1 over [t, t + dur], sampled at 200 Hz.
  function shaped(io, t, dur, f) {
    const g = io.ctx.createGain(), n = Math.max(2, Math.ceil(dur * 200)), curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = f(i / (n - 1));
    g.gain.value = 0;
    g.gain.setValueCurveAtTime(curve, t, dur);
    return g;
  }
  // Out to the mix: through a panner to the dry bus, and a share of it to the reverb.
  function out(io, node, t, pan, send) {
    const p = io.ctx.createStereoPanner();
    if (Array.isArray(pan)) {
      p.pan.setValueAtTime(pan[0], t);
      p.pan.linearRampToValueAtTime(pan[1], t + pan[2]);
    } else p.pan.value = pan;
    node.connect(p);
    p.connect(io.dry);
    if (send > 0) { const s = io.ctx.createGain(); s.gain.value = send; p.connect(s); s.connect(io.wet); }
  }
  const chain = (...nodes) => { for (let i = 1; i < nodes.length; i++) nodes[i - 1].connect(nodes[i]); return nodes[nodes.length - 1]; };

  // ---- the sounds ----------------------------------------------------------------------------
  const KINDS = {
    // Room tone under everything: a faint, wide, dark hiss, faded in and out.
    air(io, t, o, r) {
      const until = o.until ?? io.duration, dur = until - t, g = o.gain ?? 0.02;
      const env = shaped(io, t, dur, (u) => g * Math.min(1, u * dur / 0.8, (1 - u) * dur / 1.2));
      out(io, chain(source(io, io.PN, t, dur, r), filter(io, 'lowpass', 700), filter(io, 'highpass', 45), env), t, 0, 0);
    },
    // Air moving past: a band of noise sweeping in pitch and across the stereo field.
    whoosh(io, t, o, r) {
      const dur = o.dur ?? 0.8, g = o.gain ?? 0.3, from = o.from ?? 250, to = o.to ?? 1800;
      const bp = filter(io, 'bandpass', from, o.q ?? 1.1);
      bp.frequency.setValueAtTime(from, t);
      bp.frequency.exponentialRampToValueAtTime(to, t + dur);
      const env = shaped(io, t, dur, (u) => g * Math.sin(Math.PI * Math.pow(u, 1.4)) ** 2);   // swells, peaks at 60 %
      out(io, chain(source(io, io.WN, t, dur, r), bp, filter(io, 'lowpass', 7000), env), t, o.pan ?? [-0.35, 0.35, dur], o.send ?? 0.45);
    },
    // A build into a hit: noise rising in pitch and level, cut at the end.
    riser(io, t, o, r) {
      const dur = o.dur ?? 1, g = o.gain ?? 0.18;
      const bp = filter(io, 'bandpass', 350, 1.6);
      bp.frequency.setValueAtTime(350, t);
      bp.frequency.exponentialRampToValueAtTime(o.to ?? 3200, t + dur);
      const env = shaped(io, t, dur, (u) => g * u ** 3 * Math.min(1, (1 - u) * dur / 0.03));
      out(io, chain(source(io, io.WN, t, dur, r), bp, env), t, o.pan ?? 0, 0.35);
    },
    // The cinematic hit for a number that matters: a falling sub, a dark body and a short crack, in the room.
    hit(io, t, o, r) {
      const g = o.gain ?? 0.9, low = o.low ?? 42, tail = o.tail ?? 1.6, pan = o.pan ?? 0;
      const osc = io.ctx.createOscillator();
      osc.frequency.setValueAtTime(low * 2.4, t);
      osc.frequency.exponentialRampToValueAtTime(low, t + 0.09);
      osc.start(t); osc.stop(t + tail + 0.1);
      out(io, chain(osc, pluck(io, t, g, 0.004, tail)), t, 0, 0.12);
      out(io, chain(source(io, io.PN, t, 0.6, r), filter(io, 'lowpass', 380), pluck(io, t, g * 0.9, 0.002, 0.35)), t, pan, 0.6);
      out(io, chain(source(io, io.WN, t, 0.1, r), filter(io, 'highpass', 2500), pluck(io, t, g * 0.16, 0.001, 0.05)), t, pan, 0.5);
    },
    // A softer landing: something set down on a table.
    thump(io, t, o, r) {
      const g = o.gain ?? 0.4, pan = o.pan ?? 0;
      const osc = io.ctx.createOscillator();
      osc.frequency.setValueAtTime(90, t);
      osc.frequency.exponentialRampToValueAtTime(46, t + 0.06);
      osc.start(t); osc.stop(t + 0.5);
      out(io, chain(osc, pluck(io, t, g, 0.003, 0.32)), t, pan, 0.2);
      out(io, chain(source(io, io.PN, t, 0.3, r), filter(io, 'lowpass', 300), pluck(io, t, g * 0.6, 0.002, 0.12)), t, pan, 0.3);
    },
    // A small, dry tick for text and marks.
    tick(io, t, o, r) {
      const g = o.gain ?? 0.07;
      out(io, chain(source(io, io.WN, t, 0.06, r), filter(io, 'bandpass', o.tone ?? 3200, 5), pluck(io, t, g, 0.0008, 0.022)), t, o.pan ?? 0, o.send ?? 0.18);
    },
    // An SD card going home: a light push click, then the spring latch and a small knock.
    latch(io, t, o, r) {
      const g = o.gain ?? 0.16, pan = o.pan ?? 0;
      KINDS.tick(io, t, { gain: g * 0.55, tone: 4300, pan, send: 0.1 }, r);
      KINDS.tick(io, t + 0.068, { gain: g, tone: 2300, pan, send: 0.15 }, r);
      out(io, chain(source(io, io.WN, t + 0.068, 0.1, r), filter(io, 'bandpass', 950, 3), pluck(io, t + 0.068, g * 0.7, 0.001, 0.045)), t, pan, 0.12);
      const osc = io.ctx.createOscillator();
      osc.frequency.value = 170;
      osc.start(t + 0.068); osc.stop(t + 0.2);
      out(io, chain(osc, pluck(io, t + 0.068, g * 0.45, 0.002, 0.06)), t, pan, 0.05);
    },
    // A camera body shaking in the hand: low rumble and some handling noise, following level(t).
    rumble(io, t, o, r) {
      const until = o.until ?? io.duration, dur = until - t, g = o.gain ?? 0.2, level = o.level ?? (() => 1);
      const at = (u) => level(t + u * dur);
      out(io, chain(source(io, io.PN, t, dur, r), filter(io, 'lowpass', 150, 0.8), shaped(io, t, dur, (u) => g * at(u))), t, o.pan ?? 0, 0.08);
      out(io, chain(source(io, io.WN, t, dur, r), filter(io, 'bandpass', 700, 1.5), shaped(io, t, dur, (u) => g * 0.07 * at(u) ** 2)), t, o.pan ?? 0, 0.1);
    },
    // The stabiliser answering the shake: a faint, high, mechanical whisper.
    servo(io, t, o, r) {
      const until = o.until ?? io.duration, dur = until - t, g = o.gain ?? 0.03, level = o.level ?? (() => 1);
      out(io, chain(source(io, io.WN, t, dur, r), filter(io, 'bandpass', o.tone ?? 2600, 6), shaped(io, t, dur, (u) => g * level(t + u * dur))), t, o.pan ?? 0, 0.05);
    },
  };

  // ---- mix -----------------------------------------------------------------------------------
  async function render(cues, duration) {
    const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR), SR);
    const dry = ctx.createGain(), wet = ctx.createGain(), verb = ctx.createConvolver(), glue = ctx.createDynamicsCompressor();
    verb.normalize = true; verb.buffer = room(ctx, 7);
    wet.gain.value = 0.5;
    glue.threshold.value = -18; glue.knee.value = 10; glue.ratio.value = 3; glue.attack.value = 0.005; glue.release.value = 0.25;
    wet.connect(verb); verb.connect(glue); dry.connect(glue); glue.connect(ctx.destination);
    const io = { ctx, dry, wet, duration, WN: noise(ctx, 6, 11), PN: noise(ctx, 6, 23, true) };
    cues.forEach(([kind, t, o], i) => {
      if (!KINDS[kind]) throw new Error(`unknown sound "${kind}"`);
      KINDS[kind](io, t, o || {}, rng(1000 + i));
    });
    const buf = await ctx.startRendering();
    // Peak-normalise, then short fades so the file starts and ends on silence.
    const L = buf.getChannelData(0), R = buf.getChannelData(1), n = L.length;
    let peak = 1e-9;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const k = PEAK / peak, fin = Math.round(0.01 * SR), fout = Math.round(0.08 * SR);
    for (let i = 0; i < n; i++) {
      const f = Math.min(1, i / fin, (n - 1 - i) / fout);
      L[i] *= k * f; R[i] *= k * f;
    }
    return buf;
  }

  // 24-bit PCM WAV, interleaved.
  function wav(buf) {
    const n = buf.length, ch = buf.numberOfChannels, bytes = n * ch * 3;
    const out = new Uint8Array(44 + bytes), v = new DataView(out.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * 3, true); v.setUint16(32, ch * 3, true); v.setUint16(34, 24, true);
    str(36, 'data'); v.setUint32(40, bytes, true);
    const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-8388608, Math.min(8388607, Math.round(data[c][i] * 8388607)));
        out[o++] = s & 255; out[o++] = (s >> 8) & 255; out[o++] = (s >> 16) & 255;
      }
    }
    return out;
  }

  window.S5_SOUND = { SR, KINDS: Object.keys(KINDS), render, wav };
})();
