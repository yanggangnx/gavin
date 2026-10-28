"""Render checks and shots from the saved scene.

  check views on white (like the press photos), matched to the reference scale:
    python render.py -- --blend S5_2060.blend --out renders --check front,top,back,left,right,hero
  frames of the light-sweep animation:
    python render.py -- --blend S5_2060.blend --out renders --frames 1,75,150 --res 1280x720
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import preview  # noqa: E402


def press_lighting():
    sc = bpy.context.scene
    for ob in list(sc.objects):
        if ob.type == "LIGHT" or ob.name == "Floor":
            ob.hide_render = True
    w = sc.world
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = 0.55
    for name, loc, energy, size in (("Soft_Key", (-0.35, -0.45, 0.55), 22, 0.6), ("Soft_Side", (0.5, -0.1, 0.25), 9, 0.5),
                                    ("Soft_Back", (0.1, 0.6, 0.45), 9, 0.6)):
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.size = energy, size
        lo = bpy.data.objects.new(name, ld)
        sc.collection.objects.link(lo)
        lo.location = loc
        preview.look_at(lo, (0, 0, 0.04), (0, 0, 1))
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "None"


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--check", default=None)
    ap.add_argument("--frames", default=None)
    ap.add_argument("--res", default=None)
    ap.add_argument("--samples", type=int, default=None)
    ap.add_argument("--lens-off", action="store_true")
    ap.add_argument("--cam", action="append", default=[],
                    help="name:x,y,z:tx,ty,tz:lens  (mm, studio lighting at the current frame)")
    ap.add_argument("--frame", type=int, default=40)
    ap.add_argument("--lcd-open", type=float, default=0.0, help="swing the screen out by this many degrees")
    ap.add_argument("--anim", action="store_true", help="render the whole timeline into --out")
    ap.add_argument("--step", type=int, default=1)
    a = ap.parse_args(argv)
    bpy.ops.wm.open_mainfile(filepath=a.blend)
    os.makedirs(a.out, exist_ok=True)
    sc = bpy.context.scene
    if a.lens_off:
        for ob in sc.objects:
            if ob.name.startswith("Lens"):
                ob.hide_render = True
    if a.samples:
        sc.cycles.samples = a.samples
    if a.lcd_open:
        import math
        bpy.data.objects["LCD_Pivot"].rotation_euler[2] = -math.radians(a.lcd_open)
    if a.check:
        sc.timeline_markers.clear()          # markers would override the check cameras
        press_lighting()
        sc.cycles.samples = a.samples or 24
        for v in a.check.split(","):
            preview.render_view(v, a.out)
    if a.cam:
        sc.timeline_markers.clear()
        sc.frame_set(a.frame)
        if a.res:
            w, h = map(int, a.res.lower().split("x"))
            sc.render.resolution_x, sc.render.resolution_y = w, h
        for spec in a.cam:
            name, loc, tgt, lens = spec.split(":")
            cd = bpy.data.cameras.new(name)
            cd.lens = float(lens)
            cd.clip_start = 0.002
            co = bpy.data.objects.new(name, cd)
            sc.collection.objects.link(co)
            co.location = [float(v) * 0.001 for v in loc.split(",")]
            preview.look_at(co, [float(v) * 0.001 for v in tgt.split(",")], (0, 0, 1))
            sc.camera = co
            sc.render.filepath = os.path.join(a.out, f"{name}.png")
            bpy.ops.render.render(write_still=True)
    if a.anim:
        if a.res:
            w, h = map(int, a.res.lower().split("x"))
            sc.render.resolution_x, sc.render.resolution_y = w, h
        sc.frame_step = a.step
        sc.render.filepath = os.path.join(a.out, "f_")
        sc.render.image_settings.file_format = "PNG"
        bpy.ops.render.render(animation=True)
    if a.frames:
        if a.res:
            w, h = map(int, a.res.lower().split("x"))
            sc.render.resolution_x, sc.render.resolution_y = w, h
        for f in a.frames.split(","):
            sc.frame_set(int(f))
            sc.render.filepath = os.path.join(a.out, f"frame_{int(f):04d}.png")
            bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
