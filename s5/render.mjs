#!/usr/bin/env node
// Render an episode page (s5/index.html by default) frame by frame: open it in headless Chromium, seek to t = i / fps,
// read the canvas as PNG and pipe it to ffmpeg. Output is tagged BT.709 so players and
// editors read the colours the same way.
//
//   node s5/render.mjs                          → s5/out/s5.mp4      H.264, 24 fps, motion blur on
//   node s5/render.mjs --format prores          → s5/out/s5.mov      ProRes 422 HQ, 10-bit, for the edit
//   node s5/render.mjs --format png             → s5/out/frames/     PNG sequence
//   node s5/render.mjs --still 8.4              → s5/out/still-8.4.png
//   node s5/render.mjs --size 3840x2160         → 4K (any size; the page redraws at that resolution)
//   node s5/render.mjs --page ep2.html          → episode 2 → s5/out/ep2.mp4
//   node s5/render.mjs --greybox --guide        → grey-box animatic with timecode and read-along
//   node s5/render.mjs --letterbox 0 --grain 0 --mb 0
//
// Needs ffmpeg on PATH (or FFMPEG=/path/to/ffmpeg) and Playwright.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const opts = { page: 'index.html', fps: 24, size: '1920x1080', out: null, still: null, from: 0, to: null, format: 'h264', crf: 14, greybox: '0', guide: '0', letterbox: '1', grain: '1', mb: '1' };
const PAGE_FLAGS = ['greybox', 'guide', 'letterbox', 'grain', 'mb'];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) continue;
  const key = m[1];
  if (!(key in opts)) {
    console.error(`未知参数 --${key}`);
    process.exit(1);
  }
  let val = m[2];
  if (val == null) val = PAGE_FLAGS.includes(key) && !/^[01]$/.test(argv[i + 1] ?? '') ? '1' : argv[++i];
  opts[key] = ['fps', 'still', 'from', 'to', 'crf'].includes(key) ? Number(val) : val;
}
if (opts.greybox === '1') opts.mb = '0';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const path = normalize(join(here, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!path.startsWith(here)) throw new Error('outside');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const query = ['render', ...PAGE_FLAGS.map((k) => `${k}=${opts[k]}`)].join('&');
const url = `http://127.0.0.1:${server.address().port}/${opts.page}?${query}`;
const stem = opts.page === 'index.html' ? 's5' : opts.page.replace(/\.html$/, '');

async function launch() {
  try {
    return await chromium.launch();
  } catch (err) {
    try {
      return await chromium.launch({ channel: 'chrome' });
    } catch {
      throw err;
    }
  }
}

function encoder(out) {
  const color = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];
  const scale = (pix) => ['-vf', `scale=out_color_matrix=bt709:out_range=tv,format=${pix}`];
  const codec = opts.format === 'prores'
    ? ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', ...scale('yuv422p10le')]
    : ['-c:v', 'libx264', '-preset', 'slow', '-crf', String(opts.crf), '-tune', 'grain', ...scale('yuv420p'), '-movflags', '+faststart'];
  const ff = spawn(process.env.FFMPEG || 'ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(opts.fps), '-i', '-',
    ...codec, ...color, '-r', String(opts.fps), out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.on('error', (err) => {
    console.error(`\n无法启动 ffmpeg：${err.message}`);
    process.exit(1);
  });
  return ff;
}

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => console.error(`页面错误：${err.message}`));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__motion, null, { timeout: 60000 });
  await page.evaluate(() => window.__motion.ready);
  const { duration } = await page.evaluate(() => ({ duration: window.__motion.duration }));
  const [w, h] = opts.size.split('x').map(Number);
  const grab = async (t) => {
    const b64 = await page.evaluate(([tt, ww, hh, fps]) => window.__motion.capture(tt, ww, hh, fps), [t, w, h, opts.fps]);
    return Buffer.from(b64, 'base64');
  };

  if (opts.still != null && !Number.isNaN(opts.still)) {
    const out = resolve(here, opts.out ?? `out/${stem}-still-${opts.still}.png`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, await grab(opts.still));
    console.log(`已保存 ${out}`);
  } else {
    const from = Math.max(0, opts.from);
    const to = Math.min(duration, opts.to ?? duration);
    const frames = Math.round((to - from) * opts.fps);
    const ext = { h264: 'mp4', prores: 'mov' }[opts.format];
    const out = resolve(here, opts.out ?? (opts.format === 'png' ? `out/${stem}-frames` : `out/${stem}.${ext}`));
    mkdirSync(opts.format === 'png' ? out : dirname(out), { recursive: true });
    const ff = opts.format === 'png' ? null : encoder(out);

    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      const t = from + i / opts.fps;
      const png = await grab(t);
      if (ff) {
        if (!ff.stdin.write(png)) await once(ff.stdin, 'drain');
      } else {
        writeFileSync(join(out, `${stem}_${String(i).padStart(4, '0')}.png`), png);
      }
      if (i % 12 === 0 || i === frames - 1) {
        const left = ((Date.now() - started) / (i + 1)) * (frames - i - 1) / 1000;
        process.stdout.write(`\r第 ${i + 1}/${frames} 帧  t=${t.toFixed(3)}s  预计还需 ${Math.ceil(left)} 秒   `);
      }
    }
    if (ff) {
      ff.stdin.end();
      const [code] = await once(ff, 'close');
      if (code !== 0) throw new Error(`ffmpeg 退出码 ${code}`);
    }
    console.log(`\n完成：${out}（${frames} 帧，${((Date.now() - started) / 1000).toFixed(1)} 秒）`);
  }
} finally {
  await browser.close();
  server.close();
}
