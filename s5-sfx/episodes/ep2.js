'use strict';
// Episode 2 · 18 seconds, one continuous shot. The S5 is the subject and never leaves the frame:
// a front photo with the lens off, it joins a row of seven other ~24 MP bodies, then the camera
// pushes into its mount and the sensor glass becomes a drawn sensor on the resolution line. It
// pulls back out to the photo for three facts, and pushes in once more to show the recording area
// going from an APS-C crop to the full width while the list of recording modes lights the two
// uncropped 4:2:2 10-bit rows. Like Keynote's Magic Move, objects keep their identity and only
// their properties interpolate. Sources for every number: evidence/ep2-ledger.csv (none are cited
// on screen); for the photos: evidence/ep2-camera-sources.csv.
const { W, H, ML, C, F, IMG, lerp, E, P, mix, font, txt, rule, makeCanvas } = S5;
const DURATION = 18;

// Word-level beats in seconds, from an estimated read of about six characters a second of the
// trimmed script in VO (README). Retime these once the voice-over is recorded.
const B = {
  mp: 1.3, ff: 2.75,                 // 2420 万像素 / 全画幅 CMOS
  known: 3.75,                       // 这个像素大家都不陌生
  line: 5.45, balance: 6.7,          // 它刚好落在一条平衡线上
  photo: 7.35, video: 8.1, iso: 8.85,
  px: 10.2, frame: 10.6, not: 11.2,  // 但像素和全画幅，都不是它真正的卖点
  value: 12.8, crop: 13.9, nocrop: 14.2, c4k: 15.0, uhd: 15.65, depth: 16.65,
};
const VO = [
  [0.15, 3.53, 'S5 用的是一块 2420 万像素全画幅 CMOS。'],
  [3.73, 7.21, '这个像素大家都不陌生，它刚好落在一条平衡线上：'],
  [7.35, 9.65, '照片够用，4K 够用，高感也不错。'],
  [9.90, 12.55, '但像素和全画幅，都不是它真正的卖点。'],
  [12.80, 17.62, '它真正值钱的，是能无裁切录制 C4K 或 4K 30 帧的 4:2:2 10-bit。'],
];
const BEATS = [[B.mp, '2420 万'], [B.known, '不陌生'], [B.balance, '平衡线'], [B.photo, '照片'],
  [B.video, '4K'], [B.iso, '高感'], [B.not, '不是卖点'], [B.nocrop, '无裁切'], [B.c4k, 'C4K'],
  [B.uhd, '4K 30 帧'], [B.depth, '4:2:2 10-bit']];

// ---- data ------------------------------------------------------------------------------------
const SENSOR = { w: 35.6, h: 23.8, px: 6000, py: 4000 };   // A01
const MM = 18;                                    // world px per millimetre
const SW = SENSOR.w * MM, SH = SENSOR.h * MM;
const HOME = { x: 1390, y: 540 };                 // the S5 sensor's centre in world space; it never moves
const PITCH = (width, px) => (width / px) * 1000;  // µm

// B · bodies with ~24 MP full-frame sensors, in release order; the S5 is slot 3 (A03). Each is an
// 800 × 800 front photo with the lens off (build/cameras.js). In photo pixels, glass is the sensor's
// cover glass and body the camera's outline, both measured by hand.
const ROW_STEP = 761;
const ROW = [
  { name: '索尼 A7 III', mp: '2420 万像素', img: 'Sony_A7_III', glass: [375, 376, 554, 499], body: [61, 163, 738, 634] },
  { name: '尼康 Z6', mp: '2450 万像素', img: 'Nikon_Z6', glass: [387, 382, 574, 512], body: [60, 155, 739, 644] },
  { name: '松下 LUMIX S1', mp: '2420 万像素', img: 'Panasonic_LUMIX_S1', glass: [403, 393, 570, 508], body: [60, 159, 739, 640] },
  { name: '松下 LUMIX S5', mp: '2420 万像素', img: 'Panasonic_LUMIX_S5', glass: [392, 377, 575, 502], body: [60, 166, 739, 632], self: true },
  { name: '佳能 EOS R6 Mark II', mp: '2420 万像素', img: 'Canon_EOS_R6_Mark_II', glass: [398, 366, 582, 491], body: [60, 154, 739, 646] },
  { name: '佳能 EOS R8', mp: '2420 万像素', img: 'Canon_EOS_R8', glass: [404, 379, 589, 502], body: [60, 174, 738, 625] },
  { name: '松下 LUMIX S5II', mp: '2420 万像素', img: 'Panasonic_LUMIX_S5II', glass: [380, 386, 566, 513], body: [60, 148, 738, 651] },
  { name: '尼康 Z6III', mp: '2450 万像素', img: 'Nikon_Z6III', glass: [385, 374, 566, 500], body: [61, 163, 739, 635] },
].map((m, k) => ({ ...m, x: HOME.x + (k - 3) * ROW_STEP }));
const S5_BODY = ROW[3];

// Every photo is scaled so its sensor glass is as wide as the S5's (all eight are full frame), which
// leaves the bodies at their true relative size, and is placed by the centre of that glass.
const REST = 0.9;                                  // world px per S5 photo px: a body about 610 px wide
const glassW = (m) => m.glass[2] - m.glass[0];
const DIVE = SW / (glassW(S5_BODY) * REST);        // how much the S5 photo grows for its glass to fill SW

function place(k, m, wx, grow = 1) {
  const g = m.glass, b = m.body, s = REST * glassW(S5_BODY) / glassW(m) * grow;
  const o = scr(k, wx - (g[0] + g[2]) / 2 * s, HOME.y - (g[1] + g[3]) / 2 * s), z = s * k.z;
  return { o, z, x: o.x + b[0] * z, y: o.y + b[1] * z, w: (b[2] - b[0]) * z, h: (b[3] - b[1]) * z };
}
// The row's labels share one baseline under the lowest body.
const LABEL_Y = Math.max(...ROW.map((m) => {
  const s = REST * glassW(S5_BODY) / glassW(m);
  return HOME.y + (m.body[3] - (m.glass[1] + m.glass[3]) / 2) * s;
}));

// C · full-frame bodies from fewest to most pixels, placed on a log scale with the S5 fixed (A04).
const LINE_LEN = 4005;
const LINE = [
  { name: '索尼 A7S III', mp: 1210, width: 35.6, px: 4240 },
  { name: '松下 LUMIX S5', mp: 2420, width: 35.6, px: 6000, self: true },
  { name: '索尼 A7 IV', mp: 3300, width: 35.9, px: 7008 },
  { name: '佳能 EOS R5', mp: 4500, width: 36.0, px: 8192 },
  { name: '索尼 A7R V', mp: 6100, width: 35.7, px: 9504 },
].map((m, i, all) => {
  const f = (v) => Math.log(v / all[0].mp) / Math.log(all[all.length - 1].mp / all[0].mp);
  return { ...m, x: HOME.x + (f(m.mp) - f(2420)) * LINE_LEN, pitch: PITCH(m.width, m.px) };
});

// D · three facts (A05–A07).
const FACTS = [
  { at: B.photo, label: '照片', value: '6000 × 4000，按 300 dpi 可印约 51 × 34 厘米' },
  { at: B.video, label: '4K', value: `传感器 ${SENSOR.px} 像素宽，4K 只要 3840` },
  { at: B.iso, label: '高感', value: '双原生 ISO 640 / 4000' },
];

// F · internal MOV recording modes, firmware 2.0 and later (A08–A12); hl marks the two that matter.
const MODES = [
  { group: '全画幅，不裁切' },
  { res: 'C4K', fps: '30p / 25p / 24p', depth: '4:2:2 10-bit', rate: '150 Mbps', hl: 'c4k' },
  { res: 'C4K', fps: '30p / 25p / 24p', depth: '4:2:0 8-bit', rate: '100 Mbps' },
  { res: '4K', fps: '30p / 25p / 24p', depth: '4:2:2 10-bit', rate: '150 Mbps', hl: 'uhd' },
  { res: '4K', fps: '30p / 25p / 24p', depth: '4:2:0 8-bit', rate: '100 Mbps' },
  { res: '4:3 变形', fps: '30p / 25p / 24p', depth: '4:2:2 10-bit', rate: '150 Mbps' },
  { res: '4:3 变形', fps: '30p / 25p / 24p', depth: '4:2:0 8-bit', rate: '100 Mbps' },
  { res: 'FHD', fps: '60p – 24p', depth: '4:2:2 10-bit', rate: '100 Mbps' },
  { res: 'FHD', fps: '60p – 24p', depth: '4:2:0 8-bit', rate: '100 Mbps' },
  { group: 'APS-C 裁切（约 1.5×）', crop: true },
  { res: 'C4K', fps: '60p / 50p', depth: '4:2:0 8-bit', rate: '150 Mbps', crop: true, aps: true },
  { res: '4K', fps: '60p / 50p', depth: '4:2:0 10-bit', rate: '200 Mbps', crop: true, aps: true },
  { res: '4K', fps: '60p / 50p', depth: '4:2:0 8-bit', rate: '150 Mbps', crop: true, aps: true },
  { group: '其他', crop: true },
  { res: '升格', fps: 'FHD 最高 180 fps', depth: '', rate: '', crop: true },
  { res: 'HDMI 输出', fps: '4K 60p / 50p', depth: '4:2:2 10-bit', rate: '', crop: true },
  { res: 'RAW 输出', fps: '5.9K', depth: '12-bit', rate: '', crop: true },
];

// ---- the camera: one continuous move through world space ---------------------------------------
// [time, centre x, centre y, zoom]; zoom interpolates in log space so pulls and pushes feel even.
const CAM = [
  [0.0, 960, 540, 1.0],
  [B.known, 990, 540, 1.03],
  [B.known + 0.9, 1770, 600, 0.288],          // pull back: the S5 is one of eight identical sensors
  [B.line, 1770, 600, 0.3],
  [B.line + 0.85, 1670, 600, 0.37],           // the row becomes the resolution line
  [B.photo - 0.15, 1670, 600, 0.38],
  [B.photo + 0.6, 960, 540, 1.0],             // back in on the S5 for the three facts
  [B.value, 1000, 540, 1.02],
  [B.value + 0.7, 980, 560, 0.95],            // make room on the left for the modes
  [DURATION, 1010, 560, 1.0],
];

function cam(t) {
  let i = 0;
  while (i < CAM.length - 2 && t >= CAM[i + 1][0]) i++;
  const [t0, x0, y0, z0] = CAM[i], [t1, x1, y1, z1] = CAM[i + 1];
  const p = E.inout3(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
  return { x: lerp(x0, x1, p), y: lerp(y0, y1, p), z: Math.exp(lerp(Math.log(z0), Math.log(z1), p)) };
}
const scr = (k, wx, wy) => ({ x: W / 2 + (wx - k.x) * k.z, y: H / 2 + (wy - k.y) * k.z });

// 0: the S5 is a photo. 1: the camera has pushed into its mount and the glass is the drawn sensor.
const dive = (t) => P(t, B.line, B.line + 0.85) * (1 - P(t, B.photo - 0.15, B.photo + 0.6)) + P(t, B.value, B.value + 0.7);

// The photos, a little desaturated so the sensor glass and red trim sit in the grey palette.
const STILL = {};
function still(id) {
  if (!STILL[id] && IMG[id]) {
    const cv = makeCanvas(800, 800), g = cv.getContext('2d');
    g.filter = 'saturate(0.8)';
    g.drawImage(IMG[id], 0, 0);
    STILL[id] = cv;
  }
  return STILL[id];
}

function photo(c, k, m, wx, alpha, grow = 1) {
  const p = place(k, m, wx, grow);
  if (alpha <= 0) return p;
  c.save();
  c.globalAlpha *= alpha;
  // A faint pool of light behind the body, so black plastic separates from the black background.
  c.save();
  c.translate(p.x + p.w / 2, p.y + p.h * 0.55); c.scale(1, 0.62);
  const r = p.w * 0.78, pool = c.createRadialGradient(0, 0, 0, 0, 0, r);
  pool.addColorStop(0, 'rgba(236,235,230,0.07)'); pool.addColorStop(1, 'rgba(236,235,230,0)');
  c.fillStyle = pool; c.fillRect(-r, -r, 2 * r, 2 * r);
  c.restore();
  const im = still(m.img);
  if (im) {
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(im, p.o.x, p.o.y, 800 * p.z, 800 * p.z);
  } else {
    // No build/cameras.js: outline the body and its sensor instead.
    const g = m.glass;
    c.strokeStyle = C.ink3; c.lineWidth = 1;
    c.strokeRect(p.x, p.y, p.w, p.h);
    c.strokeRect(p.o.x + g[0] * p.z, p.o.y + g[1] * p.z, (g[2] - g[0]) * p.z, (g[3] - g[1]) * p.z);
  }
  c.restore();
  return p;
}

// A sensor centred on world x = wx, drawn in screen space so lines stay hairline at any zoom.
function sensor(c, k, wx, o = {}) {
  const a = o.alpha ?? 1, sc = o.scale ?? 1;
  const s = scr(k, wx - SW * sc / 2, HOME.y - SH * sc / 2), w = SW * sc * k.z, h = SH * sc * k.z;
  if (a <= 0) return { ...s, w, h };
  c.save();
  c.globalAlpha *= a;
  if (o.grid > 0) {
    // Pixel grid, spaced in proportion to the real pixel size (illustrative, not one line per pixel).
    const g = o.pitch * 9 * k.z * sc;
    c.save();
    c.globalAlpha *= o.grid;
    c.strokeStyle = C.rule; c.lineWidth = 1;
    c.beginPath();
    for (let x = s.x + g; x < s.x + w - 1; x += g) { c.moveTo(x, s.y); c.lineTo(x, s.y + h); }
    for (let y = s.y + g; y < s.y + h - 1; y += g) { c.moveTo(s.x, y); c.lineTo(s.x + w, y); }
    c.stroke();
    c.restore();
  }
  c.strokeStyle = o.color || C.ink2; c.lineWidth = o.lw || 1.5;
  c.strokeRect(s.x, s.y, w, h);
  c.restore();
  return { ...s, w, h };
}

const fade = (t, a, b, c0, d) => P(t, a, b, E.lin) * (1 - P(t, c0, d, E.lin));

// ---- the S5's pixel count: one object that magic-moves between the layouts ----------------------
const TOKEN = { family: F.serif, weight: 700 };
// "万像素" is a small suffix next to the big number, but the same size as the number once it is a label.
const suffix = (size) => lerp(1, 0.42, Math.min(1, Math.max(0, (size - 24) / (190 - 24))));

function tokenAt(c, t, rowAt, s5) {
  // Layout A/D: big on the left. B: under the S5 photo in the row. C: under the S5 sensor on the line.
  const big = { x: ML, y: 578, size: 190 };
  const centred = (x, y, size) => {
    font(c, size, 700, F.serif);
    const w = c.measureText('2420').width + size * 0.12 + measure(c, '万像素', size * suffix(size));
    return { x: x - w / 2, y, size };
  };
  const row = centred(rowAt.x, rowAt.y, 24), line = centred(s5.x + s5.w / 2, s5.y + s5.h + 46, 28);
  const mix3 = (a, b, p) => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), size: lerp(a.size, b.size, p) });
  if (t < B.known) return big;
  if (t < B.line) return mix3(big, row, P(t, B.known, B.known + 0.9));
  if (t < B.photo - 0.15) return mix3(row, line, P(t, B.line, B.line + 0.85));
  return mix3(line, big, P(t, B.photo - 0.15, B.photo + 0.6));
}

function measure(c, s, size, weight = 600) { font(c, size, weight, F.serif); return c.measureText(s).width; }

function drawToken(c, t, rowAt, s5, alpha) {
  if (alpha <= 0) return;
  const p = tokenAt(c, t, rowAt, s5);
  font(c, p.size, 700, F.serif);
  const nw = c.measureText('2420').width;
  txt(c, '2420', p.x, p.y, { ...TOKEN, size: p.size, alpha });
  txt(c, '万像素', p.x + nw + p.size * 0.12, p.y, { family: F.serif, size: p.size * suffix(p.size), weight: 600, color: C.ink2, alpha });
}

// ---- the frame ------------------------------------------------------------------------------
function frame(c, u, t) {
  const k = cam(t);
  const rowA = fade(t, B.known + 0.1, B.known + 0.6, B.line, B.line + 0.4);
  const lineA = fade(t, B.line + 0.15, B.line + 0.7, B.photo - 0.15, B.photo + 0.25);
  const balance = P(t, B.balance - 0.1, B.balance + 0.3);

  // World: the other cameras of the row, the sensors of the line, then the S5 itself on top.
  const ly = scr(k, 0, LABEL_Y).y;
  ROW.forEach((m) => {
    if (m.self || rowA <= 0) return;
    const p = photo(c, k, m, m.x, rowA);
    txt(c, m.name, p.x + p.w / 2, ly + 34, { size: 18, color: C.ink3, align: 'center', alpha: rowA });
    txt(c, m.mp, p.x + p.w / 2, ly + 72, { family: F.serif, size: 22, weight: 600, color: C.ink2, align: 'center', alpha: rowA });
  });
  LINE.forEach((m) => {
    if (m.self || lineA <= 0) return;
    const s = sensor(c, k, m.x, { alpha: lineA * lerp(1, 0.55, balance), color: C.ink3, grid: 1, pitch: m.pitch });
    txt(c, m.name, s.x + s.w / 2, s.y - 22, { size: 19, color: C.ink3, align: 'center', alpha: lineA });
    txt(c, `${m.mp} 万像素`, s.x + s.w / 2, s.y + s.h + 46, { family: F.serif, size: 26, weight: 600, color: C.ink2, align: 'center', alpha: lineA * lerp(1, 0.6, balance) });
    txt(c, `单个像素约 ${m.pitch.toFixed(1)} 微米`, s.x + s.w / 2, s.y + s.h + 80, { size: 17, color: C.ink3, align: 'center', alpha: lineA });
  });
  // The S5: the photo grows around its sensor glass while the drawn sensor grows out of that glass to
  // full size, so the two outlines coincide all the way through the push-in (and the pull-out).
  const v = dive(t), grow = Math.exp(v * Math.log(DIVE));
  const rest = place(k, S5_BODY, HOME.x);
  // The last push-in clears the photo sooner, before the list of modes arrives on the left.
  const gone = t > B.value ? P(v, 0.1, 0.55, E.lin) : P(v, 0.25, 0.85, E.lin);
  photo(c, k, S5_BODY, HOME.x, P(t, 0.1, 1.1) * (1 - gone), grow);
  const self = LINE.find((m) => m.self);
  sensor(c, k, HOME.x, {
    alpha: P(v, 0.05, 0.6, E.lin), scale: grow / DIVE,
    color: mix(C.ink2, C.ink, balance * lineA),
    lw: lerp(1.5, 2, balance * lineA),
    grid: lineA, pitch: self.pitch,
  });
  const s5 = sensor(c, k, HOME.x, { alpha: 0 });   // the full-size sensor: anchors labels and the box

  // C · the axis under the line of sensors.
  if (lineA > 0) {
    const first = scr(k, LINE[0].x, HOME.y), last = scr(k, LINE[LINE.length - 1].x, HOME.y);
    const ay = s5.y + s5.h + 120;
    rule(c, first.x - 60, last.x + 60, ay, lineA, C.ink3);
    LINE.forEach((m) => {
      const p = scr(k, m.x, HOME.y);
      c.save(); c.globalAlpha *= lineA; c.fillStyle = m.self ? C.ink : C.ink3;
      c.beginPath(); c.arc(p.x, ay, m.self ? lerp(4, 6, balance) : 4, 0, Math.PI * 2); c.fill(); c.restore();
    });
    txt(c, '← 单个像素更大', first.x - 60, ay + 40, { size: 19, color: C.ink3, alpha: lineA });
    txt(c, '细节更多 →', last.x + 60, ay + 40, { size: 19, color: C.ink3, align: 'right', alpha: lineA });
    txt(c, '松下 LUMIX S5', s5.x + s5.w / 2, s5.y - 22, { size: 19, color: C.ink, align: 'center', alpha: lineA });
    txt(c, `单个像素约 ${self.pitch.toFixed(1)} 微米`, s5.x + s5.w / 2, s5.y + s5.h + 80, { size: 17, color: C.ink2, align: 'center', alpha: lineA });
  }
  if (rowA > 0) txt(c, '松下 LUMIX S5', rest.x + rest.w / 2, ly + 34, { size: 18, color: C.ink, align: 'center', alpha: rowA });

  // F · the recording area on the S5: an APS-C crop first, then the full width.
  const box = fade(t, B.crop - 0.05, B.crop + 0.15, DURATION + 1, DURATION + 2);
  if (box > 0) {
    const full = P(t, B.nocrop, B.nocrop + 0.4, E.inout3);
    const aspect = lerp(16 / 9, 4096 / 2160, P(t, B.c4k, B.c4k + 0.3)) + (16 / 9 - 4096 / 2160) * P(t, B.uhd, B.uhd + 0.3);
    const bw = lerp(s5.w / 1.5, s5.w, full), bh = bw / aspect;
    const bx = s5.x + (s5.w - bw) / 2, by = s5.y + (s5.h - bh) / 2;
    c.save();
    c.globalAlpha *= box;
    c.fillStyle = 'rgba(236,235,230,0.06)'; c.fillRect(bx, by, bw, bh);
    c.strokeStyle = C.ink; c.lineWidth = 2; c.strokeRect(bx, by, bw, bh);
    c.restore();
    const lab = (s, a) => txt(c, s, bx + 18, by + 34, { size: 20, color: C.ink2, alpha: box * a });
    lab('60p：APS-C 裁切（约 1.5×）', 1 - P(t, B.nocrop, B.nocrop + 0.2, E.lin));
    lab('30p：全宽读出，不裁切', P(t, B.nocrop + 0.2, B.nocrop + 0.4, E.lin) * (1 - P(t, B.c4k - 0.1, B.c4k + 0.1, E.lin)));
    lab('C4K  4096 × 2160', P(t, B.c4k, B.c4k + 0.2, E.lin) * (1 - P(t, B.uhd - 0.1, B.uhd + 0.1, E.lin)));
    lab('C4K / 4K  ·  30p / 25p / 24p  ·  全宽不裁切', P(t, B.uhd, B.uhd + 0.2, E.lin));
    const big = P(t, B.depth - 0.05, B.depth + 0.25, E.out3);
    txt(c, '4:2:2 10-bit', bx + bw / 2, by + bh / 2 + 30 + (1 - big) * 10, { family: F.serif, size: 84, weight: 700, align: 'center', alpha: box * big });
  }

  // Screen space · the left column.
  const header = [
    ['松下 LUMIX S5 的传感器', fade(t, 0.05, 0.3, B.known, B.known + 0.3) + fade(t, B.photo + 0.3, B.photo + 0.6, B.value, B.value + 0.3)],
    ['约 2400 万像素的全画幅机', fade(t, B.known + 0.4, B.known + 0.8, B.line, B.line + 0.3)],
    ['全画幅相机的像素档位', fade(t, B.line + 0.4, B.line + 0.8, B.photo - 0.15, B.photo + 0.15)],
  ];
  const dimmed = 1 - 0.75 * P(t, B.not, B.not + 0.4);
  header.forEach(([s, a]) => txt(c, s, ML, 360, { size: 28, color: C.ink2, alpha: a * dimmed }));

  const leftA = fade(t, 0, 0.01, B.value, B.value + 0.3);
  const tokA = P(t, B.mp - 0.05, B.mp + 0.15, E.lin) * leftA * lerp(1, 0.25, P(t, B.px - 0.05, B.px + 0.25));
  drawToken(c, t, { x: rest.x + rest.w / 2, y: ly + 72 }, s5, tokA);
  const ff = P(t, B.ff - 0.05, B.ff + 0.15, E.lin) * (1 - P(t, B.known, B.known + 0.3, E.lin) + P(t, B.photo + 0.3, B.photo + 0.6, E.lin)) * leftA;
  txt(c, '全画幅 CMOS', ML, 664, { family: F.serif, size: 40, weight: 600, alpha: ff * lerp(1, 0.25, P(t, B.frame - 0.05, B.frame + 0.25)) });
  FACTS.forEach((f, i) => {
    const a = P(t, f.at - 0.05, f.at + 0.15, E.lin) * leftA * dimmed;
    txt(c, f.label, ML, 748 + i * 46, { size: 24, color: C.ink3, alpha: a });
    txt(c, f.value, ML + 96, 748 + i * 46, { size: 24, color: C.ink2, alpha: a });
  });

  // F · every recording mode, then the two uncropped 4:2:2 10-bit rows.
  if (t > B.value) modes(c, t);
}

const MC = { res: ML, fps: 300, depth: 520, rate: 730, right: 900 };

function modes(c, t) {
  const show = P(t, B.value + 0.1, B.value + 0.45, E.lin);
  txt(c, '机内录制规格（MOV，固件 2.0 起）', ML, 236, { size: 22, color: C.ink2, alpha: show });
  const crop = P(t, B.crop - 0.1, B.crop + 0.15, E.lin) * (1 - P(t, B.nocrop, B.nocrop + 0.3, E.lin));
  const nocrop = P(t, B.nocrop, B.nocrop + 0.3);
  const on = { c4k: P(t, B.c4k - 0.05, B.c4k + 0.2), uhd: P(t, B.uhd - 0.05, B.uhd + 0.2) };
  const focus = Math.max(on.c4k, on.uhd);
  const under = P(t, B.depth - 0.05, B.depth + 0.25);
  let y = 262;
  MODES.forEach((m, i) => {
    const a = P(t, B.value + 0.15 + i * 0.025, B.value + 0.35 + i * 0.025, E.out3);
    if (m.group) {
      y += i ? 10 : 0;
      const g = m.crop ? lerp(1, 0.35, nocrop) : 1;
      txt(c, m.group, ML, y + 22, { size: 18, weight: 500, color: m.crop ? C.ink3 : C.ink2, alpha: a * g * lerp(1, 0.6, focus) });
      rule(c, ML, MC.right, y + 32, a * 0.6);
      y += 40;
      return;
    }
    const hl = m.hl ? on[m.hl] : 0;
    let base = m.crop ? lerp(0.85, 0.3, nocrop) : 0.85;
    if (m.aps) base = lerp(base, 1, crop);           // the 60p rows light up while the crop box shows
    base *= lerp(1, m.hl ? 1 : 0.24, focus);
    if (hl > 0) {
      c.save(); c.globalAlpha = hl * 0.08 * a; c.fillStyle = C.ink;
      c.fillRect(ML - 8, y + 4, MC.right - ML + 16, 28); c.restore();
    }
    const o = { size: 19, color: hl > 0 ? C.ink : C.ink2, alpha: a * Math.max(base, hl) };
    txt(c, m.res, MC.res, y + 24, { ...o, weight: 500 });
    txt(c, m.fps, MC.fps, y + 24, o);
    txt(c, m.depth, MC.depth, y + 24, { ...o, weight: m.hl ? 500 : 400 });
    if (m.hl && under > 0) {
      font(c, 19, 500, F.sans);
      rule(c, MC.depth, MC.depth + c.measureText(m.depth).width, y + 30, under * a, C.ink);
    }
    txt(c, m.rate, MC.right, y + 24, { ...o, align: 'right' });
    y += 30;
  });
}

// ---- sound -----------------------------------------------------------------------------------
// Motion sound only, no music (lib/sfx.js). Cues hang off B and the same camera and layout the
// picture uses, so they follow when the beats are retimed to the recorded voice-over. The two pushes
// into the mount share one sound, as they share one move; every glint is from the same A-major set.
function sfx(s) {
  const at = (t, wx) => s.pan(scr(cam(t), wx, HOME.y).x);
  const left = s.pan(ML + 220);                        // the left column
  const box = at(14, HOME.x);                          // the S5's sensor and its recording area
  const rows = s.pan((ML + MC.right) / 2);             // the list of recording modes

  // A · the S5 comes up out of the dark, then its two numbers.
  s.bloom(0.05, 1.35, { db: -24, peak: 0.55, pan: at(1, HOME.x), label: 'S5 浮现' });
  s.hit(B.mp - 0.04, { db: -14, f: 52, tail: 1.1, pan: left, label: '2420 万像素' });
  s.thud(B.ff - 0.04, { db: -20, pan: left, label: '全画幅 CMOS' });
  s.tick(B.ff - 0.04, { f: 3200, db: -31, pan: left });

  // B · the camera pulls right back: the S5 is one of eight ~24 MP bodies. Each of the other seven
  // ticks as it comes into frame, panned where it lands.
  s.camera(B.known - 0.05, B.known + 1.0, cam, { db: -16, body: 0.4, label: '拉远：八台机身' });
  ROW.forEach((m, k) => {
    if (m.self) return;
    let t = B.known + 0.1;
    for (; t < B.known + 0.9; t += 1 / 200) {
      const p = place(cam(t), m, m.x);
      if (P(t, B.known + 0.1, B.known + 0.6, E.lin) > 0.2 && p.x + p.w > 80 && p.x < W - 80) break;
    }
    const p = place(cam(B.known + 0.9), m, m.x);
    s.tick(t, { f: 4300 - Math.abs(k - 3) * 260, db: -33, q: 4, rv: 0.2, pan: s.pan(p.x + p.w / 2), label: k ? '' : '其余七台' });
  });

  // C · into the mount: the photo's sensor glass becomes the drawn sensor; the line of sensors
  // comes in around it, then the S5 is singled out on it.
  const dive = (t0, t1, label) => s.move(t0, t1, E.inout3, { f: [300, 2400], shift: 1.5, body: 0.3, pan: [at(t0, HOME.x), at(t1, HOME.x)], db: -18, label });
  dive(B.line, B.line + 0.85, '推进卡口');
  LINE.filter((m) => !m.self).forEach((m, i) => {
    const t = B.line + 0.28 + Math.abs(LINE.indexOf(m) - 1) * 0.06;
    s.tick(t, { f: 3900 + i * 180, db: -33, q: 4, rv: 0.2, pan: at(B.line + 0.85, m.x), label: i ? '' : '像素档位' });
  });
  s.ping(B.line + 0.62, { f: 3520, db: -34, decay: 0.5, pan: at(B.line + 0.85, HOME.x) });
  s.ping(B.balance - 0.08, { f: 880, db: -24, decay: 1.4, pan: at(B.balance, HOME.x), label: '平衡线' });
  s.thud(B.balance - 0.08, { db: -23, f: 60, pan: at(B.balance, HOME.x) });

  // D · back out of the mount to the photo; the three facts tick in.
  s.move(B.photo - 0.15, B.photo + 0.6, E.inout3, { f: [280, 2000], shift: 0.62, body: 0.45, pan: [at(B.photo - 0.15, HOME.x), at(B.photo + 0.6, HOME.x)], db: -17, label: '退回照片' });
  FACTS.forEach((f, i) => s.tick(f.at - 0.04, { f: 2800 * 1.12 ** i, db: -27, double: 0.03, pan: left, label: f.label }));

  // E · not the selling point: the left column dims one step at a time and goes quiet.
  s.tick(B.px - 0.04, { f: 1500, db: -29, q: 3, body: -30, pan: left, label: '像素变暗' });
  s.tick(B.frame - 0.04, { f: 1250, db: -30, q: 3, body: -30, pan: left, label: '全画幅变暗' });
  s.drop(B.not, B.not + 0.45, { f: [110, 55], ease: E.inout3, db: -22, tail: 0.4, pan: left, label: '不是卖点' });
  s.puff(B.not, { db: -28, dur: 0.6, f: [1200, 200], pan: left });

  // F · back into the mount; every recording mode drops into the list; the crop box opens to the
  // full width; the two uncropped 4:2:2 10-bit rows light; 4:2:2 10-bit lands.
  s.swell(B.value - 0.5, B.value, { db: -29, f: [300, 1800], label: '蓄力' });
  dive(B.value, B.value + 0.7, '再次推进卡口');
  MODES.forEach((m, i) => s.tick(B.value + 0.15 + i * 0.025, { f: 4200 - i * 60, db: m.group ? -31 : -35, q: 4, rv: 0.08, pan: rows, label: i ? '' : '录制规格列表' }));
  s.tick(B.crop - 0.04, { f: 2600, db: -24, double: 0.045, pan: box, label: 'APS-C 裁切框' });
  s.thud(B.crop - 0.04, { db: -22, f: 80, pan: box });
  s.move(B.nocrop, B.nocrop + 0.4, E.inout3, { f: [500, 3600], shift: 1.3, wide: true, pan: [box, box], db: -20, label: '裁切框打开到全宽' });
  s.thud(B.nocrop + 0.36, { db: -13, f: 60, pan: box, label: '不裁切' });
  s.ping(B.c4k - 0.03, { f: 1318.5, db: -26, decay: 0.8, pan: rows, label: 'C4K' });
  s.tick(B.c4k, { f: 3000, db: -32, pan: box });
  s.ping(B.uhd - 0.03, { f: 1760, db: -26, decay: 0.8, pan: rows, label: '4K 30 帧' });
  s.tick(B.uhd, { f: 3200, db: -32, pan: box });
  s.swell(B.depth - 0.42, B.depth - 0.04, { db: -27, f: [700, 4200], pan: box });
  s.hit(B.depth - 0.04, { db: -7, f: 46, tail: 1.6, pan: box * 0.5, label: '4:2:2 10-bit' });
  s.ping(B.depth - 0.02, { f: 2637, db: -31, decay: 1.2, pan: box });
  s.scribe(B.depth - 0.03, B.depth + 0.25, { db: -34, pan: [s.pan(MC.depth), s.pan(MC.depth + 130)], label: '下划线' });
}

// ---- run ------------------------------------------------------------------------------------
S5.run({
  name: 's5-ep2',
  duration: DURATION,
  shots: [[0, DURATION, frame]],
  vo: VO,
  beats: BEATS,
  images: window.S5_CAMERAS,
  sfx,
  label: (t) => (t < B.known ? 'A 传感器' : t < B.line ? 'B 不陌生' : t < B.photo ? 'C 平衡线' : t < B.px ? 'D 够用' : t < B.value ? 'E 不是卖点' : 'F 录制规格'),
});
