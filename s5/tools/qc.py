#!/usr/bin/env python3
"""Measure the deliverables instead of eyeballing them. Writes s5/out/qc/README.md plus images.

Usage: python3 -I s5/tools/qc.py [master.mp4] [--nograin clip.mp4]

  1. ffprobe: codec, size, frame rate, frame count, duration, colour tags
  2. levels: letterbox black, darkest and brightest picture pixel (limited range 16–235)
  3. scopes: luma waveform and histogram of a few frames
  4. banding: re-encode at a platform-like 3 Mbps and measure the longest run of identical luma
     values across a dark, otherwise empty gradient (the right half of S3, at 5.5 s). Grain should keep
     runs short; compare with a no-grain clip rendered from 5 s (render.mjs --from 5 --to 6 --grain 0).
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "out" / "qc"
STRIP = (1300, 1880)          # x range of the empty gradient right of the price in S3
ROWS = (300, 420, 540, 660, 780, 900)


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def probe(path):
    j = json.loads(run("ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
                       "-show_entries", "stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_read_frames,"
                       "color_range,color_space,color_transfer,color_primaries:format=duration,size",
                       "-of", "json", str(path)))
    s, f = j["streams"][0], j["format"]
    return {**s, "duration": float(f["duration"]), "size_mb": int(f["size"]) / 1048576}


def levels(path):
    def stats(crop):
        out = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-vf", f"crop={crop},signalstats,metadata=print",
                              "-f", "null", "-"], capture_output=True, text=True).stderr
        vals = {}
        for key in ("YMIN", "YMAX", "YAVG"):
            nums = [float(l.split("=")[1]) for l in out.splitlines() if f"signalstats.{key}=" in l]
            vals[key] = nums
        return vals
    bar = stats("1920:120:0:0")
    pic = stats("1920:800:0:140")
    return {"bar_avg": max(bar["YAVG"]), "pic_min": min(pic["YMIN"]), "pic_max": max(pic["YMAX"])}


def gray_frame(path, t, dst):
    run("ffmpeg", "-v", "error", "-ss", str(t), "-i", str(path), "-frames:v", "1", "-vf", "format=gray", "-y", str(dst))
    return Image.open(dst)


def runs(img):
    px = img.load()
    longest = []
    for y in ROWS:
        best, cur, prev = 1, 1, None
        for x in range(*STRIP):
            v = px[x, y]
            cur = cur + 1 if v == prev else 1
            best = max(best, cur)
            prev = v
        longest.append(best)
    return max(longest), sum(longest) / len(longest)


def platform(src, dst):
    run("ffmpeg", "-v", "error", "-i", str(src), "-c:v", "libx264", "-preset", "medium", "-b:v", "3M",
        "-maxrate", "3M", "-bufsize", "6M", "-pix_fmt", "yuv420p", "-y", str(dst))


def main():
    args = sys.argv[1:]
    master = (Path(args[0]) if args and not args[0].startswith("--") else ROOT / "out" / "s5.mp4").resolve()
    nograin = Path(args[args.index("--nograin") + 1]).resolve() if "--nograin" in args else None
    OUT.mkdir(parents=True, exist_ok=True)
    lines = ["# 质检报告", "", f"对象：`{master.relative_to(ROOT)}`", ""]

    files = [master] + [p for p in (ROOT / "out").glob("s5*.mov")]
    lines += ["## 1. 编码参数", "", "| 文件 | 编码 | 尺寸 | 像素格式 | 帧率 | 帧数 | 时长 | 色彩标签 | 大小 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for f in files:
        p = probe(f)
        tags = f"{p.get('color_primaries')}/{p.get('color_transfer')}/{p.get('color_space')} {p.get('color_range')}"
        lines.append(f"| {f.name} | {p['codec_name']} {p.get('profile', '')} | {p['width']}×{p['height']} | {p['pix_fmt']} | {p['r_frame_rate']} | {p['nb_read_frames']} | {p['duration']:.3f} s | {tags} | {p['size_mb']:.1f} MB |")

    lv = levels(master)
    lines += ["", "## 2. 电平（limited range，16 = 黑，235 = 白）", "",
              f"- 遮幅黑边平均亮度：{lv['bar_avg']:.0f}",
              f"- 画面最暗：{lv['pic_min']:.0f}，最亮：{lv['pic_max']:.0f}",
              "- 判定：16–235 是标准范围；EBU R103 允许编码振铃带来的小幅越界，8-bit 下为 5–246。",
              f"- 结论：{'在 16–235 之内' if lv['pic_min'] >= 16 and lv['pic_max'] <= 235 else ('略超 16–235，但在 EBU R103 容许范围 5–246 之内' if lv['pic_min'] >= 5 and lv['pic_max'] <= 246 else '超出 EBU R103 容许范围，需要处理')}", ""]

    lines += ["## 3. 示波器", ""]
    for t in (2.0, 3.9, 6.0, 9.9):
        name = f"scope-{t:.1f}s.png"
        run("ffmpeg", "-v", "error", "-ss", str(t), "-i", str(master), "-frames:v", "1", "-filter_complex",
            "[0:v]split=3[a][b][c];[a]scale=960:540[pic];[b]waveform=g=green:i=0.08:s=ire,scale=960:540[wf];"
            "[c]histogram=display_mode=overlay:level_height=160,scale=960:540[hi];[pic][wf][hi]hstack=3",
            "-y", str(OUT / name))
        lines.append(f"- {t:.1f} s：![{name}]({name})（左：画面；中：亮度波形；右：直方图）")

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        re = tmp / "platform.mp4"
        platform(master, re)
        m_run = runs(gray_frame(master, 5.5, tmp / "m.png"))
        p_run = runs(gray_frame(re, 5.5, tmp / "p.png"))
        lines += ["", "## 4. 色带（模拟平台 3 Mbps 二次压缩）", "",
                  f"取 S3（5.5 s）价格右侧的空白暗部渐变，x {STRIP[0]}–{STRIP[1]}，{len(ROWS)} 行，统计相同亮度连续像素的最长长度。数值越长，越容易看到一圈圈的色带。", "",
                  "| 版本 | 最长连续同值（像素） | 平均 |", "| --- | --- | --- |",
                  f"| 母版（有颗粒） | {m_run[0]} | {m_run[1]:.1f} |",
                  f"| 平台压缩后（有颗粒） | {p_run[0]} | {p_run[1]:.1f} |"]
        if nograin:
            re2 = tmp / "platform-nograin.mp4"
            platform(nograin, re2)
            t0 = 0.5            # the no-grain clip starts at 5 s, so this is 5.5 s too
            n_run = runs(gray_frame(nograin, t0, tmp / "n.png"))
            q_run = runs(gray_frame(re2, t0, tmp / "q.png"))
            lines += [f"| 对照：无颗粒 | {n_run[0]} | {n_run[1]:.1f} |",
                      f"| 对照：无颗粒，平台压缩后 | {q_run[0]} | {q_run[1]:.1f} |"]
        crop = (STRIP[0], 140, STRIP[1], 940)
        img = gray_frame(re, 5.5, tmp / "pc.png").crop(crop)
        img = img.point(lambda v: max(0, min(255, (v - 14) * 8)))   # stretch the dark end so steps show
        img.save(OUT / "banding-platform-stretched.png")
        lines += ["", "![平台压缩后、暗部拉伸 8 倍](banding-platform-stretched.png)（平台压缩后、暗部亮度拉伸 8 倍，色带会显成一圈圈台阶）"]

    (OUT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
