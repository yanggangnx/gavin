# usage: compare.py render.png reference.jpg out.png [mode]
# mode: blend (50/50), side (side by side), edges (reference edges in red over render)
import sys

import numpy as np
from PIL import Image, ImageFilter

r = Image.open(sys.argv[1]).convert("RGB")
f = Image.open(sys.argv[2]).convert("RGB").resize(r.size)
mode = sys.argv[4] if len(sys.argv) > 4 else "edges"
if mode == "blend":
    out = Image.blend(r, f, 0.5)
elif mode == "side":
    out = Image.new("RGB", (r.width * 2, r.height))
    out.paste(f, (0, 0))
    out.paste(r, (r.width, 0))
else:
    e = np.asarray(f.convert("L").filter(ImageFilter.FIND_EDGES), float)
    m = np.clip((e - 30) / 60, 0, 1)[..., None]
    base = np.asarray(r, float)
    out = Image.fromarray((base * (1 - m) + np.array([255, 0, 40]) * m).astype(np.uint8))
out.save(sys.argv[3])
