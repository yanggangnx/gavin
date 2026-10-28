"""Printed markings for the lens as RGBA textures (PIL), white on transparent."""
import math
import os

from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"
FONT_MED = "/usr/share/fonts/opentype/inter/Inter-Medium.otf"
WHITE = (236, 236, 236, 255)
GREY = (120, 120, 124, 255)


def _font(cap_px, path=FONT):
    return ImageFont.truetype(path, max(4, int(round(cap_px / 0.727))))


class Cyl:
    """Unwrapped cylinder: u = angle/360 (0 at +X, counter-clockwise toward +Z), v = height."""

    def __init__(self, w, h, radius, h0, h1):
        self.im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)
        self.r, self.h0, self.h1 = radius, h0, h1
        self.sx = w / (2 * math.pi * radius)        # px per mm around
        self.sy = h / (h1 - h0)                     # px per mm along the axis

    def px(self, ang_deg, hmm):
        return (ang_deg % 360) / 360 * self.im.width, (1 - (hmm - self.h0) / (self.h1 - self.h0)) * self.im.height

    def text(self, s, ang, hmm, cap_mm, fill=WHITE, path=FONT, anchor="mm"):
        """Text centred at (ang, h), reading toward increasing angle, top toward +h."""
        cap = cap_mm * self.sy
        f = _font(cap, path)
        w = int(f.getlength(s)) + 8
        tmp = Image.new("RGBA", (w, int(cap * 2.2)), (0, 0, 0, 0))
        ImageDraw.Draw(tmp).text((w / 2, tmp.height / 2), s, font=f, fill=fill, anchor="mm")
        tmp = tmp.resize((max(1, int(w * self.sx / self.sy)), tmp.height), Image.LANCZOS)
        x, y = self.px(ang, hmm)
        self.im.alpha_composite(tmp, (int(x - tmp.width / 2), int(y - tmp.height / 2)))

    def rect(self, ang0, ang1, hmm0, hmm1, fill=WHITE, radius_mm=0.0):
        x0, y1 = self.px(ang0, hmm0)
        x1, y0 = self.px(ang1, hmm1)
        self.d.rounded_rectangle((x0, y0, x1, y1), radius=radius_mm * self.sy, fill=fill)

    def save(self, path):
        self.im.save(path)


def barrel(path):
    c = Cyl(8192, 1024, 35.2, 9.8, 29.7)
    c.rect(89.6, 90.4, 15.5, 28.8)                       # zoom index line
    c.text("20-60", 121.8, 20.25, 3.4, path=FONT_MED)
    c.text("0.15m/0.49ft|min|-∞", 121.8, 16.4, 1.15, path=FONT_MED)
    # S badge: grey rounded square with a dark S knocked out
    a = 5.2 / (2 * math.pi * 35.2) * 360
    c.rect(61.2 - a / 2, 61.2 + a / 2, 15.6, 20.8, fill=(70, 70, 74, 255), radius_mm=0.8)
    c.text("S", 61.2, 18.2, 3.2, fill=(16, 16, 17, 255), path=FONT)
    c.text("AF", 7.5, 26.6, 1.3)
    c.text("MF", -7.5, 26.6, 1.3)
    c.save(path)


def scale_band(path):
    c = Cyl(8192, 256, 35.5, 29.7, 33.0)
    for s, ang in (("20", 90), ("24", 76.2), ("28", 65.3), ("35", 47), ("50", 20), ("60", -6)):
        c.text(s, ang, 31.35, 1.55, path=FONT_MED)
    c.save(path)


def front_ring(path, size=2048, half=34.0):
    """Planar texture for the front text ring, as seen from the front (+x right, +z up)."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    s = size / (2 * half)

    def arc_text(text, radius, cap, centre_deg, outward):
        f = _font(cap * s, FONT_MED)
        widths = [f.getlength(ch) / s for ch in text]
        total = sum(widths) * 1.04
        ang = centre_deg + (total / 2) / radius * 180 / math.pi * (1 if outward else -1)
        for ch, w in zip(text, widths):
            step = w * 1.04 / radius * 180 / math.pi
            mid = ang - step / 2 if outward else ang + step / 2
            g = Image.new("RGBA", (int(w * s * 2 + 8), int(cap * s * 2.6)), (0, 0, 0, 0))
            ImageDraw.Draw(g).text((g.width / 2, g.height / 2), ch, font=f, fill=WHITE, anchor="mm")
            rot = mid - 90 if outward else mid + 90
            g = g.rotate(rot, resample=Image.BICUBIC, expand=True)
            x = half + radius * math.cos(math.radians(mid))
            y = half - radius * math.sin(math.radians(mid))
            im.alpha_composite(g, (int(x * s - g.width / 2), int(y * s - g.height / 2)))
            ang = ang - step if outward else ang + step

    arc_text("LUMIX", 31.5, 2.0, 90, True)
    arc_text("S 1:3.5-5.6 / 20-60mm Φ67", 30.3, 1.6, 270, False)
    im.save(path)


def make_all(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    paths = {k: os.path.join(out_dir, f"lens_{k}.png") for k in ("barrel", "scale", "front")}
    barrel(paths["barrel"])
    scale_band(paths["scale"])
    front_ring(paths["front"])
    return paths


if __name__ == "__main__":
    import sys
    print(make_all(sys.argv[1] if len(sys.argv) > 1 else "textures"))
