#!/usr/bin/env node
// Render index.html to an MP4, one frame at a time:
// serve this folder over HTTP, open the page in headless Chromium, seek the
// timeline to t = i / fps, screenshot the stage, and pipe the images into ffmpeg.
//
//   node render.mjs                         → out/yaoqiu-yueduo.mp4 (30 fps)
//   node render.mjs --fps 60 --out a.mp4    → 60 fps to a.mp4
//   node render.mjs --from 9 --to 12        → render only 9s–12s
//   node render.mjs --still 19.6            → one PNG of the frame at 19.6s
//   node render.mjs --format png            → lossless PNG frames (slower; default is JPEG q95)
//
// Needs ffmpeg on PATH (or set FFMPEG=/path/to/ffmpeg).

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const opts = { fps: 30, out: null, still: null, from: 0, to: null, crf: 18, format: 'jpeg', page: 'index.html' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const m = argv[i].match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) continue;
  const key = m[1];
  const val = m[2] ?? argv[++i];
  if (!(key in opts)) {
    console.error(`未知参数 --${key}`);
    process.exit(1);
  }
  opts[key] = ['fps', 'still', 'from', 'to', 'crf'].includes(key) ? Number(val) : val;
}

// ES modules (three.js) do not load from file://, so serve the folder locally.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css' };
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
const base = `http://127.0.0.1:${server.address().port}/`;

async function launch() {
  const args = [
    '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', // software WebGL when there is no GPU (servers, CI)
  ];
  // Fonts come from Google Fonts; send that through HTTPS_PROXY if one is set, but keep the local server direct.
  if (process.env.HTTPS_PROXY) args.push(`--proxy-server=${process.env.HTTPS_PROXY}`, '--proxy-bypass-list=127.0.0.1;localhost');
  try {
    return await chromium.launch({ args });
  } catch (err) {
    // No Playwright browser downloaded? Fall back to the installed Google Chrome.
    try {
      return await chromium.launch({ channel: 'chrome', args });
    } catch {
      throw err;
    }
  }
}

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => console.error(`页面错误：${err.message}`));
  await page.goto(`${base}${opts.page}?render`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__motion, null, { timeout: 60000 });
  await page.evaluate(() => window.__motion.ready);
  const { duration, width, height } = await page.evaluate(() => {
    const m = window.__motion;
    return { duration: m.duration, width: m.width, height: m.height };
  });
  await page.setViewportSize({ width, height });

  if (opts.still != null && !Number.isNaN(opts.still)) {
    const out = resolve(here, opts.out ?? `out/still-${opts.still}.png`);
    mkdirSync(dirname(out), { recursive: true });
    await page.evaluate((t) => window.__motion.seek(t), opts.still);
    writeFileSync(out, await page.screenshot({ type: 'png' }));
    console.log(`已保存 ${out}`);
  } else {
    const out = resolve(here, opts.out ?? 'out/yaoqiu-yueduo.mp4');
    mkdirSync(dirname(out), { recursive: true });
    const from = Math.max(0, opts.from);
    const to = Math.min(duration, opts.to ?? duration);
    const frames = Math.round((to - from) * opts.fps);
    const png = opts.format === 'png';
    // In render mode the stage sits at 0,0 and fills the viewport, so a page shot is the frame.
    const shoot = () => page.screenshot(png ? { type: 'png' } : { type: 'jpeg', quality: 95 });

    const ffmpeg = spawn(process.env.FFMPEG || 'ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-c:v', png ? 'png' : 'mjpeg', '-framerate', String(opts.fps), '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(opts.crf), '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', out,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    ffmpeg.on('error', (err) => {
      console.error(`\n无法启动 ffmpeg：${err.message}。请先安装 ffmpeg，或用 FFMPEG=/路径/ffmpeg 指定。`);
      process.exit(1);
    });

    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      const t = from + i / opts.fps;
      await page.evaluate((tt) => window.__motion.seek(tt), t);
      if (!ffmpeg.stdin.write(await shoot())) await once(ffmpeg.stdin, 'drain');
      if (i % 10 === 0 || i === frames - 1) {
        const left = ((Date.now() - started) / (i + 1)) * (frames - i - 1) / 1000;
        process.stdout.write(`\r第 ${i + 1}/${frames} 帧  t=${t.toFixed(2)}s  预计还需 ${Math.ceil(left)} 秒   `);
      }
    }
    ffmpeg.stdin.end();
    const [code] = await once(ffmpeg, 'close');
    if (code !== 0) throw new Error(`ffmpeg 退出码 ${code}`);
    console.log(`\n完成：${out}（${frames} 帧，${((Date.now() - started) / 1000).toFixed(1)} 秒）`);
  }
} finally {
  await browser.close();
  server.close();
}
