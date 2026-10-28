#!/usr/bin/env bash
# Rebuild everything from the scripts: body + eyecup meshes, the .blend scene, GLB/FBX exports.
# usage: ./build.sh [python-with-bpy-numpy-scipy-skimage]
#   macOS with Blender installed: ./build.sh /Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13
#   (or: pip install bpy==5.2.3 numpy scipy scikit-image pillow, then ./build.sh python3)
set -euo pipefail
cd "$(dirname "$0")"
PY=${1:-python3}
mkdir -p build out
$PY src/body.py --h 0.25 --out build/body.npz
$PY src/body.py --part eyecup --h 0.16 --out build/eyecup.npz
$PY src/build_s5.py -- --body build/body.npz --eyecup build/eyecup.npz --out out/S5_2060.blend
$PY src/export.py -- --blend out/S5_2060.blend --glb out/S5_2060.glb --fbx out/S5_2060.fbx
