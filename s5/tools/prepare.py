#!/usr/bin/env python3
"""Turn the S5 reference photos into the textures the 3D scene uses.

    python3 s5/tools/prepare.py            # reads s5/ref/*.jpg, writes s5/assets/*.png

Two kinds of output:
  * print: white markings lifted from the photos (LUMIX, S5, dial symbols, button
    labels) as white-on-transparent PNGs, so they sit on the 3D surfaces and take
    the scene's lighting instead of the photo's;
  * surface: tileable normal / roughness / anisotropy maps generated from noise
    (pebble leather, paint grain, machined discs, knurling).
Needs numpy and Pillow.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
REF, OUT = ROOT / 'ref', ROOT / 'assets'
rng = np.random.default_rng(5)


def lum(img):
    a = np.asarray(img.convert('RGB'), dtype=np.float32) / 255
    return a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32), a


def smooth(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def save_rgba(alpha, name, rgb=(1, 1, 1)):
    h, w = alpha.shape
    px = np.empty((h, w, 4), np.uint8)
    px[..., :3] = (np.array(rgb) * 255).astype(np.uint8)
    px[..., 3] = (np.clip(alpha, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(px, 'RGBA').save(OUT / name)
    return px


def print_mask(photo, box, lo, hi, *, circle=None, local=None, grey=None):
    """White print inside `box` (l, t, r, b): luminance between lo..hi maps to alpha 0..1.

    circle: keep only pixels within this fraction of the half-size (drops button rims).
    local:  also require the pixel to be this much brighter than its 15 px neighbourhood
            (separates letters from machined highlights on the dials).
    grey:   reject coloured pixels whose saturation exceeds this.
    """
    crop = photo.crop(box)
    L, rgb = lum(crop)
    a = smooth(L, lo, hi)
    if local is not None:
        blur = np.asarray(crop.convert('L').filter(ImageFilter.BoxBlur(15)), np.float32) / 255
        a *= smooth(L - blur, local * 0.5, local)
    if grey is not None:
        sat = rgb.max(-1) - rgb.min(-1)
        a *= 1 - smooth(sat, grey, grey * 2)
    if circle is not None:
        h, w = L.shape
        y, x = np.mgrid[0:h, 0:w]
        r = np.hypot((x - (w - 1) / 2) / (w / 2), (y - (h - 1) / 2) / (h / 2))
        a *= 1 - smooth(r, circle - 0.04, circle)
    return a


# ---------- periodic noise helpers ----------
def blur_periodic(x, sigma):
    """Gaussian blur that wraps around, via FFT (keeps textures tileable)."""
    h, w = x.shape
    fy, fx = np.fft.fftfreq(h)[:, None], np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(x) * g))


def noise(n, sigma):
    x = blur_periodic(rng.standard_normal((n, n)), sigma)
    return (x - x.mean()) / (x.std() + 1e-8)


def normals(h, strength):
    """Tangent-space normal map (OpenGL / three.js convention, +Y = up the texture)."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    drow = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-dx, drow, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8), 'RGB')


def grey_png(x, name):
    Image.fromarray((np.clip(x, 0, 1) * 255).astype(np.uint8), 'L').save(OUT / name)


def worley(n, cells, warp):
    """F1, F2 distances (in cell units) to jittered points on a wrapping grid."""
    pts = rng.random((cells, cells, 2))
    y, x = np.mgrid[0:n, 0:n].astype(np.float32) / n * cells
    # low-frequency warp with integer frequencies so it still tiles
    k = 2 * np.pi / cells
    x += warp * (np.sin(y * k * 2 + 1.3) + 0.6 * np.sin(y * k * 5 + x * k * 3))
    y += warp * (np.sin(x * k * 3 + 0.4) + 0.6 * np.sin(x * k * 4 - y * k * 2))
    cx, cy = np.floor(x).astype(int), np.floor(y).astype(int)
    d = []
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            gx, gy = cx + ox, cy + oy
            p = pts[gy % cells, gx % cells]
            d.append(np.hypot(gx + p[..., 0] - x, gy + p[..., 1] - y))
    d = np.sort(np.stack(d, -1), -1)
    cid = (cy % cells) * cells + (cx % cells)
    return d[..., 0], d[..., 1], cid


def main():
    OUT.mkdir(exist_ok=True)
    front = Image.open(REF / 'front.jpg')
    back = Image.open(REF / 'back.jpg')
    top = Image.open(REF / 'top.jpg')
    made = []

    # ---------- print lifted from the photos ----------
    # (box in photo pixels, luminance ramp, options)
    prints = {
        'lumix.png': (front, (1050, 145, 1450, 245), .30, .62, {}),
        's5.png': (front, (1664, 458, 1792, 527), .28, .55, {}),
        'dial-mode.png': (top, (1055, 415, 1385, 745), .55, .8, {'circle': .9, 'local': .18}),
        'dial-drive.png': (top, (140, 435, 440, 735), .55, .8, {'circle': .9, 'local': .18}),
        'btn-wb.png': (top, (1478, 300, 1578, 400), .5, .75, {'circle': .62}),
        'btn-iso.png': (top, (1598, 300, 1698, 400), .5, .75, {'circle': .62}),
        'btn-ev.png': (top, (1718, 300, 1818, 400), .5, .75, {'circle': .62}),
        'top-onoff.png': (top, (1452, 630, 1545, 750), .45, .7, {}),
        'top-scmf.png': (top, (1070, 925, 1240, 980), .45, .7, {}),
        'top-plane.png': (top, (1760, 545, 1835, 595), .45, .7, {}),
        'panasonic.png': (top, (645, 990, 845, 1040), .20, .36, {}),
        'btn-play.png': (back, (197, 465, 277, 545), .45, .7, {'circle': .7}),
        'btn-lvf.png': (back, (352, 465, 432, 545), .45, .7, {'circle': .8}),
        'btn-af.png': (back, (1108, 452, 1188, 532), .45, .7, {'circle': .7}),
        'btn-afon.png': (back, (1490, 390, 1590, 490), .45, .7, {'circle': .66}),
        'btn-q.png': (back, (1470, 670, 1550, 750), .45, .7, {'circle': .7}),
        'btn-menu.png': (back, (1520, 965, 1620, 1065), .45, .7, {'circle': .74}),
        'btn-back.png': (back, (1443, 1217, 1523, 1297), .45, .7, {'circle': .7}),
        'btn-disp.png': (back, (1608, 1212, 1698, 1302), .45, .7, {'circle': .7}),
        'back-trash.png': (back, (1390, 1285, 1430, 1325), .40, .65, {}),
    }
    for name, (photo, box, lo, hi, opt) in prints.items():
        save_rgba(print_mask(photo, box, lo, hi, **opt), name)
        made.append(name)

    # LUMIX and S5 are raised chrome letters: keep a soft height so they can catch light.
    for name in ('lumix.png', 's5.png'):
        a = np.asarray(Image.open(OUT / name))[..., 3].astype(np.float32) / 255
        hgt = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.2)), np.float32) / 255
        normals(hgt, 9).save(OUT / name.replace('.png', '-n.png'))
        made.append(name.replace('.png', '-n.png'))

    # rear screen: the photo shown on the LCD
    back.crop((318, 698, 1233, 1313)).save(OUT / 'screen.jpg', quality=92)
    made.append('screen.jpg')

    # ---------- surfaces ----------
    # pebble leather: raised irregular cells with soft grooves, 512 px tile
    n = 512
    f1, f2, cid = worley(n, 26, 0.45)
    cellh = rng.random(26 * 26)[cid]
    edge = smooth(f2 - f1, 0.0, 0.32)
    h = edge * (0.7 + 0.3 * cellh) - 0.45 * f1 + 0.06 * noise(n, 1.2) + 0.12 * noise(n, 6)
    normals(h, 5.5).save(OUT / 'leather-n.png')
    grey_png(0.74 - 0.16 * edge * cellh + 0.04 * noise(n, 2), 'leather-r.png')
    made += ['leather-n.png', 'leather-r.png']

    # paint grain on the magnesium top plate: fine sand, 256 px tile
    g = 0.7 * noise(256, 0.8) + 0.3 * noise(256, 2.5)
    normals(g, 0.9).save(OUT / 'grain-n.png')
    made.append('grain-n.png')

    # machined disc: concentric grooves (normal) + radial anisotropy (direction in rg, strength in b)
    n = 512
    y, x = (np.mgrid[0:n, 0:n] + 0.5) / n * 2 - 1
    y = -y  # texture v runs up
    r, th = np.hypot(x, y), np.arctan2(y, x)
    rings = np.sin(r * 2 * np.pi * 48 + 0.6 * np.sin(th * 3)) * smooth(r, 0.02, 0.08)
    normals(rings, 1.6).save(OUT / 'disc-n.png')
    aniso = np.stack([np.cos(th) * 0.5 + 0.5, np.sin(th) * 0.5 + 0.5, smooth(r, 0.0, 0.1)], -1)
    Image.fromarray((aniso * 255).astype(np.uint8), 'RGB').resize((256, 256), Image.LANCZOS).save(OUT / 'disc-aniso.png')
    made += ['disc-n.png', 'disc-aniso.png']

    # knurling: square pyramids, one per tile (repeat it around the dial rim)
    n = 64
    v, u = (np.mgrid[0:n, 0:n] + 0.5) / n - 0.5
    pyr = 1 - 2 * np.maximum(np.abs(u), np.abs(v))
    normals(pyr, 4.0).save(OUT / 'knurl-n.png')
    # straight ridges for the front/rear command dials
    ridge = np.abs(np.sin(u * np.pi + np.pi / 2)) ** 0.6
    normals(ridge, 3.0).save(OUT / 'ridge-n.png')
    made += ['knurl-n.png', 'ridge-n.png']

    print('wrote', len(made), 'files to', OUT.relative_to(ROOT.parent))


if __name__ == '__main__':
    main()
