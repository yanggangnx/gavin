#!/usr/bin/env python3
"""Bundle a Beni page, its frame file and the MP4 muxer into one self-contained HTML file.

    python3 beni/tools/build_single.py                       # index.html + frames.js -> out/beni-overview.html
    python3 beni/tools/build_single.py imaging               # imaging.html + imaging-frames.js -> out/beni-imaging.html

The result opens with a double-click and can export MP4 without a server. Only the fonts
(Google Fonts) need a network connection; without it the page falls back to system fonts.
"""
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
beni = os.path.dirname(here)
PAGES = {
    'overview': ('index.html', 'frames.js', 'beni-overview.html'),
    'imaging': ('imaging.html', 'imaging-frames.js', 'beni-imaging.html'),
}
which = sys.argv[1] if len(sys.argv) > 1 else 'overview'
page, frames_file, out_name = PAGES[which]
out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(beni), 'out', out_name)


def read(*p):
    with open(os.path.join(beni, *p), encoding='utf-8') as f:
        return f.read()


html = read(page)
muxer = read('vendor', 'mp4-muxer.js')
frames = read(frames_file)
lic = read('vendor', 'mp4-muxer.LICENSE').strip().splitlines()
tag = '<script src="vendor/mp4-muxer.js"></script>'
assert html.count(tag) == 1, 'muxer script tag not found'
for name, body in (('mp4-muxer.js', muxer), (frames_file, frames)):
    assert '</script' not in body, name + ' contains </script'
inline = ('<script>\n/* mp4-muxer 5.1.3 — %s · %s */\n%s\n</script>\n<script>\n%s\n</script>' % (lic[0], lic[2], muxer, frames))
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    f.write(html.replace(tag, inline))
print('%s (%.1f MB)' % (out, os.path.getsize(out) / 1e6))
