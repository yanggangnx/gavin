#!/usr/bin/env node
// Put the motion sound into the S5 storyboard pages.
//
//   node build.mjs <s5-storyboard.html> <ep2-storyboard.html> <ep3-storyboard.html> [--out out]
//
// Each page is a bundle of scripts (fonts, images, muxers, engine, episode). This keeps every bundled
// asset as it is and swaps in the files from this folder: lib/sfx.js is added, lib/stage.js and the
// episode script are replaced, and the one-take page (which has no stage.js) gets its sound controls
// in its markup. The pages carry third-party photos and screenshots, so they stay out of git; only
// the scripts here are tracked.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
let outDir = join(here, 'out');
const inputs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outDir = resolve(args[++i]);
  else inputs.push(args[i]);
}
if (!inputs.length) {
  console.error('用法：node build.mjs <s5-storyboard.html> <ep2-storyboard.html> <ep3-storyboard.html> [--out 目录]');
  process.exit(1);
}

const src = (p) => {
  const s = readFileSync(join(here, p), 'utf8');
  if (/<\/script/i.test(s)) throw new Error(`${p} 里不能出现 </script>`);
  return s;
};

function blocks(html) {
  const out = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push({ start: m.index, end: m.index + m[0].length, body: m[1] });
  return out;
}

// Replace exactly one occurrence, or stop: a page that doesn't match is not one this build knows.
function swap(html, from, to, what) {
  const n = html.split(from).length - 1;
  if (n !== 1) throw new Error(`${what}：找到 ${n} 处，应为 1 处`);
  return html.replace(from, () => to);
}

const SFX = `<script>/* lib/sfx.js */\n${src('lib/sfx.js')}</script>\n`;

const S5_MARKUP = [
  ['    <label><input type="checkbox" data-opt="mb"> 运动模糊</label>\n  </div>',
    '    <label><input type="checkbox" data-opt="mb"> 运动模糊</label>\n    <label><input type="checkbox" data-opt="sfx"> 音效</label>\n  </div>', '预览选项'],
  ['    <button id="ex-go">开始导出</button>\n    <button id="ex-cancel" hidden>取消</button>\n  </div>',
    '    <label><input type="checkbox" id="ex-audio" checked> 带音效</label>\n    <button id="ex-go">开始导出</button>\n    <button id="ex-cancel" hidden>取消</button>\n    <button id="ex-wav">只导出音效 WAV</button>\n  </div>', '导出按钮'],
  ['进剪辑软件建议用 PNG 序列，或用 render.mjs 导出 ProRes。</p>\n</div>',
    '进剪辑软件建议用 PNG 序列，或用 render.mjs 导出 ProRes。</p>\n  <p class="note">音效只有运动声，没有配乐，48 kHz 立体声。MP4 里是 AAC（浏览器不支持 AAC 编码时改用 Opus），WebM 里是 Opus；PNG 序列会在同一个文件夹（或 ZIP）里附一个 24-bit WAV。进剪辑软件建议用单独的 WAV，从第 0 帧对齐即可。</p>\n</div>', '说明文字'],
];

function build(html) {
  if (html.includes('/* lib/sfx.js */')) throw new Error('这一页已经加过音效了，请用原始文件');
  const bs = blocks(html), last = bs[bs.length - 1];
  const stage = bs.find((b) => b.body.startsWith('/* lib/stage.js */'));
  let kind;
  if (stage) {
    kind = /name: 's5-ep2'/.test(last.body) ? 'ep2' : /name: 's5-ep3'/.test(last.body) ? 'ep3' : null;
  } else if (/LUMIX S5 voice-over, ten seconds in one continuous shot/.test(last.body)) {
    kind = 's5';
  }
  if (!kind) throw new Error('认不出这是哪一集');

  // Work from the end so earlier offsets stay valid.
  let out = html.slice(0, last.start) + `<script>\n${src(`episodes/${kind}.js`)}</script>` + html.slice(last.end);
  if (stage) {
    out = out.slice(0, stage.start) + SFX + `<script>/* lib/stage.js */\n${src('lib/stage.js')}</script>` + out.slice(stage.end);
  } else {
    out = out.slice(0, last.start) + SFX + out.slice(last.start);
    for (const [from, to, what] of S5_MARKUP) out = swap(out, from, to, what);
  }
  return { kind, html: out };
}

mkdirSync(outDir, { recursive: true });
const NAMES = { s5: 's5-storyboard.html', ep2: 'ep2-storyboard.html', ep3: 'ep3-storyboard.html' };
for (const file of inputs) {
  const { kind, html } = build(readFileSync(file, 'utf8'));
  const out = join(outDir, NAMES[kind]);
  writeFileSync(out, html);
  console.log(`${basename(file)} → ${out}（${(html.length / 1048576).toFixed(1)} MB）`);
}
