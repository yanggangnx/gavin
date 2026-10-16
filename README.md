# 要求越多

用网页做的 9:16 竖屏动效短片（1080×1920，30 fps，18 秒），可以逐帧导出成 MP4。

> 本来就想出去玩的时候，给自己、给朋友拍点好看的照片。结果越看测评，要求越多：要全画幅，要专业视频，镜头最好也一步到位。

## 怎么用网页渲染 motion 视频

整个做法分三步：

1. **固定画布。** `#stage` 是一块 1080×1920 的画布，所有元素都按像素摆放。浏览器里预览时整体缩放，导出时 1:1 截图。
2. **每一帧都是时间的函数。** `index.html` 里的 `render(t)` 根据时间 `t`（秒）算出每个元素的位置、缩放、透明度和模糊。页面不用 CSS transition/animation，不用 `setTimeout`，胶片颗粒的随机数也带种子，所以任意一帧都能原样重现。
3. **逐帧导出。** `render.mjs` 用 Playwright 打开 `index.html?render`，对第 i 帧调用 `__motion.seek(i / fps)`，截一张图，经管道交给 ffmpeg 编码成 H.264。导出不受电脑快慢影响，慢机器只是导得慢，不会掉帧。

Remotion、Motion Canvas、GSAP（`timeline.seek(t)`）这些工具也是同一个原理，只是把 `render(t)` 换成了各自的写法。

## 快速开始

需要 Node 18+ 和 ffmpeg（macOS：`brew install ffmpeg`；Windows：`winget install ffmpeg`）。

```bash
npm install
npx playwright install chromium   # 已装 Google Chrome 可跳过，脚本会自动用它
npm run render                    # → out/yaoqiu-yueduo.mp4
```

预览：直接用浏览器打开 `index.html`，或 `npm run preview`。空格播放/暂停，← → 逐帧，Shift + ← → 跳 1 秒，右侧分镜可点击跳转。

更多导出参数：

```bash
node render.mjs --fps 60                 # 60 帧
node render.mjs --from 7 --to 10         # 只导 7–10 秒
node render.mjs --still 16.6             # 导出某一帧 PNG（做封面）
node render.mjs --crf 23                 # 文件更小（默认 18，胶片颗粒会让码率偏高）
node render.mjs --format png             # 中间帧用无损 PNG（更慢）
```

## 分镜

| 时间 | 文案 | 画面 |
| --- | --- | --- |
| 0:00 | 本来就想出去玩的时候， | 晴天，太阳升起，小相机跳出来 |
| 0:01.4 | 给自己、给朋友 | 闪光两下，拍立得弹出、慢慢显影 |
| 0:02.5 | 拍点好看的照片。 | 第三张落地，“好看的照片”划上记号 |
| 0:04.6 | 结果越看测评， | 测评视频越堆越快，计数涨到 47 条 |
| 0:07.2 | — | 快门帘幕落下，画面进入取景器 |
| 0:07.6 | 要求越多： | 网格线、电量、拍摄参数亮起 |
| 0:08.5 | 要全画幅， | 机身变大，传感器 23.5×15.6 → 36×24 mm |
| 0:10.2 | 要专业视频， | REC 开始计时，兔笼、提手、麦克风、监视器装上 |
| 0:12.2 | 镜头最好也一步到位。 | 镜头越换越大，预算条冲出画面 |
| 0:15.1 | — | 第一张照片落回画面，其余压暗 |

画面从明亮的手绘风格，逐步变成暗色的取景器界面；文案也从宋体的“心里话”，变成黑体和等宽字体的“参数表”。

## 改什么在哪

- **文案**：`index.html` 里 `#l1 #l2 #l3`（第一段）、`#lb`（测评）、`#lc #r1 #r2 #r3`（要求清单）。
- **节奏**：`render(t)` 里每个 `P(t, 开始秒数, 时长, 缓动)` 就是一段动画，改秒数即可；分镜表同步改 `#beats` 里的 `data-t`。
- **测评卡片**：`CARDS` 数组（标题、播放量、时长、配色、落点）。
- **预算和重量**：`PRICE`、`WEIGHT` 数组。画面里的价格、重量只是示意，可按你的实际清单改。
- **总时长**：`DUR`，以及滑块的 `max`。

## 加配乐或配音

导出的视频没有声音。可以在剪映里加，或者用 ffmpeg：

```bash
ffmpeg -i out/yaoqiu-yueduo.mp4 -i bgm.mp3 -c:v copy -c:a aac -shortest out/with-music.mp4
```

如果先录好配音，把每句话的起始秒数填进对应的 `P(t, …)`，画面就能对上口型和节奏。

## 文件

- `index.html`：动效本体和预览播放器（字体来自 Google Fonts，打开时需要联网）
- `render.mjs`：逐帧导出脚本
- `out/`：导出结果（不进 git）
