#!/usr/bin/env bash
# Stills for the three shots, a press-style hero on white, and a low-res preview of the animation.
# usage: tools/render_all.sh <python-with-bpy>
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${1:-python3}
B=out/S5_2060.blend
mkdir -p renders/anim
$PY src/render.py -- --blend $B --out renders/tmp --frames 75,205,335 --res 1920x1080 --samples 128
mv renders/tmp/frame_0075.png renders/shot1_hero.png
mv renders/tmp/frame_0205.png renders/shot2_lens.png
mv renders/tmp/frame_0335.png renders/shot3_top.png
$PY src/render.py -- --blend $B --out renders/tmp --check hero,heroback,front,top --samples 64
for v in hero heroback front top; do mv renders/tmp/$v.png renders/press_$v.png; done
$PY src/render.py -- --blend $B --out renders/anim --anim --res 640x360 --samples 24
ffmpeg -y -loglevel error -framerate 30 -i renders/anim/f_%04d.png -c:v libx264 -pix_fmt yuv420p -crf 18 \
  renders/S5_lightsweep_preview.mp4
rm -rf renders/tmp renders/anim
echo done
