"""Quick shape check: render body meshes with orthographic cameras that match
the reference photos' scale, so renders can be overlaid on the photos.

    python preview.py --npz ../build/body.npz --out ../build/preview --views front,top,back,left,right,hero
"""
import argparse
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

MM = 0.001

# camera setups: (location mm, look-at mm, ortho width mm or None, resolution)
VIEWS = {
    # front.jpg: 7.134 px/mm, mount axis at x=638, bottom at y=698
    "front": dict(loc=(-17.66, -600, 47.3), up=(0, 0, 1), ortho=1024 / 7.134, res=(1024, 721)),
    # top_lens.jpg: 7.066 px/mm, axis x=382, body front y=635 (image up = -Y)
    "top": dict(loc=(-18.4, -14.5, 600), up=(0, -1, 0), ortho=1024 / 7.066, res=(1024, 1065)),
    # back.jpg: 7.17 px/mm, axis x=377
    "back": dict(loc=(-18.8, 600, 48.0), up=(0, 0, 1), ortho=1024 / 7.17, res=(1024, 724)),
    "left": dict(loc=(600, 18, 48.5), up=(0, 0, 1), ortho=100.0, res=(700, 700)),
    "right": dict(loc=(-600, 18, 48.5), up=(0, 0, 1), ortho=100.0, res=(700, 700)),
    "hero": dict(loc=(-260, -330, 190), look=(-15, 10, 42), lens=105, res=(1024, 820)),
    "heroback": dict(loc=(150, 330, 230), look=(-15, 15, 45), lens=105, res=(1024, 820)),
}


def load_npz_mesh(path, name, mats):
    d = np.load(path)
    v, f, m = d["verts"] * MM, d["faces"], d["mat"]
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(v))
    me.vertices.foreach_set("co", v.ravel())
    me.loops.add(f.size)
    me.loops.foreach_set("vertex_index", f.ravel())
    me.polygons.add(len(f))
    me.polygons.foreach_set("loop_start", np.arange(0, f.size, 3))
    me.polygons.foreach_set("material_index", m.astype(np.int32))
    me.update(calc_edges=True)
    me.validate()
    for mt in mats:
        me.materials.append(mt)
    me.polygons.foreach_set("use_smooth", np.ones(len(f), bool))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def simple_mat(name, rgb, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m


def look_at(ob, target, up):
    """Point the object's -Z at target with `up` as image up."""
    from mathutils import Matrix
    f = (Vector(target) - ob.location).normalized()
    u = Vector(up)
    r = f.cross(u)
    if r.length < 1e-6:
        r = f.cross(Vector((0, 1, 0)))
    r.normalize()
    u2 = r.cross(f)
    ob.rotation_euler = Matrix((r, u2, -f)).transposed().to_euler()


def setup_scene(samples):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.film_transparent = False
    w = sc.world or bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.8, 0.8, 0.82, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
    for loc, e, s in (((-0.3, -0.4, 0.5), 9, 0.25), ((0.4, 0.3, 0.3), 4, 0.25)):
        ld = bpy.data.lights.new("L", "AREA")
        ld.energy = e
        ld.size = s
        lo = bpy.data.objects.new("L", ld)
        lo.location = loc
        sc.collection.objects.link(lo)
        look_at(lo, (0, 0, 0.04), (0, 0, 1))
    sc.view_settings.view_transform = "Standard"


def render_view(name, out):
    v = VIEWS[name]
    sc = bpy.context.scene
    cd = bpy.data.cameras.new(name)
    co = bpy.data.objects.new(name, cd)
    sc.collection.objects.link(co)
    co.location = Vector(v["loc"]) * MM
    cd.clip_start = 0.01
    cd.clip_end = 5
    if "ortho" in v:
        cd.type = "ORTHO"
        cd.ortho_scale = v["ortho"] * MM
        d = Vector((0, 0, 0))
        loc = Vector(v["loc"])
        # look straight along the dominant axis
        axis = max(range(3), key=lambda i: abs(loc[i]))
        tgt = loc.copy()
        tgt[axis] = 0
        look_at(co, tgt * MM, v["up"])
    else:
        cd.lens = v["lens"]
        look_at(co, Vector(v["look"]) * MM, (0, 0, 1))
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = v["res"]
    sc.render.resolution_percentage = 100
    sc.render.filepath = os.path.join(out, f"{name}.png")
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--npz", action="append", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--views", default="front,top,back,left,right,hero")
    ap.add_argument("--samples", type=int, default=12)
    a = ap.parse_args(argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(a.out, exist_ok=True)
    setup_scene(a.samples)
    mats = [simple_mat("paint", (0.32, 0.32, 0.33), 0.45), simple_mat("leather", (0.12, 0.12, 0.13), 0.8),
            simple_mat("inside", (0.6, 0.05, 0.05), 0.6)]
    for i, p in enumerate(a.npz):
        load_npz_mesh(p, f"part{i}", mats)
    for v in a.views.split(","):
        render_view(v, a.out)


if __name__ == "__main__":
    main()
