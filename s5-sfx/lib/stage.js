'use strict';
// Shared engine for the S5 episode pages. An episode page loads this file, takes the helpers off
// window.S5, defines its shots and calls S5.run(). Every frame is a pure function of t:
// renderInto() redraws the canvas from scratch and the grain is seeded, so any frame can be
// redrawn exactly, at any resolution. This file also builds the preview player, the export
// panel and the window.__motion hook that render.mjs drives.
(() => {
  const W = 1920, H = 1080, FPS = 24;
  const LB = Math.round((H - W / 2.39) / 2);     // 2.39:1 letterbox bar height, 138 px
  const ML = 150;                                // left margin; layouts hang off it

  const GRAIN_K = 4;                             // grain adds 0..2K levels, so the background sits K below its look
  const C = {
    bg: '#080807', rule: '#2e2d2a',               // bg reads as #0c0c0b once the grain's mean is added
    ink: '#ecebe6', ink2: '#a5a39c', ink3: '#6b6964',
    accent: '#b3352b',                            // one use per episode
  };
  const F = {
    serif: '"S5 Serif", "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif',
    sans: '"S5 Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  };

  // ---- options (URL flags; the preview checkboxes flip the same object) -----------------------
  const params = new URLSearchParams(location.search);
  const flag = (k, d) => (params.has(k) ? params.get(k) !== '0' : d);
  const OPT = {
    render: params.has('render'),
    greybox: flag('greybox', false),
    guide: flag('guide', false),
    letterbox: flag('letterbox', true),
    grain: flag('grain', true),
    mb: flag('mb', false),
  };

  // ---- helpers -------------------------------------------------------------------------------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    lin: (p) => p,
    out3: (p) => 1 - (1 - p) ** 3,
    inout3: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  };
  const P = (t, a, b, e = E.inout3) => e(clamp((t - a) / (b - a)));
  const fmt = (n) => Math.round(n).toLocaleString('en-US');

  function mix(a, b, p) {
    const h = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const x = h(a), y = h(b);
    return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], p))).join(',')})`;
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function font(c, size, weight, family) { c.font = `${weight} ${size}px ${family}`; }

  function txt(c, s, x, y, o = {}) {
    if (!s || (o.alpha ?? 1) <= 0) return;
    c.save();
    font(c, o.size || 24, o.weight || 400, o.family || F.sans);
    c.fillStyle = o.color || C.ink;
    c.globalAlpha *= o.alpha ?? 1;
    c.textAlign = o.align || 'left';
    c.textBaseline = 'alphabetic';
    if (o.blur > 0.05) c.filter = `blur(${o.blur}px)`;
    c.fillText(s, x, y);
    c.restore();
  }

  function rule(c, x0, x1, y, alpha = 1, color = C.rule) {
    if (alpha <= 0) return;
    c.save();
    c.globalAlpha *= alpha;
    c.fillStyle = color;
    c.fillRect(x0, y, x1 - x0, 1);
    c.restore();
  }

  function camera(c, s, dx = 0, dy = 0) {
    c.translate(W / 2 + dx, H / 2 + dy); c.scale(s, s); c.translate(-W / 2, -H / 2);
  }

  // One odometer digit. g is a real number of "digit steps": floor(g) sits in place shifted up by
  // the fraction, the next digit comes in from below. Rising g rolls up, falling g rolls down.
  const ROLL_BUF = makeCanvas(8, 8);
  function rollDigit(c, x, by, size, w, g, o) {
    const k = Math.floor(g + 1e-9), f = g - k;
    const gap = size * 0.92, top = size * 0.86, hh = size * 1.02, ww = w + 16;
    const m = c.getTransform(), sc = Math.hypot(m.a, m.b);
    const bw = Math.ceil(ww * sc), bh = Math.ceil(hh * sc);
    if (ROLL_BUF.width < bw || ROLL_BUF.height < bh) { ROLL_BUF.width = bw; ROLL_BUF.height = bh; }
    const b = ROLL_BUF.getContext('2d');
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, ROLL_BUF.width, ROLL_BUF.height);
    b.setTransform(sc, 0, 0, sc, 0, 0);
    txt(b, String(((k % 10) + 10) % 10), 8, top - f * gap, o);
    if (f > 0.001) txt(b, String((((k + 1) % 10) + 10) % 10), 8, top + (1 - f) * gap, o);
    const mask = b.createLinearGradient(0, 0, 0, hh);
    mask.addColorStop(0, 'rgba(0,0,0,0)'); mask.addColorStop(0.16, '#000');
    mask.addColorStop(0.86, '#000'); mask.addColorStop(1, 'rgba(0,0,0,0)');
    b.globalCompositeOperation = 'destination-in';
    b.fillStyle = mask; b.fillRect(0, 0, ww, hh);
    b.globalCompositeOperation = 'source-over';
    c.drawImage(ROLL_BUF, 0, 0, bw, bh, x - 8, by - top, ww, hh);
  }

  // ---- assets --------------------------------------------------------------------------------
  const IMG = {};
  let GRAIN = [];

  function buildGrain() {
    // Four seeded noise tiles; the frame number picks one, so grain moves but stays reproducible.
    // Values are 0..2K levels, added on top of the frame: an even dither however dark the picture.
    let s = 0x5eed5;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    GRAIN = [0, 1, 2, 3].map(() => {
      const t = makeCanvas(256, 256), g = t.getContext('2d');
      const im = g.createImageData(256, 256);
      for (let i = 0; i < im.data.length; i += 4) {
        const v = Math.round(clamp(GRAIN_K + (rnd() + rnd() + rnd() - 1.5) * 2 * GRAIN_K * 0.9, 0, 2 * GRAIN_K));
        im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
      }
      g.putImageData(im, 0, 0);
      return t;
    });
  }

  async function loadAssets(images) {
    if (window.S5_FONTS) {
      await Promise.all(window.S5_FONTS.map(async (f) => {
        const face = new FontFace(f.family, `url(${f.src})`, { weight: f.weight });
        document.fonts.add(await face.load());
      }));
    }
    await document.fonts.ready;
    await Promise.all(Object.entries(images || {}).map(([id, src]) => new Promise((res) => {
      const im = new Image();
      im.onload = () => { IMG[id] = im; res(); };
      im.onerror = res;
      im.src = src;
    })));
    buildGrain();
  }

  // ---- export helpers --------------------------------------------------------------------------
  const CRC_TABLE = (() => {
    const tab = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      tab[n] = c >>> 0;
    }
    return tab;
  })();
  function crc32(d) {
    let c = 0xffffffff;
    for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // Minimal store-only ZIP (PNGs are already compressed). Fallback when folders can't be picked.
  class ZipWriter {
    constructor() { this.parts = []; this.central = []; this.offset = 0; this.count = 0; }
    add(name, data) {
      const nb = new TextEncoder().encode(name), crc = crc32(data);
      if (this.offset + data.length > 0xfff00000) throw new Error('ZIP 超过 4 GB，请改用选择文件夹导出，或降低分辨率/帧率');
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, nb.length, true);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(14, 0x21, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, nb.length, true); cd.setUint32(42, this.offset, true);
      this.parts.push(h.buffer, nb, data);
      this.central.push(cd.buffer, nb);
      this.offset += 30 + nb.length + data.length;
      this.count++;
    }
    finish() {
      const size = this.central.reduce((s, b) => s + b.byteLength, 0);
      const e = new DataView(new ArrayBuffer(22));
      e.setUint32(0, 0x06054b50, true); e.setUint16(8, this.count, true); e.setUint16(10, this.count, true);
      e.setUint32(12, size, true); e.setUint32(16, this.offset, true);
      return new Blob([...this.parts, ...this.central, e.buffer], { type: 'application/zip' });
    }
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  // H.264 levels, lowest first: 4.0, 4.2, 5.1, 5.2, with the macroblock rate each allows.
  const AVC = [['avc1.640028', 245760], ['avc1.64002a', 522240], ['avc1.640033', 983040], ['avc1.640034', 2073600]];

  async function pickConfig(format, w, h, fps, bitrate) {
    const mbps = Math.ceil(w / 16) * Math.ceil(h / 16) * fps;
    const codecs = format === 'mp4'
      ? AVC.filter(([, max]) => max >= mbps).map(([c]) => c)
      : ['vp09.00.40.08', 'vp09.00.41.08', 'vp09.00.50.08', 'vp09.00.51.08'];
    for (const codec of codecs) {
      const cfg = { codec, width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality', bitrateMode: 'variable' };
      if (format === 'mp4') cfg.avc = { format: 'avc' };
      try {
        if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg;
      } catch { /* try the next one */ }
    }
    return null;
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  function timecode(f) {
    const ff = f % FPS, s = Math.floor(f / FPS);
    return `00:00:${String(s).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
  }

  // ---- page ------------------------------------------------------------------------------------
  const CSS = `
    :root { --bg: #0a0a09; --panel: #141413; --line: #2c2b28; --ink: #ecebe6; --ink-2: #a5a39c; --ink-3: #6b6964; }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.6 "PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif; }
    #app { max-width: 1280px; margin: 0 auto; padding: 24px 16px 48px; }
    #viewport { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; }
    #stage { width: 100%; height: 100%; display: block; }
    .bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 18px; margin-top: 14px; }
    button, select, input[type=number] { background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; font: inherit; }
    button { cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: default; }
    input[type=number] { width: 5.5em; }
    #tc { font-variant-numeric: tabular-nums; color: var(--ink-2); min-width: 8.5em; }
    #scrub-wrap { position: relative; flex: 1 1 420px; height: 34px; }
    #scrub { width: 100%; margin: 0; position: absolute; bottom: 0; accent-color: #a5a39c; }
    .beat { position: absolute; top: 0; height: 12px; border-left: 1px solid var(--ink-3); padding-left: 3px; font-size: 11px; line-height: 12px; color: var(--ink-3); white-space: nowrap; }
    label { color: var(--ink-2); user-select: none; }
    h2 { font-size: 15px; font-weight: 500; margin: 32px 0 0; color: var(--ink); }
    #ex-status { color: var(--ink-2); margin: 10px 0 0; min-height: 1.6em; }
    .note { color: var(--ink-3); margin: 6px 0 0; }
    body.render #app { max-width: none; padding: 0; }
    body.render #viewport { width: 1920px; height: 1080px; }
    body.render .bar, body.render h2, body.render p { display: none; }`;

  const MARKUP = `
    <div id="viewport"><canvas id="stage" width="${W}" height="${H}"></canvas></div>
    <div class="bar">
      <button id="play">播放</button>
      <span id="tc">00:00:00:00</span>
      <div id="scrub-wrap"><input id="scrub" type="range" min="0" value="0"></div>
    </div>
    <div class="bar">
      <label><input type="checkbox" data-opt="greybox"> 灰盒</label>
      <label><input type="checkbox" data-opt="guide"> 朗读提示</label>
      <label><input type="checkbox" data-opt="letterbox"> 2.39:1 遮幅</label>
      <label><input type="checkbox" data-opt="grain"> 颗粒</label>
      <label><input type="checkbox" data-opt="mb"> 运动模糊</label>
    </div>
    <h2>导出视频</h2>
    <div class="bar">
      <label>格式
        <select id="ex-format">
          <option value="mp4">MP4（H.264）</option>
          <option value="webm">WebM（VP9）</option>
          <option value="png">PNG 序列</option>
        </select>
      </label>
      <label>分辨率
        <select id="ex-size">
          <option value="1920x1080">1920×1080</option>
          <option value="3840x2160">3840×2160（4K）</option>
          <option value="1280x720">1280×720</option>
        </select>
      </label>
      <label>帧率
        <select id="ex-fps"><option>24</option><option>25</option><option>30</option><option>60</option></select>
      </label>
      <label>码率 <input id="ex-bitrate" type="number" min="2" max="200" step="1" value="40"> Mbps</label>
      <label><input type="checkbox" id="ex-mb" checked> 运动模糊</label>
      <button id="ex-go">开始导出</button>
      <button id="ex-cancel" hidden>取消</button>
    </div>
    <p id="ex-status"></p>
    <p class="note">遮幅和颗粒跟随上面的预览设置。MP4 / WebM 需要最新版 Chrome 或 Edge；PNG 序列会让你选一个文件夹逐帧写入（不支持选文件夹的浏览器会打包成 ZIP 下载）。进剪辑软件建议用 PNG 序列，或用 render.mjs 导出 ProRes。</p>`;

  // ---- run an episode -----------------------------------------------------------------------------
  // ep = { name, duration, shots: [[start, end, draw(c, local, t)]], vo, beats, label(t)?, images? }
  function run(ep) {
    const DURATION = ep.duration;
    const shotAt = (t) => ep.shots.find(([s, e]) => t >= s && t < e) || ep.shots[ep.shots.length - 1];

    function drawScene(c, t) {
      c.save();
      c.fillStyle = C.bg; c.fillRect(0, 0, W, H);
      const glow = c.createRadialGradient(W * 0.36, H * 0.42, 0, W * 0.36, H * 0.42, W * 0.62);
      glow.addColorStop(0, 'rgba(255,250,240,0.035)'); glow.addColorStop(1, 'rgba(255,250,240,0)');
      c.fillStyle = glow; c.fillRect(0, 0, W, H);
      const [a, , draw] = shotAt(t);
      draw(c, t - a, t);
      c.restore();
    }

    function hud(c, t, f) {
      const i = ep.shots.indexOf(shotAt(t));
      const shot = ep.label ? ep.label(t) : `S${i + 1}`;
      txt(c, `${timecode(f)}　${shot}　第 ${f} 帧`, 40, H - 52, { size: 22, color: C.ink2 });
      const vo = ep.vo.find(([a, b]) => t >= a - 0.05 && t <= b + 0.15);
      if (vo) txt(c, vo[2], W / 2, H - 52, { size: 30, align: 'center' });
      const beat = ep.beats.find(([b]) => Math.abs(t - b) < 1.5 / FPS);
      if (beat) {
        c.save(); c.fillStyle = C.accent; c.beginPath(); c.arc(W - 60, 70, 9, 0, Math.PI * 2); c.fill(); c.restore();
        txt(c, beat[1], W - 82, 80, { size: 26, align: 'right' });
      }
      if (OPT.greybox) txt(c, '灰盒预览，节拍按估算语速', W - 40, H - 52, { size: 20, color: C.ink3, align: 'right' });
    }

    function post(c, t, fps) {
      const f = Math.round(t * fps);
      if (!OPT.greybox) {
        const v = c.createRadialGradient(W * 0.45, H / 2, H * 0.32, W * 0.45, H / 2, W * 0.66);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.42)');
        c.fillStyle = v; c.fillRect(0, 0, W, H);
        if (OPT.grain && GRAIN.length) {
          // Grain doubles as dither, so the dark gradients survive platform re-encodes without banding.
          // Tiles are drawn at 2× so the grain clumps a little, like film rather than sensor noise.
          c.save();
          c.globalCompositeOperation = 'lighter';
          const tile = GRAIN[f % GRAIN.length];
          const ox = (f * 197) % 512, oy = (f * 331) % 512;
          for (let y = -oy; y < H; y += 512) for (let x = -ox; x < W; x += 512) c.drawImage(tile, x, y, 512, 512);
          c.restore();
        } else {
          c.fillStyle = `rgba(${GRAIN_K},${GRAIN_K},${GRAIN_K},1)`;   // keep the same mean level with grain off
          c.save(); c.globalCompositeOperation = 'lighter'; c.fillRect(0, 0, W, H); c.restore();
        }
      }
      if (OPT.letterbox) {
        c.fillStyle = '#000';
        c.fillRect(0, 0, W, LB); c.fillRect(0, H - LB, W, LB);
      }
      if (OPT.greybox || OPT.guide) hud(c, t, Math.round(t * FPS));
    }

    // Draw frame t into any canvas; its width sets the scale (1920 → 1×, 3840 → 2×).
    const BUFS = {};
    const buffers = (w, h) => (BUFS[`${w}x${h}`] ||= { scene: makeCanvas(w, h), acc: makeCanvas(w, h) });

    function renderInto(target, t, { fps = FPS, mb = OPT.mb } = {}) {
      t = clamp(t, 0, DURATION - 1e-6);
      const c = target.getContext('2d');
      const k = target.width / W;
      if (mb && !OPT.greybox) {
        // 180° shutter: average eight sub-frames across half a frame, never across a cut.
        const [a, b] = shotAt(t);
        const { scene, acc } = buffers(target.width, target.height);
        const sc = scene.getContext('2d'), ac = acc.getContext('2d');
        const N = 8, shutter = 0.5 / fps;
        for (let i = 0; i < N; i++) {
          sc.setTransform(k, 0, 0, k, 0, 0);
          drawScene(sc, clamp(t + (i / (N - 1) - 0.5) * shutter, a, b - 1e-4));
          ac.globalAlpha = 1 / (i + 1);
          ac.drawImage(scene, 0, 0);
        }
        ac.globalAlpha = 1;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.drawImage(acc, 0, 0);
      } else {
        c.setTransform(k, 0, 0, k, 0, 0);
        drawScene(c, t);
      }
      c.setTransform(k, 0, 0, k, 0, 0);
      post(c, t, fps);
      c.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Page: markup, styles, render hook.
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    const app = document.createElement('div');
    app.id = 'app';
    app.innerHTML = MARKUP;
    document.body.prepend(app);
    const stage = document.getElementById('stage');
    const render = (t) => renderInto(stage, t);
    const ready = loadAssets(ep.images);

    const captureCanvases = {};
    window.__motion = {
      duration: DURATION, fps: FPS, width: W, height: H,
      ready,
      seek: (t) => render(t),
      capture(t, w = W, h = H, fps = FPS) {
        const cv = (captureCanvases[`${w}x${h}`] ||= makeCanvas(w, h));
        renderInto(cv, t, { fps });
        return cv.toDataURL('image/png').split(',')[1];
      },
      beats: ep.beats,
    };

    if (OPT.render) {
      document.body.classList.add('render');
      return;
    }

    // Export: every frame is drawn from t, not recorded, so any frame rate is exact.
    let exporting = null;
    async function runExport() {
      const status = (s) => { document.getElementById('ex-status').textContent = s; };
      const format = document.getElementById('ex-format').value;
      const [w, h] = document.getElementById('ex-size').value.split('x').map(Number);
      const fps = +document.getElementById('ex-fps').value;
      const bitrate = +document.getElementById('ex-bitrate').value * 1e6;
      const mb = document.getElementById('ex-mb').checked;
      const frames = Math.round(DURATION * fps);
      const canvas = makeCanvas(w, h);
      const job = { cancelled: false };
      exporting = job;
      const started = performance.now();
      const progress = (i) => {
        const left = ((performance.now() - started) / (i + 1)) * (frames - i - 1) / 1000;
        status(`正在导出 ${w}×${h}、${fps} 帧：第 ${i + 1} / ${frames} 帧，预计还需 ${Math.ceil(left)} 秒`);
      };

      if (format === 'png') {
        let dir = null;
        if (window.showDirectoryPicker) {
          try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch { status('已取消。'); return; }
        }
        const zip = dir ? null : new ZipWriter();
        for (let i = 0; i < frames && !job.cancelled; i++) {
          renderInto(canvas, i / fps, { fps, mb });
          const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
          const name = `${ep.name}_${String(i).padStart(4, '0')}.png`;
          if (dir) {
            const fh = await dir.getFileHandle(name, { create: true });
            const ws = await fh.createWritable();
            await ws.write(blob); await ws.close();
          } else {
            zip.add(name, new Uint8Array(await blob.arrayBuffer()));
          }
          progress(i);
          await tick();
        }
        if (job.cancelled) return status('已取消。');
        if (zip) download(zip.finish(), `${ep.name}-png-${w}x${h}-${fps}p.zip`);
        return status(`完成：${frames} 张 PNG（${w}×${h}，${fps} 帧）${dir ? '已写入所选文件夹' : '已打包下载'}。`);
      }

      if (!('VideoEncoder' in window)) return status('这个浏览器不支持 WebCodecs，请用最新版 Chrome 或 Edge；也可以导出 PNG 序列。');
      const cfg = await pickConfig(format, w, h, fps, bitrate);
      if (!cfg) return status(`这个浏览器不支持 ${w}×${h} ${fps} 帧的${format === 'mp4' ? ' H.264' : ' VP9'} 编码，换个分辨率或格式试试。`);
      const M = format === 'mp4' ? window.Mp4Muxer : window.WebMMuxer;
      const muxer = new M.Muxer({
        target: new M.ArrayBufferTarget(),
        video: { codec: format === 'mp4' ? 'avc' : 'V_VP9', width: w, height: h, frameRate: fps },
        ...(format === 'mp4' ? { fastStart: 'in-memory' } : {}),
      });
      let failed = null;
      const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e; } });
      enc.configure(cfg);
      for (let i = 0; i < frames && !job.cancelled && !failed; i++) {
        renderInto(canvas, i / fps, { fps, mb });
        const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
        enc.encode(frame, { keyFrame: i % fps === 0 });
        frame.close();
        while (enc.encodeQueueSize > 3) await tick();
        progress(i);
        await tick();
      }
      if (job.cancelled || failed) {
        enc.close();
        return status(failed ? `编码出错：${failed.message}` : '已取消。');
      }
      await enc.flush();
      enc.close();
      muxer.finalize();
      const blob = new Blob([muxer.target.buffer], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' });
      download(blob, `${ep.name}-${w}x${h}-${fps}p.${format}`);
      status(`完成：${frames} 帧，${(blob.size / 1048576).toFixed(1)} MB（${cfg.codec}，${cfg.bitrate / 1e6} Mbps）。`);
    }

    // Preview player.
    const play = document.getElementById('play'), scrub = document.getElementById('scrub'), tc = document.getElementById('tc');
    scrub.max = DURATION; scrub.step = 1 / FPS;
    let now = 0, playing = false, last = 0;
    const show = () => { render(now); scrub.value = now; tc.textContent = timecode(Math.round(now * FPS)); };
    const wrap = document.getElementById('scrub-wrap');
    for (const [b, name] of ep.beats) {
      const m = document.createElement('div');
      m.className = 'beat';
      m.style.left = `calc(8px + (100% - 16px) * ${b / DURATION})`;
      m.textContent = name;
      wrap.appendChild(m);
    }
    const loop = (ms) => {
      if (!playing) return;
      now += (ms - last) / 1000; last = ms;
      if (now >= DURATION) now = 0;
      show();
      requestAnimationFrame(loop);
    };
    const toggle = () => {
      playing = !playing;
      play.textContent = playing ? '暂停' : '播放';
      if (playing) { last = performance.now(); requestAnimationFrame(loop); }
    };
    play.onclick = toggle;
    scrub.oninput = () => { now = +scrub.value; show(); };
    document.querySelectorAll('[data-opt]').forEach((el) => {
      el.checked = OPT[el.dataset.opt];
      el.onchange = () => { OPT[el.dataset.opt] = el.checked; show(); };
    });
    addEventListener('keydown', (e) => {
      if (e.target.closest('select, input[type=number]')) return;
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      const step = e.shiftKey ? 1 : 1 / FPS;
      if (e.code === 'ArrowRight') { now = clamp(now + step, 0, DURATION - 1 / FPS); show(); }
      if (e.code === 'ArrowLeft') { now = clamp(now - step, 0, DURATION); show(); }
    });

    const size = document.getElementById('ex-size'), rate = document.getElementById('ex-bitrate');
    size.onchange = () => { rate.value = { '1920x1080': 40, '3840x2160': 120, '1280x720': 20 }[size.value]; };
    const go = document.getElementById('ex-go'), cancel = document.getElementById('ex-cancel');
    go.onclick = async () => {
      if (playing) toggle();
      go.disabled = true; cancel.hidden = false;
      try {
        await runExport();
      } catch (err) {
        document.getElementById('ex-status').textContent = `导出失败：${err.message}`;
      } finally {
        go.disabled = false; cancel.hidden = true; exporting = null;
        show();
      }
    };
    cancel.onclick = () => { if (exporting) exporting.cancelled = true; };
    ready.then(show);
  }

  window.S5 = {
    W, H, FPS, LB, ML, C, F, OPT, IMG,
    clamp, lerp, E, P, fmt, mix, makeCanvas, font, txt, rule, camera, rollDigit,
    run,
  };
})();

