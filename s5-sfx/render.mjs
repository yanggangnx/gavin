#!/usr/bin/env node
// Render a built page's soundtrack to WAV and, unless --wav, the picture with it to an MP4 for review.
//
//   node render.mjs out/ep3-storyboard.html            → out/ep3-storyboard.wav + .mp4
//   node render.mjs out/ep3-storyboard.html --wav      → the WAV only
//   node render.mjs out/s5-storyboard.html --fps 24 --scale 0.5 --crf 20
//
// Opens the page in headless Chromium (the pages are single files, so file:// is fine), asks
// window.__motion for the sound, then captures every frame and pipes it to ffmpeg with the WAV.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT || '/opt/node-tools/node_modules/playwright')); }

const argv = process.argv.slice(2);
const opts = { wav: false, fps: 24, scale: 1, crf: 18 };
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--wav') opts.wav = true;
  else if (a.startsWith('--')) opts[a.slice(2)] = Number(argv[++i]);
  else files.push(a);
}
if (!files.length) { console.error('用法：node render.mjs <页面.html> [--wav] [--fps 24] [--scale 1] [--crf 18]'); process.exit(1); }

const browser = await chromium.launch();
try {
  for (const file of files) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', (e) => console.error(`页面错误：${e.message}`));
    await page.goto(`${pathToFileURL(resolve(file)).href}?render`);
    await page.waitForFunction(() => window.__motion, null, { timeout: 60000 });
    await page.evaluate(() => window.__motion.ready);
    const b64 = await page.evaluate(() => window.__motion.audio(24));
    if (!b64) throw new Error(`${file} 没有音效（不是 build.mjs 生成的页面？）`);
    const base = resolve(file).replace(/\.html$/, '');
    writeFileSync(`${base}.wav`, Buffer.from(b64, 'base64'));
    const cues = await page.evaluate(async () => (await window.__motion.sfx.ready).cues);
    writeFileSync(`${base}.cues.json`, JSON.stringify(cues, null, 1));
    console.log(`已保存 ${base}.wav（${cues.length} 个音效）`);
    if (opts.wav) { await page.close(); continue; }

    const { duration, width, height } = await page.evaluate(() => { const m = window.__motion; return { duration: m.duration, width: m.width, height: m.height }; });
    const w = Math.round(width * opts.scale / 2) * 2, h = Math.round(height * opts.scale / 2) * 2;
    const frames = Math.round(duration * opts.fps);
    const ff = spawn(process.env.FFMPEG || 'ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-c:v', 'png', '-framerate', String(opts.fps), '-i', '-',
      '-i', `${base}.wav`,
      '-map', '0:v', '-map', '1:a',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(opts.crf), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', `${base}.mp4`,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    for (let i = 0; i < frames; i++) {
      const png = await page.evaluate(([t, w, h, fps]) => window.__motion.capture(t, w, h, fps), [i / opts.fps, w, h, opts.fps]);
      if (!ff.stdin.write(Buffer.from(png, 'base64'))) await once(ff.stdin, 'drain');
      if (i % 24 === 0) process.stdout.write(`\r${file}：第 ${i + 1}/${frames} 帧   `);
    }
    ff.stdin.end();
    const [code] = await once(ff, 'close');
    if (code !== 0) throw new Error(`ffmpeg 退出码 ${code}`);
    console.log(`\n已保存 ${base}.mp4`);
    await page.close();
  }
} finally {
  await browser.close();
}
