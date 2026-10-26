#!/usr/bin/env python3
"""Crop single listing cards out of the Xianyu search screenshots.

Usage: python3 -I s5/tools/crop_xianyu.py

Reads s5/evidence/raw/, writes s5/evidence/xianyu/<id>.png plus contact.png.
Every card keeps its original pixels; the only change is a pixelated block over
the seller avatar (and over a seller-ID watermark where one shows), so the
redaction stays visible.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "evidence" / "raw"
OUT = ROOT / "evidence" / "xianyu"

BG = 248                 # page background (grey 248) behind every card
COLS = {"L": (13, 453), "R": (467, 907)}

# id, screenshot, column, card top (photo top), card bottom (below the seller row).
# Bounds were read off a row profile of each column; see the evidence README.
CARDS = [
    ("X01", "xianyu-2.webp", "R", 356, 1205),
    ("X02", "xianyu-2.webp", "L", 1088, 1938),
    ("X03", "xianyu-2.webp", "R", 1235, 2000),   # cut off by the screen edge, no seller row
    ("X04", "xianyu-3.webp", "L", 332, 1046),
    ("X05", "xianyu-3.webp", "L", 1076, 1934),
    ("X06", "xianyu-3.webp", "R", 344, 935),
    ("X07", "xianyu-3.webp", "R", 965, 1667),
    ("X08", "xianyu-4.webp", "L", 342, 1194),
    ("X09", "xianyu-4.webp", "R", 332, 926),
    ("X10", "xianyu-5.webp", "L", 486, 1078),
    ("X11", "xianyu-5.webp", "L", 1106, 1699),
    ("X12", "xianyu-5.webp", "R", 332, 924),
    ("X13", "xianyu-6.webp", "L", 340, 932),
    ("X14", "xianyu-6.webp", "L", 961, 1556),
    ("X15", "xianyu-6.webp", "R", 549, 1401),
]

# Extra redactions in screenshot coordinates: the seller ID printed on X09's photo.
EXTRA = {"X09": [(722, 622, 896, 654)]}


def seller_row(gray, x0, x1, bottom):
    """Rows of the bottom-most ink run: the pill with the seller avatar and location."""
    px = gray.load()

    def ink(y):
        return any(abs(px[x, y] - BG) > 3 for x in range(x0, x1, 2))

    y = bottom - 1
    while y > 0 and not ink(y):
        y -= 1
    end = y + 1
    while y > 0 and ink(y):
        y -= 1
    return y + 1, end


def pixelate(im, box, block=9):
    region = im.crop(box)
    w, h = region.size
    small = region.resize((max(1, w // block), max(1, h // block)), Image.BILINEAR)
    im.paste(small.resize((w, h), Image.NEAREST), box[:2])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    crops = []
    for cid, name, col, top, bottom in CARDS:
        im = Image.open(RAW / name).convert("RGB")
        gray = im.convert("L")
        x0, x1 = COLS[col]
        if bottom < im.height:
            p0, p1 = seller_row(gray, x0, x1, bottom)
            pixelate(im, (x0 + 12, p0, x0 + 68, p1))
        for box in EXTRA.get(cid, []):
            pixelate(im, box, block=7)
        card = im.crop((x0, top, x1 + 1, bottom))
        card.save(OUT / f"{cid}.png")
        crops.append(card)
        print(f"{cid}  {name:15s} {col}  y {top}-{bottom}  {card.size[0]}x{card.size[1]}")

    # Contact sheet for review.
    cw = 300
    thumbs = [c.resize((cw, round(c.height * cw / c.width))) for c in crops]
    ch = max(t.height for t in thumbs)
    cols = 5
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (cw + 12) + 12, rows * (ch + 12) + 12), (20, 20, 22))
    for i, t in enumerate(thumbs):
        sheet.paste(t, (12 + (i % cols) * (cw + 12), 12 + (i // cols) * (ch + 12)))
    sheet.save(OUT / "contact.png")


if __name__ == "__main__":
    main()
