"""Assemble the LUMIX S5 + 20-60mm scene and save it.

    python build_s5.py -- --body ../build/body.npz --eyecup ../build/eyecup.npz --out ../out/S5_2060.blend
(run with Blender's Python: `blender -b -P build_s5.py -- ...` or a Python with the bpy module)
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import parts_body as PB  # noqa: E402
import parts_lens as PL  # noqa: E402
import prints  # noqa: E402
import scene as S  # noqa: E402


def decimate(ob, ratio, planar_deg=None):
    """Collapse decimation, or planar dissolve (keeps curvature, merges flats)."""
    mod = ob.modifiers.new("Decimate", "DECIMATE")
    if planar_deg:
        import math
        mod.decimate_type = "DISSOLVE"
        mod.angle_limit = math.radians(planar_deg)
        mod.delimit = {"MATERIAL"}
    else:
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.remove(mod)
    ob.data = me
    me.name = old.name
    bpy.data.meshes.remove(old)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--body", required=True)
    ap.add_argument("--eyecup", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tex", default=None)
    ap.add_argument("--decimate", type=float, default=1.0)
    ap.add_argument("--planar", type=float, default=0.0, help="planar dissolve angle in degrees, 0 = off")
    ap.add_argument("--no-scene", action="store_true")
    a = ap.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.length_unit = "MILLIMETERS"
    out_dir = os.path.dirname(os.path.abspath(a.out))
    os.makedirs(out_dir, exist_ok=True)
    tex = prints.make_all(a.tex or os.path.join(out_dir, "textures"))

    coll = bpy.data.collections.new("LUMIX_S5")
    sc.collection.children.link(coll)
    root = bpy.data.objects.new("S5_Root", None)
    coll.objects.link(root)
    root.scale = (0.001, 0.001, 0.001)
    root.empty_display_size = 60
    c = PB.Ctx(root, coll)

    body = PB.shell(c, a.body)
    if a.planar:
        decimate(body, 1.0, a.planar)
        # big planar n-gons next to fillets need face-weighted normals to shade flat
        wn = body.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
        wn.mode = "FACE_AREA"
        wn.weight = 100
        wn.keep_sharp = True
        tri = body.modifiers.new("Triangulate", "TRIANGULATE")
        tri.quad_method = "BEAUTY"
        tri.ngon_method = "BEAUTY"
        tri.keep_custom_normals = True
        body.modifiers.move(1, 0)
    elif a.decimate < 1:
        decimate(body, a.decimate)
    PB.eyecup(c, a.eyecup)
    PB.mode_dial(c)
    PB.drive_dial(c)
    PB.front_dial_and_shutter(c)
    PB.rear_dial(c)
    PB.top_buttons(c)
    PB.front_buttons(c)
    PB.back_buttons(c)
    PB.mount(c)
    PB.hot_shoe(c)
    PB.lcd(c)
    PB.lugs(c)
    PB.doors(c)
    PL.build(c, tex)

    if not a.no_scene:
        S.world_and_floor()
        L = S.lights()
        S.animate(L, *S.focus_targets())
        S.render_settings()
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.out), compress=True)
    n = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print(f"saved {a.out}: {len(bpy.data.objects)} objects, {n} faces")


if __name__ == "__main__":
    main()
