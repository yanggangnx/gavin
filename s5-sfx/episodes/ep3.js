'use strict';
// Episode 3 · 10 seconds, one continuous camera. 0–3 s: the S5 and the A7 IV side by side, both
// shrinking to a 1.5× crop for 4K 60p. 3–10 s: the camera drifts onto the S5 alone while its
// firmware history scrolls past, newest first, down to Ver. 2.0 and "外录 6K 12-bit RAW"; the
// S5's crop box, still there from the first beat, opens to the 5888 × 3312 RAW area.
// Sources: evidence/ep3-ledger.csv (none are cited on screen).
const { W, H, ML, C, F, lerp, E, P, makeCanvas, font, txt, rule } = S5;
const DURATION = 10;

const B = {
  crop: 0.45,      // both crop boxes shrink to 1.5×
  move: 3.0,       // camera leaves the pair for the S5 and its firmware list
  list: 3.65,      // the list comes in once the camera has nearly settled, clear of the S5
  scroll: 4.0, scrolled: 6.4,
  raw: 6.6,        // 外录 6K 12-bit RAW
};
const BEATS = [[B.crop, '4K 60p 裁切'], [B.move, '固件更新'], [B.raw, '外录 6K RAW']];

// ---- data ------------------------------------------------------------------------------------
const MM = 18;                                    // world px per millimetre
const BODIES = [                                  // C01–C03
  { name: '松下 LUMIX S5', w: 35.6, h: 23.8, x: 588, crop: 'APS-C', self: true },
  { name: '索尼 A7 IV', w: 35.9, h: 23.9, x: 1332, crop: 'Super 35' },
];
const Y0 = 520;                                    // sensors' centre line in world space
const RAW = { w: 5888, h: 3312, px: 6000 };        // C05: the RAW area is 98% of the S5's width

const FIRMWARE = [                                 // C04, condensed; newest first
  { v: '2.9', date: '2025.07.29', items: ['增强安全性，提升运行稳定性'] },
  { v: '2.8', date: '2024.10.09', items: ['装松下伸缩镜头时弹出提示'] },
  { v: '2.7', date: '2023.10.17', items: ['改善与电池手柄 DMW-BG1 的兼容性'] },
  { v: '2.6', date: '2022.08.08', items: ['修复竖拍照片回放时出现竖线'] },
  { v: '2.5', date: '2022.07.25', items: ['改善 BRAW 在达芬奇里的白平衡', '修复 DMW-RS2 录像键偶发失灵'] },
  { v: '2.4', date: '2022.01.24', items: ['修复使用蓝牙时偶发死机'] },
  { v: '2.3', date: '2021.07.13', items: ['RAW 外录支持 Blackmagic Video Assist 12G HDR', '支持 DJI RS 2 / RSC 2 跟踪'] },
  { v: '2.2', date: '2021.04.06', items: ['视频可选是否记录竖拍方向', '接 AC 电源时可用省电模式'] },
  { v: '2.0', date: '2020.11.24', items: ['外录 6K 12-bit RAW（Atomos Ninja V，ProRes RAW）', '新增 C4K 录制模式', '对焦性能提升'], key: 0 },
];

// ---- camera ----------------------------------------------------------------------------------
const CAM = [                                      // [time, centre x, centre y, zoom]
  [0, 960, Y0, 1.0],
  [B.move, 960, Y0, 1.04],
  [B.move + 0.85, 10, 560, 0.85],                  // drift right onto the S5; the A7 IV leaves the frame
  [DURATION, 0, 560, 0.9],
];
function cam(t) {
  let i = 0;
  while (i < CAM.length - 2 && t >= CAM[i + 1][0]) i++;
  const [t0, x0, y0, z0] = CAM[i], [t1, x1, y1, z1] = CAM[i + 1];
  const p = E.inout3(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
  return { x: lerp(x0, x1, p), y: lerp(y0, y1, p), z: Math.exp(lerp(Math.log(z0), Math.log(z1), p)) };
}
const scr = (k, wx, wy) => ({ x: W / 2 + (wx - k.x) * k.z, y: H / 2 + (wy - k.y) * k.z });

function sensorRect(k, b) {
  const s = scr(k, b.x - (b.w * MM) / 2, Y0 - (b.h * MM) / 2);
  return { x: s.x, y: s.y, w: b.w * MM * k.z, h: b.h * MM * k.z };
}

// ---- the list, scrolled inside a soft-edged window ---------------------------------------------
const LIST = { x: 140, y: 230, w: 1000, h: 690, fade: 56 };
const ENTRY_H = (e) => Math.max(82, 32 + e.items.length * 34 + 16);
const LIST_H = FIRMWARE.reduce((s, e) => s + ENTRY_H(e), 0);
const LIST_BUF = makeCanvas(8, 8);

function masked(c, box, draw) {
  const m = c.getTransform(), k = Math.hypot(m.a, m.b);
  const bw = Math.ceil(box.w * k), bh = Math.ceil(box.h * k);
  if (LIST_BUF.width !== bw || LIST_BUF.height !== bh) { LIST_BUF.width = bw; LIST_BUF.height = bh; }
  const b = LIST_BUF.getContext('2d');
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.clearRect(0, 0, bw, bh);
  b.setTransform(k, 0, 0, k, -box.x * k, -box.y * k);
  draw(b);
  b.setTransform(1, 0, 0, 1, 0, 0);
  const g = b.createLinearGradient(0, 0, 0, bh), f = box.fade / box.h;
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(f, '#000'); g.addColorStop(1 - f, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
  b.globalCompositeOperation = 'destination-in';
  b.fillStyle = g; b.fillRect(0, 0, bw, bh);
  b.globalCompositeOperation = 'source-over';
  c.drawImage(LIST_BUF, 0, 0, bw, bh, box.x, box.y, box.w, box.h);
}

function firmware(c, t) {
  const enter = P(t, B.list, B.list + 0.6, E.out3);
  if (enter <= 0) return;
  const scroll = (LIST_H - LIST.h + 44) * P(t, B.scroll, B.scrolled, E.inout3);
  const hl = P(t, B.raw - 0.05, B.raw + 0.25);
  masked(c, LIST, (b) => {
    let y = LIST.y + 24 + (1 - enter) * 90 - scroll;
    FIRMWARE.forEach((e) => {
      const key = e.key != null;
      const dim = lerp(1, key ? 1 : 0.28, hl);
      txt(b, e.v, ML, y + 34, { family: F.serif, size: 34, weight: 600, alpha: enter * dim });
      txt(b, e.date, ML, y + 62, { size: 17, color: C.ink3, alpha: enter * dim });
      e.items.forEach((s, j) => {
        const on = key && j === e.key;
        const a = enter * (on ? 1 : dim * (key ? lerp(1, 0.55, hl) : 1));
        txt(b, s, 330, y + 32 + j * 34, { size: 22, weight: on ? 500 : 400, color: on ? C.ink : C.ink2, alpha: a });
        if (on && hl > 0) {
          font(b, 22, 500, F.sans);
          rule(b, 330, 330 + b.measureText(s).width, y + 40 + j * 34, hl, C.ink);
        }
      });
      y += ENTRY_H(e);
      rule(b, ML, LIST.x + LIST.w - 20, y - 12, enter * 0.6 * dim);
    });
  });
}

// ---- the frame ------------------------------------------------------------------------------
function frame(c, u, t) {
  const k = cam(t);
  const shrink = P(t, B.crop, B.crop + 0.75, E.inout3);
  const open = P(t, B.raw + 0.35, B.raw + 1.0, E.inout3);
  const crop = 1 / 1.5;

  BODIES.forEach((b) => {
    const r = sensorRect(k, b);
    const alpha = b.self ? 1 : 1 - P(t, B.move + 0.3, B.move + 0.8, E.lin);
    if (alpha <= 0) return;
    c.save();
    c.globalAlpha *= alpha;
    c.strokeStyle = C.ink2; c.lineWidth = 1.5;
    const perim = 2 * (r.w + r.h), draw = P(t, 0.02, 0.4, E.inout3);
    if (draw < 1) c.setLineDash([perim * draw, perim]);
    c.strokeRect(r.x, r.y, r.w, r.h);
    c.restore();

    // The 16:9 recording area: full width, then the 1.5× crop for 4K 60p; on the S5 it later
    // opens to the 5888 × 3312 RAW area.
    const ratio = b.self ? lerp(lerp(1, crop, shrink), RAW.w / RAW.px, open) : lerp(1, crop, shrink);
    const bw = r.w * ratio, bh = bw * 9 / 16;
    const bx = r.x + (r.w - bw) / 2, by = r.y + (r.h - bh) / 2;
    const boxA = alpha * P(t, 0.25, 0.45, E.lin);
    c.save();
    c.globalAlpha *= boxA;
    c.fillStyle = 'rgba(236,235,230,0.06)'; c.fillRect(bx, by, bw, bh);
    c.strokeStyle = C.ink; c.lineWidth = 2; c.strokeRect(bx, by, bw, bh);
    c.restore();
    const labelSize = 20 * Math.min(1, k.z * 1.05);
    const to60 = P(t, B.crop + 0.25, B.crop + 0.45, E.lin);
    txt(c, '4K 30p：全宽', bx + 16, by + 32, { size: labelSize, color: C.ink2, alpha: boxA * (1 - to60) });
    txt(c, '4K 60p', bx + 16, by + 32, { size: labelSize, color: C.ink2, alpha: boxA * to60 * (b.self ? 1 - P(t, B.raw + 0.3, B.raw + 0.5, E.lin) : 1) });
    if (b.self) txt(c, `RAW  ${RAW.w} × ${RAW.h}  12-bit`, bx + 16, by + 32, { size: labelSize, color: C.ink, alpha: P(t, B.raw + 0.7, B.raw + 1.0, E.lin) });

    // Names above, the crop below; they travel with the sensors.
    txt(c, b.name, r.x + r.w / 2, r.y - 24, { size: 24, color: b.self ? C.ink : C.ink2, align: 'center', alpha: alpha * P(t, 0.05, 0.3, E.lin) });
    const cropA = alpha * P(t, B.crop + 0.5, B.crop + 0.8, E.lin) * (b.self ? 1 - P(t, B.move, B.move + 0.4, E.lin) : 1);
    txt(c, '约 1.5× 裁切', r.x + r.w / 2, r.y + r.h + 66, { family: F.serif, size: 40, weight: 600, align: 'center', alpha: cropA });
    txt(c, `4K 60p 用 ${b.crop} 区域`, r.x + r.w / 2, r.y + r.h + 102, { size: 20, color: C.ink3, align: 'center', alpha: cropA });

    if (b.self) {
      const call = P(t, B.raw + 0.6, B.raw + 1.0, E.out3);
      txt(c, '外录 6K 12-bit RAW', r.x + r.w / 2, r.y + r.h + 86 + (1 - call) * 12, { family: F.serif, size: 54, weight: 700, align: 'center', alpha: call });
      txt(c, `5.9K · ${RAW.w} × ${RAW.h} · 固件 2.0 起`, r.x + r.w / 2, r.y + r.h + 124, { size: 20, color: C.ink3, align: 'center', alpha: call });
    }
  });

  txt(c, '4K 60p 的录制区域', ML, 200, { size: 26, color: C.ink2, alpha: P(t, 0.05, 0.3, E.lin) * (1 - P(t, B.move, B.move + 0.3, E.lin)) });
  txt(c, '松下 LUMIX S5 固件更新记录', ML, 200, { size: 26, color: C.ink2, alpha: P(t, B.move + 0.25, B.move + 0.6, E.lin) * lerp(1, 0.5, P(t, B.raw, B.raw + 0.3)) });
  firmware(c, t);
}

// ---- run ------------------------------------------------------------------------------------
S5.run({
  name: 's5-ep3',
  duration: DURATION,
  shots: [[0, DURATION, frame]],
  vo: [],
  beats: BEATS,
  label: (t) => (t < B.move ? 'A 4K 60p 裁切' : 'B 固件更新'),
});
