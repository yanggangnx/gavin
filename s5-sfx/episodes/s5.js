'use strict';
// LUMIX S5 voice-over, ten seconds in one continuous shot (一镜到底). Every frame is a pure function
// of t: renderInto() redraws the canvas from scratch and the grain is seeded, so any frame can be
// redrawn exactly, at any resolution.
//
// There are no cuts. One camera drifts over one stage and each beat grows out of the last: the year
// shrinks into the launch caption, the 4K headline drops into the table, the S5's price cell grows
// into the big number. A time axis runs along the bottom the whole way. Its playhead runs out to 现在
// for 六年, goes back to the launch for the 4K and again for the price, then runs out to 现在 a second
// time while the price falls, so 13,998 and 3,688 each sit on their own date.
//
// The sound (sfx() below, lib/sfx.js) is motion sound only: rendered from the same timeline, played
// in the preview, muxed into MP4 / WebM exports and available as a WAV.

const W = 1920, H = 1080, FPS = 24, DURATION = 10;
const LB = Math.round((H - W / 2.39) / 2);       // 2.39:1 letterbox bar height, 138 px
const ML = 150;                                  // left margin; the layout hangs off it

const GRAIN_K = 4;                               // grain adds 0..2K levels, so the background sits K below its look
const C = {
  bg: '#080807', rule: '#2e2d2a',                 // reads as #0c0c0b once the grain's mean is added
  ink: '#ecebe6', ink2: '#a5a39c', ink3: '#6b6964',
  accent: '#b3352b',                              // used once: the "1" that goes out
};
const F = {
  serif: '"S5 Serif", "Noto Serif SC", "Source Han Serif SC", "Songti SC", serif',
  sans: '"S5 Sans", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
};

// Timeline in seconds. Without a recorded voice-over these follow an estimated read of about
// five characters a second; move them here to retime the shot.
const T = {
  s1: 0,        // 六年
  s2: 0.95,     // 足够让 4K 从旗舰卖点……
  s2b: 2.65,    // ……变成基础配置
  s3: 4.45,     // 也足够让一台 14000 元的机身
  s4: 7.5,      // 掉到现在: the playhead runs from the launch to 现在
  kill: 8.25,   // 只剩个：the "1" goes out as the playhead lands
  close: 8.5,   // the gap closes, 3,998 stands on its own (零头)
  roll: 9.25,   // the last digits roll down to the median
  land: 9.6,
  end: DURATION,
};
const VO = [
  [0.20, 0.62, '六年，'],
  [0.95, 4.15, '足够让 4K 从旗舰卖点变成基础配置，'],
  [4.45, 7.25, '也足够让一台 14000 元的机身，'],
  [7.50, 9.30, '掉到现在只剩个零头。'],
];
const BEATS = [[0.20, '六年'], [1.55, '4K'], [3.35, '基础配置'], [5.65, '一万四'], [7.50, '掉'], [8.90, '零头']];

// ---- data ------------------------------------------------------------------------------------
// A calendar date as a decimal year, which is where it sits on the time axis.
function when(y, m, d = 15) {
  const y0 = Date.UTC(y, 0, 1);
  return y + (Date.UTC(y, m - 1, d) - y0) / (Date.UTC(y + 1, 0, 1) - y0);
}
const LAUNCH = 13998;                            // 国行官方定价，单机身
const ODD = LAUNCH % 10000;                      // 3998: what is left once the "1" is gone
const D_LAUNCH = when(2020, 9, 2);               // S5 发布
const D_NOW = when(2026, 10, 26);                // 现在
const CAMERAS = [                                // 2024–2025 entry mirrorless cameras with 4K 60p 10bit, in launch order
  { name: '索尼 ZV-E10 II', date: '2024年7月', d: when(2024, 7), price: 6899 },
  { name: '富士 X-M5', date: '2024年10月', d: when(2024, 10), price: 5699 },
  { name: '尼康 Z50II', date: '2024年11月', d: when(2024, 11), price: 6199 },
  { name: '佳能 EOS R50 V', date: '2025年3月', d: when(2025, 3), price: 4799 },
];
const SAMPLE = (window.S5_SAMPLE || []).slice()  // the listings, cheapest first
  .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
const MID = SAMPLE[(SAMPLE.length - 1) >> 1] || { id: '', price: ODD };
const MEDIAN = SAMPLE.length % 2 ? MID.price
  : (SAMPLE[SAMPLE.length / 2 - 1].price + SAMPLE[SAMPLE.length / 2].price) / 2;

// ---- options ---------------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const flag = (k, d) => (params.has(k) ? params.get(k) !== '0' : d);
const OPT = {
  render: params.has('render'),
  greybox: flag('greybox', false),
  guide: flag('guide', false),
  letterbox: flag('letterbox', true),
  grain: flag('grain', true),
  mb: flag('mb', false),
  sfx: flag('sfx', true),
};

// ---- helpers ---------------------------------------------------------------------------------
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, p) => a + (b - a) * p;
const E = {
  lin: (p) => p,
  out3: (p) => 1 - (1 - p) ** 3,
  inout2: (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2),
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

function vrule(c, x, y0, y1, alpha = 1, color = C.ink3, w = 1) {
  if (alpha <= 0) return;
  c.save();
  c.globalAlpha *= alpha;
  c.fillStyle = color;
  c.fillRect(x - w / 2, Math.min(y0, y1), w, Math.abs(y1 - y0));
  c.restore();
}

function dot(c, x, y, r, alpha = 1, color = C.ink) {
  if (alpha <= 0) return;
  c.save();
  c.globalAlpha *= alpha;
  c.fillStyle = color;
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  c.restore();
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

// ---- assets ----------------------------------------------------------------------------------
const IMG = {};
let S5_IMG = null;                               // a cut-out product photo, if the build has one (s5/tools/cutout.py)
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

const ready = (async () => {
  if (window.S5_FONTS) {
    await Promise.all(window.S5_FONTS.map(async (f) => {
      const face = new FontFace(f.family, `url(${f.src})`, { weight: f.weight });
      document.fonts.add(await face.load());
    }));
  }
  await document.fonts.ready;
  const cards = window.S5_CARDS || {};
  await Promise.all(Object.entries(cards).map(([id, src]) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { IMG[id] = im; res(); };
    im.onerror = res;
    im.src = src;
  })));
  if (window.S5_PHOTO) {
    await new Promise((res) => {
      const im = new Image();
      im.onload = () => { S5_IMG = im; res(); };
      im.onerror = res;
      im.src = window.S5_PHOTO;
    });
  }
  buildGrain();
})();

// ---- camera ----------------------------------------------------------------------------------
// [t, x, y, zoom]: the stage point at the centre of the frame, and the zoom there. The camera
// passes through the keys on a Catmull–Rom spline (zoom in log space), so it never stops dead.
const CAM = [
  [0.00, 700, 610, 1.30],    // tight on the year, the axis just in frame
  [0.95, 960, 540, 1.00],    // pulled back: the year over the whole axis
  [1.80, 905, 540, 1.05],    // in on the 4K headline
  [2.75, 925, 540, 1.05],
  [3.70, 960, 540, 1.00],    // the table, and its four dots on the axis
  [4.50, 955, 540, 1.00],
  [5.40, 935, 548, 1.06],    // in on 13,998 and the body
  [7.35, 930, 552, 1.08],
  [8.40, 960, 540, 1.00],    // out again as the playhead runs to 现在
  [10.0, 972, 536, 0.985],
];

function camAt(t) {
  const n = CAM.length;
  let i = 0;
  while (i < n - 2 && t >= CAM[i + 1][0]) i++;
  const k0 = CAM[i], k1 = CAM[i + 1], h = k1[0] - k0[0], u = clamp((t - k0[0]) / h);
  const val = (k, j) => (j === 3 ? Math.log(k[3]) : k[j]);
  const tan = (m, j) => {
    const a = CAM[Math.max(m - 1, 0)], b = CAM[Math.min(m + 1, n - 1)];
    return (val(b, j) - val(a, j)) / (b[0] - a[0]);
  };
  const [x, y, lz] = [1, 2, 3].map((j) => {
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * val(k0, j) + (u3 - 2 * u2 + u) * tan(i, j) * h
      + (-2 * u3 + 3 * u2) * val(k1, j) + (u3 - u2) * tan(i + 1, j) * h;
  });
  return { x, y, z: Math.exp(lz) };
}

// ---- time axis -------------------------------------------------------------------------------
const AX = { y: 872, x0: ML, x1: 1770 };          // 2020年1月 at x0, 现在 at x1
const X = (d) => lerp(AX.x0, AX.x1, (d - 2020) / (D_NOW - 2020));
const PY = (p) => AX.y - p * 160 / 14000;        // a price, drawn as a height above the axis
const D_CAMS = CAMERAS[CAMERAS.length - 1].d;

// Where the story is on the time axis at t. Each move starts where the one before it stopped.
function playhead(t) {
  let d = D_LAUNCH;
  d = lerp(d, D_NOW, P(t, 0.08, 0.8, E.inout2));            // 六年
  d = lerp(d, D_LAUNCH, P(t, T.s2, T.s2 + 0.42));           // back to the launch for the 4K
  d = lerp(d, D_CAMS, P(t, T.s2b + 0.55, T.s2b + 1.25));    // out to the cheap cameras
  d = lerp(d, D_LAUNCH, P(t, T.s3, T.s3 + 0.5));            // back to the launch for the price
  d = lerp(d, D_NOW, P(t, T.s4, T.kill));                   // 掉到现在
  return d;
}

// The year's last digit as odometer steps: each step rolls in as the playhead passes 1 January.
const yearSteps = (d) => [1, 2, 3, 4, 5, 6].reduce((s, k) => s + E.inout3(clamp((d - 2020 - k) / 0.6)), 0);

// The price the playhead carries while it runs to 现在. Only the two ends are data; the line
// between them is drawn dashed.
const runPrice = (d) => lerp(LAUNCH, MEDIAN, clamp((d - D_LAUNCH) / (D_NOW - D_LAUNCH)));

// ---- 4K: the 2020 headline, then one cell in a table of cheap cameras that all have it ----------
const COL = { name: ML, date: 590, spec: 775, price: 1245 };   // the S5 itself stands to the right
const ROW_S5 = 404;
const ROW_Y = CAMERAS.map((_, i) => 512 + i * 68);
const rowIn = (t, i) => P(t - T.s2b, 0.7 + i * 0.09, 0.9 + i * 0.09, E.out3);
const tableOut = (t) => P(t, T.s3, T.s3 + 0.35, E.inout3);

function band(c, t) {
  const d = playhead(t), y = AX.y, xl = X(D_LAUNCH), xd = X(d);

  rule(c, AX.x0, AX.x1, y);
  c.save();                                      // the stretch from the launch to the playhead
  c.fillStyle = C.ink2;
  c.fillRect(Math.min(xl, xd), y - 0.5, Math.abs(xd - xl), 2);
  c.restore();
  for (let k = 0; k <= 6; k++) {
    const x = X(2020 + k), lit = clamp((d - 2020 - k) * 4 + 1);
    vrule(c, x, y, y + 7);
    txt(c, String(2020 + k), x, y + 35, { size: 20, align: 'center', color: mix(C.ink3, C.ink2, lit) });
  }
  vrule(c, AX.x1, y - 7, y + 9, 1, C.ink2);
  txt(c, '现在', AX.x1, y + 35, { size: 20, align: 'center', color: C.ink2 });

  dot(c, xl, y, 4.5);
  txt(c, 'LUMIX S5 发布', xl + 12, y - 14, { size: 20, color: C.ink3, alpha: 1 - P(t, T.s3, T.s3 + 0.3, E.lin) });

  const gone = P(t, T.s3, T.s3 + 0.35, E.lin);
  CAMERAS.forEach((cam, i) => dot(c, X(cam.d), y, 3.5, rowIn(t, i) * (1 - gone), C.ink2));

  // From the price beat on, the playhead carries the price: a stem up from the axis to a dot.
  const stem = P(t, T.s3 + 0.5, T.s3 + 0.9, E.inout3);
  const run = t >= T.s4;
  const py = lerp(y, PY(run ? runPrice(d) : LAUNCH), stem);
  if (run) {
    c.save();
    c.globalAlpha = 0.9;
    c.strokeStyle = C.ink2; c.lineWidth = 1.5; c.setLineDash([7, 7]);
    c.beginPath(); c.moveTo(xl, PY(LAUNCH)); c.lineTo(xd, py); c.stroke();
    c.restore();
    dot(c, xl, PY(LAUNCH), 4.5, 0.8, C.ink2);     // the stem has left with the playhead
  }
  if (stem > 0) {
    vrule(c, xd, y, py, 1, C.ink2);
    dot(c, xd, py, 5, stem);
  } else {
    vrule(c, xd, y - 12, y + 12, 1, C.ink, 2);
  }
  txt(c, `${fmt(LAUNCH)} 元`, xl + 14, PY(LAUNCH) - 12,
    { family: F.serif, size: 26, weight: 600, color: C.ink2, alpha: P(t, T.s3 + 0.8, T.s3 + 1.1, E.lin) });
  txt(c, `${fmt(MEDIAN)} 元`, AX.x1 + 6, PY(MEDIAN) - 18,
    { family: F.serif, size: 26, weight: 600, color: C.ink, align: 'right', alpha: P(t, T.roll + 0.1, T.land + 0.05, E.lin) });
}

// ---- 六年: the year rolls with the playhead, rolls back, and flies up into the launch caption ----
function year(c, t) {
  const fly = P(t, T.s2 + 0.2, T.s2 + 0.7, E.inout3);
  const cap = P(t, T.s2 + 0.5, T.s2 + 0.78, E.lin) * (1 - P(t, T.s2b, T.s2b + 0.2, E.lin));
  txt(c, '2020年9月，松下 LUMIX S5 发布，主打的视频规格', ML, 392, { size: 28, color: C.ink2, alpha: cap });
  if (fly >= 1) return;
  const size = 300;
  const st = { family: F.serif, size, weight: 700, color: mix(C.ink, C.ink2, fly), alpha: 1 - P(fly, 0.7, 1, E.lin) };
  font(c, size, 700, F.serif);
  const w202 = c.measureText('202').width, dw = c.measureText('0').width;
  c.save();
  c.translate(ML, lerp(590, 392, fly));
  const s = lerp(1, 28 / size, fly);
  c.scale(s, s);
  txt(c, '202', 0, 0, st);
  rollDigit(c, w202, 0, size, dw, yearSteps(playhead(t)), st);
  c.restore();
}

function spec(c, t) {
  const tb = T.s2b;
  const rise = P(t, T.s2 + 0.48, T.s2 + 0.9, E.out3);
  if (rise <= 0) return;
  const detail = P(t, T.s2 + 0.85, T.s2 + 1.15, E.lin) * (1 - P(t, tb, tb + 0.2, E.lin));
  txt(c, '机内录制 4K 60p 10bit（4:2:0，单段最长 30 分钟，需裁切画幅）', ML, 668, { size: 24, color: C.ink3, alpha: detail });

  // The selling point shrinks into the S5 row and becomes one cell of the table.
  const fly = P(t, tb, tb + 0.8, E.inout3);
  c.save();
  c.translate(lerp(ML, COL.spec, fly), lerp(580 + 46 * (1 - rise), ROW_S5, fly));
  const s = lerp(1, 34 / 156, fly);
  c.scale(s, s);
  txt(c, '4K 60p 10bit', 0, 0, { family: F.serif, size: 156, weight: 700, alpha: rise * (1 - tableOut(t)) });
  c.restore();
}

function table(c, t) {
  const u = t - T.s2b, out = tableOut(t);
  if (u <= 0 || out >= 1) return;
  const head = P(u, 0.35, 0.5, E.lin) * (1 - out);
  txt(c, '机型', COL.name, 316, { size: 20, color: C.ink3, alpha: head });
  txt(c, '发布', COL.date, 316, { size: 20, color: C.ink3, alpha: head });
  txt(c, '视频规格', COL.spec, 316, { size: 20, color: C.ink3, alpha: head });
  txt(c, '国行首发价（单机身）', COL.price, 316, { size: 20, color: C.ink3, align: 'right', alpha: head });
  rule(c, ML, COL.price, 338, head);

  const r0 = P(u, 0.45, 0.65, E.lin) * (1 - out);  // the price cell is price()'s: it grows out of here
  txt(c, '松下 LUMIX S5', COL.name, ROW_S5, { family: F.serif, size: 38, weight: 600, alpha: r0 });
  txt(c, '2020年9月', COL.date, ROW_S5, { size: 26, color: C.ink2, alpha: r0 });
  rule(c, ML, COL.price, 444, r0, C.ink3);

  CAMERAS.forEach((cam, i) => {
    const a = rowIn(t, i);
    if (a <= 0) return;
    const y = ROW_Y[i] - 30 * out;
    c.save();
    c.globalAlpha *= 1 - out;
    c.beginPath(); c.rect(ML - 10, y - 52, (COL.price - ML + 20) * a, 76); c.clip();
    txt(c, cam.name, COL.name, y, { family: F.serif, size: 34, weight: 600 });
    txt(c, cam.date, COL.date, y, { size: 24, color: C.ink2 });
    txt(c, '4K 60p 10bit', COL.spec, y, { family: F.serif, size: 32, weight: 600 });
    txt(c, `${fmt(cam.price)} 元`, COL.price, y, { family: F.serif, size: 34, weight: 600, align: 'right' });
    c.restore();
    if (i < CAMERAS.length - 1) rule(c, ML, COL.price, y + 28, a * 0.7 * (1 - out));
  });
}

// ---- 13,998 元 → 3,998 元 → median ------------------------------------------------------------
const NUM = { x: ML, by: 560, size: 200 };

function numberMetrics(c) {
  const { size } = NUM;
  font(c, size, 700, F.serif);
  const dw = c.measureText('0').width, cw = c.measureText(',').width * 1.12;
  font(c, size * 0.4, 600, F.serif);
  return { dw, cw, width: 5 * dw + cw + size * 0.1 + c.measureText('元').width };
}

// The big number at the origin, baseline 0.
function bigNumber(c, t, m) {
  const { size } = NUM;
  const unit = { family: F.serif, size: size * 0.4, weight: 600, color: C.ink2 };
  const g = [
    { ch: '1', w: m.dw, kill: true },
    { ch: '3', w: m.dw, d: 0 },
    { ch: ',', w: m.cw },
    { ch: '9', w: m.dw, d: 1 },
    { ch: '9', w: m.dw, d: 2 },
    { ch: '8', w: m.dw, d: 3 },
  ];
  const kill = P(t, T.kill, T.kill + 0.3, E.inout3);
  const close = P(t, T.close, T.close + 0.32, E.inout3);
  const roll = P(t, T.roll, T.land, E.inout3);
  const from = String(ODD), to = String(Math.round(MEDIAN)).padStart(4, '0');
  const base = { family: F.serif, size, weight: 700, color: C.ink };
  g[0].w *= 1 - close;

  let x = 0;
  for (const q of g) {
    if (q.kill) {
      if (kill < 1) {
        const heat = P(t, T.kill - 0.12, T.kill + 0.04);
        txt(c, q.ch, x, 0, { ...base, color: mix(C.ink, C.accent, heat), alpha: 1 - kill, blur: kill * 3 });
      }
    } else if (q.d != null && roll > 0) {
      const fd = +from[q.d], td = +to[q.d];
      rollDigit(c, x, 0, size, q.w, fd + roll * (td - fd), base);
    } else {
      txt(c, q.ch, x, 0, base);
    }
    x += q.w;
  }
  txt(c, '元', x + size * 0.1, 0, unit);
}

// Above the number: its date, which rolls with the playhead, and what the number is.
function priceLabel(c, t) {
  const a = P(t, T.s3 + 0.6, T.s3 + 0.95, E.lin);
  if (a <= 0) return;
  const y = 340, st = { size: 28, weight: 500, color: C.ink2, alpha: a };
  font(c, 28, 500, F.sans);
  const w202 = c.measureText('202').width, dw = c.measureText('0').width;
  txt(c, '202', ML, y, st);
  rollDigit(c, ML + w202, y, 28, dw, yearSteps(playhead(t)), st);
  const x = ML + w202 + dw + c.measureText('年').width;
  txt(c, '年', ML + w202 + dw, y, st);
  txt(c, '9月', x, y, { ...st, alpha: a * (1 - P(t, T.s4, T.s4 + 0.12, E.lin)) });
  txt(c, '10月', x, y, { ...st, alpha: a * P(t, T.kill - 0.1, T.kill + 0.05, E.lin) });
  txt(c, '　LUMIX S5 国行首发价（单机身）', x + c.measureText('9月').width, y,
    { ...st, alpha: a * (1 - P(t, T.s4, T.s4 + 0.15, E.lin)) });
  txt(c, '　闲鱼二手（单机身）', x + c.measureText('10月').width, y,
    { ...st, alpha: a * P(t, T.roll + 0.05, T.land, E.lin) });
}

function price(c, t) {
  const r0 = P(t - T.s2b, 0.45, 0.65, E.lin);
  if (r0 <= 0) return;
  // The S5's price cell in the table grows into the big number.
  const grow = P(t, T.s3 + 0.05, T.s3 + 0.85, E.inout3);
  txt(c, `${fmt(LAUNCH)} 元`, COL.price, ROW_S5,
    { family: F.serif, size: 38, weight: 600, align: 'right', alpha: r0 * (1 - P(grow, 0, 0.3, E.lin)) });
  if (grow <= 0) return;
  const m = numberMetrics(c), s0 = 38 / NUM.size;
  c.save();
  c.translate(lerp(COL.price - m.width * s0, NUM.x, grow), lerp(ROW_S5, NUM.by, grow));
  c.scale(lerp(s0, 1, grow), lerp(s0, 1, grow));
  c.globalAlpha *= P(grow, 0, 0.3, E.lin);
  bigNumber(c, t, m);
  c.restore();

  priceLabel(c, t);
  txt(c, `闲鱼上 ${SAMPLE.length} 条 S5 单机身挂牌价的中位数`, ML, 650,
    { size: 24, color: C.ink2, alpha: P(t, T.roll + 0.1, T.land + 0.05, E.lin) });
}

// ---- the listings ----------------------------------------------------------------------------
const WALL = { x: 1010, w: 148, gap: 12, cols: 5, top: 152, fade0: 650, fade1: 730 };

function wallLayout() {
  const col = new Array(WALL.cols).fill(WALL.top);
  return SAMPLE.map((s) => {
    const im = IMG[s.id];
    const h = im ? WALL.w * im.height / im.width : 210;
    const k = col.indexOf(Math.min(...col));
    const y = col[k];
    col[k] += h + WALL.gap;
    return { ...s, x: WALL.x + k * (WALL.w + WALL.gap), y, h };
  });
}

// The listings, cheapest first, laid out like the feed they came from and scrolling slowly
// upwards; they fade out above the time axis. Muted until the median lights up in its own colours.
const wallIn = (t) => P(t, T.s4 + 0.45, T.s4 + 0.95, E.out3);
const midIn = (t) => P(t, T.s4 + 0.32, T.s4 + 0.62, E.lin);   // where the S5 lands, a beat before the rest
const wallShift = (t) => lerp(56, -36, P(t, T.s4, T.end, E.lin)) + (1 - wallIn(t)) * 20;

function wall(c, t) {
  const a = wallIn(t);
  if (a <= 0 && midIn(t) <= 0) return;
  const mid = P(t, T.roll + 0.05, T.land);
  const layer = buffers(c.canvas.width, c.canvas.height).layer;
  const g = layer.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, layer.width, layer.height);
  g.setTransform(c.getTransform());
  for (const s of wallLayout()) {
    const isMid = s.id === MID.id;
    const y = s.y + wallShift(t);
    g.save();
    g.globalAlpha = isMid ? Math.max(a, midIn(t)) * lerp(0.78, 1, mid) : a * lerp(0.78, 0.3, mid);
    g.beginPath(); g.roundRect(s.x, y, WALL.w, s.h, 6);
    const im = IMG[s.id];
    if (im && !OPT.greybox) {
      g.save(); g.clip();
      g.filter = `saturate(${isMid ? lerp(0.45, 1, mid) : 0.45})`;
      g.drawImage(im, s.x, y, WALL.w, s.h);
      g.restore();
    } else {
      g.fillStyle = '#151514'; g.fill(); g.strokeStyle = C.rule; g.stroke();
      txt(g, s.id, s.x + 14, y + 34, { size: 16, color: C.ink3 });
      txt(g, `${fmt(s.price)} 元`, s.x + 14, y + 60, { size: 18, color: C.ink2 });
    }
    g.restore();
    if (isMid && mid > 0) {
      g.save();
      g.globalAlpha = mid; g.strokeStyle = C.ink; g.lineWidth = 2;
      g.beginPath(); g.roundRect(s.x - 5, y - 5, WALL.w + 10, s.h + 10, 9); g.stroke();
      g.restore();
    }
  }
  const fade = g.createLinearGradient(0, WALL.top - 44, 0, WALL.fade1);
  const at = (y) => (y - (WALL.top - 44)) / (WALL.fade1 - (WALL.top - 44));
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(at(WALL.top - 8), '#000');
  fade.addColorStop(at(WALL.fade0), '#000'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = fade; g.fillRect(WALL.x - 40, -2000, W, 4000);
  g.globalCompositeOperation = 'source-over';
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(layer, 0, 0);
  c.restore();
}

// ---- the S5 itself ---------------------------------------------------------------------------
// The body in front view, drawn rather than photographed so it stays sharp at any export size.
// Millimetres from the bottom-left corner, y up. The outline follows the published size
// (132.6 × 97.1 mm) and the listing photos; the details are simplified.
const S5 = { w: 132.6, h: 97.1, top: 80, mx: 75, my: 46 };  // top: the shoulders; mx, my: mount centre
const S5_AT = { x: 1342, y: 610, k: 3 };                   // bottom-left on the stage, and px per mm

const S5_PATH = (() => {
  const body = new Path2D();
  body.moveTo(6, 0);
  body.lineTo(S5.w - 4, 0);
  body.quadraticCurveTo(S5.w, 0, S5.w, 4);
  body.lineTo(S5.w, S5.top - 6);
  body.quadraticCurveTo(S5.w, S5.top, S5.w - 6, S5.top);  // right shoulder
  body.lineTo(97, S5.top);                                   // the viewfinder hump
  body.lineTo(93.2, 95.4);
  body.quadraticCurveTo(92.8, S5.h, 91, S5.h);
  body.lineTo(59, S5.h);
  body.quadraticCurveTo(57.2, S5.h, 56.8, 95.4);
  body.lineTo(53, S5.top);
  body.lineTo(39, S5.top);                                   // left shoulder, up onto the grip
  body.bezierCurveTo(35, S5.top, 34, 82, 30, 82);
  body.lineTo(13, 82);
  body.bezierCurveTo(4, 82, 0, 76, 0, 66);
  body.lineTo(0, 7);
  body.quadraticCurveTo(0, 0, 6, 0);
  body.closePath();

  const grip = new Path2D();                                 // the rubber, out to where the grip turns
  grip.moveTo(-2, -2);
  grip.lineTo(35, -2);
  grip.bezierCurveTo(39.5, 22, 39.5, 52, 36.5, 82);
  grip.lineTo(-2, 90);
  grip.closePath();

  const edge = new Path2D();
  edge.moveTo(35, 2);
  edge.bezierCurveTo(39.5, 22, 39.5, 52, 36.5, 79);

  const dials = new Path2D();                                // top: front dial, rear dial, drive/mode dial, hot shoe
  for (const [x0, x1, y0, y1] of [[9, 27, 82, 87], [40, 51, S5.top, 85.5], [104, 124, S5.top, 88], [63, 87, S5.h, 98.8]]) {
    dials.roundRect(x0, y0 - 0.6, x1 - x0, y1 - y0 + 0.6, [0, 0, 1.2, 1.2]);
  }
  const knurl = new Path2D();
  for (const [x0, x1, y0, y1] of [[9, 27, 82.6, 86.4], [104, 124, 83.5, 87.4]]) {
    for (let x = x0 + 1.2; x < x1 - 0.6; x += 1.3) { knurl.moveTo(x, y0); knurl.lineTo(x, y1); }
  }
  const lugs = new Path2D();
  lugs.roundRect(S5.w - 0.4, 64, 3, 6, 1.2);
  lugs.roundRect(-2.6, 68, 3, 6, 1.2);
  return { body, grip, edge, dials, knurl, lugs };
})();

let S5_TEXTURE = null;
function s5Texture(c) {
  // The grip's pebbled rubber: a seeded tile of specks, sized in millimetres so it scales with the body.
  if (!S5_TEXTURE) {
    const t = makeCanvas(96, 96), g = t.getContext('2d');
    let s = 0x55;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,250,240,0.07)' : 'rgba(0,0,0,0.35)';
      g.beginPath(); g.arc(rnd() * 96, rnd() * 96, 0.6 + rnd() * 0.9, 0, Math.PI * 2); g.fill();
    }
    S5_TEXTURE = t;
  }
  const p = c.createPattern(S5_TEXTURE, 'repeat');
  p.setTransform(new DOMMatrix().scale(0.18));
  return p;
}

// x, y: the bottom-left corner on the stage; k: px per mm.
function drawS5(c, x, y, k, alpha = 1) {
  if (alpha <= 0 || k <= 0) return;
  const { mx, my } = S5, px = 1 / k;                         // px: one stage pixel, in mm
  const ring = (r0, r1, fill) => {
    c.beginPath(); c.arc(mx, my, r1, 0, Math.PI * 2); if (r0) c.arc(mx, my, r0, 0, Math.PI * 2, true);
    c.fillStyle = fill; c.fill('evenodd');
  };
  c.save();
  c.globalAlpha *= alpha;
  c.translate(x, y);
  c.scale(k, -k);

  const shade = c.createLinearGradient(0, 0, 0, S5.h);
  shade.addColorStop(0, '#0d0d0c'); shade.addColorStop(1, '#1b1a18');
  c.fillStyle = '#171614'; c.fill(S5_PATH.dials);
  c.fillStyle = shade; c.fill(S5_PATH.body);
  c.fillStyle = '#121211'; c.fill(S5_PATH.lugs);
  c.save();
  c.clip(S5_PATH.body);
  c.fillStyle = '#121110'; c.fill(S5_PATH.grip);
  c.fillStyle = s5Texture(c); c.fill(S5_PATH.grip);
  c.restore();

  c.lineWidth = px;
  c.strokeStyle = C.ink3;
  c.stroke(S5_PATH.dials); c.stroke(S5_PATH.lugs);
  c.globalAlpha *= 0.6; c.stroke(S5_PATH.knurl); c.stroke(S5_PATH.edge); c.globalAlpha /= 0.6;
  c.save(); c.globalAlpha *= 0.5; c.fillStyle = C.ink3;      // where the top plate meets the leatherette
  c.fillRect(37.5, 70, mx - 37.5, 0.5 * px * 2); c.fillRect(mx, 70, S5.w - mx, 0.5 * px * 2);
  c.restore();
  c.lineWidth = 1.4 * px; c.strokeStyle = C.ink2;
  c.globalAlpha *= 0.75; c.stroke(S5_PATH.body); c.globalAlpha /= 0.75;

  // The L-mount: flange, bayonet ring, throat, contacts, and the full-frame sensor inside.
  ring(0, 31.5, '#131312');
  const metal = c.createLinearGradient(mx - 30, my + 30, mx + 30, my - 30);
  metal.addColorStop(0, '#8d8a83'); metal.addColorStop(0.45, '#4a4945'); metal.addColorStop(0.7, '#6e6c66'); metal.addColorStop(1, '#3a3936');
  ring(25.8, 29.6, metal);
  ring(0, 25.8, '#060606');
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    ring(0, 0.8, '#2a2927');
    c.beginPath(); c.arc(mx + 27.7 * Math.cos(a), my + 27.7 * Math.sin(a), 0.75, 0, Math.PI * 2); c.fillStyle = '#25241f'; c.fill();
  }
  c.fillStyle = '#5f5a4c';
  for (let i = 0; i < 11; i++) {
    const a = Math.PI * (0.36 + 0.028 * i);
    c.save(); c.translate(mx + 23.6 * Math.cos(a), my + 23.6 * Math.sin(a)); c.rotate(a);
    c.fillRect(-0.5, -0.45, 1, 0.9); c.restore();
  }
  const glass = c.createLinearGradient(mx - 18, my - 12, mx + 18, my + 12);
  glass.addColorStop(0, '#101116'); glass.addColorStop(0.55, '#1d1f27'); glass.addColorStop(0.62, '#2a2c35'); glass.addColorStop(1, '#121318');
  c.fillStyle = '#1a1a19'; c.fillRect(mx - 20, my - 14, 40, 28);
  c.fillStyle = glass; c.fillRect(mx - 18, my - 12, 36, 24);
  c.lineWidth = px; c.strokeStyle = '#3d3c39'; c.strokeRect(mx - 18, my - 12, 36, 24);
  c.beginPath(); c.arc(mx, my, 31.5, 0, Math.PI * 2); c.strokeStyle = C.ink3; c.stroke();

  for (const [ang, r] of [[150, 2.6], [212, 4.2]]) {           // the two buttons on the grip side
    const a = (ang * Math.PI) / 180, bx = mx + 35.5 * Math.cos(a), by = my + 35.5 * Math.sin(a);
    c.beginPath(); c.arc(bx, by, r, 0, Math.PI * 2); c.fillStyle = '#1c1b19'; c.fill();
    c.strokeStyle = C.ink3; c.stroke();
  }
  c.restore();

  // Lettering, upright.
  const letter = (s, lx, ly, size, weight, color, track = 0) => {
    c.save();
    c.globalAlpha *= alpha;
    font(c, size * k, weight, F.sans);
    c.fillStyle = color; c.textBaseline = 'alphabetic';
    const ws = [...s].map((ch) => c.measureText(ch).width), tw = ws.reduce((a, b) => a + b, 0) + track * k * (s.length - 1);
    let cx = x + lx * k - tw / 2;
    [...s].forEach((ch, i) => { c.fillText(ch, cx, y - ly * k); cx += ws[i] + track * k; });
    c.restore();
  };
  letter('LUMIX', mx, 85.2, 6.6, 500, C.ink2, 1.1);
  letter('S5', 120.5, 63, 6, 600, C.ink3);
}

// The product photo instead of the drawing, in the same box: the body as wide as the drawn one
// (the strap lugs stick out past it), standing on the same baseline. Graded down a little to sit in the dark, with a faint
// light behind it so a black body still separates from a black stage.
const PHOTO_BODY = 0.91;                         // the body's share of the photo's width; the rest is strap lugs

function drawS5Photo(c, x, y, k, alpha = 1) {
  if (alpha <= 0 || k <= 0) return;
  const w = S5.w * k / PHOTO_BODY, h = w * S5_IMG.height / S5_IMG.width;
  const cx = x + (S5.w / 2) * k, top = y - h;
  c.save();
  c.globalAlpha *= alpha;
  const gy = top + h * 0.55, r = w * 0.8;
  const back = c.createRadialGradient(cx, gy, 0, cx, gy, r);
  back.addColorStop(0, 'rgba(255,250,240,0.07)'); back.addColorStop(1, 'rgba(255,250,240,0)');
  c.fillStyle = back; c.fillRect(cx - r, gy - r, 2 * r, 2 * r);
  c.filter = 'brightness(0.9) contrast(1.05) saturate(0.7)';
  c.drawImage(S5_IMG, cx - w / 2, top, w, h);
  c.restore();
}

// On the right from the launch caption on; when the price falls it shrinks into the median
// listing, the same body second-hand.
function s5(c, t) {
  const rise = P(t, T.s2 + 0.35, T.s2 + 0.95, E.out3);
  if (rise <= 0) return;
  const fly = P(t, T.s4, T.s4 + 0.6, E.inout3);
  let { x, y, k } = S5_AT;
  y += 30 * (1 - rise);
  if (fly > 0) {
    const card = wallLayout().find((s) => s.id === MID.id);
    if (card) {
      const k1 = 0.62 * WALL.w / S5.w;
      const cx = card.x + 0.4 * WALL.w, cy = card.y + wallShift(t) + 0.25 * card.h;
      x = lerp(x, cx - (S5.w / 2) * k1, fly);
      y = lerp(y, cy + (S5.h / 2) * k1, fly);
      k = lerp(k, k1, fly);
    }
  }
  (S5_IMG && !OPT.greybox ? drawS5Photo : drawS5)(c, x, y, k, rise * (1 - P(fly, 0.55, 1, E.lin)));
}

// ---- sound -----------------------------------------------------------------------------------
// Motion sound only, no music (lib/sfx.js). Every cue hangs off T and the same motion functions the
// picture uses: the playhead's speed drives its glide, the year and price digits tick as they roll,
// moves sound along their own easing. Retime T and the sound moves with it.
function sfx(s) {
  const at = (t, x) => { const k = camAt(t); return s.pan(W / 2 + (x - k.x) * k.z); };
  const h = 1 / 500;
  // The playhead running along the axis: louder and brighter the faster it goes, panned with it.
  const runs = (t0, t1, o) => s.air(t0, t1, (t) => {
    const v = clamp(Math.abs(X(playhead(t + h)) - X(playhead(t - h))) / (2 * h) / 4200) ** 1.2;
    return { v, f: (o.f0 || 700) * 3 ** v, pan: at(t, X(playhead(t))) };
  }, { q: 2.2, air: 0.05, tail: 0.1, ...o });
  // The year's last digit, ticking each time it rolls over (big on the year, small in the price label).
  const years = (t0, t1, o) => s.ticks(s.crossings((t) => yearSteps(playhead(t)), t0, t1), (i, c) => ({ ...o, f: o.f * (c.dir > 0 ? 1.03 ** i : 0.97 ** i), label: i ? '' : o.label }));

  // 0 · 六年: the shot opens on the year and pulls back while the playhead runs out to 现在.
  s.bloom(0, 1.15, { db: -25, peak: 0.3, label: '开场' });
  s.camera(0, 1.0, camAt, { db: -25, label: '拉开' });
  runs(0.06, 0.84, { db: -27, label: '时间轴跑到现在' });
  years(0, 0.9, { f: 2300, db: -25, body: -1, pan: at(0.4, 640), label: '年份 2020→2026' });
  s.tick(0.8, { f: 2000, db: -27, double: 0.012, pan: at(0.8, AX.x1), label: '到“现在”' });

  // 0.95 · back to the launch: the year rolls back and flies up into the launch caption; the S5 rises.
  runs(T.s2 - 0.02, T.s2 + 0.5, { db: -28, f0: 600, label: '时间轴回到发布' });
  years(T.s2, T.s2 + 0.5, { f: 2100, db: -27, body: -1, pan: at(1.1, 640), label: '年份倒回' });
  s.move(T.s2 + 0.2, T.s2 + 0.7, E.inout3, { f: [480, 2400], shift: 1.5, pan: [at(1.15, 640), at(1.65, 380)], db: -26, label: '年份飞进标题' });
  s.bloom(T.s2 + 0.35, T.s2 + 1.25, { db: -27, peak: 0.35, pan: at(1.6, 1540), label: 'S5 机身浮现' });

  // 1.43 · 4K 60p 10bit comes up: the first hit.
  s.hit(T.s2 + 0.5, { db: -12, f: 50, tail: 1.25, pan: at(1.45, 600), label: '4K 60p 10bit' });

  // 2.65 · the headline shrinks into its cell; the table builds, one wipe per row, with a dot on the axis each.
  s.move(T.s2b, T.s2b + 0.8, E.inout3, { f: [380, 2300], shift: 1.6, pan: [at(2.65, 650), at(3.45, 880)], db: -22, label: '标题缩进表格' });
  s.tick(T.s2b + 0.36, { f: 2600, db: -31, double: 0.06, pan: at(3, 500), label: '表头' });
  CAMERAS.forEach((cam, i) => {
    const t0 = T.s2b + 0.7 + i * 0.09;
    s.tick(t0, { f: 2900 * 1.06 ** i, db: -28, pan: at(t0, ML + 80), label: i ? '' : '四台新机' });
    s.move(t0, t0 + 0.2, E.out3, { f: [1500, 4600], q: 1.2, tail: 0.08, air: 0.2, pan: [at(t0, ML), at(t0, COL.price)], db: -31 });
  });
  runs(T.s2b + 0.52, T.s2b + 1.3, { db: -31, f0: 800 });

  // 4.45 · the table drops away, the playhead goes back, the S5's price cell grows into 13,998.
  s.move(T.s3, T.s3 + 0.35, E.inout3, { f: [240, 800], pan: [0, 0], db: -29, wide: true });
  runs(T.s3, T.s3 + 0.55, { db: -31, f0: 600 });
  s.move(T.s3 + 0.05, T.s3 + 0.85, E.inout3, { f: [260, 1500], shift: 0.6, body: 0.6, pan: [at(4.5, 1150), at(5.3, 520)], db: -19, label: '价格放大' });
  s.thud(T.s3 + 0.76, { db: -15, pan: at(5.2, 520), label: '13,998 落定' });
  s.tick(T.s3 + 0.52, { f: 3600, db: -32, pan: at(4.97, X(D_LAUNCH)), label: '价格竖线' });

  // 7.5 · 掉到现在: the price slides down its stem as the playhead runs to 现在, the year rolls on,
  // the body flies into its listing and the listings come in.
  s.swell(T.s4 - 0.45, T.s4, { db: -31, f: [350, 2000], label: '下落前' });
  s.drop(T.s4, T.kill, { f: [130, 44], ease: E.inout3, db: -18, tail: 0.3, label: '价格下落' });
  runs(T.s4, T.kill + 0.02, { db: -21, f0: 520, body: 0.3, label: '时间轴跑到现在' });
  years(T.s4, T.kill + 0.1, { f: 3500, db: -31, pan: at(7.8, ML + 60), label: '年份 2020→2026' });
  const card = wallLayout().find((c) => c.id === MID.id);
  const cardX = card ? card.x + WALL.w / 2 : 1400;
  s.move(T.s4, T.s4 + 0.6, E.inout3, { f: [700, 3600], shift: 1.8, air: 0.25, pan: [at(7.5, 1540), at(8.1, cardX)], db: -27, label: '机身飞进挂牌' });
  wallLayout().forEach((c, i) => {
    const t0 = c.id === MID.id ? T.s4 + 0.33 : T.s4 + 0.46 + ((i * 0.618) % 1) * 0.22;
    s.tick(t0, { f: 3800 + ((i * 0.382) % 1) * 1800, db: c.id === MID.id ? -31 : -37, q: 4, pan: at(t0, c.x + WALL.w / 2), rv: 0.18, label: i ? '' : '闲鱼挂牌' });
  });

  // 8.25 · the 1 heats up and goes out as the playhead lands: the big hit, dark, then the 1 dissolves.
  s.swell(T.kill - 0.32, T.kill, { db: -26, f: [700, 3000], pan: at(8.2, ML + 40), label: '“1”变红' });
  s.hit(T.kill, { db: -9, f: 44, tail: 1.4, dark: 1, pan: at(T.kill, ML + 200), label: '“1”熄灭' });
  s.puff(T.kill + 0.02, { db: -24, dur: 0.38, f: [2400, 300], pan: at(8.3, ML + 50), label: '“1”消散' });

  // 8.5 · the gap closes and 3,998 locks in place.
  s.move(T.close, T.close + 0.32, E.inout3, { f: [700, 2600], tail: 0.05, pan: [at(8.5, 420), at(8.8, 330)], db: -31 });
  s.tick(T.close + 0.3, { f: 2400, db: -25, body: -1, double: 0.012, pan: at(8.8, 330), label: '缺口合上' });

  // 9.25 · the last digits roll down to the median, a tick per digit step.
  const from = String(ODD), to = String(Math.round(MEDIAN)).padStart(4, '0');
  const roll = (t) => P(t, T.roll, T.land, E.inout3);
  const steps = [];
  for (let d = 0; d < 4; d++) {
    if (from[d] === to[d]) continue;
    const g = (t) => +from[d] + roll(t) * (to[d] - from[d]);
    s.crossings(g, T.roll, T.land).forEach((c) => steps.push({ t: c.t, x: ML + 110 + d * 115 }));
  }
  steps.sort((a, b) => a.t - b.t)
    .filter((c, i, all) => !i || c.t - all[i - 1].t > 0.008)
    .forEach((c, i) => s.tick(c.t, { f: 2700 - i * 120, db: -26, body: -2, pan: at(c.t, c.x), label: i ? '' : '数字滚到中位数' }));

  // 9.6 · the median lights up: a soft landing and a glint on the listing it came from.
  s.thud(T.land - 0.03, { db: -19, f: 64, pan: at(9.6, 500), label: '中位数落定' });
  s.ping(T.land - 0.02, { f: 1760, db: -27, decay: 0.9, pan: at(9.6, cardX), label: '中位数挂牌亮起' });
}

// ---- frame composition -----------------------------------------------------------------------
function drawScene(c, t) {
  c.save();
  c.fillStyle = C.bg; c.fillRect(0, 0, W, H);
  const glow = c.createRadialGradient(W * 0.36, H * 0.42, 0, W * 0.36, H * 0.42, W * 0.62);
  glow.addColorStop(0, 'rgba(255,250,240,0.035)'); glow.addColorStop(1, 'rgba(255,250,240,0)');
  c.fillStyle = glow; c.fillRect(0, 0, W, H);
  const cam = camAt(t);
  c.translate(W / 2, H / 2); c.scale(cam.z, cam.z); c.translate(-cam.x, -cam.y);
  band(c, t);
  year(c, t);
  spec(c, t);
  table(c, t);
  price(c, t);
  wall(c, t);
  s5(c, t);
  c.restore();
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

function timecode(f) {
  const ff = f % FPS, s = Math.floor(f / FPS);
  return `00:00:${String(s).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}

function hud(c, t, f) {
  const part = t < T.s2 ? '六年' : t < T.s3 ? '4K' : t < T.s4 ? '一万四' : '现在';
  txt(c, `${timecode(f)}　${part}　第 ${f} 帧`, 40, H - 52, { size: 22, color: C.ink2 });
  const vo = VO.find(([a, b]) => t >= a - 0.05 && t <= b + 0.15);
  if (vo) txt(c, vo[2], W / 2, H - 52, { size: 30, align: 'center' });
  const beat = BEATS.find(([b]) => Math.abs(t - b) < 1.5 / FPS);
  if (beat) {
    c.save(); c.fillStyle = C.accent; c.beginPath(); c.arc(W - 60, 70, 9, 0, Math.PI * 2); c.fill(); c.restore();
    txt(c, beat[1], W - 82, 80, { size: 26, align: 'right' });
  }
  if (OPT.greybox) txt(c, '灰盒预览，节拍按估算语速', W - 40, H - 52, { size: 20, color: C.ink3, align: 'right' });
}

// Draw frame t into any canvas; its width sets the scale (1920 → 1×, 3840 → 2×).
const BUFS = {};
function buffers(w, h) {
  const key = `${w}x${h}`;
  return (BUFS[key] ||= { scene: makeCanvas(w, h), acc: makeCanvas(w, h), layer: makeCanvas(w, h) });
}

function renderInto(target, t, { fps = FPS, mb = OPT.mb } = {}) {
  t = clamp(t, 0, DURATION - 1e-6);
  const c = target.getContext('2d');
  const k = target.width / W;
  if (mb && !OPT.greybox) {
    // 180° shutter: average eight sub-frames across half a frame. One take, so nothing to stop at.
    const { scene, acc } = buffers(target.width, target.height);
    const sc = scene.getContext('2d'), ac = acc.getContext('2d');
    const N = 8, shutter = 0.5 / fps;
    for (let i = 0; i < N; i++) {
      sc.setTransform(k, 0, 0, k, 0, 0);
      drawScene(sc, clamp(t + (i / (N - 1) - 0.5) * shutter, 0, DURATION - 1e-4));
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

const stage = document.getElementById('stage');
const render = (t) => renderInto(stage, t);
const sound = window.S5SFX ? window.S5SFX.track(sfx, DURATION) : null;

// ---- render hook (render.mjs) ------------------------------------------------------------------
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
  beats: BEATS, timeline: T,
  sfx: sound,                                     // the soundtrack: .ready → { buffer, cues, peak }
  // The soundtrack as a base64 WAV (render.mjs can mux it: ffmpeg -i video -i sfx.wav), or null.
  audio: async (bits = 24) => {
    if (!sound) return null;
    await ready;                                  // the score reads the listings' layout
    return sound.base64(bits);
  },
};

// ---- in-page export --------------------------------------------------------------------------
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

let exporting = null;
const tick = () => new Promise((r) => setTimeout(r, 0));

async function runExport() {
  const status = (s) => { document.getElementById('ex-status').textContent = s; };
  const format = document.getElementById('ex-format').value;
  const [w, h] = document.getElementById('ex-size').value.split('x').map(Number);
  const fps = +document.getElementById('ex-fps').value;
  const bitrate = +document.getElementById('ex-bitrate').value * 1e6;
  const mb = document.getElementById('ex-mb').checked;
  const withAudio = !!sound && document.getElementById('ex-audio').checked;
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
      const name = `s5_${String(i).padStart(4, '0')}.png`;
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
    if (withAudio) {
      const name = 's5-sfx.wav', data = await sound.wav(24);
      if (dir) {
        const ws = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await ws.write(data); await ws.close();
      } else {
        zip.add(name, data);
      }
    }
    if (zip) download(zip.finish(), `s5-png-${w}x${h}-${fps}p.zip`);
    return status(`完成：${frames} 张 PNG（${w}×${h}，${fps} 帧）${withAudio ? '和音效 WAV ' : ''}${dir ? '已写入所选文件夹' : '已打包下载'}。`);
  }

  if (!('VideoEncoder' in window)) return status('这个浏览器不支持 WebCodecs，请用最新版 Chrome 或 Edge；也可以导出 PNG 序列。');
  const cfg = await pickConfig(format, w, h, fps, bitrate);
  if (!cfg) return status(`这个浏览器不支持 ${w}×${h} ${fps} 帧的${format === 'mp4' ? ' H.264' : ' VP9'} 编码，换个分辨率或格式试试。`);
  // The sound is encoded first, whole; both muxers interleave it with the video as frames arrive.
  const audio = withAudio ? await sound.encoded(format) : null;
  const M = format === 'mp4' ? window.Mp4Muxer : window.WebMMuxer;
  const muxer = new M.Muxer({
    target: new M.ArrayBufferTarget(),
    video: { codec: format === 'mp4' ? 'avc' : 'V_VP9', width: w, height: h, frameRate: fps },
    ...(audio ? { audio: { codec: audio.mux, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate } } : {}),
    ...(format === 'mp4' ? { fastStart: 'in-memory' } : {}),
  });
  if (audio) for (const [chunk, meta] of audio.chunks) muxer.addAudioChunk(chunk, meta);
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
  download(blob, `s5-${w}x${h}-${fps}p.${format}`);
  const said = audio ? `，音效 ${audio.codec === 'opus' ? 'Opus' : 'AAC'}` : withAudio ? '；这个浏览器不能编码音频，视频里没有声音，请另外导出音效 WAV' : '';
  status(`完成：${frames} 帧，${(blob.size / 1048576).toFixed(1)} MB（${cfg.codec}，${cfg.bitrate / 1e6} Mbps${said}）。`);
}

// ---- preview player ----------------------------------------------------------------------------
// While the sound plays, the picture runs off the sound's clock, so the two stay together.
if (OPT.render) {
  document.body.classList.add('render');
} else {
  const play = document.getElementById('play'), scrub = document.getElementById('scrub'), tc = document.getElementById('tc');
  let now = 0, playing = false, last = 0;
  const show = () => { render(now); scrub.value = now; tc.textContent = timecode(Math.round(now * FPS)); };
  const listen = () => { if (sound) { if (playing && OPT.sfx) sound.player.play(now); else sound.player.stop(); } };
  const wrap = document.getElementById('scrub-wrap');
  for (const [b, name] of BEATS) {
    const m = document.createElement('div');
    m.className = 'beat';
    m.style.left = `calc(8px + (100% - 16px) * ${b / DURATION})`;
    m.textContent = name;
    wrap.appendChild(m);
  }
  const loop = (ms) => {
    if (!playing) return;
    const heard = sound && OPT.sfx ? sound.player.time() : null;
    now = heard ?? now + (ms - last) / 1000; last = ms;
    if (now >= DURATION) { now = 0; listen(); }
    show();
    requestAnimationFrame(loop);
  };
  const toggle = () => {
    playing = !playing;
    play.textContent = playing ? '暂停' : '播放';
    if (playing) { last = performance.now(); requestAnimationFrame(loop); }
    listen();
  };
  const seek = (t) => { now = t; show(); if (playing) listen(); };
  play.onclick = toggle;
  scrub.oninput = () => seek(+scrub.value);
  document.querySelectorAll('[data-opt]').forEach((el) => {
    el.checked = OPT[el.dataset.opt];
    el.onchange = () => { OPT[el.dataset.opt] = el.checked; show(); if (el.dataset.opt === 'sfx') listen(); };
    if (el.dataset.opt === 'sfx' && !sound) el.parentElement.hidden = true;
  });
  addEventListener('keydown', (e) => {
    if (e.target.closest('select, input[type=number]')) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    const step = e.shiftKey ? 1 : 1 / FPS;
    if (e.code === 'ArrowRight') seek(clamp(now + step, 0, DURATION - 1 / FPS));
    if (e.code === 'ArrowLeft') seek(clamp(now - step, 0, DURATION));
  });

  const size = document.getElementById('ex-size'), rate = document.getElementById('ex-bitrate');
  size.onchange = () => { rate.value = { '1920x1080': 40, '3840x2160': 120, '1280x720': 20 }[size.value]; };
  const go = document.getElementById('ex-go'), cancel = document.getElementById('ex-cancel'), wavBtn = document.getElementById('ex-wav');
  if (!sound) { wavBtn.hidden = true; document.getElementById('ex-audio').parentElement.hidden = true; }
  wavBtn.onclick = async () => {
    wavBtn.disabled = true;
    try {
      download(new Blob([await sound.wav(24)], { type: 'audio/wav' }), 's5-sfx.wav');
      document.getElementById('ex-status').textContent = `完成：音效 WAV（48 kHz，24-bit，${DURATION} 秒）。`;
    } catch (err) {
      document.getElementById('ex-status').textContent = `导出失败：${err.message}`;
    } finally {
      wavBtn.disabled = false;
    }
  };
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
  if (sound) {                                    // render the sound once the page is up, before the first play
    ready.then(() => sound.ready).catch((err) => { document.getElementById('ex-status').textContent = `音效生成失败：${err.message}`; });
  }
}
