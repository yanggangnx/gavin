#!/usr/bin/env python3
"""Cut a product shot off its white background, for the S5 storyboard.

    python3 s5/tools/cutout.py s5-front.jpg s5/out/s5-photo.png --js s5/out/s5-photo.js

Writes a trimmed, transparent PNG and, with --js, the same image as
`window.S5_PHOTO = "data:image/png;base64,..."` for the page to load.

How: the background is whatever is close to the border colour *and* connected
to the border, so white inside the body (LUMIX lettering, highlights on the
mount) stays. Edges get a soft alpha from how far each pixel is from the
background, and the background is un-mixed from edge colours so no white rim
shows on a dark stage. A soft drop shadow lighter than --tol goes with the
background; raise --tol if a shadow is left attached under the body.

Needs Pillow and numpy.
"""
import argparse
import base64
import io

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def cutout(im, tol=40, soft=60, max_width=1600):
    rgb = np.asarray(im.convert('RGB'), dtype=np.float32)
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    # How much darker than the background each pixel is, in its darkest channel.
    dist = np.clip(bg[None, None, :] - rgb, 0, None).max(axis=2)

    # Background = near-background pixels connected to the border. Flood fill on a small copy.
    scale = min(1.0, 900 / max(w, h))
    sw, sh = max(1, round(w * scale)), max(1, round(h * scale))
    near = Image.fromarray(((dist < tol) * 255).astype(np.uint8)).resize((sw, sh), Image.NEAREST)
    fill = near.copy()
    for x, y in [(i, 0) for i in range(0, sw, 8)] + [(i, sh - 1) for i in range(0, sw, 8)] + \
                [(0, j) for j in range(0, sh, 8)] + [(sw - 1, j) for j in range(0, sh, 8)]:
        if fill.getpixel((x, y)) == 255:
            ImageDraw.floodfill(fill, (x, y), 128)
    bgmask = Image.fromarray(((np.asarray(fill) == 128) * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR)
    bgmask = np.asarray(bgmask, dtype=np.float32) / 255

    # Solid inside, clear outside, and a soft edge in a band around the boundary.
    band = max(3, round(4 / scale))
    m = Image.fromarray((bgmask * 255).astype(np.uint8))
    sure_bg = np.asarray(m.filter(ImageFilter.MinFilter(2 * band + 1)), dtype=np.float32) / 255 > 0.5
    sure_fg = np.asarray(m.filter(ImageFilter.MaxFilter(2 * band + 1)), dtype=np.float32) / 255 < 0.5
    alpha = np.clip((dist - tol * 0.25) / (soft - tol * 0.25), 0, 1)
    alpha[sure_bg] = 0
    alpha[sure_fg] = 1

    # Un-mix the background from the edge pixels: observed = a * colour + (1 - a) * bg.
    a = np.maximum(alpha, 1e-3)[..., None]
    col = np.clip((rgb - (1 - a) * bg[None, None, :]) / a, 0, 255)
    out = np.dstack([col, alpha * 255]).astype(np.uint8)
    res = Image.fromarray(out, 'RGBA')

    box = res.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if box:
        pad = 2
        res = res.crop((max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + pad)))
    if res.width > max_width:
        res = res.resize((max_width, round(res.height * max_width / res.width)), Image.LANCZOS)
    return res


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('src')
    ap.add_argument('out', help='transparent PNG')
    ap.add_argument('--js', help='also write window.S5_PHOTO = "data:..." here')
    ap.add_argument('--tol', type=float, default=40, help='how far from the background still counts as background (0-255)')
    ap.add_argument('--soft', type=float, default=60, help='distance at which an edge pixel is fully opaque')
    ap.add_argument('--max-width', type=int, default=1600)
    args = ap.parse_args()
    res = cutout(Image.open(args.src), args.tol, args.soft, args.max_width)
    res.save(args.out, optimize=True)
    if args.js:
        buf = io.BytesIO()
        res.save(buf, 'PNG', optimize=True)
        with open(args.js, 'w', encoding='utf-8') as f:
            f.write('window.S5_PHOTO = "data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode() + '";\n')
    print(f'{args.out}: {res.width}×{res.height}')


if __name__ == '__main__':
    main()
