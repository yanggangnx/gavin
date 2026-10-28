"""Export the camera (no lights, cameras or floor) to glTF binary and FBX.

    python export.py -- --blend ../out/S5_2060.blend --glb ../out/S5_2060.glb --fbx ../out/S5_2060.fbx
glTF keeps the PBR base values and printed textures; the procedural leather and
paint grain exist only in the .blend.
"""
import argparse
import os
import sys

import bpy


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--glb")
    ap.add_argument("--fbx")
    ap.add_argument("--decimate", type=float, default=0.5, help="body shell ratio for the exchange formats")
    a = ap.parse_args(argv)
    bpy.ops.wm.open_mainfile(filepath=a.blend)
    sc = bpy.context.scene
    keep = set(bpy.data.collections["LUMIX_S5"].all_objects)
    for ob in list(sc.objects):
        if ob not in keep:
            bpy.data.objects.remove(ob)
    for ob in sc.objects:
        ob.select_set(True)
    body = bpy.data.objects["S5_Body"]
    if a.decimate < 1:
        mod = body.modifiers.new("Decimate", "DECIMATE")
        mod.ratio = a.decimate
    if a.glb:
        kw = dict(filepath=os.path.abspath(a.glb), export_format="GLB", use_selection=True, export_apply=True,
                  export_cameras=False, export_lights=False, export_yup=True)
        try:
            bpy.ops.export_scene.gltf(export_draco_mesh_compression_enable=True,
                                      export_draco_mesh_compression_level=6, **kw)
        except Exception as e:  # Draco missing from this build
            print("draco unavailable:", e)
            bpy.ops.export_scene.gltf(**kw)
        print("glb", os.path.getsize(a.glb) / 1e6, "MB")
    if a.fbx:
        bpy.ops.export_scene.fbx(filepath=os.path.abspath(a.fbx), use_selection=True, apply_unit_scale=True,
                                 use_mesh_modifiers=True, path_mode="COPY", embed_textures=True,
                                 object_types={"EMPTY", "MESH"}, add_leaf_bones=False)
        print("fbx", os.path.getsize(a.fbx) / 1e6, "MB")


if __name__ == "__main__":
    main()
