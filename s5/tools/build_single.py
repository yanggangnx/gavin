#!/usr/bin/env python3
"""Inline every script into one HTML file you can hand over and open with a double click.

Usage: python3 -I s5/tools/build_single.py [page.html]
  index.html (default) → s5/out/s5-storyboard.html
  ep2.html             → s5/out/ep2-storyboard.html
  ep3.html             → s5/out/ep3-storyboard.html
  ep4.html             → s5/out/ep4-storyboard.html
  ep5.html             → s5/out/ep5-storyboard.html

Fonts, listing cards, the engine and the muxers are all inlined, so the file works offline.
Episodes 1 and 2 contain third-party images (build/cards.js, build/cameras.js), so output lands
in out/ and stays out of git.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    page = sys.argv[1] if len(sys.argv) > 1 else "index.html"
    stem = "s5" if page == "index.html" else Path(page).stem
    html = (ROOT / page).read_text(encoding="utf-8")

    def inline(m):
        src = ROOT / m.group(1)
        if not src.exists():
            raise SystemExit(f"缺少 {src.relative_to(ROOT)}：先运行 build_assets.py")
        body = src.read_text(encoding="utf-8")
        if "</script" in body.lower():
            raise SystemExit(f"{src.name} 里有 </script>，不能直接内联")
        return f"<script>/* {m.group(1)} */\n{body}\n</script>"

    out = re.sub(r'<script src="([^"]+)"></script>', inline, html)
    dst = ROOT / "out" / f"{stem}-storyboard.html"
    dst.parent.mkdir(exist_ok=True)
    dst.write_text(out, encoding="utf-8")
    print(f"{dst.relative_to(ROOT.parent)}：{dst.stat().st_size / 1048576:.1f} MB")


if __name__ == "__main__":
    main()
