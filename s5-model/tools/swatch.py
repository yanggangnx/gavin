"""Render leather material variants on a curved swatch for quick look-dev.

    python swatch.py -- --out swatches.png
Each variant overrides inputs of the leather node tree built in src/mats.py.
"""
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))

import bpy  # noqa: E402

import mats as M  # noqa: E402

VARIANTS = [
    dict(scale=0.8, sub=0.3, crink=0.3, relief=0.15),
    dict(scale=0.8, sub=0.25, crink=0.4, relief=0.25),
    dict(scale=1.0, sub=0.35, crink=0.3, relief=0.2),
    dict(scale=0.7, sub=0.2, crink=0.45, relief=0.3),
]


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else "swatches.png"
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.resolution_x = sc.render.resolution_y = 600
    sc.view_settings.view_transform = "AgX"
    sc.world = bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.02
    root = bpy.data.objects.new("root", None)
    sc.collection.objects.link(root)
    root.scale = (0.001,) * 3
    bpy.ops.mesh.primitive_cylinder_add(vertices=512, radius=20, depth=30, location=(0, 0, 0))
    cyl = bpy.context.active_object
    cyl.parent = root
    bpy.ops.object.shade_smooth()
    ld = bpy.data.lights.new("key", "AREA")
    ld.size, ld.size_y = 0.6, 0.6
    ld.shape = "RECTANGLE"
    ld.energy = 6 * math.pi * 0.36
    lo = bpy.data.objects.new("key", ld)
    sc.collection.objects.link(lo)
    lo.location = (-0.35, -0.2, 0.35)
    from mathutils import Vector
    lo.rotation_euler = (Vector((0, 0, 0)) - lo.location).to_track_quat("-Z", "Y").to_euler()
    ld.energy = 10 * math.pi * 0.36
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = 0.02
    co = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(co)
    co.location = (0, -0.3, 0)
    co.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = co
    from PIL import Image
    tiles = []
    for i, v in enumerate(VARIANTS):
        M._cache.clear()
        mat = M._leather(**v)
        cyl.data.materials.clear()
        cyl.data.materials.append(mat)
        path = os.path.abspath(f"{out}.{i}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        tiles.append(Image.open(path).convert("RGB"))
    W = Image.new("RGB", (600 * len(tiles), 600))
    for i, t in enumerate(tiles):
        W.paste(t, (600 * i, 0))
    W.save(out)


if __name__ == "__main__":
    main()
